import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAadhaarAdministratorMock = vi.fn();
const findEmployeeByIdMock = vi.fn();
const restrictedAadhaarDocumentMock = vi.fn();
const documentToJpegMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  requireAadhaarAdministrator: requireAadhaarAdministratorMock,
}));

vi.mock("@/lib/server/employee-document-access", () => ({
  findEmployeeById: findEmployeeByIdMock,
}));

vi.mock("@/lib/server/aadhaar", () => ({
  restrictedAadhaarDocument: restrictedAadhaarDocumentMock,
}));

vi.mock("@/lib/server/document-image-converter", () => ({
  documentToJpeg: documentToJpegMock,
}));

describe("GET /api/admin/employees/[id]/aadhaar/document", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("downloads Aadhaar documents as JPEG without recent password authentication", async () => {
    const privateData = {
      documentStoragePath: "restrictedEmployeeAadhaar/guard-1/front.png",
      contentType: "image/png",
    };
    const auditAdd = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "employeeAadhaarPrivate") {
          return {
            doc: () => ({
              get: async () => ({ exists: true, data: () => privateData }),
            }),
          };
        }
        return { add: auditAdd };
      }),
    };
    const download = vi.fn().mockResolvedValue([Buffer.from("png-bytes")]);
    const storage = { bucket: () => ({ file: () => ({ download }) }) };
    const employee = { id: "guard-1" };

    requireAadhaarAdministratorMock.mockResolvedValue({ uid: "admin-1" });
    findEmployeeByIdMock.mockResolvedValue(employee);
    restrictedAadhaarDocumentMock.mockReturnValue({
      side: "front",
      documentStoragePath: privateData.documentStoragePath,
      contentType: privateData.contentType,
    });
    documentToJpegMock.mockResolvedValue(Buffer.from("jpeg-bytes"));
    vi.doMock("@/lib/firebaseAdmin", () => ({ db, storage }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/employees/guard-1/aadhaar/document?side=front&download=true"),
      { params: Promise.resolve({ id: "guard-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="aadhaar-front.jpg"');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("jpeg-bytes");
    expect(documentToJpegMock).toHaveBeenCalledWith(Buffer.from("png-bytes"), "image/png");
    expect(auditAdd).toHaveBeenCalledWith(expect.objectContaining({ action: "aadhaar_document_downloaded" }));
  });
});
