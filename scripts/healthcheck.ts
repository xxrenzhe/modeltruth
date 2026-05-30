const response = await fetch("http://127.0.0.1:3000/api/health");
if (!response.ok) {
  console.error(`[healthcheck] failed with ${response.status}`);
  process.exit(1);
}

console.log("[healthcheck] ok");

export {};
