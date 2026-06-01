import QRCode from "qrcode";
import { buildQrContent } from "./qr/qr-token";

/**
 * Generate a signed QR code data URL for an employee.
 * The QR includes an HMAC token to prevent tampering and forgery.
 */
export async function generateQrCodeDataUrl(
  employeeId: string,
  fullName: string,
  phoneNumber: string
): Promise<string> {
  const dataString = await buildQrContent(employeeId, fullName, phoneNumber);

  return QRCode.toDataURL(dataString, {
    errorCorrectionLevel: "H",
    margin: 1,
    type: "image/png",
    width: 256,
  } as Parameters<typeof QRCode.toDataURL>[1]);
}
