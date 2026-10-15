import { describe, expect, it } from "vitest";

/**
 * An unauthenticated read must be reported as 401. These routes previously fell
 * through to the generic catch and answered 500 with the internal message
 * "Missing bearer token.", which reads as a server fault to the caller.
 */
describe("client read routes without a bearer token", () => {
  const unauthenticated = () =>
    new Request("https://example.test/api/client/attendance");

  it("attendance answers 401, not 500", async () => {
    const { GET } = await import("./route");
    const response = await GET(unauthenticated());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid session." });
  });

  it("guards answers 401, not 500", async () => {
    const { GET } = await import("../guards/route");
    const response = await GET(unauthenticated());

    expect(response.status).toBe(401);
  });

  it("work orders answers 401, not 500", async () => {
    const { GET } = await import("../work-orders/route");
    const response = await GET(unauthenticated());

    expect(response.status).toBe(401);
  });
});
