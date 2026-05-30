#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runSmokeAudit } from "@modeltruth/audit-engine";
import { redactSecrets } from "@modeltruth/crypto";

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliCommandResult> {
  const [command, ...args] = argv;
  const flags = parseFlags(args);

  try {
    if (command === "audit") return await auditCommand(flags, env);
    if (command === "login") return await loginCommand(flags, env);
    if (command === "upload") return await uploadCommand(flags, env);
    return { exitCode: 1, stdout: usage(), stderr: command ? `Unknown command: ${command}` : "Missing command" };
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

async function auditCommand(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv): Promise<CliCommandResult> {
  const apiKey = stringFlag(flags, "api-key") ?? env.MODELTRUTH_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("API key required via --api-key, MODELTRUTH_API_KEY or OPENAI_API_KEY");
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
  return { exitCode: 0, stdout: JSON.stringify({ reportPath: output, runId: result.runId, status: result.overallStatus }), stderr: "" };
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
  const config = readCliConfig();
  const apiBase = apiBaseUrl(flags, env, config.apiBase);
  const payload = redactSecrets({
    consent: true,
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    runId: report.result?.runId,
    status: report.result?.overallStatus,
    confidence: report.result?.confidence,
    metrics: report.result?.metrics,
    assertions: report.result?.assertions,
    evidenceSummary: report.result?.evidenceSummary
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
  return { exitCode: 0, stdout: body, stderr: "" };
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

function usage() {
  return [
    "modeltruth audit --base-url https://api.example.com/v1 --model gpt-5.1 --suite smoke@1.0.0",
    "modeltruth login --email you@example.com --api-base http://localhost:3000",
    "modeltruth upload --run ./modeltruth-report.json --consent true"
  ].join("\n");
}

if (process.argv[1]?.endsWith("apps/cli/src/index.ts")) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.exitCode);
  });
}
