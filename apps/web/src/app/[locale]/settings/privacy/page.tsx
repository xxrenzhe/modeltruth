import type { Locale } from "@modeltruth/i18n";
import { absoluteUrl, breadcrumbJsonLd, buildSeoMetadata, jsonLdScript } from "@modeltruth/seo";
import { PrivacySettingsClient } from "./privacy-settings-client";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/settings/privacy",
    title: "Privacy settings | ModelTruth.ai",
    description: "Export your ModelTruth account data or delete your account and workspace identity."
  });
}

export default async function PrivacySettingsPage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(`/${locale}`) },
            { name: "Privacy", url: absoluteUrl(`/${locale}/privacy`) },
            { name: "Privacy settings", url: absoluteUrl(`/${locale}/settings/privacy`) }
          ])
        )}
      />
      <section className="hero compactHero">
        <div>
          <div className="eyebrow">Privacy Settings</div>
          <h1>Control your account data.</h1>
          <p className="lede">
            Export account and workspace metadata, or delete your account. Node deletion clears
            encrypted API key material while historical metrics remain only as aggregate evidence.
          </p>
        </div>
      </section>
      <PrivacySettingsClient />
    </>
  );
}
