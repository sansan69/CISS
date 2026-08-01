import { describe, expect, it } from "vitest";
import {
  assertEnrollmentStorageFile,
  resolveEnrollmentStoragePath,
} from "./enrollment-documents";

const bucket = {
  file: () => ({
    exists: async () => [true] as [boolean],
  }),
};

describe("enrollment document references", () => {
  it("accepts a Firebase Storage URL from the current public draft", async () => {
    const reference =
      "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/" +
      `${encodeURIComponent("enrollments/draft-abc-123/profilePictures/profile.png")}?alt=media`;

    await expect(
      assertEnrollmentStorageFile(
        reference,
        "Profile picture",
        "profilePictures",
        {
          bucketName: "test-bucket",
          flow: "public",
          draftId: "draft-abc-123",
          phoneNumber: "9012345690",
        },
        bucket,
      ),
    ).resolves.toBe("enrollments/draft-abc-123/profilePictures/profile.png");
  });

  it("rejects external URLs and a file from another public draft", async () => {
    const context = {
      bucketName: "test-bucket",
      flow: "public" as const,
      draftId: "draft-abc-123",
      phoneNumber: "9012345690",
    };

    await expect(
      assertEnrollmentStorageFile("https://example.com/id-front.png", "Identity proof front", "idProofs", context, bucket),
    ).rejects.toThrow("must be uploaded through the enrollment form");

    await expect(
      assertEnrollmentStorageFile(
        "enrollments/other-draft/idProofs/id-front.png",
        "Identity proof front",
        "idProofs",
        context,
        bucket,
      ),
    ).rejects.toThrow("must be uploaded through the enrollment form");
  });

  it("accepts only the authenticated admin employee folder", async () => {
    const context = {
      bucketName: "test-bucket",
      flow: "admin" as const,
      phoneNumber: "9012345690",
    };

    await expect(
      assertEnrollmentStorageFile(
        "employees/9012345690/addressProofs/address-front.png",
        "Address proof front",
        "addressProofs",
        context,
        bucket,
      ),
    ).resolves.toBe("employees/9012345690/addressProofs/address-front.png");

    await expect(
      assertEnrollmentStorageFile(
        "employees/9012345691/addressProofs/address-front.png",
        "Address proof front",
        "addressProofs",
        context,
        bucket,
      ),
    ).rejects.toThrow("must be uploaded through the enrollment form");
  });

  it("returns null for a Storage URL belonging to another bucket", () => {
    expect(
      resolveEnrollmentStoragePath(
        "https://firebasestorage.googleapis.com/v0/b/other-bucket/o/enrollments%2Fdraft-abc-123%2FidProofs%2Fid.png?alt=media",
        "test-bucket",
      ),
    ).toBeNull();
  });
});
