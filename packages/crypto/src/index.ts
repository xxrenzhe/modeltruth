const secretPatterns = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /(authorization["':\s]+bearer\s+)[A-Za-z0-9._-]+/gi,
  /(apiKey["':\s]+)[A-Za-z0-9._-]+/gi
];

export function redactSecrets<T>(value: T): T {
  const json = JSON.stringify(value);
  let redacted = json;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, (match, prefix) =>
      typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return JSON.parse(redacted) as T;
}
