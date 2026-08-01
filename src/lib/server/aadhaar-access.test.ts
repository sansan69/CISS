import { describe, expect, it } from "vitest";
import {
  requireAadhaarAdministratorToken,
} from "./auth";
import {
  documentCompletionFromEmployee,
  restrictedAadhaarPaths,
  validateAadhaarNumber,
} from "./aadhaar";

function token(overrides: Record<string, unknown> = {}) {
  return {
    uid: "admin-uid",
    aud: "project",
    auth_time: 1,
    exp: 2,
    firebase: { identities: {}, sign_in_provider: "password" },
    iat: 1,
    iss: "issuer",
    sub: "admin-uid",
    email: "admin@cisskerala.app",
    email_verified: true,
    role: "admin",
    ...overrides,
  } as any;
}

describe("Aadhaar restricted access", () => {
  it("allows only the verified designated admin account", () => {
    expect(requireAadhaarAdministratorToken(token()).email).toBe("admin@cisskerala.app");
    expect(() => requireAadhaarAdministratorToken(token({ email: "other-admin@cisskerala.app" }))).toThrow();
    expect(() => requireAadhaarAdministratorToken(token({ role: "superAdmin" }))).toThrow();
    expect(() => requireAadhaarAdministratorToken(token({ email_verified: false }))).toThrow();
  });

  it("performs syntax validation without claiming Aadhaar verification", () => {
    expect(validateAadhaarNumber("1234 5678 9012")).toBe("123456789012");
    expect(() => validateAadhaarNumber("1234")).toThrow();
  });

  it("grandfathers missing legacy documents and recognizes legacy field names", () => {
    expect(documentCompletionFromEmployee({}, false)).toEqual({
      aadhaar: "missing",
      identity: "missing",
      address: "missing",
    });
    expect(documentCompletionFromEmployee({
      aadharCardDocumentUrl: "legacy-aadhaar",
      idProofDocumentUrl: "legacy-id",
      addressProofUrlFront: "legacy-address",
    }, false)).toEqual({
      aadhaar: "complete",
      identity: "complete",
      address: "complete",
    });
  });

  it("collects only employee-scoped restricted files for replacement or deletion", () => {
    expect(restrictedAadhaarPaths({
      documentStoragePath: "restrictedEmployeeAadhaar/employee-1/front.jpg",
      additionalDocuments: [
        { documentStoragePath: "restrictedEmployeeAadhaar/employee-1/back.jpg" },
        { documentStoragePath: "restrictedEmployeeAadhaar/employee-2/not-owned.jpg" },
        { documentStoragePath: "employees/employee-1/aadharCards/legacy.jpg" },
      ],
    }, "employee-1")).toEqual([
      "restrictedEmployeeAadhaar/employee-1/front.jpg",
      "restrictedEmployeeAadhaar/employee-1/back.jpg",
    ]);
  });
});
