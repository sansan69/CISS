import { describe, expect, it } from "vitest";
import { enrollmentErrorFormField } from "./enrollment-errors";

describe("enrollment error field mapping", () => {
  it.each([
    ["serviceBookDocumentUrl", "serviceBookDocument"],
    ["armsLicenseDocumentUrl", "armsLicenseDocument"],
    ["panCardDocumentUrl", "panCardDocument"],
    ["aadharCardDocumentBackUrl", "aadharCardDocumentBack"],
    ["profilePictureUrl", "profilePicture"],
    ["termsAccepted", "termsAndConditions"],
    ["phoneNumber", "phoneNumber"],
  ])("maps %s onto the visible %s control", (api, form) => {
    expect(enrollmentErrorFormField(api)).toBe(form);
  });
});
