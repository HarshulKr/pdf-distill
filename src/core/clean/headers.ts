// Running headers/footers and page numbers.

import type { Line, PageLines } from '../types';

export interface HeaderFooterOptions {
  /**
   * Top and bottom fraction of the page treated as header/footer zones. 8%
   * of a US Letter page is ~63pt (0.9in), which covers typical running heads
   * and folios without reaching body text.
   */
  edgeZone: number;
  /**
   * A normalised edge line must appear on more than this fraction of sampled
   * pages. 40% (not 50%+) because books often alternate headers: the book
   * title on even pages and the chapter title on odd pages, ~50% each.
   */
  minFraction: number;
  /** ...and on at least this many pages, so 2-page samples never trigger. */
  minPages: number;
}

export const DEFAULT_HEADER_FOOTER_OPTIONS: HeaderFooterOptions = {
  edgeZone: 0.08,
  minFraction: 0.4,
  minPages: 3,
};

/** Normalise so "Chapter 2 · Page 14" and "Chapter 2 · Page 15" match. */
export function normalizeEdgeLine(text: string): string {
  return text.replace(/\d+/g, '#').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type Zone = 'top' | 'bottom' | null;

export function edgeZoneOf(line: Line, pageHeight: number, edgeZone: number): Zone {
  // The top of a line is roughly baseline minus font size.
  if (line.y - line.fontSize <= pageHeight * edgeZone) return 'top';
  if (line.y >= pageHeight * (1 - edgeZone)) return 'bottom';
  return null;
}

/**
 * Find normalised header/footer lines that repeat across the sample.
 * Keys are zone-qualified so a top-of-page line and a bottom-of-page line
 * with the same text are counted separately.
 */
export function findRunningLines(
  pages: PageLines[],
  options: HeaderFooterOptions = DEFAULT_HEADER_FOOTER_OPTIONS,
): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>(); // count each key once per page
    for (const line of page.lines) {
      const zone = edgeZoneOf(line, page.height, options.edgeZone);
      if (!zone) continue;
      seen.add(`${zone}:${normalizeEdgeLine(line.text)}`);
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const running = new Set<string>();
  for (const [key, count] of counts) {
    // "More than 40%" per the spec, and at least minPages.
    if (count >= options.minPages && count > options.minFraction * pages.length) {
      running.add(key);
    }
  }
  return running;
}

/**
 * Roman numerals up to 399 (no M or D). Roman page numbers are for front
 * matter, which is never that long; excluding M/D avoids words like "mix"
 * (= 1009) or "dim" being read as page numbers.
 */
const ROMAN_RE = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

/**
 * True for lines that are only a page number: "12", "xiv", "Page 3",
 * "Page 3 of 40", "3 of 40", "3 / 40", "- 7 -".
 */
export function isPageNumberText(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  if (/^\d{1,4}$/.test(t)) return true;
  if (t.length <= 8 && ROMAN_RE.test(t)) return true;
  if (/^page\s+\d{1,4}(\s+(of|\/)\s+\d{1,4})?$/i.test(t)) return true;
  if (/^\d{1,4}\s*(of|\/)\s*\d{1,4}$/i.test(t)) return true;
  if (/^[-–—]\s*\d{1,4}\s*[-–—]$/.test(t)) return true;
  return false;
}

export interface RemovalResult {
  pages: PageLines[];
  removed: number;
}

/** Remove running headers/footers and page-number lines from the edge zones. */
export function removeHeadersAndFooters(
  pages: PageLines[],
  running: Set<string>,
  options: HeaderFooterOptions = DEFAULT_HEADER_FOOTER_OPTIONS,
): RemovalResult {
  let removed = 0;
  const out = pages.map((page) => {
    const lines = page.lines.filter((line) => {
      const zone = edgeZoneOf(line, page.height, options.edgeZone);
      if (!zone) return true;
      const drop = running.has(`${zone}:${normalizeEdgeLine(line.text)}`) || isPageNumberText(line.text);
      if (drop) removed += 1;
      return !drop;
    });
    return { ...page, lines };
  });
  return { pages: out, removed };
}
