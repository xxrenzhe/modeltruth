const url = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1/api/health";
const response = await fetch(url);
if (!response.ok) {
  console.error(`[healthcheck] failed for ${url} with ${response.status}`);
  process.exit(1);
}

console.log("[healthcheck] ok");

export {};
