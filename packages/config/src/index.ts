import { existsSync } from "node:fs";
import path from "node:path";

export interface AppConfig {
  databasePath: string;
  databaseUrl?: string;
  encryptionKey: string;
  nodeEnv: string;
}

export function getAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = resolveProjectRoot(env);
  return {
    databasePath: env.DATABASE_PATH ?? path.join(root, "data", "modeltruth.sqlite"),
    databaseUrl: emptyToUndefined(env.DATABASE_URL),
    encryptionKey:
      env.APP_SECRET_ENCRYPTION_KEY ??
      env.MODELTRUTH_ENCRYPTION_KEY ??
      env.ENCRYPTION_KEY ??
      "modeltruth-local-development-key",
    nodeEnv: env.NODE_ENV ?? "development"
  };
}

function emptyToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveProjectRoot(env: NodeJS.ProcessEnv) {
  let current = env.MODELTRUTH_ROOT ?? env.INIT_CWD ?? process.cwd();
  while (true) {
    if (existsSync(path.join(current, "migrations")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}
