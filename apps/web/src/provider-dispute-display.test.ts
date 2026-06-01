import { describe, expect, it } from "vitest";
import {
  disputeStatusClass,
  disputeStatusLabel,
  requestTypeLabel,
  reviewStatusClass,
  reviewStatusLabel
} from "./lib/provider-dispute-display";

describe("provider dispute display policy", () => {
  it("prioritizes provider response updates over resolved and under-review disputes", () => {
    const disputes = [
      { status: "under_review" as const },
      { status: "resolved" as const },
      { status: "provider_response_attached" as const }
    ];

    expect(reviewStatusLabel(disputes)).toBe("Updated after review");
    expect(reviewStatusClass(disputes)).toBe("pass");
  });

  it("surfaces resolved status before under-review status when no provider response is attached", () => {
    const disputes = [{ status: "under_review" as const }, { status: "resolved" as const }];

    expect(reviewStatusLabel(disputes)).toBe("Resolved");
    expect(reviewStatusClass(disputes)).toBe("pass");
  });

  it("keeps active reviews visually distinct from boards with no dispute", () => {
    expect(reviewStatusLabel([{ status: "under_review" as const }])).toBe("Under review");
    expect(reviewStatusClass([{ status: "under_review" as const }])).toBe("warning");
    expect(reviewStatusLabel([])).toBe("No active dispute");
    expect(reviewStatusClass([])).toBe("muted");
  });

  it("maps individual dispute statuses and request types to neutral public labels", () => {
    expect(disputeStatusLabel("provider_response_attached")).toBe("Updated after review");
    expect(disputeStatusClass("provider_response_attached")).toBe("pass");
    expect(disputeStatusLabel("resolved")).toBe("Resolved");
    expect(disputeStatusClass("resolved")).toBe("pass");
    expect(disputeStatusLabel("under_review")).toBe("Under review");
    expect(disputeStatusClass("under_review")).toBe("warning");
    expect(requestTypeLabel("takedown")).toBe("Takedown request");
    expect(requestTypeLabel("provider_response")).toBe("Provider response");
    expect(requestTypeLabel("correction")).toBe("Correction request");
    expect(requestTypeLabel(undefined)).toBe("Correction request");
  });
});
