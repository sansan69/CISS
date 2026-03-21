import { verifyRequestAuth } from "@/lib/server/auth";

export async function requireGuard(
  request: Request
): Promise<{ uid: string; employeeId: string; employeeDocId: string }> {
  const decodedToken = await verifyRequestAuth(request);

  if (decodedToken.role !== "guard") {
    throw new Error("Guard access required.");
  }

  const employeeId =
    typeof decodedToken.employeeId === "string" ? decodedToken.employeeId : "";
  const employeeDocId =
    typeof decodedToken.employeeDocId === "string"
      ? decodedToken.employeeDocId
      : "";

  return { uid: decodedToken.uid, employeeId, employeeDocId };
}
