import { describe, expect, it } from "vitest";
import { normalizeEmployeeDocumentFields } from "@/lib/employee-document-fields";

describe("normalizeEmployeeDocumentFields", () => {
  it("maps legacy imported document field names to the profile names", () => {
    expect(normalizeEmployeeDocumentFields({
      profilePhotoUrl: "profile.jpg",
      signature: { url: "signature.png" },
      idProofType: "PAN Card",
      idProofNumber: "ABCDE1234F",
      idProofFrontUrl: "id-front.png",
      idProofBackUrl: "id-back.png",
      addressProofTypeLegacy: "Voter ID",
      addressProofNumberLegacy: "VOTER-001",
      addressProofFrontUrl: "address-front.png",
      addressProofBackUrl: "address-back.png",
    })).toEqual({
      profilePictureUrl: "profile.jpg",
      signatureUrl: "signature.png",
      identityProofType: "PAN Card",
      identityProofNumber: "ABCDE1234F",
      identityProofUrlFront: "id-front.png",
      identityProofUrlBack: "id-back.png",
      addressProofType: "Voter ID",
      addressProofNumber: "VOTER-001",
      addressProofUrlFront: "address-front.png",
      addressProofUrlBack: "address-back.png",
    });
  });

  it("prefers the current field when both current and legacy values exist", () => {
    expect(normalizeEmployeeDocumentFields({
      identityProofUrlFront: "current.png",
      idProofFrontUrl: "legacy.png",
    }).identityProofUrlFront).toBe("current.png");
  });

  it("falls back when a current field is present but empty", () => {
    expect(normalizeEmployeeDocumentFields({
      identityProofUrlFront: "",
      idProofFrontUrl: "legacy.png",
      addressProofType: "",
      addressProofTypeLegacy: "Voter ID",
    })).toMatchObject({
      identityProofUrlFront: "legacy.png",
      addressProofType: "Voter ID",
    });
  });
});
