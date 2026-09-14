import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/employees/[id]/page.tsx"),
  "utf8",
);
const documentRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/employees/profile/[id]/document/route.ts"),
  "utf8",
);

describe("employee document rows", () => {
  it("offers view and download as independent actions", () => {
    const documentItem = profileSource.slice(
      profileSource.indexOf("const DocumentItem"),
      profileSource.indexOf("const ADMIN_DOCUMENT_URL_FIELDS"),
    );

    // A document that can be downloaded must still expose its view action.
    expect(documentItem).toContain("View and Download are independent actions");
    expect(documentItem).toContain("onClick={onView}");
    expect(documentItem).toContain("onClick={onDownload}");
    expect(documentItem).toContain('target="_blank" rel="noopener noreferrer"');
    // The regression shadowed the stored link behind a download-only branch.
    expect(documentItem).not.toContain("View/Download");
  });

  it("keeps a direct view link for every admin document row", () => {
    // Admins view the stored object at full fidelity; the audited streaming
    // viewer is the fallback used by field officers and client accounts.
    const adminRows = profileSource.match(/url=\{isAdminView \? employee\./g) ?? [];
    expect(adminRows.length).toBeGreaterThanOrEqual(9);
    expect(profileSource).toContain("url={isFieldOfficerView ? undefined : employee.profilePictureUrl}");
  });

  it("keeps the streaming view for field officers", () => {
    expect(profileSource).toContain(
      'onView={isFieldOfficerView && hasProfilePictureDocument ? () => void viewGuardDocument("profile-picture") : undefined}',
    );
    expect(profileSource).toContain(
      'onView={isFieldOfficerView && hasSignatureDocument ? () => void viewGuardDocument("signature") : undefined}',
    );
    expect(profileSource).toContain(
      'onView={isFieldOfficerView && hasPoliceClearanceDocument ? () => void viewGuardDocument("police-clearance") : undefined}',
    );
  });

  it("lets client accounts view identity, address and qualification documents", () => {
    const clientViewable = [
      ["identity-front", "IdentityFront"],
      ["identity-back", "IdentityBack"],
      ["address-front", "AddressFront"],
      ["address-back", "AddressBack"],
    ] as const;

    for (const [category, flag] of clientViewable) {
      expect(profileSource).toContain(
        `onView={!isAdminView && has${flag}Document ? () => void viewGuardDocument("${category}") : undefined}`,
      );
    }
    // The qualification certificate is streamed as a PDF for every role.
    expect(profileSource).toContain(
      'onView={hasQualificationCertificate ? () => void viewGuardDocument("qualification-certificate") : undefined}',
    );
  });

  it("does not offer a profile picture download to client accounts", () => {
    expect(profileSource).toContain("const canStreamProfilePicture = !isClientView;");
    expect(profileSource).toContain(
      'onDownload={canStreamProfilePicture && hasProfilePictureDocument ? () => void downloadGuardDocument("profile-picture") : undefined}',
    );
    // The streaming route refuses profile pictures to client accounts, so the
    // button must stay hidden for that role instead of failing with a 403.
    expect(documentRouteSource).toContain("CLIENT_DOCUMENT_CATEGORIES");
    const clientCategories = documentRouteSource.slice(
      documentRouteSource.indexOf("const CLIENT_DOCUMENT_CATEGORIES"),
      documentRouteSource.indexOf("function resolveStoragePath"),
    );
    expect(clientCategories).not.toContain("profile-picture");
  });

  it("keeps both view and download for restricted Aadhaar copies", () => {
    expect(profileSource).toContain("View Aadhaar front");
    expect(profileSource).toContain("Download Aadhaar front (JPEG)");
    expect(profileSource).toContain("View Aadhaar back");
    expect(profileSource).toContain("Download Aadhaar back (JPEG)");
    expect(profileSource).toContain("const viewAadhaarDocument = async (side: 'front' | 'back') => {");
    expect(profileSource).toContain("aadhaar/document?side=${side}`");
  });
});
