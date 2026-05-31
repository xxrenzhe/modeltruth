import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureSqliteReady, getEvidencePackage } from "@modeltruth/db";
import { POST } from "./app/api/playground/audit/route";

describe("Playground audit API", () => {
  it("rejects private Base URLs before consuming quota or running an audit", async () => {
    const harness = await createHarness();
    const response = await POST(
      new Request("http://localhost/api/playground/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://127.0.0.1/v1",
          model: "gpt-5.1",
          apiKey: "sk-test-secret"
        })
      })
    );
    const body = await response.json();
    harness.cleanup();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Base URL must be a public endpoint");
  });

  it("allows the three lightweight Playground suites", async () => {
    const harness = await createHarness();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = body.messages.at(-1)?.content ?? "";
      const needles = [...prompt.matchAll(/needle_[a-z]+=[0-9a-f-]+/g)].map((match) => match[0]);
      const content = needles.length ? needles.join(" ") : `${prompt} 8310`;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { total_tokens: 12 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    for (const suiteId of ["smoke@1.0.0", "reasoning-lite@1.0.0", "context-lite@1.0.0"]) {
      const response = await POST(
        new Request("http://localhost/api/playground/audit", {
          method: "POST",
          headers: { "content-type": "application/json", "x-modeltruth-fingerprint": `fp-${suiteId}` },
          body: JSON.stringify({
            baseUrl: "https://api.example.com/v1",
            model: "gpt-5.1",
            apiKey: "sk-test-secret",
            suiteId
          })
        })
      );
      const body = await response.json();
      expect(response.status, suiteId).toBe(200);
      expect(body.evidenceSummary.suiteVersion, suiteId).toBe("1.0.0");
      expect(body.evidenceSummary.suiteId, suiteId).toBe(suiteId.split("@")[0]);
      expect(body.metrics.usage.totalTokens, suiteId).toBe(12);
      expect(JSON.stringify(body), suiteId).not.toContain("total_tokens");
      expect(JSON.stringify(body), suiteId).not.toContain("sk-test-secret");
    }

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    harness.cleanup();
  });

  it("rejects billing suites that are not allowed for the Free Playground", async () => {
    const harness = await createHarness();
    const response = await POST(
      new Request("http://localhost/api/playground/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://api.example.com/v1",
          model: "gpt-5.1",
          apiKey: "sk-test-secret",
          suiteId: "billing-lite@1.0.0"
        })
      })
    );
    const body = await response.json();
    harness.cleanup();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Playground supports smoke@1.0.0, reasoning-lite@1.0.0 and context-lite@1.0.0 only");
  });

  it("enforces the daily three-run Playground quota by IP and fingerprint before provider calls", async () => {
    const harness = await createHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "quota smoke 8310" } }],
          usage: { total_tokens: 12 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(
        await POST(
          new Request("http://localhost/api/playground/audit", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "203.0.113.42",
              "x-modeltruth-fingerprint": "fp-quota-route"
            },
            body: JSON.stringify({
              baseUrl: "https://api.example.com/v1",
              model: "gpt-5.1",
              apiKey: "sk-quota-secret-123456"
            })
          })
        )
      );
    }
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const evidence = await getEvidencePackage(bodies[0].runId);

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    harness.cleanup();

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429]);
    expect(bodies[3]).toMatchObject({ error: "daily playground audit limit reached" });
    expect(bodies[3].runId).toBeUndefined();
    expect(responses[3].headers.get("x-ratelimit-remaining")).toBe("0");
    expect(bodies.slice(0, 3).map((body) => body.runId)).toHaveLength(3);
    expect(JSON.stringify(evidence)).not.toContain("sk-quota-secret");
  });

  it("persists redacted audit errors for redirect and oversized response safety failures", async () => {
    const harness = await createHarness();
    const originalFetch = globalThis.fetch;
    const cases = [
      {
        fingerprint: "fp-cross-host-redirect",
        apiKey: "sk-redirect-secret-123456",
        fetchImpl: async () =>
          new Response("redirect body sk-redirect-secret-123456", {
            status: 302,
            headers: { location: "https://metadata.google.internal/latest" }
          }),
        expectedMessage: "Cross-host redirects are not allowed"
      },
      {
        fingerprint: "fp-oversized-response",
        apiKey: "sk-oversized-secret-123456",
        fetchImpl: async () => new Response(`${"x".repeat(2 * 1024 * 1024 + 1)}sk-oversized-secret-123456`),
        expectedMessage: "Response body exceeded 2097152 bytes"
      }
    ];

    for (const item of cases) {
      globalThis.fetch = vi.fn(item.fetchImpl) as typeof fetch;
      const response = await POST(
        new Request("http://localhost/api/playground/audit", {
          method: "POST",
          headers: { "content-type": "application/json", "x-modeltruth-fingerprint": item.fingerprint },
          body: JSON.stringify({
            baseUrl: "https://api.example.com/v1",
            model: "gpt-5.1",
            apiKey: item.apiKey
          })
        })
      );
      const body = await response.json();
      const evidence = await getEvidencePackage(body.runId);
      const serialized = JSON.stringify({ body, evidence });

      expect(response.status).toBe(200);
      expect(body.overallStatus).toBe("error");
      expect(body.assertions[0]).toMatchObject({ id: "REQUEST_FAILED", status: "error" });
      expect(body.assertions[0].message).toContain(item.expectedMessage);
      expect(evidence).toMatchObject({ runId: body.runId, status: "error", runType: "playground" });
      expect(serialized).not.toContain(item.apiKey);
      expect(serialized).not.toContain("metadata.google.internal/latest");
      expect(serialized).not.toContain("sk-");
    }

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    harness.cleanup();
  });
});

async function createHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-playground-api-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  return {
    cleanup() {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
