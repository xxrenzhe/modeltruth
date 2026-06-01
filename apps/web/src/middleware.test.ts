import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

function request(
  pathname: string,
  options: {
    acceptLanguage?: string;
    cookieLocale?: string;
    userAgent?: string;
  } = {}
) {
  const url = new URL(`https://modeltruth.ai${pathname}`);
  return {
    nextUrl: {
      pathname,
      clone() {
        return new URL(url.toString());
      }
    },
    cookies: {
      get(name: string) {
        return name === "locale" && options.cookieLocale ? { value: options.cookieLocale } : undefined;
      }
    },
    headers: {
      get(name: string) {
        const normalized = name.toLowerCase();
        if (normalized === "accept-language") return options.acceptLanguage ?? "";
        if (normalized === "user-agent") return options.userAgent ?? "";
        return null;
      }
    }
  } as never;
}

describe("middleware", () => {
  it("blocks dangerous files and common repository probes", () => {
    expect(middleware(request("/.env"))?.status).toBe(404);
    expect(middleware(request("/backup.sql"))?.status).toBe(404);
    expect(middleware(request("/.git/config"))?.status).toBe(404);
    expect(middleware(request("/wp-admin/setup-config.php"))?.status).toBe(404);
    expect(middleware(request("/phpmyadmin/index.php"))?.status).toBe(404);
  });

  it("does not locale-redirect API and infrastructure routes", () => {
    const api = middleware(request("/api/health"));
    const sitemap = middleware(request("/sitemap.xml"));
    expect(api?.status).not.toBe(307);
    expect(sitemap?.status).not.toBe(307);
    expect(api?.headers.get("x-request-id")).toBeTruthy();
  });

  it("redirects public non-locale pages to default locale with request id", () => {
    const response = middleware(request("/pricing"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toContain("/en/pricing");
    expect(response?.headers.get("x-request-id")).toBeTruthy();
  });

  it("uses locale cookie before Accept-Language for public redirects", () => {
    const response = middleware(request("/pricing", { acceptLanguage: "en-US,en;q=0.8", cookieLocale: "zh-CN" }));
    expect(response?.headers.get("location")).toContain("/zh-CN/pricing");
  });

  it("uses Accept-Language when no locale cookie is set", () => {
    const response = middleware(request("/", { acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.5" }));
    expect(response?.headers.get("location")).toContain("/zh-CN");
  });

  it("persists the selected locale when visiting localized pages", () => {
    const response = middleware(request("/zh-CN/pricing"));
    expect(response?.status).not.toBe(307);
    expect(response?.headers.getSetCookie().join(";")).toContain("locale=zh-CN");
  });

  it("defaults search bots to the English canonical entry", () => {
    const response = middleware(request("/", { acceptLanguage: "zh-CN,zh;q=0.9", userAgent: "Googlebot/2.1" }));
    expect(response?.headers.get("location")).toContain("/en");
  });
});
