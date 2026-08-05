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

  it("normalizes optional documents saved under legacy aliases", () => {
    expect(normalizeEmployeeDocumentFields({
      bankPassbookUrl: "bank.pdf",
      panCardUrl: { downloadURL: "pan.pdf" },
      serviceBookSourceUrl: "service-book.pdf",
      armsLicenseCopyUrl: "arms.pdf",
      passportCopyUrl: "passport.pdf",
      pccUrl: "pcc.pdf",
      highestQualificationDocumentUrl: "qualification.pdf",
    })).toMatchObject({
      bankPassbookStatementUrl: "bank.pdf",
      panCardDocumentUrl: "pan.pdf",
      serviceBookDocumentUrl: "service-book.pdf",
      armsLicenseDocumentUrl: "arms.pdf",
      passportDocumentUrl: "passport.pdf",
      policeClearanceCertificateUrl: "pcc.pdf",
      qualificationCertificateUrl: "qualification.pdf",
    });
  });

  it("accepts storage metadata objects as document references", () => {
    expect(normalizeEmployeeDocumentFields({
      identityProofUrlFront: { storagePath: "employees/guard/id-front.png" },
      addressProofUrlBack: { downloadUrl: "https://example.test/address-back.png" },
    })).toMatchObject({
      identityProofUrlFront: "employees/guard/id-front.png",
      addressProofUrlBack: "https://example.test/address-back.png",
    });
  });
});
