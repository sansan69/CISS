import { describe, expect, it } from "vitest";

import { matchesClientScope } from "./client-access";

const scope = {
  clientId: "client-geodis",
  clientName: "Geodis India Ltd.",
  stateCode: null,
};

describe("matchesClientScope", () => {
  it("matches attendance records by home employee client as well as worked site client", () => {
    expect(
      matchesClientScope(
        {
          clientName: "Federal Bank Ltd.",
          siteClientName: "Federal Bank Ltd.",
          employeeClientName: "Geodis India Ltd.",
        },
        scope,
      ),
    ).toBe(true);

    expect(
      matchesClientScope(
        {
          clientName: "Federal Bank Ltd.",
          siteClientName: "Federal Bank Ltd.",
          employeeClientName: "Federal Bank Ltd.",
        },
        scope,
      ),
    ).toBe(false);
  });
});
