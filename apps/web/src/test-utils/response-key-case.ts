import { expect } from "vitest";

const snakeCaseKeyPattern = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/;

export function expectResponseKeysCamelCase(payload: unknown) {
  const snakeCasePaths: string[] = [];
  collectSnakeCaseKeyPaths(payload, "$", snakeCasePaths);
  expect(snakeCasePaths).toEqual([]);
}

function collectSnakeCaseKeyPaths(value: unknown, path: string, matches: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSnakeCaseKeyPaths(item, `${path}[${index}]`, matches));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const keyPath = `${path}.${key}`;
    if (snakeCaseKeyPattern.test(key)) matches.push(keyPath);
    collectSnakeCaseKeyPaths(nested, keyPath, matches);
  }
}
