import { getDictionary, type Locale } from "@modeltruth/i18n";

export default async function PlaygroundPage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  return (
    <section className="hero">
      <div>
        <div className="eyebrow">{dictionary.playground.eyebrow}</div>
        <h1>{dictionary.playground.title}</h1>
        <p className="lede">{dictionary.playground.lede}</p>
      </div>
      <form className="card formGrid" action="/api/playground/audit" method="post">
        <label>
          Base URL
          <input name="baseUrl" placeholder="https://api.example.com/v1" required />
        </label>
        <label>
          API Key
          <input name="apiKey" placeholder="sk-..." type="password" required />
        </label>
        <label>
          Model
          <input name="model" placeholder="gpt-5.1" required />
        </label>
        <label>
          Suite
          <select name="suiteId" defaultValue="smoke@1.0.0">
            <option value="smoke@1.0.0">smoke@1.0.0</option>
            <option value="reasoning-lite@1.0.0">reasoning-lite@1.0.0</option>
          </select>
        </label>
        <button className="button" type="submit">
          {dictionary.playground.submit}
        </button>
      </form>
    </section>
  );
}
