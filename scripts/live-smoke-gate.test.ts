import { describe, expect, it } from "vitest";
import { runLiveSmokeGate } from "./live-smoke-gate";

describe("live smoke gate", () => {
  it("skips by default when live endpoint credentials are absent", async () => {
    const result = await runLiveSmokeGate({});

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(result.message).toContain("MODELTRUTH_LIVE_SMOKE_BASE_URL");
  });

  it("fails closed when the release requires a live endpoint", async () => {
    const result = await runLiveSmokeGate({ MODELTRUTH_LIVE_SMOKE_REQUIRED: "true" });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
  });
});
