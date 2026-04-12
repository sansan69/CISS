import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootLayoutSource = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
const homePageSource = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
const adminLoginSource = readFileSync(resolve(process.cwd(), "src/app/admin-login/page.tsx"), "utf8");
const appLayoutSource = readFileSync(resolve(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
const fcmSource = readFileSync(resolve(process.cwd(), "src/lib/fcm.ts"), "utf8");

describe("browser warning guards", () => {
  it("marks the root html element for smooth scrolling", () => {
    expect(rootLayoutSource).toContain('data-scroll-behavior="smooth"');
  });

  it("prioritizes the landing-page logo image", () => {
    expect(homePageSource).toMatch(
      /<Image[\s\S]*src="\/ciss-logo\.png"[\s\S]*priority[\s\S]*\/>/
    );
  });

  it("uses the logo asset's intrinsic aspect ratio on the admin login page", () => {
    expect(adminLoginSource).toMatch(
      /<Image[\s\S]*src="\/ciss-logo\.png"[\s\S]*width=\{200\}[\s\S]*height=\{202\}[\s\S]*\/>/
    );
  });

  it("does not warn when a user simply denies notification permission", () => {
    expect(fcmSource).not.toContain("Notification permission denied");
  });

  it("keeps the app-shell logo images on automatic aspect ratio sizing", () => {
    const logoImageMatches =
      appLayoutSource.match(/<Image[\s\S]*?src="\/ciss-logo\.png"[\s\S]*?\/>/g) ?? [];

    expect(logoImageMatches.length).toBeGreaterThan(0);
    for (const imageTag of logoImageMatches) {
      expect(imageTag).toMatch(/className="[^"]*\bh-auto\b[^"]*\bw-auto\b[^"]*"/);
    }
  });
});
