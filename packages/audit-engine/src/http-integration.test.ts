import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runSmokeAudit } from "./index";

const servers: Array<{ close: (callback: () => void) => void }> = [];

describe("audit engine HTTP integration", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  });

  it("runs an OpenAI-compatible audit against a real HTTP test server", async () => {
    const server = await startOpenAiCompatibleServer();

    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-real-http-secret-123456",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async (url, init) => {
        const target = new URL(String(url));
        const redirected = new URL(server.url);
        redirected.pathname = target.pathname;
        redirected.search = target.search;
        return fetch(redirected, init);
      }
    });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/chat/completions",
      authorization: "Bearer sk-real-http-secret-123456"
    });
    expect(server.requests[0].body).toMatchObject({ model: "gpt-5.1", max_tokens: 32, temperature: 0 });
    expect(result.overallStatus).toBe("pass");
    expect(result.metrics.usage).toEqual({ promptTokens: 11, completionTokens: 4, totalTokens: 15 });
    expect(result.evidenceSummary.responseMetadata).toMatchObject({
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_real_http" },
      usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 }
    });
    expect(JSON.stringify(result)).not.toContain("sk-real-http-secret");
    expect(JSON.stringify(result)).not.toContain("real-http-completion");
    expect(result.evidenceSummary.completionHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

async function startOpenAiCompatibleServer() {
  const requests: Array<{
    method?: string;
    url?: string;
    authorization?: string;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body
    });
    response.writeHead(200, { "content-type": "application/json", "x-request-id": "req_real_http" });
    response.end(
      JSON.stringify({
        model: "gpt-5.1",
        choices: [{ message: { content: "real-http-completion 8310" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { requests, url: `http://127.0.0.1:${address.port}` };
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
