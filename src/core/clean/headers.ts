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
  /**
   * Alternatively, a line is running if it appears on `minPages` pages that
   * all fall within this many consecutive page numbers. This catches headers
   * that change often: a chapter title printed on odd pages of a 20-page
   * chapter is on ~10 of the ~31 sampled pages (32%, under minFraction), and
   * section-title headers change every few pages. 6 allows odd-only headers
   * (pages n, n+2, n+4) and one missing page (e.g. a full-page figure).
   */
  nearbySpan: number;
}

export const DEFAULT_HEADER_FOOTER_OPTIONS: HeaderFooterOptions = {
  edgeZone: 0.08,
  minFraction: 0.4,
  minPages: 3,
  nearbySpan: 6,
};

/** True if some `count` of the sorted page numbers fit within `span` pages. */
export function hasNearbyRun(sortedPages: number[], count: number, span: number): boolean {
  for (let i = 0; i + count - 1 < sortedPages.length; i++) {
    const first = sortedPages[i] ?? 0;
    const last = sortedPages[i + count - 1] ?? 0;
    if (last - first <= span) return true;
  }
  return false;
}

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
  /** Key -> page numbers it appears on (each page once). */
  const seenOn = new Map<string, number[]>();
  for (const page of pages) {
    const seen = new Set<string>(); // count each key once per page
    for (const line of page.lines) {
      const zone = edgeZoneOf(line, page.height, options.edgeZone);
      if (!zone) continue;
      seen.add(`${zone}:${normalizeEdgeLine(line.text)}`);
    }
    for (const key of seen) {
      const list = seenOn.get(key);
      if (list) list.push(page.page);
      else seenOn.set(key, [page.page]);
    }
  }
  const running = new Set<string>();
  for (const [key, onPages] of seenOn) {
    if (onPages.length < options.minPages) continue;
    // "More than 40%" of the sample per the spec, or repeated on nearby pages.
    const frequent = onPages.length > options.minFraction * pages.length;
    const sorted = [...onPages].sort((a, b) => a - b);
    if (frequent || hasNearbyRun(sorted, options.minPages, options.nearbySpan)) running.add(key);
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

// ---------------------------------------------------------------- folios

/**
 * Headers that carry the printed page number ("Section 3.1 Problem-Solving
 * Agents 83", "84 Chapter 3 ...") change their text every section, so
 * repetition can't find them. The page number can: it starts or ends the
 * page's first or last line and equals the PDF page number plus a fixed
 * offset (front matter shifts printed numbers) on page after page.
 */
export interface FolioOptions {
  /** First/last lines must lie in this top/bottom fraction. Wider than edgeZone: LaTeX puts folios ~13% down. */
  zone: number;
  /** An offset must hold on this fraction of sampled pages... */
  minFraction: number;
  /** ...and at least this many pages. */
  minPages: number;
}

export const DEFAULT_FOLIO_OPTIONS: FolioOptions = { zone: 0.15, minFraction: 0.3, minPages: 3 };

/** Numbers at the start or end of a line ("84 Chapter 3", "Agents 83", "10"). */
export function edgeNumbers(text: string): number[] {
  const out: number[] = [];
  const start = /^(\d{1,4})\b/.exec(text.trim());
  const end = /\b(\d{1,4})$/.exec(text.trim());
  if (start?.[1]) out.push(Number(start[1]));
  if (end?.[1] && end.index > 0) out.push(Number(end[1]));
  return out;
}

/** The page's first and last lines, if they lie in the folio zones. */
function folioCandidates(page: PageLines, zone: number): Line[] {
  const first = page.lines[0];
  const last = page.lines[page.lines.length - 1];
  const out: Line[] = [];
  if (first && first.y - first.fontSize <= zone * page.height) out.push(first);
  if (last && last !== first && last.y >= (1 - zone) * page.height) out.push(last);
  return out;
}

/** Offsets (printed number - PDF page number) that hold across the sample. */
export function findFolioOffsets(pages: PageLines[], options: FolioOptions = DEFAULT_FOLIO_OPTIONS): Set<number> {
  const counts = new Map<number, number>();
  for (const page of pages) {
    const offsets = new Set<number>();
    for (const line of folioCandidates(page, options.zone)) {
      for (const n of edgeNumbers(line.text)) offsets.add(n - page.page);
    }
    for (const offset of offsets) counts.set(offset, (counts.get(offset) ?? 0) + 1);
  }
  const found = new Set<number>();
  for (const [offset, count] of counts) {
    if (count >= options.minPages && count >= options.minFraction * pages.length) found.add(offset);
  }
  return found;
}

function isFolioLine(line: Line, page: PageLines, offsets: Set<number>): boolean {
  return edgeNumbers(line.text).some((n) => offsets.has(n - page.page));
}

// ---------------------------------------------------------------- removal

export interface RemovalResult {
  pages: PageLines[];
  removed: number;
}

/**
 * Remove running headers/footers and page-number lines from the edge zones,
 * plus first/last lines that carry the page number (see findFolioOffsets).
 */
export function removeHeadersAndFooters(
  pages: PageLines[],
  running: Set<string>,
  folioOffsets: Set<number> = new Set(),
  options: HeaderFooterOptions = DEFAULT_HEADER_FOOTER_OPTIONS,
  folioOptions: FolioOptions = DEFAULT_FOLIO_OPTIONS,
): RemovalResult {
  let removed = 0;
  const out = pages.map((page) => {
    const folios = new Set(
      folioOffsets.size ? folioCandidates(page, folioOptions.zone).filter((l) => isFolioLine(l, page, folioOffsets)) : [],
    );
    const lines = page.lines.filter((line) => {
      let drop = folios.has(line);
      const zone = edgeZoneOf(line, page.height, options.edgeZone);
      if (!drop && zone) {
        drop = running.has(`${zone}:${normalizeEdgeLine(line.text)}`) || isPageNumberText(line.text);
      }
      if (drop) removed += 1;
      return !drop;
    });
    return { ...page, lines };
  });
  return { pages: out, removed };
}
