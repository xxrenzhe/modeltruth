import { checkDatabaseHealth } from "@modeltruth/db";

const health = await checkDatabaseHealth();
if (!health.ok) {
  console.error("[validate-db-schema] database health failed", health);
  process.exit(1);
}

console.log("[validate-db-schema] database health passed", health);
