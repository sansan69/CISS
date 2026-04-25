import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";

export function normalizePdfText(input: unknown): string {
  let s = (input ?? "").toString();
  s = s.replace(/\r\n/g, "\n");
  s = s.replace(/\r/g, "\n");
  s = s.replace(/ /g, " ");
  s = s.replace(/\t/g, " ");
  return s;
}

export function wrapTextToWidth(
  text: string,
  font: { widthOfTextAtSize(text: string): number },
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const raw of normalizePdfText(text).split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      const width = font.widthOfTextAtSize(test);
      if (width > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    lines.push(line || "");
  }
  return lines;
}

export function drawMultilineText(opts: {
  page: { drawText(text: string, opts: { x: number; y: number }): void };
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  font: { widthOfTextAtSize(text: string): number };
  fontSize: number;
}): void {
  const lines = wrapTextToWidth(opts.text, opts.font, opts.fontSize, opts.maxWidth);
  let y = opts.y;
  for (const line of lines) {
    opts.page.drawText(line, { x: opts.x, y });
    y -= opts.fontSize * 1.4;
  }
}

export function sanitizePdfString(input: unknown): string {
  const s = normalizePdfText(input);
  return s.replace(/[^\S\n]+/g, " ");
}

export function titleCase(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export async function fetchImageBytes(
  url: string | undefined,
): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}