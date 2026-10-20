// SSERecord is one parsed SSE record: the event name and its data payload.
export interface SSERecord {
  event: string;
  data: string;
}

// The scanner caps one line at 16 MiB, the same limit Go's bufio.Scanner
// applies, so a single oversized line is a stream failure rather than an
// unbounded allocation.
const MAX_LINE_BYTES = 16 * 1024 * 1024;

export class SSELineTooLongError extends Error {
  constructor() {
    super("upstream SSE line exceeds the 16 MiB limit");
  }
}

// SSEReader reads SSE records from a byte stream. It is line based: a record
// ends on a blank line, a line starting with a colon is a comment and does not
// end a record, and a trailing record without its blank line is dropped.
export class SSEReader {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");
  private readonly encoder = new TextEncoder();
  private eventName = "";
  private dataLines: string[] = [];
  private sawData = false;
  private closed = false;

  // push feeds bytes into the reader and returns the records that became
  // complete. Bytes are decoded as a stream so a character split across two
  // pushes is not corrupted.
  push(chunk: Uint8Array): SSERecord[] {
    if (this.closed) {
      return [];
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  // close flushes the decoder and reports that the stream ended. A record that
  // was never terminated by a blank line is dropped, and the caller is told the
  // stream ended unexpectedly.
  close(): { records: SSERecord[]; truncated: boolean } {
    if (this.closed) {
      return { records: [], truncated: false };
    }
    this.closed = true;
    const tail = this.decoder.decode();
    if (tail !== "") {
      this.buffer += tail;
    }
    const records = this.drain(false);
    return { records, truncated: this.sawData };
  }

  private drain(final: boolean): SSERecord[] {
    const records: SSERecord[] = [];
    for (;;) {
      const boundary = this.nextLineBoundary();
      if (boundary === undefined) {
        break;
      }
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      const record = this.consumeLine(line);
      if (record !== undefined) {
        records.push(record);
      }
    }
    if (final && this.buffer !== "") {
      this.buffer = "";
    }
    return records;
  }

  // nextLineBoundary returns the index of the next newline, or undefined when
  // the buffer holds no complete line yet.
  private nextLineBoundary(): number | undefined {
    const index = this.buffer.indexOf("\n");
    return index === -1 ? undefined : index;
  }

  // consumeLine applies one line of the SSE grammar and returns a record when
  // the line closes one.
  private consumeLine(raw: string): SSERecord | undefined {
    if (this.encoder.encode(raw).length > MAX_LINE_BYTES) {
      throw new SSELineTooLongError();
    }
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      if (!this.sawData) {
        // A record without a data line is not delivered.
        this.eventName = "";
        this.dataLines = [];
        return undefined;
      }
      const record: SSERecord = {
        event: this.eventName,
        data: this.dataLines.join("\n"),
      };
      this.eventName = "";
      this.dataLines = [];
      this.sawData = false;
      return record;
    }
    if (line.startsWith(":")) {
      return undefined;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.eventName = value.trim();
        break;
      case "data":
        this.dataLines.push(value.trim());
        this.sawData = true;
        break;
      default:
        break;
    }
    return undefined;
  }
}

// nextSSEBoundary returns the end index of the first complete SSE frame in
// buffer, preferring whichever of the two line endings comes first. A frame
// ends at the blank line that follows it.
export function nextSSEBoundary(buffer: string): number | undefined {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) {
    return undefined;
  }
  if (lf === -1) {
    return crlf + 4;
  }
  if (crlf === -1) {
    return lf + 2;
  }
  return Math.min(lf + 2, crlf + 4);
}
