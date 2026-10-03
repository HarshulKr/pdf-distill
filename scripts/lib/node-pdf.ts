// Node-side helpers: open a PDF with pdf.js's legacy (Node) build and run the
// same extraction + conversion code the extension uses.
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { convert, type ConvertOptions } from '../../src/core/convert';
import { countDocumentText, extractPages } from '../../src/core/extract/extract';
import { parsePageRange, samplePages } from '../../src/core/pages/range';
import type { ConversionResult } from '../../src/core/types';

export const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures');

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Frees the document and its worker-side resources. */
  close: () => Promise<void>;
}

export async function openPdf(path: string): Promise<OpenedPdf> {
  const data = new Uint8Array(await readFile(path));
  // fontExtraProperties: same setting as the extension, so real font names
  // (used for bold detection) are available.
  const task = getDocument({ data, verbosity: 0, fontExtraProperties: true });
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
): Promise<ConversionResult> {
  const { doc, close } = await openPdf(path);
  try {
    const parsed = parsePageRange(range, doc.numPages);
    if (!parsed.ok) throw new Error(parsed.error);
    const sample = samplePages(parsed.pages, doc.numPages);
    const pages = await extractPages(doc, sample, { fonts: true });
    const whole = await countDocumentText(doc);
    return convert({ pages, selected: parsed.pages, options, fileName: basename(path), wholeDocument: whole });
  } finally {
    await close();
  }
}

export async function convertFixture(name: string, range = '', options?: ConvertOptions): Promise<ConversionResult> {
  return convertPdf(join(FIXTURES, name), range, options);
}
