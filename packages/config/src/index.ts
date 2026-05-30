export interface AppConfig {
  databaseUrl?: string;
  databasePath: string;
  nodeEnv: string;
}

export function getAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const projectRoot = findProjectRoot(process.cwd());
  return {
    databaseUrl: env.DATABASE_URL,
    databasePath: env.DATABASE_PATH ?? `${projectRoot}/data/modeltruth.sqlite`,
    nodeEnv: env.NODE_ENV ?? "development"
  };
}

function findProjectRoot(start: string): string {
  let current = start;
  while (current !== "/") {
    if (existsSync(`${current}/migrations`) && existsSync(`${current}/package.json`)) {
      return current;
    }
    current = dirname(current);
  }
  return start;
}
import { existsSync } from "node:fs";
import { dirname } from "node:path";
