// The response shape the admin helpers write to. It is looser than Node's
// ServerResponse so the handlers stay testable.
export interface AdminResponse {
  statusCode?: number;
  setHeader(name: string, value: string | string[]): void;
  writeHead(status: number, headers?: Record<string, string | string[]>): unknown;
  end(chunk?: string | Buffer): void;
}

// writeAdminError answers a request with the admin error envelope.
export function writeAdminError(
  response: AdminResponse,
  status: number,
  code: string,
  message: string,
): void {
  const body = `${JSON.stringify({ error: { code, message } })}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

// writeAdminJSON answers a request with a JSON document.
export function writeAdminJSON(
  response: AdminResponse,
  status: number,
  body: unknown,
  noStore = false,
): void {
  const text = `${JSON.stringify(body)}\n`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(text)),
  };
  if (noStore) {
    headers["Cache-Control"] = "no-store";
  }
  response.writeHead(status, headers);
  response.end(text);
}
