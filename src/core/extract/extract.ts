// pdf.js -> TextItem[] per page.
//
// This module talks to pdf.js objects but has no runtime dependency on pdf.js
// itself: it only uses the small structural interfaces below. That keeps it
// pure (no DOM, no Chrome) and lets the same code run in the side panel and in
// Node tests.

import type { PageContent, TextItem } from '../types';

export interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

/** pdf.js text content may also contain marked-content markers; we skip those. */
export type PdfTextContentItem = PdfTextItemLike | { type: string };

export interface PdfViewportLike {
  width: number;
  height: number;
  transform: number[];
}

export interface PdfObjectsLike {
  has(id: string): boolean;
  get(id: string): unknown;
}

export interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  getTextContent(): Promise<{ items: PdfTextContentItem[] }>;
  getOperatorList(): Promise<unknown>;
  commonObjs: PdfObjectsLike;
  cleanup(): unknown;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface ExtractOptions {
  /**
   * Resolve real font names (needed for bold detection). pdf.js only loads
   * font objects while building the page's operator list, which costs extra
   * time, so this is enabled only for pages that are being converted.
   */
  fonts: boolean;
}

/** Multiply two 2D affine matrices in pdf.js [a, b, c, d, e, f] form. */
export function multiplyTransform(m1: number[], m2: number[]): number[] {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = m1;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function isTextItem(item: PdfTextContentItem): item is PdfTextItemLike {
  return 'str' in item;
}

/** Font weight words used in PostScript font names, e.g. "Minion-Semibold". */
const BOLD_FONT_RE = /bold|black|heavy|semibold|demi/i;

export function isBoldFontName(fontName: string): boolean {
  return BOLD_FONT_RE.test(fontName);
}

/**
 * Turn pdf.js's internal font id (e.g. "g_d0_f1") into something whose name
 * says whether it is bold. With `fontExtraProperties` pdf.js gives the real
 * name ("ABCDEF+Helvetica-Bold"); otherwise fall back to its bold/black flags.
 */
export function resolveFontName(id: string, objs: PdfObjectsLike): string {
  if (!objs.has(id)) return id;
  const font = objs.get(id);
  if (typeof font !== 'object' || font === null) return id;
  const f = font as { name?: unknown; bold?: unknown; black?: unknown };
  if (typeof f.name === 'string' && f.name) return f.name;
  if (f.black === true) return `${id}-Black`;
  if (f.bold === true) return `${id}-Bold`;
  return id;
}

/**
 * Map pdf.js text items to TextItems in top-down page coordinates.
 *
 * Combining the item transform with the viewport transform (scale 1) handles
 * page rotation and non-zero MediaBox origins in one step: the result's
 * (e, f) is the baseline start in top-down points, and the length of the
 * vertical column vector (c, d) is the rendered font size.
 */
export function mapTextItems(
  items: PdfTextContentItem[],
  viewport: PdfViewportLike,
  page: number,
  fontNameFor: (id: string) => string = (id) => id,
): TextItem[] {
  const out: TextItem[] = [];
  for (const raw of items) {
    if (!isTextItem(raw)) continue;
    if (raw.str.trim() === '') continue; // spacing is recomputed from geometry
    const m = multiplyTransform(viewport.transform, raw.transform);
    const fontSize = Math.hypot(m[2] ?? 0, m[3] ?? 0) || raw.height || 1;
    out.push({
      str: raw.str,
      x: m[4] ?? 0,
      y: m[5] ?? 0,
      width: raw.width,
      height: raw.height || fontSize,
      fontName: fontNameFor(raw.fontName),
      fontSize,
      page,
    });
  }
  return out;
}

export async function extractPage(
  doc: PdfDocumentLike,
  pageNumber: number,
  options: ExtractOptions,
): Promise<PageContent> {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let fontNameFor: (id: string) => string = (id) => id;
    if (options.fonts && content.items.length > 0) {
      try {
        await page.getOperatorList();
        fontNameFor = (id) => resolveFontName(id, page.commonObjs);
      } catch {
        // Fonts are only used for bold detection; carry on without them.
      }
    }
    return {
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      items: mapTextItems(content.items, viewport, pageNumber, fontNameFor),
    };
  } finally {
    // Release parsed page resources; a 500-page book would otherwise keep
    // every operator list in memory.
    page.cleanup();
  }
}

/** Let the UI repaint and handle clicks (e.g. Cancel) between pages. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export interface Progress {
  done: number;
  total: number;
  page: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

/** Extract several pages one at a time, yielding between pages. */
export async function extractPages(
  doc: PdfDocumentLike,
  pageNumbers: number[],
  options: ExtractOptions & RunOptions,
): Promise<PageContent[]> {
  const out: PageContent[] = [];
  for (const [i, pageNumber] of pageNumbers.entries()) {
    throwIfAborted(options.signal);
    out.push(await extractPage(doc, pageNumber, options));
    options.onProgress?.({ done: i + 1, total: pageNumbers.length, page: pageNumber });
    await yieldToEventLoop();
  }
  throwIfAborted(options.signal);
  return out;
}

/** Pages with fewer characters than this are treated as having no text layer. */
export const LOW_TEXT_CHARS = 20;

export interface DocumentTextCount {
  pages: number;
  /** Characters of raw extracted text, with one newline per text line. */
  chars: number;
  /** Pages with (almost) no text layer: OCR candidates. */
  lowTextPages: number[];
}

/**
 * Count the raw extracted text of the whole document, for the "before" token
 * estimate. Uses getTextContent only (no fonts), so it is much cheaper than
 * converting.
 */
export async function countDocumentText(doc: PdfDocumentLike, options: RunOptions = {}): Promise<DocumentTextCount> {
  let chars = 0;
  const lowTextPages: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    throwIfAborted(options.signal);
    const page = await doc.getPage(p);
    try {
      const content = await page.getTextContent();
      let pageChars = 0;
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        pageChars += item.str.length + (item.hasEOL ? 1 : 0);
      }
      chars += pageChars;
      if (pageChars < LOW_TEXT_CHARS) lowTextPages.push(p);
    } finally {
      page.cleanup();
    }
    options.onProgress?.({ done: p, total: doc.numPages, page: p });
    await yieldToEventLoop();
  }
  return { pages: doc.numPages, chars, lowTextPages };
}
