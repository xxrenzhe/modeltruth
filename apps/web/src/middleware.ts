import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@modeltruth/i18n";

const blockedPathPattern = /\.(env|sql|bak|log|pem|key)$/i;
const ignoredPrefixes = ["/api/", "/_next/", "/sitemap.xml", "/robots.txt", "/favicon.ico", "/icon.svg"];

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { pathname } = request.nextUrl;

  if (blockedPathPattern.test(pathname) || pathname.includes("/.git/")) {
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
    url.pathname = `/${defaultLocale}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
