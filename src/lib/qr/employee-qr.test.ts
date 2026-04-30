import { describe, expect, it } from "vitest";
import { parseEmployeeIdFromQrText, parseEmployeeQrText } from "./employee-qr";

describe("parseEmployeeIdFromQrText", () => {
  it("reads labeled employee id payloads", () => {
    expect(
      parseEmployeeIdFromQrText(
        "Employee ID: CISS/ABC/2025-26/123\nName: Guard One\nPhone: 9999999999",
      ),
    ).toBe("CISS/ABC/2025-26/123");
  });

  it("reads raw ciss ids from the first line", () => {
    expect(parseEmployeeIdFromQrText("CISS/ABC/2025-26/123")).toBe("CISS/ABC/2025-26/123");
  });

  it("reads raw ciss ids anywhere in the payload", () => {
    expect(
      parseEmployeeIdFromQrText(
        "Name: Guard One\nPhone: 9999999999\nID: CISS/ABC/2025-26/123",
      ),
    ).toBe("CISS/ABC/2025-26/123");
  });

  it("returns null for unrelated text", () => {
    expect(parseEmployeeIdFromQrText("hello world")).toBeNull();
  });

  it("extracts the employee id and phone number from the qr payload", () => {
    expect(
      parseEmployeeQrText(
        "Employee ID: CISS/ABC/2025-26/123\nName: Guard One\nPhone: +91 99999 88888",
      ),
    ).toEqual({
      employeeId: "CISS/ABC/2025-26/123",
      phoneNumber: "9999988888",
    });
  });
});
