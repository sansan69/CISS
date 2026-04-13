import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const pagePath = resolve(process.cwd(), "src/app/page.tsx");
const pageSource = readFileSync(pagePath, "utf8");

const lucideProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "__esModule") return true;
      if (prop === "default") return {};
      return (props: Record<string, unknown>) =>
        React.createElement("svg", {
          ...props,
          "data-icon": String(prop),
          "aria-hidden": "true",
        });
    },
  },
);

type MockWithChildrenProps = Record<string, unknown> & {
  children?: React.ReactNode;
};

const moduleMocks: Record<string, unknown> = {
  "next/navigation": {
    useRouter: () => ({
      push() {},
      replace() {},
      refresh() {},
      back() {},
      forward() {},
      prefetch() {},
    }),
  },
  "next/image": {
    __esModule: true,
    default: ({ alt, src, priority: _priority, ...props }: Record<string, unknown>) =>
      React.createElement("img", {
        ...props,
        alt,
        src,
      }),
  },
  "next/link": {
    __esModule: true,
    default: ({ href, children, ...props }: MockWithChildrenProps & { href?: string }) =>
      React.createElement("a", { href, ...props }, children),
  },
  "lucide-react": lucideProxy,
  "@/hooks/use-toast": {
    useToast: () => ({
      toast() {},
    }),
  },
  "@/components/ui/button": {
    __esModule: true,
    Button: ({ children, ...props }: MockWithChildrenProps) =>
      React.createElement("button", props, children),
  },
  "@/components/ui/input": {
    __esModule: true,
    Input: (props: Record<string, unknown>) => React.createElement("input", props),
  },
};

let cachedLandingPage: React.ComponentType | null = null;

function loadLandingPage() {
  if (cachedLandingPage) return cachedLandingPage;

  const { code } = transformSync(pageSource, {
    loader: "tsx",
    format: "cjs",
    target: "es2018",
  });

  const compiledModule = { exports: {} as Record<string, unknown> };
  const localRequire = (request: string) =>
    (moduleMocks[request] as Record<string, unknown>) ?? require(request);

  // Execute the real page module in-process with only the external dependencies mocked.
  new Function("require", "module", "exports", code)(
    localRequire,
    compiledModule,
    compiledModule.exports,
  );

  cachedLandingPage = (compiledModule.exports.default ??
    compiledModule.exports) as React.ComponentType;
  return cachedLandingPage;
}

function normalizeTextContent(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHrefList(html: string) {
  const hrefs: string[] = [];
  const anchorPattern = /<a\b[^>]*\bhref="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    hrefs.push(match[1]);
  }
  return hrefs;
}

function extractImageData(html: string) {
  const images: Array<{ alt?: string; src?: string }> = [];
  const imagePattern = /<img\b([^>]*)>/gi;
  const altPattern = /\balt="([^"]*)"/i;
  const srcPattern = /\bsrc="([^"]*)"/i;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(html))) {
    const attrs = match[1];
    images.push({
      alt: attrs.match(altPattern)?.[1],
      src: attrs.match(srcPattern)?.[1],
    });
  }

  return images;
}

function indexOfAttribute(html: string, attribute: string) {
  const index = html.indexOf(attribute);
  expect(index, `expected to find "${attribute}" in rendered html`).toBeGreaterThanOrEqual(0);
  return index;
}

function indexOfText(textContent: string, value: string) {
  const index = textContent.indexOf(value);
  expect(index, `expected to find "${value}" in rendered text`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("landing page surface", () => {
  it("renders the approved editorial split desktop and native mobile landing surface", () => {
    const LandingPage = loadLandingPage();
    const html = renderToStaticMarkup(React.createElement(LandingPage));
    const textContent = normalizeTextContent(html);
    const hrefs = extractHrefList(html);
    const images = extractImageData(html);

    const shellIndex = indexOfAttribute(html, 'data-slot="landing-shell"');
    const headerSectionIndex = indexOfAttribute(html, 'data-mobile-section="header"');
    const verificationSectionIndex = indexOfAttribute(html, 'data-mobile-section="verification"');
    const quickAccessSectionIndex = indexOfAttribute(html, 'data-mobile-section="quick-access"');
    const brandIndex = indexOfText(textContent, "CISS Workforce");
    const descriptorIndex = indexOfText(textContent, "Security workforce management platform");
    const verificationIntroIndex = indexOfText(textContent, "Enter mobile number.");
    const mobileLabelIndex = indexOfText(textContent, "Mobile number");
    const verifyButtonIndex = indexOfText(textContent, "Verify Employee");
    const quickAccessIndex = indexOfText(textContent, "Quick access");
    const attendanceIndex = indexOfText(textContent, "Record Attendance");

    expect(brandIndex).toBeLessThan(descriptorIndex);
    expect(shellIndex).toBeLessThan(headerSectionIndex);
    expect(headerSectionIndex).toBeLessThan(verificationSectionIndex);
    expect(verificationSectionIndex).toBeLessThan(quickAccessSectionIndex);
    expect(descriptorIndex).toBeLessThan(verificationIntroIndex);
    expect(verificationIntroIndex).toBeLessThan(mobileLabelIndex);
    expect(mobileLabelIndex).toBeLessThan(verifyButtonIndex);
    expect(verifyButtonIndex).toBeLessThan(quickAccessIndex);
    expect(verificationIntroIndex).toBeLessThan(quickAccessIndex);
    expect(verificationIntroIndex).toBeLessThan(attendanceIndex);

    expect(textContent).toContain("CISS Workforce");
    expect(textContent).toContain("Security workforce management platform");
    expect(textContent).toContain("Enter mobile number.");
    expect(textContent).toContain("Fast mobile verification for daily workforce access.");
    expect(hrefs).toEqual(expect.arrayContaining(["/attendance", "/guard-login", "/admin-login"]));
    expect(images).toEqual(
      expect.arrayContaining([{ alt: "CISS Workforce Logo", src: "/ciss-logo.png" }]),
    );
    expect(html).toContain('data-desktop-section="brand"');
    expect(html).toContain("lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]");
    expect(html).not.toContain('aria-label="Desktop hero"');
    expect(html).not.toContain(
      "rounded-[2rem] border border-white/30 bg-[linear-gradient(135deg,#014c85_0%,#0f67a7_58%,#3f87bd_100%)]",
    );
    expect(html).not.toContain("shadow-[0_28px_80px_-30px_rgba(1,76,133,0.85)]");
    expect(html).not.toContain("Verify guards, record attendance, and access admin operations fast.");
    expect(html).not.toContain("Native mobile access");
    expect(html).toContain('data-mobile-section="header"');
    expect(html).toContain("lg:hidden");
    expect(html).toContain('data-mobile-section="header"');
    expect(html).toContain('data-mobile-section="verification"');
    expect(html).toContain('data-mobile-section="quick-access"');
    expect(html).not.toContain('data-mobile-section="install"');
  });
});
