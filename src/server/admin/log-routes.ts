import type { IncomingMessage, ServerResponse } from "node:http";
import { writeAdminJSON } from "./responses.js";
import type { WebUIServer } from "./server.js";

// The number of events the log stream replays.
const REPLAY_LIMIT = 2000;

// The interval the log stream sends a keepalive at.
const KEEPALIVE_MS = 20_000;

// handleLogs answers with the recent log events.
export function handleLogs(
  server: WebUIServer,
  response: ServerResponse,
  url: URL,
): void {
  const after = parseUint(url.searchParams.get("after") ?? "");
  const limit = parseInt(url.searchParams.get("limit") ?? "");
  const result = server.gateway.logs.recent(after, limit);
  writeAdminJSON(response, 200, { events: result.events, gap: result.gap });
}

// handleLogStream relays the live log events. The cursor comes from the
// Last-Event-ID header, which the browser resends on a reconnect, or from the
// after query parameter.
export function handleLogStream(
  server: WebUIServer,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): void {
  const header = request.headers["last-event-id"];
  let cursor = parseUint(typeof header === "string" ? header : "");
  const query = parseUint(url.searchParams.get("after") ?? "");
  if (query > cursor) {
    cursor = query;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    "X-Accel-Buffering": "no",
  });
  const replay = server.gateway.logs.recent(cursor, REPLAY_LIMIT);
  if (replay.gap) {
    response.write(
      `event: gap\ndata: ${JSON.stringify({
        message: "older log events have expired",
      })}\n\n`,
    );
  }
  for (const event of replay.events) {
    cursor = event.sequence;
    response.write(
      `id: ${event.sequence}\nevent: log\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
  const unsubscribe = server.gateway.logs.subscribe((event) => {
    if (cursor > 0 && event.sequence > cursor + 1) {
      response.write(
        `event: gap\ndata: ${JSON.stringify({
          message: "slow client missed log events",
          after: cursor,
          next: event.sequence,
        })}\n\n`,
      );
    }
    cursor = event.sequence;
    response.write(
      `id: ${event.sequence}\nevent: log\ndata: ${JSON.stringify(event)}\n\n`,
    );
  });
  const keepalive = setInterval(() => {
    // The session is re-validated before every keepalive, because nothing
    // re-authenticates the stream in the middle of its life.
    if (server.validSession(request) === undefined) {
      clearInterval(keepalive);
      unsubscribe();
      response.end();
      return;
    }
    response.write(": keepalive\n\n");
  }, KEEPALIVE_MS);
  keepalive.unref?.();
  request.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
}

// parseUint reads an unsigned integer, ignoring a parse error.
function parseUint(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

// parseInt reads an integer, ignoring a parse error.
function parseInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}
