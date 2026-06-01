import { getDictionary, type Locale } from "@modeltruth/i18n";
import { LoginForm } from "./login-form";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  return {
    title: dictionary.login.title,
    description: dictionary.login.lede,
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false }
    }
  };
}

export default async function LoginPage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  return (
    <section className="hero">
      <div>
        <div className="eyebrow">{dictionary.login.eyebrow}</div>
        <h1>{dictionary.login.title}</h1>
        <p className="lede">{dictionary.login.lede}</p>
      </div>
      <LoginForm labels={dictionary.login} />
    </section>
  );
}
