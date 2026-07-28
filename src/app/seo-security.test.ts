import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("public SEO metadata", () => {
  it("publishes a canonical homepage and a 1200 by 630 social image", () => {
    const pageSource = readSource("src/app/page.tsx");
    const imageSource = readSource("src/app/opengraph-image.tsx");

    expect(pageSource).toContain('canonical: "/"');
    expect(pageSource).toContain('url: "/opengraph-image"');
    expect(pageSource).toContain("width: 1200");
    expect(pageSource).toContain("height: 630");
    expect(imageSource).toContain("width: 1200");
    expect(imageSource).toContain("height: 630");
  });

  it("guides crawlers to public pages and advertises the sitemap", () => {
    const robotsMetadata = robots();
    const sitemapMetadata = sitemap();

    expect(robotsMetadata.sitemap).toBe("https://cisskerala.site/sitemap.xml");
    expect(robotsMetadata.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userAgent: "*",
          disallow: expect.arrayContaining(["/api/", "/dashboard", "/guard/"]),
        }),
      ]),
    );
    expect(sitemapMetadata.map((entry) => entry.url)).toEqual([
      "https://cisskerala.site",
      "https://cisskerala.site/download",
      "https://cisskerala.site/enroll",
    ]);
  });
});

describe("browser security policy", () => {
  it("sets MIME sniffing and clickjacking protection headers", () => {
    const configSource = readSource("next.config.ts");

    expect(configSource).toContain('"X-Content-Type-Options"');
    expect(configSource).toContain('"nosniff"');
    expect(configSource).toContain('"X-Frame-Options"');
    expect(configSource).toContain('"DENY"');
  });

  it("uses nonce-based scripts and restrictive CSP directives", () => {
    const middlewareSource = readSource("src/middleware.ts");
    const layoutSource = readSource("src/app/layout.tsx");

    expect(middlewareSource).toContain("'nonce-${nonce}'");
    expect(middlewareSource).toContain("\"object-src 'none'\"");
    expect(middlewareSource).toContain("\"frame-ancestors 'none'\"");
    expect(layoutSource).toContain("nonce={nonce}");
  });
});
