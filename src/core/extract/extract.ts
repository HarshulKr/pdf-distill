// pdf.js -> TextItem[] per page.
//
// This module talks to pdf.js objects but has no runtime dependency on pdf.js
// itself: it only uses the small structural interfaces below. That keeps it
// pure (no DOM, no Chrome) and lets the same code run in the side panel and in
// Node tests.

import type { HeadingCandidate } from '../outline/outline';
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

/**
 * Font weight words used in PostScript font names, e.g. "Minion-Semibold".
 * TeX fonts say "bold extended" as BX plus a design size: CMBX12, CMSSBX10,
 * SFBX1000.
 */
const BOLD_FONT_RE = /bold|black|heavy|semibold|demi|bx(\d|$)/i;

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
  /** Most common font size in the document, weighted by characters. */
  bodySize: number;
  /** Large text runs, for finding chapters in PDFs without bookmarks. */
  headingCandidates: HeadingCandidate[];
}

/** A run must be this much larger than its page's most common size to be kept. */
const CANDIDATE_PAGE_RATIO = 1.15;
/** Pages with less text than this (e.g. chapter title pages) keep their largest runs regardless. */
const SPARSE_PAGE_CHARS = 300;
/** At most this many candidates per page, largest first, to bound memory on big books. */
const CANDIDATES_PER_PAGE = 5;

function itemSize(item: PdfTextItemLike): number {
  return Math.round(Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * 2) / 2;
}

/**
 * Group a page's items into runs of the same size on the same baseline, in
 * content-stream order. Good enough for titles, which are usually written in
 * one go; body text is never kept.
 */
export function textRuns(items: PdfTextItemLike[]): { text: string; size: number }[] {
  const runs: { text: string; size: number; y: number }[] = [];
  for (const item of items) {
    if (item.str.trim() === '') continue;
    const size = itemSize(item);
    const y = item.transform[5] ?? 0;
    const last = runs[runs.length - 1];
    if (last?.size === size && Math.abs(last.y - y) < 0.5 * size) {
      last.text += last.text.endsWith(' ') || item.str.startsWith(' ') ? item.str : ` ${item.str}`;
    } else {
      runs.push({ text: item.str, size, y });
    }
  }
  return runs.map((r) => ({ text: r.text.replace(/\s+/g, ' ').trim(), size: r.size }));
}

/** The largest-text runs of one page that might be chapter titles. */
export function pageHeadingCandidates(items: PdfTextItemLike[], page: number): HeadingCandidate[] {
  const runs = textRuns(items);
  const weights = new Map<number, number>();
  let total = 0;
  for (const r of runs) {
    weights.set(r.size, (weights.get(r.size) ?? 0) + r.text.length);
    total += r.text.length;
  }
  let pageMode = 0;
  let best = -1;
  for (const [size, w] of weights) {
    if (w > best) {
      pageMode = size;
      best = w;
    }
  }
  const sparse = total < SPARSE_PAGE_CHARS;
  return runs
    .filter((r) => r.size > 0 && (sparse || r.size >= CANDIDATE_PAGE_RATIO * pageMode))
    .sort((a, b) => b.size - a.size)
    .slice(0, CANDIDATES_PER_PAGE)
    .map((r) => ({ page, text: r.text, size: r.size }));
}

/**
 * Count the raw extracted text of the whole document, for the "before" token
 * estimate, and collect chapter-title candidates on the way. Uses
 * getTextContent only (no fonts), so it is much cheaper than converting.
 */
export async function countDocumentText(doc: PdfDocumentLike, options: RunOptions = {}): Promise<DocumentTextCount> {
  let chars = 0;
  const lowTextPages: number[] = [];
  const sizeChars = new Map<number, number>();
  const headingCandidates: HeadingCandidate[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    throwIfAborted(options.signal);
    const page = await doc.getPage(p);
    try {
      const content = await page.getTextContent();
      const items = content.items.filter(isTextItem);
      let pageChars = 0;
      for (const item of items) {
        pageChars += item.str.length + (item.hasEOL ? 1 : 0);
        const size = itemSize(item);
        sizeChars.set(size, (sizeChars.get(size) ?? 0) + item.str.length);
      }
      chars += pageChars;
      if (pageChars < LOW_TEXT_CHARS) lowTextPages.push(p);
      else headingCandidates.push(...pageHeadingCandidates(items, p));
    } finally {
      page.cleanup();
    }
    options.onProgress?.({ done: p, total: doc.numPages, page: p });
    await yieldToEventLoop();
  }
  let bodySize = 0;
  let best = -1;
  for (const [size, w] of sizeChars) {
    if (w > best) {
      bodySize = size;
      best = w;
    }
  }
  return { pages: doc.numPages, chars, lowTextPages, bodySize, headingCandidates };
}
