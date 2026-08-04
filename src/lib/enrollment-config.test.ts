import { describe, expect, it } from "vitest";
import {
  getEnabledFields,
  normalizeEnrollmentFormConfig,
  validateEnrollmentSubmissionAgainstConfig,
} from "./enrollment-config";
import { MANDATORY_NEW_ENROLLMENT_FIELDS } from "./enrollment-policy";

describe("new enrollment mandatory document policy", () => {
  it("merges newer fields into an older saved configuration and protects mandatory settings", () => {
    const config = normalizeEnrollmentFormConfig({
      sections: {
        documents: {
          label: "Old documents",
          fields: [{ key: "identityProofType", label: "Old identity", enabled: false, required: false, order: 1 }],
        },
        details: {
          label: "Old details",
          fields: [{ key: "aadharNumber", label: "Old Aadhaar", enabled: false, required: false, order: 1 }],
        },
      },
    });
    const documentKeys = config.sections.documents.fields.map((field) => field.key);
    expect(documentKeys).toContain("aadharCardDocumentBack");
    expect(config.sections.documents.fields.find((field) => field.key === "identityProofType")).toMatchObject({
      label: "Old identity",
      enabled: true,
      required: true,
    });
    expect(config.sections.documents.fields.map((field) => field.key)).toContain("aadharNumber");
    expect(config.sections.details.fields.map((field) => field.key)).not.toContain("aadharNumber");
    expect(config.sections.details.fields.map((field) => field.key)).toContain("emailAddress");
  });

  it("keeps mandatory proofs, bank document, email, and consents required even when remote config disables fields", () => {
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
      "Profile picture is required",
      "Aadhaar number is required",
      "Aadhaar front copy is required",
      "Aadhaar back copy is required",
      "signatureUrl is required",
      "Bank passbook/statement is required",
      "Email address is required",
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

  it("allows a normalized client override to enable a globally disabled field", () => {
    const config = normalizeEnrollmentFormConfig({
      sections: {
        personal: {
          label: "Personal",
          fields: [{ key: "serviceBookDocument", label: "Service Book", enabled: false, required: false, order: 1 }],
        },
      },
      clientOverrides: {
        "LNG Petronet": {
          personal: {
            serviceBookDocument: { enabled: true, required: true },
          },
        },
      },
    });

    const fields = getEnabledFields(config, "Petronet LNG Ltd.");
    expect(fields.find((field) => field.key === "serviceBookDocument")).toMatchObject({
      enabled: true,
      required: true,
    });
  });
});
