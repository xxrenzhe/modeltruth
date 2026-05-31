import type { Locale } from "@modeltruth/i18n";
import { buildSeoMetadata, faqPageJsonLd, jsonLdScript } from "@modeltruth/seo";
import { PlaygroundClient } from "./playground-client";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/playground",
    title: "Test an OpenAI-compatible API | ModelTruth.ai",
    description:
      "Run a stateless smoke audit against an OpenAI-compatible endpoint without storing your API key."
  });
}

export default function PlaygroundPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Does the Playground store API keys?",
              answer: "No. Keys are used only in memory for the current audit request."
            },
            {
              question: "Which lightweight suites does the Playground support?",
              answer: "It supports smoke, reasoning-lite and context-lite audits without storing API keys."
            }
          ])
        )}
      />
      <section className="hero compactHero">
        <div>
          <div className="eyebrow">Stateless Playground</div>
          <h1>Audit an endpoint without storing the key.</h1>
          <p className="lede">
            Run a lightweight OpenAI-compatible API smoke, reasoning or context audit. API keys are redacted and
            are not persisted by the Free Playground.
          </p>
        </div>
      </section>
      <PlaygroundClient />
    </>
  );
}
