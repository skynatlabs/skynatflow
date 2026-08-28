import QRCode from "qrcode";

// Returns a base64 PNG data URL — @react-pdf/renderer's <Image> accepts a
// data URL directly, no file storage needed.
export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 200 });
}
