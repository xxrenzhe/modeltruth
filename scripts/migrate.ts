import { ensureDatabaseReady } from "@modeltruth/db";

const result = await ensureDatabaseReady();
console.log(
  `[migrate] database ready: ${result.type}, migrations scanned: ${result.scanned}, executed: ${result.executed}`
);
