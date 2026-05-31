import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, locales, type Locale } from "@modeltruth/i18n";

const blockedPathPattern = /\.(env|sql|bak|log|pem|key)$/i;
const blockedProbePattern = /\/(?:wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|adminer|webshell|shell\.php|backup(?:s)?)(?:\/|$)/i;
const ignoredPrefixes = ["/api/", "/_next/", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/icon.svg"];
const localeCookieName = "locale";

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { pathname } = request.nextUrl;

  if (blockedPathPattern.test(pathname) || pathname.includes("/.git/") || blockedProbePattern.test(pathname)) {
    return new NextResponse("Not found", { status: 404, headers: { "x-request-id": requestId } });
  }

  if (ignoredPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const firstSegment = pathname.split("/")[1];
  if (!isLocale(firstSegment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${selectLocale(request)}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const response = NextResponse.next();
  response.cookies.set(localeCookieName, firstSegment, { path: "/", sameSite: "lax" });
  response.headers.set("x-request-id", requestId);
  return response;
}

function selectLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(localeCookieName)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const userAgent = request.headers.get("user-agent") ?? "";
  if (/(bot|crawler|spider|slurp|bingpreview)/i.test(userAgent)) return defaultLocale;

  const accepted = parseAcceptLanguage(request.headers.get("accept-language") ?? "");
  return accepted.find((locale) => locales.includes(locale)) ?? defaultLocale;
}

function parseAcceptLanguage(header: string) {
  return header
    .split(",")
    .map((part) => {
      const [tag = "", qValue = "q=1"] = part.trim().split(";");
      const quality = Number(qValue.replace(/^q=/, "")) || 0;
      return { tag: tag.toLowerCase(), quality };
    })
    .sort((left, right) => right.quality - left.quality)
    .flatMap(({ tag }) =>
      locales.filter((locale) => tag === locale.toLowerCase() || tag.split("-")[0] === locale.split("-")[0])
    );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
