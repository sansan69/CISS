/**
 * Text extraction for payslip PDFs.
 *
 * Uses the legacy pdfjs build (configured in `next.config.ts` under
 * `serverExternalPackages`) so the serverless bundler does not try to trace its
 * optional canvas dependency.
 *
 * Contract: this function NEVER throws. Malformed, encrypted or truncated PDFs
 * return `complete: false` with empty text, and the caller refuses the file.
 * Every page is inspected (within explicit resource limits) because a PDF that
 * contains more than one employee's slip must never be attributed to the first
 * employee.
 */

/** Safety caps: a payslip is a handful of pages, never a 500-page bundle. */
export const PAYSLIP_MAX_PAGES = 50;
export const PAYSLIP_MAX_CHARS = 200_000;

export type PdfTextExtraction = {
  text: string;
  /** True only when every page was inspected and the text stayed within limits. */
  complete: boolean;
  pagesRead: number;
  totalPages: number;
};

/** Collapse runs of whitespace so regexes can match across pdfjs's text items. */
export function normalizePayslipPdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export async function extractPdfTextDetailed(
  buffer: Buffer,
): Promise<PdfTextExtraction> {
  const empty = { text: "", complete: false, pagesRead: 0, totalPages: 0 };
  if (!buffer || buffer.length === 0) return empty;

  let doc: {
    numPages: number;
    getPage: (n: number) => Promise<any>;
    destroy: () => Promise<void>;
  } | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    doc = await pdfjs.getDocument({
      // A copy, because pdfjs transfers (detaches) the typed array it is given.
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    const totalPages = doc.numPages;
    const pages = Math.min(totalPages, PAYSLIP_MAX_PAGES);
    const chunks: string[] = [];
    let chars = 0;
    let complete = totalPages <= PAYSLIP_MAX_PAGES;

    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = (content.items as Array<{ str?: string }>)
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .join(" ");
        chunks.push(text);
        chars += text.length;
        if (chars > PAYSLIP_MAX_CHARS) {
          complete = false;
          break;
        }
      } finally {
        (page as { cleanup?: () => void }).cleanup?.();
      }
    }

    return {
      text: complete ? normalizePayslipPdfText(chunks.join("\n")) : "",
      complete,
      pagesRead: pages,
      totalPages,
    };
  } catch (error) {
    // Never surface file contents; the reason is enough to diagnose a bad
    // upload or a missing runtime dependency.
    console.warn(
      "[payslip-pdf] text extraction failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { ...empty, totalPages: doc?.numPages ?? 0 };
  } finally {
    await doc?.destroy?.().catch(() => undefined);
  }
}

/** Text only; callers that store the whole PDF must use the detailed result. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  return (await extractPdfTextDetailed(buffer)).text;
}
