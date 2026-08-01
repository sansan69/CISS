import { describe, expect, it } from "vitest";
import { validateEnrollmentSubmissionAgainstConfig } from "./enrollment-config";
import { MANDATORY_NEW_ENROLLMENT_FIELDS } from "./enrollment-policy";

describe("new enrollment mandatory document policy", () => {
  it("keeps the three proofs and both consents required even when remote config disables fields", () => {
    const config = {
      sections: {
        documents: {
          label: "Documents",
          fields: MANDATORY_NEW_ENROLLMENT_FIELDS.map((key, order) => ({
            key,
            label: key,
            enabled: false,
            required: false,
            order,
          })),
        },
      },
    };

    const errors = validateEnrollmentSubmissionAgainstConfig(config, {});

    expect(errors).toEqual(expect.arrayContaining([
      "identityProofType is required",
      "identityProofNumber is required",
      "identityProofUrlFront is required",
      "addressProofType is required",
      "addressProofNumber is required",
      "Aadhaar number is required",
      "Aadhaar copy is required",
      "signatureUrl is required",
      "Terms and declaration is required",
      "Aadhaar consent is required",
    ]));
  });

  it("overrides a remote optional setting for protected fields", () => {
    const config = {
      sections: {
        documents: {
          label: "Documents",
          fields: [
            {
              key: "aadharNumber",
              label: "Optional Aadhaar",
              enabled: true,
              required: false,
              order: 1,
            },
          ],
        },
      },
    };

    expect(validateEnrollmentSubmissionAgainstConfig(config, {})).toContain(
      "Aadhaar number is required",
    );
  });
});
