import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const PDF_SIGNATURE = Buffer.from("%PDF-");
const PDF_RENDER_SCALE = 1.5;
const JPEG_QUALITY = 90;

function isPdfBuffer(buffer: Buffer) {
  return buffer.subarray(0, 1024).includes(PDF_SIGNATURE);
}

async function pdfToJpeg(buffer: Buffer) {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import("@napi-rs/canvas"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  const standardFontDataUrl = pathToFileURL(
    path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
  ).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl,
  });
  const pdf = await loadingTask.promise;

  try {
    const pages: { buffer: Buffer; width: number; height: number }[] = [];
    let totalHeight = 0;
    let maxWidth = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const pageBuffer = canvas.toBuffer("image/png");
      const width = canvas.width;
      const height = canvas.height;
      pages.push({ buffer: pageBuffer, width, height });
      totalHeight += height;
      maxWidth = Math.max(maxWidth, width);
      page.cleanup();
    }

    if (pages.length === 0) {
      throw new Error("The PDF does not contain a page.");
    }

    let top = 0;
    const composites = pages.map((page) => {
      const composite = { input: page.buffer, left: 0, top };
      top += page.height;
      return composite;
    });

    return sharp({
      create: {
        width: maxWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(composites)
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } finally {
    await pdf.destroy();
  }
}

export async function documentToJpeg(buffer: Buffer, contentType?: string) {
  const normalizedContentType = contentType?.toLowerCase().split(";", 1)[0];
  if (normalizedContentType === "application/pdf" || isPdfBuffer(buffer)) {
    return pdfToJpeg(buffer);
  }

  return sharp(buffer)
    .rotate()
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
