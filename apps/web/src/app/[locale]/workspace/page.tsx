import { getDictionary, type Locale } from "@modeltruth/i18n";
import { WorkspaceClient } from "./workspace-client";

export default async function WorkspacePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  return (
    <>
      <section className="hero compactHero">
        <div>
          <div className="eyebrow">{dictionary.workspace.eyebrow}</div>
          <h1>{dictionary.workspace.title}</h1>
          <p className="lede">{dictionary.workspace.lede}</p>
        </div>
      </section>
      <WorkspaceClient labels={dictionary.workspace} />
    </>
  );
}
