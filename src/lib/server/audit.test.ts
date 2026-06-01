import { describe, expect, it } from "vitest";

import { buildServerAuditEvent } from "./audit";

describe("buildServerAuditEvent", () => {
  it("omits undefined detail values so Firestore writes stay valid", () => {
    const event = buildServerAuditEvent(
      "attendance_submitted",
      undefined,
      {
        employeeDocId: "emp-1",
        clientRequestId: undefined,
      },
    );

    expect(event).toMatchObject({
      action: "attendance_submitted",
      by: null,
      byEmail: null,
      employeeDocId: "emp-1",
    });
    expect(event).not.toHaveProperty("clientRequestId");
  });
});
