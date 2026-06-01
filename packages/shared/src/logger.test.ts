import { describe, expect, it, vi } from "vitest";
import {
  assertPublicResolvedAddresses,
  installGracefulShutdown,
  isPublicHostname,
  redactLogValue,
  scrubObservabilityPayload,
  safeErrorMessage,
  validatePublicHttpsUrl,
  writeJsonLog
} from "./index";

describe("structured logger", () => {
  it("writes JSON lines and redacts sensitive fields and token fragments", () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    writeJsonLog(
      {
        service: "worker",
        event: "audit.completed",
        data: {
          runId: "run_1",
          apiKey: "sk-secret-value",
          nested: { authorization: "Bearer abc.def", message: "failed for sk-othersecret" }
        }
      },
      sink
    );

    const line = sink.log.mock.calls[0][0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: "info", service: "worker", event: "audit.completed", runId: "run_1" });
    expect(line).not.toContain("sk-secret-value");
    expect(line).not.toContain("abc.def");
    expect(line).toContain("[REDACTED]");
  });

  it("routes errors to stderr-compatible sink", () => {
    const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    writeJsonLog({ service: "scheduler", event: "tick.failed", level: "error", error: new Error("boom") }, sink);

    expect(sink.error).toHaveBeenCalledOnce();
    expect(JSON.parse(sink.error.mock.calls[0][0])).toMatchObject({
      level: "error",
      service: "scheduler",
      event: "tick.failed",
      error: { name: "Error", message: "boom" }
    });
  });

  it("can redact arbitrary log payloads before custom handling", () => {
    expect(redactLogValue({ headers: { "x-api-key": "sk-test-secret" }, text: "Bearer token123" })).toEqual({
      headers: { "x-api-key": "[REDACTED]" },
      text: "Bearer [REDACTED]"
    });
  });

  it("scrubs Sentry, Axiom and OpenTelemetry payloads before export", () => {
    const payload = {
      request: { headers: { authorization: "Bearer abc.def", "x-api-key": "sk-observability-secret" } },
      tags: { apiKey: "sk-tag-secret-123456", route: "/api/playground/audit" },
      resource: { attributes: { "http.request.header.authorization": "Bearer otel.secret" } }
    };

    for (const sink of ["sentry", "axiom", "opentelemetry"] as const) {
      const serialized = JSON.stringify(scrubObservabilityPayload(sink, payload));
      expect(serialized).not.toContain("abc.def");
      expect(serialized).not.toContain("sk-observability-secret");
      expect(serialized).not.toContain("sk-tag-secret");
      expect(serialized).not.toContain("otel.secret");
      expect(serialized).toContain("[REDACTED]");
    }
  });

  it("redacts sensitive fragments from API-safe error messages", () => {
    const message = safeErrorMessage(new Error("provider rejected Authorization: Bearer abc.def and apiKey sk-error-secret-123456"), "audit failed");

    expect(message).not.toContain("abc.def");
    expect(message).not.toContain("sk-error-secret");
    expect(message).toContain("[REDACTED]");
  });

  it("validates public HTTPS endpoints and blocks local, private and metadata hosts", () => {
    expect(validatePublicHttpsUrl("https://api.example.com/v1", "Base URL").hostname).toBe("api.example.com");

    for (const blocked of [
      "http://api.example.com/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.2/v1",
      "https://172.16.0.2/v1",
      "https://192.168.1.2/v1",
      "https://169.254.169.254/latest",
      "https://metadata.google.internal/latest",
      "https://[::1]/v1",
      "https://[fd00::1]/v1",
      "https://[fe80::1]/v1"
    ]) {
      expect(() => validatePublicHttpsUrl(blocked, "Base URL"), blocked).toThrow();
    }
  });

  it("normalizes bracketed IPv6 hostnames before public-host checks", () => {
    expect(isPublicHostname("[::1]")).toBe(false);
    expect(isPublicHostname("[fd00::1]")).toBe(false);
    expect(isPublicHostname("[2606:4700:4700::1111]")).toBe(true);
  });

  it("rejects DNS records that resolve public hostnames to private addresses", async () => {
    await expect(
      assertPublicResolvedAddresses(new URL("https://api.example.com/v1"), async () => [{ address: "10.0.0.2" }], "Base URL")
    ).rejects.toThrow("Resolved Base URL address is not public");
    await expect(
      assertPublicResolvedAddresses(new URL("https://api.example.com/v1"), async () => [{ address: "203.0.113.10" }], "Base URL")
    ).resolves.toBeUndefined();
  });

  it("runs cleanup before exiting on termination signals", async () => {
    const cleanup = vi.fn();
    const exit = vi.fn((() => undefined) as unknown as (code: number) => never);
    const shutdown = installGracefulShutdown({ service: "worker", cleanup, exit });

    await shutdown("SIGTERM");
    await shutdown("SIGTERM");

    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
