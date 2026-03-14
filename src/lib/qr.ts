import QRCode from "qrcode";

export async function generateQrCodeDataUrl(
  employeeId: string,
  fullName: string,
  phoneNumber: string
): Promise<string> {
  const dataString = `Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`;

  return QRCode.toDataURL(dataString, {
    errorCorrectionLevel: "H",
    margin: 1,
    type: "image/png",
    width: 256,
  } as Parameters<typeof QRCode.toDataURL>[1]);
}
