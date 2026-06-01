export type AuditStatus = "pass" | "warning" | "fail" | "inconclusive" | "error";

export interface AuditMetricSummary {
  ttftMs?: number;
  totalLatencyMs?: number;
  statusCode?: number;
}

export type LogLevel = "info" | "warn" | "error";

export interface StructuredLogEvent {
  service: string;
  event: string;
  level?: LogLevel;
  message?: string;
  error?: unknown;
  data?: Record<string, unknown>;
}

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string }>>;
export type ObservabilitySink = "sentry" | "axiom" | "opentelemetry";

const sensitiveKeyPattern = /(^|[._-])(api[-_]?key|authorization|x[-_]?api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|token|secret|password)($|[._-])/i;

export function writeJsonLog(input: StructuredLogEvent, sink: Pick<Console, "log" | "error" | "warn"> = console) {
  const level = input.level ?? "info";
  const payload = redactLogValue({
    ts: new Date().toISOString(),
    level,
    service: input.service,
    event: input.event,
    message: input.message,
    error: input.error instanceof Error ? { name: input.error.name, message: input.error.message } : input.error,
    ...(input.data ?? {})
  });
  const line = JSON.stringify(payload);
  if (level === "error") sink.error(line);
  else if (level === "warn") sink.warn(line);
  else sink.log(line);
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactLogValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSensitiveLogKey(key) ? "[REDACTED]" : redactLogValue(entry)
    ])
  );
}

export function scrubObservabilityPayload<T>(sink: ObservabilitySink, payload: T): T {
  const scrubbed = redactLogValue(payload) as T;
  if (!["sentry", "axiom", "opentelemetry"].includes(sink)) {
    throw new Error("unsupported observability sink");
  }
  return scrubbed;
}

export function installGracefulShutdown(input: {
  service: string;
  cleanup?: () => void | Promise<void>;
  exit?: (code: number) => never;
}) {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    writeJsonLog({ service: input.service, event: "shutdown.started", data: { signal } });
    try {
      await input.cleanup?.();
      writeJsonLog({ service: input.service, event: "shutdown.completed", data: { signal } });
      (input.exit ?? process.exit)(0);
    } catch (error) {
      writeJsonLog({ service: input.service, event: "shutdown.failed", level: "error", error });
      (input.exit ?? process.exit)(1);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return shutdown;
}

export function validatePublicHttpsUrl(value: string, label = "URL"): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  if (!isPublicHostname(url.hostname)) throw new Error(`${label} must be a public endpoint`);
  return url;
}

export async function assertPublicResolvedAddresses(
  url: URL,
  lookup: DnsLookup,
  label = "URL"
): Promise<void> {
  if (isLiteralIp(url.hostname)) return;
  const records = await lookup(url.hostname);
  if (records.length === 0) throw new Error(`${label} hostname did not resolve`);
  for (const record of records) {
    if (!isPublicHostname(record.address)) throw new Error(`Resolved ${label} address is not public`);
  }
}

export function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "metadata.google.internal"].includes(normalized)) return false;
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) return false;
  if (/^169\.254\./.test(normalized)) return false;
  if (/^10\./.test(normalized)) return false;
  if (/^127\./.test(normalized)) return false;
  if (/^192\.168\./.test(normalized)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return false;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return false;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(normalized)) return false;
  if (/^fe[89ab][0-9a-f]?:/i.test(normalized)) return false;
  return true;
}

function isLiteralIp(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return /^[\d.]+$/.test(normalized) || normalized.includes(":");
}

function redactString(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, "sk-[REDACTED]");
}

function isSensitiveLogKey(key: string) {
  return sensitiveKeyPattern.test(`.${key.toLowerCase()}.`);
}
