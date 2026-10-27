import { describe, expect, it } from "vitest";

import { isHostAllowed, normalizeHost } from "./domain-lock";

describe("normalizeHost", () => {
  it("strips scheme, path, port, case and trailing dot", () => {
    expect(normalizeHost("HTTPS://Ciss-TN.In:443/app?x=1")).toBe("ciss-tn.in");
    expect(normalizeHost("ciss-tn.in.")).toBe("ciss-tn.in");
    expect(normalizeHost("localhost:3000")).toBe("localhost");
  });

  it("returns an empty string for unusable input", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("http://[bad")).toBe("");
  });
});

describe("isHostAllowed", () => {
  it("allows everything when no allowlist is configured", () => {
    expect(isHostAllowed("anything.example", [])).toBe(true);
    expect(isHostAllowed("anything.example", null)).toBe(true);
  });

  it("allows exact domains, with or without a port", () => {
    expect(isHostAllowed("ciss-tn.in", ["ciss-tn.in"])).toBe(true);
    expect(isHostAllowed("ciss-tn.in:443", ["ciss-tn.in"])).toBe(true);
    expect(isHostAllowed("app.ciss-tn.in", ["ciss-tn.in"])).toBe(false);
  });

  it("supports wildcard subdomains but not the bare apex", () => {
    expect(isHostAllowed("app.ciss-tn.in", ["*.ciss-tn.in"])).toBe(true);
    expect(isHostAllowed("ciss-tn.in", ["*.ciss-tn.in"])).toBe(false);
  });

  it("rejects a different domain", () => {
    expect(isHostAllowed("evil.example", ["ciss-tn.in"])).toBe(false);
    expect(isHostAllowed("ciss-tn.in.evil.example", ["ciss-tn.in"])).toBe(false);
  });

  it("allows loopback only in development", () => {
    expect(isHostAllowed("localhost:3000", ["ciss-tn.in"], { isDev: true })).toBe(true);
    expect(isHostAllowed("localhost:3000", ["ciss-tn.in"], { isDev: false })).toBe(false);
  });
});
