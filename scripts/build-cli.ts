import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "apps", "cli", "dist");
const outfile = path.join(outdir, "index.js");

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "apps", "cli", "src", "index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  external: ["node:*"],
  logLevel: "silent"
});

const output = readFileSync(outfile, "utf8");
if (!output.startsWith("#!/usr/bin/env node")) {
  throw new Error("CLI bundle is missing node shebang");
}
if (output.includes("@modeltruth/")) {
  throw new Error("CLI bundle still references private @modeltruth workspace packages");
}

chmodSync(outfile, 0o755);
console.error(`[build-cli] wrote ${path.relative(root, outfile)}`);
