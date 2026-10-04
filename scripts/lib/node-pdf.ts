// Node-side helpers: open a PDF with pdf.js's legacy (Node) build and run the
// same extraction + conversion code the extension uses.
import { readFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { convert, type ConvertOptions } from '../../src/core/convert';
import { countDocumentText, extractPages } from '../../src/core/extract/extract';
import { parsePageRange, samplePages } from '../../src/core/pages/range';
import type { ConversionResult, PageContent } from '../../src/core/types';
import { createNodeOcr } from './node-ocr';

export const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures');
/** pdf.js asset folder, as a path with a trailing slash (pdf.js appends file names). */
const PDFJS_ROOT = join(import.meta.dirname, '..', '..', 'node_modules', 'pdfjs-dist') + sep;

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Frees the document and its worker-side resources. */
  close: () => Promise<void>;
}

export async function openPdf(path: string): Promise<OpenedPdf> {
  const data = new Uint8Array(await readFile(path));
  // fontExtraProperties: same setting as the extension, so real font names
  // (used for bold detection) are available. The wasm image decoders and
  // standard fonts are needed to render pages for OCR (scans are often
  // JPEG 2000 or JBIG2 images).
  const task = getDocument({
    data,
    verbosity: 0,
    fontExtraProperties: true,
    wasmUrl: PDFJS_ROOT + 'wasm/',
    standardFontDataUrl: PDFJS_ROOT + 'standard_fonts/',
  });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

export async function openFixture(name: string): Promise<OpenedPdf> {
  return openPdf(join(FIXTURES, name));
}

export async function convertPdf(
  path: string,
  range = '',
  options: ConvertOptions = { pageMarkers: true },
  { ocr = false }: { ocr?: boolean } = {},
): Promise<ConversionResult> {
  const { doc, close } = await openPdf(path);
  try {
    const parsed = parsePageRange(range, doc.numPages);
    if (!parsed.ok) throw new Error(parsed.error);
    const sample = samplePages(parsed.pages, doc.numPages);
    let pages = await extractPages(doc, sample, { fonts: true });
    const whole = await countDocumentText(doc);
    const input = { selected: parsed.pages, options, fileName: basename(path), wholeDocument: whole };
    const first = convert({ ...input, pages });
    if (!ocr || first.scannedPages.length === 0) return first;
    // Same flow as the side panel: OCR the pages convert reported, then convert again.
    const engine = await createNodeOcr();
    try {
      const ocrd = new Map<number, PageContent>();
      for (const p of first.scannedPages) ocrd.set(p, await engine.ocrPage(doc, p));
      pages = pages.map((p) => ocrd.get(p.page) ?? p);
    } finally {
      await engine.close();
    }
    return convert({ ...input, pages });
  } finally {
    await close();
  }
}

export async function convertFixture(name: string, range = '', options?: ConvertOptions): Promise<ConversionResult> {
  return convertPdf(join(FIXTURES, name), range, options);
}
