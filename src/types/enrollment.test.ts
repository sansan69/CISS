import { describe, expect, it } from "vitest";
import { LNG_CLIENT_NAME } from "@/lib/constants";
import { enrollmentSubmissionSchema } from "@/types/enrollment";

const basePayload = {
  joiningDate: "2026-05-08T00:00:00.000Z",
  clientName: LNG_CLIENT_NAME,
  profilePictureUrl: "https://example.com/profile.jpg",
  fullNameInput: "Test Guard",
  firstName: "Test",
  lastName: "Guard",
  fatherName: "Test Father",
  motherName: "Test Mother",
  dateOfBirth: "1990-01-01T00:00:00.000Z",
  gender: "Male",
  maritalStatus: "Unmarried",
  educationalQualification: "High School",
  district: "Ernakulam",
  aadharNumber: "123456789012",
  nationality: "Indian",
  identificationMark: "Mole on left hand",
  heightCm: 172,
  weightKg: 72,
  lngJobDesignation: "Console Operator",
  identityProofType: "Aadhar Card",
  identityProofNumber: "123456789012",
  identityProofUrlFront: "https://example.com/id-front.jpg",
  identityProofUrlBack: "https://example.com/id-back.jpg",
  addressProofType: "PAN Card",
  addressProofNumber: "ABCDE1234F",
  addressProofUrlFront: "https://example.com/address-front.jpg",
  addressProofUrlBack: "https://example.com/address-back.jpg",
  signatureUrl: "https://example.com/signature.jpg",
  fullAddress: "Test address, Kochi, Kerala",
  phoneNumber: "9876543210",
};

describe("enrollmentSubmissionSchema", () => {
  it("accepts LNG Petronet variants without requiring a real email address", () => {
    const result = enrollmentSubmissionSchema.safeParse({
      ...basePayload,
      clientName: "Petronet LNG",
      emailAddress: "",
    });

    expect(result.success).toBe(true);
  });

  it("still requires service book details only for applicable LNG designations", () => {
    const result = enrollmentSubmissionSchema.safeParse({
      ...basePayload,
      lngJobDesignation: "Ex Servicemen Security Guard - Military",
      emailAddress: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.serviceBookNumber).toContain(
        "Service book number is required for this LNG designation.",
      );
    }
  });
});
