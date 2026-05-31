import type { AuditSuiteId } from "./types";

export type MaterializedPrompt = {
  nonce: string;
  numericNonce: number;
  timestampBucket: string;
  expected: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
};

const contextWordCount = 12_000;
const needleDepths = [0.15, 0.55, 0.85] as const;
const primePool = [
  7919, 104729, 130363, 15485863, 32452843, 49979687, 67867967, 86028121, 104395303, 122949829
];

export function materializeSuitePrompt(suiteId: AuditSuiteId, fixedNonce?: string): MaterializedPrompt {
  const nonce = fixedNonce ?? crypto.randomUUID();
  const numericNonce = numericNonceFor(nonce);
  const timestampBucket = currentTimestampBucket();
  const antiCacheLine = `session_nonce=${nonce}; numeric_nonce=${numericNonce}; timestamp_bucket=${timestampBucket}.`;

  if (suiteId === "reasoning-lite") {
    return {
      nonce,
      numericNonce,
      timestampBucket,
      expected: { answer: String(17 * 23 + numericNonce) },
      messages: [
        { role: "system", content: "You are responding to a ModelTruth reasoning-lite audit. Return concise JSON only." },
        {
          role: "user",
          content: `${antiCacheLine} Compute 17 * 23 + ${numericNonce}. Return {"answer":"<number>","session_nonce":"${nonce}"}.`
        }
      ]
    };
  }

  if (suiteId === "context-lite") {
    const context = buildContextLiteDocument(nonce);
    return {
      nonce,
      numericNonce,
      timestampBucket,
      expected: {
        needles: context.needles,
        contextTokenEstimate: context.tokenEstimate,
        needleDepths: context.needleDepths
      },
      messages: [
        { role: "system", content: "You are responding to a ModelTruth context-lite audit. Return concise JSON only." },
        {
          role: "user",
          content: `${antiCacheLine}\n${context.document}\nReturn all three needle values and session_nonce ${nonce}.`
        }
      ]
    };
  }

  if (suiteId === "billing-lite") {
    return {
      nonce,
      numericNonce,
      timestampBucket,
      expected: {},
      messages: [
        { role: "system", content: "You are responding to a ModelTruth billing-lite audit." },
        {
          role: "user",
          content: `${antiCacheLine} Reply with a short sentence containing the session_nonce. This run compares usage metadata with billing data when a balance source is configured.`
        }
      ]
    };
  }

  if (suiteId === "fingerprint-calibration") {
    return {
      nonce,
      numericNonce,
      timestampBucket,
      expected: {},
      messages: [
        { role: "system", content: "You are responding to a ModelTruth fingerprint calibration audit." },
        {
          role: "user",
          content: `${antiCacheLine} Return concise JSON with keys model_family, capabilities, and session_nonce.`
        }
      ]
    };
  }

  return {
    nonce,
    numericNonce,
    timestampBucket,
    expected: {},
    messages: [
      { role: "system", content: "You are responding to a ModelTruth smoke audit." },
      { role: "user", content: `${antiCacheLine} Reply with exactly: modeltruth-smoke-${nonce}` }
    ]
  };
}

function buildContextLiteDocument(nonce: string) {
  const words = Array.from({ length: contextWordCount }, (_, index) => `mtctx${(index % 997).toString(36)}`);
  const needles = [
    `needle_alpha=${nonce.slice(0, 8)}`,
    `needle_beta=${nonce.slice(9, 17)}`,
    `needle_gamma=${nonce.slice(18, 26)}`
  ];
  const positions = needleDepths.map((depth) => Math.floor(words.length * depth));
  positions.forEach((position, index) => {
    words.splice(position + index, 0, needles[index]);
  });
  const document = words.join(" ");
  return {
    document,
    needles,
    needleDepths: positions.map((position) => Math.round((position / words.length) * 100) / 100),
    tokenEstimate: estimateTokens(document)
  };
}

function numericNonceFor(nonce: string) {
  const normalized = nonce.replace(/[^a-f0-9]/gi, "");
  const seed = Number.parseInt(normalized.slice(0, 8) || "0", 16);
  return primePool[Math.abs(seed) % primePool.length];
}

function currentTimestampBucket(now = new Date()) {
  return now.toISOString().slice(0, 16) + "Z";
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}
