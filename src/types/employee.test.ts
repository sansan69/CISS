import { describe, expect, it } from "vitest";
import { employeeSchema } from "./employee";

describe("employeeSchema", () => {
  it("accepts employee records created by the LNG enrollment flow", () => {
    const parsed = employeeSchema.safeParse({
      id: "employee-doc-1",
      employeeId: "KL/LNG/2026-27/001",
      clientName: "LNG Petronet",
      firstName: "DUMMY",
      lastName: "GUARD",
      fullName: "DUMMY GUARD",
      dateOfBirth: { seconds: 788918400, nanoseconds: 0 },
      gender: "Male",
      fatherName: "DUMMY FATHER",
      motherName: "DUMMY MOTHER",
      maritalStatus: "Unmarried",
      district: "Ernakulam",
      panNumber: "AABCT1234C",
      aadharNumber: "123456789012",
      nationality: "INDIAN",
      identificationMark: "MOLE ON LEFT HAND",
      heightCm: 170,
      weightKg: 68,
      jobDesignation: "Lady Security Guard",
      lngJobDesignation: "Lady Security Guard",
      aadharCardDocumentUrl: "https://example.com/aadhar.pdf",
      panCardDocumentUrl: "https://example.com/pan.pdf",
      passportCountryName: "INDIA",
      passportDocumentUrl: "https://example.com/passport.pdf",
      educationalQualification: "Graduation",
      identityProofType: "PAN Card",
      identityProofNumber: "AABCT1234C",
      identityProofUrlFront: "https://example.com/id-front.png",
      identityProofUrlBack: "https://example.com/id-back.png",
      addressProofType: "Aadhar Card",
      addressProofNumber: "123456789012",
      addressProofUrlFront: "https://example.com/address-front.png",
      addressProofUrlBack: "https://example.com/address-back.png",
      signatureUrl: "https://example.com/signature.png",
      fullAddress: "DUMMY HOUSE, DUMMY ROAD, ERNAKULAM",
      phoneNumber: "9012345689",
      profilePictureUrl: "https://example.com/profile.png",
      joiningDate: { seconds: 1777595400, nanoseconds: 0 },
      status: "Active",
      createdAt: { seconds: 1777595400, nanoseconds: 0 },
      updatedAt: { seconds: 1777595400, nanoseconds: 0 },
    });

    expect(parsed.success).toBe(true);
  });
});
