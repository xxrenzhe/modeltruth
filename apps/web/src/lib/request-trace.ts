import { createHash } from "node:crypto";

export function traceIdFromRequest(request: Request) {
  const requestId = request.headers.get("x-request-id")?.trim();
  return requestId ? traceIdFromRequestId(requestId) : undefined;
}

export function traceIdFromRequestId(requestId: string) {
  return createHash("sha256").update(requestId).digest("hex").slice(0, 32);
}
