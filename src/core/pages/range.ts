// Page range parsing ("45-70, 82") and the header/footer sampling window.

export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parse a page selection. Accepts commas or spaces between parts, "-" or an
 * en/em dash in ranges, open-ended "45-" (to the end) and "-10" (from the
 * start). Empty input or "all" selects every page.
 */
export function parsePageRange(input: string, totalPages: number): PageRangeResult {
  const text = input.trim().toLowerCase();
  if (text === '' || text === 'all') {
    return { ok: true, pages: Array.from({ length: totalPages }, (_, i) => i + 1) };
  }
  const pages = new Set<number>();
  // Normalise "45 – 70" / "45 to 70" to "45-70", then split on commas,
  // semicolons or spaces.
  const normalised = text.replace(/\s*(?:[-–—]|\bto\b)\s*/g, '-');
  const parts = normalised.split(/[,;\s]+/).filter(Boolean);
  for (const part of parts) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    let start: number;
    let end: number;
    if (m) {
      if (!m[1] && !m[2]) return { ok: false, error: `"${part}" is not a page range.` };
      start = m[1] ? Number(m[1]) : 1;
      end = m[2] ? Number(m[2]) : totalPages;
    } else if (/^\d+$/.test(part)) {
      start = end = Number(part);
    } else {
      return { ok: false, error: `"${part}" is not a page number or range (try e.g. 45-70, 82).` };
    }
    if (start < 1 || end < 1) return { ok: false, error: 'Page numbers start at 1.' };
    if (start > end) return { ok: false, error: `"${part}": the first page is after the last.` };
    if (start > totalPages) {
      return { ok: false, error: `Page ${start} is past the end (the PDF has ${totalPages} pages).` };
    }
    for (let p = start; p <= Math.min(end, totalPages); p++) pages.add(p);
  }
  if (pages.size === 0) return { ok: false, error: 'No pages selected.' };
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}

/** Compact display form: [1,2,3,7,9,10] -> "1-3, 7, 9-10". */
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i] ?? 0;
    let end = start;
    while (sorted[i + 1] === end + 1) {
      end += 1;
      i += 1;
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    i += 1;
  }
  return parts.join(', ');
}

/**
 * Header/footer detection needs several pages to see repetition. For a short
 * selection (say 2 pages) we also look at up to `radius` pages on each side,
 * as agreed for Phase 1. Returns the union of the selection and its windows.
 */
export const HEADER_SAMPLE_RADIUS = 15;

export function samplePages(selected: number[], totalPages: number, radius = HEADER_SAMPLE_RADIUS): number[] {
  const out = new Set<number>();
  for (const p of selected) {
    for (let q = Math.max(1, p - radius); q <= Math.min(totalPages, p + radius); q++) out.add(q);
  }
  return [...out].sort((a, b) => a - b);
}
