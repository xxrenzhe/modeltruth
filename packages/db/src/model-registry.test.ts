import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createModelRegistryRepository } from "./model-registry";

describe("ModelRegistryRepository", () => {
  it("upserts model capabilities and records calibration history", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-model-registry-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createModelRegistryRepository();
    try {
      const model = await repo.upsert({
        provider: "openai",
        modelId: "gpt-5.1",
        family: "gpt-5",
        status: "experimental",
        supportsReasoningUsage: true,
        supportsStreaming: true,
        maxContextTokens: 400000
      });
      const calibration = await repo.recordCalibration({
        provider: "openai",
        modelId: "gpt-5.1",
        suiteId: "fingerprint-calibration",
        suiteVersion: "1.0.0",
        status: "pass",
        metrics: { samples: 3 },
        evidenceSummary: { redaction: "applied" },
        calibratedAt: "2026-05-31T00:00:00.000Z"
      });
      const refreshed = await repo.get("openai", "gpt-5.1");
      const allModels = await repo.list();

      expect(model.supportsReasoningUsage).toBe(true);
      expect(model.status).toBe("experimental");
      expect(calibration.modelRegistryId).toBe(model.id);
      expect(refreshed?.lastCalibratedAt).toBe("2026-05-31T00:00:00.000Z");
      expect(allModels.map((entry) => entry.modelId)).toEqual(["gpt-5.1"]);
    } finally {
      await repo.close();
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
