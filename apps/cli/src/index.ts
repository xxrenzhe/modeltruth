#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { runSmokeAudit } from "@modeltruth/audit-engine";
import { redactSecrets } from "@modeltruth/crypto";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ApiKeyReader = () => Promise<string>;

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliCommandResult> {
  return runCliWithOptions(argv, { env });
}

export async function runCliWithOptions(
  argv: string[],
  options: { env?: NodeJS.ProcessEnv; apiKeyReader?: ApiKeyReader } = {}
): Promise<CliCommandResult> {
  const env = options.env ?? process.env;
  const [command, ...args] = argv;
  const flags = parseFlags(args);

  try {
    if (command === "audit") return await auditCommand(flags, env, options.apiKeyReader);
    if (command === "login") return await loginCommand(flags, env);
    if (command === "upload") return await uploadCommand(flags, env);
    return { exitCode: 1, stdout: usage(), stderr: command ? `Unknown command: ${command}` : "Missing command" };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

async function auditCommand(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  apiKeyReader: ApiKeyReader = readApiKeyInteractively
): Promise<CliCommandResult> {
  const apiKey = await resolveApiKey(flags, env, apiKeyReader);
  const suiteId = stringFlag(flags, "suite") ?? "smoke@1.0.0";
  const result = await runSmokeAudit({
    baseUrl: requiredFlag(flags, "base-url"),
    apiKey,
    model: requiredFlag(flags, "model"),
    suiteId
  });
  const report = redactSecrets({
    schemaVersion: "modeltruth.report.v1",
    generatedAt: new Date().toISOString(),
    suiteId,
    result
  });
  const output = stringFlag(flags, "output") ?? "modeltruth-report.json";
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const activation = recordLocalAuditActivation({
    baseUrl: requiredFlag(flags, "base-url"),
    model: requiredFlag(flags, "model"),
    suiteId,
    status: result.overallStatus
  });
  if (String(flags["consent-upload"]) === "true") {
    const upload = await uploadReport(report, flags, env);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        reportPath: output,
        runId: result.runId,
        status: result.overallStatus,
        uploaded: true,
        activationCta: activation.cta,
        upload
      }),
      stderr: ""
    };
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      reportPath: output,
      runId: result.runId,
      status: result.overallStatus,
      uploaded: false,
      activationCta: activation.cta
    }),
    stderr: ""
  };
}

async function resolveApiKey(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  apiKeyReader: ApiKeyReader
) {
  const configured = stringFlag(flags, "api-key") ?? env.MODELTRUTH_API_KEY ?? env.OPENAI_API_KEY;
  if (configured) return configured;
  const value = await apiKeyReader();
  if (!value.trim()) throw new Error("API key required via --api-key, MODELTRUTH_API_KEY, OPENAI_API_KEY or interactive input");
  return value.trim();
}

async function readApiKeyInteractively() {
  const terminal = createInterface({ input, output });
  try {
    return await terminal.question("ModelTruth API key: ");
  } finally {
    terminal.close();
  }
}

async function loginCommand(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv): Promise<CliCommandResult> {
  const apiBase = apiBaseUrl(flags, env);
  const email = requiredFlag(flags, "email");
  const magic = await postJson(`${apiBase}/api/auth/magic-link`, { email });
  if (!magic.verificationUrl) {
    return { exitCode: 0, stdout: JSON.stringify({ email: magic.email, message: "Magic link sent. Open it in your browser." }), stderr: "" };
  }
  const response = await fetch(String(magic.verificationUrl), { redirect: "manual" });
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Login verification did not return a session cookie");
  const token = cookie.match(/mt_session=([^;]+)/)?.[1];
  if (!token) throw new Error("Session cookie missing mt_session");
  writeCliConfig({ apiBase, sessionToken: token });
  return { exitCode: 0, stdout: JSON.stringify({ apiBase, authenticated: true }), stderr: "" };
}

async function uploadCommand(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv): Promise<CliCommandResult> {
  if (String(flags.consent) !== "true") throw new Error("upload requires --consent true");
  const reportPath = requiredFlag(flags, "run");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const body = await uploadReport(report, flags, env);
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: "" };
}

async function uploadReport(report: Record<string, unknown>, flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv) {
  const config = readCliConfig();
  const apiBase = apiBaseUrl(flags, env, config.apiBase);
  const result = typeof report.result === "object" && report.result ? (report.result as Record<string, unknown>) : {};
  const payload = redactSecrets({
    consent: true,
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    runId: result.runId,
    status: result.overallStatus,
    confidence: result.confidence,
    suiteId: report.suiteId,
    model: result.model,
    metrics: sanitizeMetrics(result.metrics),
    assertions: sanitizeAssertions(result.assertions),
    evidenceSummary: sanitizeEvidenceSummary(result.evidenceSummary)
  });
  const response = await fetch(`${apiBase}/api/cli/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.sessionToken ? { cookie: `mt_session=${config.sessionToken}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Upload failed with ${response.status}: ${body}`);
  return parseJsonOrText(body);
}

function sanitizeMetrics(value: unknown) {
  const metrics = pickObject(value, ["statusCode", "ttftMs", "totalLatencyMs", "tokenUsage", "billingVariance"]);
  if (metrics.tokenUsage) metrics.tokenUsage = pickObject(metrics.tokenUsage, ["prompt", "completion", "total"]);
  if (metrics.billingVariance) metrics.billingVariance = pickObject(metrics.billingVariance, ["reportedTokens", "expectedTokens", "varianceRatio"]);
  return metrics;
}

function sanitizeAssertions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((assertion) => pickObject(assertion, ["id", "status", "confidence", "message"]));
}

function sanitizeEvidenceSummary(value: unknown) {
  const evidenceSummary = pickObject(value, [
    "redaction",
    "requestBodyStored",
    "authorizationHeaderStored",
    "storedHeaders",
    "promptNonceHash",
    "numericNonceHash",
    "timestampBucket",
    "retestRecommendation",
    "completionHash",
    "usageHash",
    "calibrationSnapshotId",
    "billingVariance"
  ]);
  if (evidenceSummary.storedHeaders) evidenceSummary.storedHeaders = sanitizeStoredHeaders(evidenceSummary.storedHeaders);
  if (evidenceSummary.billingVariance) evidenceSummary.billingVariance = pickObject(evidenceSummary.billingVariance, ["reportedTokens", "expectedTokens", "varianceRatio"]);
  return evidenceSummary;
}

function sanitizeStoredHeaders(value: unknown) {
  return redactSecrets(pickObject(value, ["content-type", "x-request-id", "openai-processing-ms"]));
}

function pickObject(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, (value as Record<string, unknown>)[key]])
  );
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function requiredFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function apiBaseUrl(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv, fallback = "http://localhost:3000") {
  return (stringFlag(flags, "api-base") ?? env.MODELTRUTH_API_BASE ?? fallback).replace(/\/+$/, "");
}

async function postJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed with ${response.status}`);
  return body;
}

function configPath() {
  return path.join(process.env.MODELTRUTH_CLI_HOME ?? path.join(homedir(), ".modeltruth"), "config.json");
}

function writeCliConfig(config: { apiBase: string; sessionToken: string }) {
  mkdirSync(path.dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function readCliConfig(): { apiBase?: string; sessionToken?: string } {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function auditHistoryPath() {
  return path.join(path.dirname(configPath()), "audit-history.json");
}

function recordLocalAuditActivation(input: { baseUrl: string; model: string; suiteId: string; status: string }) {
  const now = new Date().toISOString();
  const key = createHash("sha256")
    .update(`${normalizedEndpoint(input.baseUrl)}|${input.model}|${input.suiteId}`)
    .digest("hex");
  const history = readAuditHistory();
  const previous = history.endpoints[key] ?? { count: 0 };
  const next = {
    count: previous.count + 1,
    lastStatus: input.status,
    lastRunAt: now
  };
  history.endpoints[key] = next;
  writeAuditHistory(history);
  return {
    count: next.count,
    cta: next.count >= 3 ? "You have audited this endpoint 3+ times locally. Keep it monitored 24/7: https://modeltruth.ai/pro" : undefined
  };
}

function readAuditHistory(): { schemaVersion: string; endpoints: Record<string, { count: number; lastStatus?: string; lastRunAt?: string }> } {
  try {
    const parsed = JSON.parse(readFileSync(auditHistoryPath(), "utf8"));
    if (parsed?.schemaVersion === "modeltruth.cli-audit-history.v1" && parsed.endpoints && typeof parsed.endpoints === "object") {
      return parsed;
    }
  } catch {
    // Missing or invalid local activation history should not block an audit.
  }
  return { schemaVersion: "modeltruth.cli-audit-history.v1", endpoints: {} };
}

function writeAuditHistory(history: { schemaVersion: string; endpoints: Record<string, { count: number; lastStatus?: string; lastRunAt?: string }> }) {
  mkdirSync(path.dirname(auditHistoryPath()), { recursive: true });
  writeFileSync(auditHistoryPath(), `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
}

function normalizedEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function parseJsonOrText(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return { response: body };
  }
}

function usage() {
  return [
    "modeltruth audit --base-url https://api.example.com/v1 --model gpt-5.1 --suite smoke@1.0.0",
    "modeltruth audit --base-url https://api.example.com/v1 --model gpt-5.1 --consent-upload true",
    "modeltruth login --email you@example.com --api-base http://localhost:3000",
    "modeltruth upload --run ./modeltruth-report.json --consent true"
  ].join("\n");
}

if (isCliEntrypoint()) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  });
}

function isCliEntrypoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
