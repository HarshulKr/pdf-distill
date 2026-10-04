// Chapters: from the PDF's bookmarks, or failing that, from large headings.
//
// Like extract.ts, this only uses small structural interfaces for pdf.js, so
// it stays pure and testable in Node.

import type { Section } from '../types';

/** Only the first two outline levels are offered as chapters. */
export const MAX_SECTION_LEVEL = 2;

/** A bookmark with the page it points to (1-based), before end pages are known. */
export interface OutlineEntry {
  title: string;
  level: number;
  page: number;
}

/**
 * Turn entries in document order into sections with page ranges. A section
 * ends just before the next entry at the same or a higher level (a smaller
 * level number), or at the end of the document. When that next entry starts
 * on the same page, the section is that one page.
 */
export function sectionsFromEntries(entries: OutlineEntry[], numPages: number): Section[] {
  const valid = entries.filter((e) => e.page >= 1 && e.page <= numPages && e.title.trim() !== '');
  return valid.map((entry, i) => {
    let endPage = numPages;
    for (let j = i + 1; j < valid.length; j++) {
      const next = valid[j];
      if (next && next.level <= entry.level) {
        endPage = Math.max(entry.page, next.page - 1);
        break;
      }
    }
    return { title: cleanTitle(entry.title), level: entry.level, startPage: entry.page, endPage };
  });
}

/** Collapse whitespace and control characters some PDFs put in bookmark titles. */
export function cleanTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[\u0000-\u001f\s]+/g, ' ').trim();
}

// ---------------------------------------------------------------- bookmarks

export interface PdfOutlineNodeLike {
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNodeLike[];
}

export interface PdfOutlineDocLike {
  numPages: number;
  getOutline(): Promise<PdfOutlineNodeLike[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: never): Promise<number>;
}

/**
 * Resolve a bookmark destination to a 1-based page number, or null.
 * Destinations are either a name (looked up in the document) or an explicit
 * array whose first element is a page reference or, in some PDFs, a 0-based
 * page index.
 */
export async function destinationPage(doc: PdfOutlineDocLike, dest: PdfOutlineNodeLike['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const target: unknown = explicit?.[0];
    if (typeof target === 'number') return Number.isInteger(target) ? target + 1 : null;
    if (typeof target === 'object' && target !== null) {
      return (await doc.getPageIndex(target as never)) + 1;
    }
  } catch {
    // A broken destination only costs that one bookmark.
  }
  return null;
}

/** Bookmarks as sections (levels 1-2), or [] when the PDF has no outline. */
export async function sectionsFromOutline(doc: PdfOutlineDocLike): Promise<Section[]> {
  let outline: PdfOutlineNodeLike[] | null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!outline?.length) return [];

  const entries: OutlineEntry[] = [];
  const walk = async (nodes: PdfOutlineNodeLike[], level: number): Promise<void> => {
    for (const node of nodes) {
      const page = await destinationPage(doc, node.dest);
      if (page !== null) entries.push({ title: node.title, level, page });
      if (level < MAX_SECTION_LEVEL && node.items.length) await walk(node.items, level + 1);
    }
  };
  await walk(outline, 1);
  if (looksLikeFileNames(entries.map((e) => e.title))) return [];
  return sectionsFromEntries(entries, doc.numPages);
}

/** "IMG_0001", "Scan 12", "Page 3", "DSC00412": names a scanner or converter gives each page. */
const FILE_NAME_TITLE_RE = /^(img|image|scan|page|pg|dsc|dscn|pict?|photo|untitled|bookmark)[\s_\-.]*\d*$/i;

/**
 * Bookmarks generated per page by scanning software carry no chapter
 * information, so a list of them is noise. True when most titles look like
 * file names.
 */
export function looksLikeFileNames(titles: string[]): boolean {
  if (titles.length === 0) return false;
  const named = titles.filter((t) => FILE_NAME_TITLE_RE.test(cleanTitle(t))).length;
  return named >= 0.8 * titles.length;
}

// ---------------------------------------------------------------- headings fallback

/** A run of same-size text that stands out on its page (collected while counting). */
export interface HeadingCandidate {
  page: number;
  text: string;
  /** Rounded font size. */
  size: number;
}

/**
 * Chapters need to stand out more than ordinary headings: 1.4x body size,
 * versus 1.2x for headings inside the converted text.
 */
export const CHAPTER_SIZE_RATIO = 1.4;
const MAX_CHAPTER_WORDS = 12;
/** More distinct sizes than this means the "headings" are probably decoration. */
const MAX_CANDIDATES = 400;

function looksLikeTitle(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words >= 1 && words <= MAX_CHAPTER_WORDS && /[A-Za-z]{2}/.test(text) && !/[.,;]$/.test(text);
}

/**
 * Sections from large text, for PDFs without bookmarks. The largest kept size
 * is level 1, the next is level 2. Only the first candidate per page and
 * level is used, so a title broken over two runs counts once.
 */
export function sectionsFromHeadings(candidates: HeadingCandidate[], bodySize: number, numPages: number): Section[] {
  const kept = candidates.filter((c) => c.size >= CHAPTER_SIZE_RATIO * bodySize && looksLikeTitle(c.text));
  if (kept.length === 0 || kept.length > MAX_CANDIDATES) return [];
  const sizes = [...new Set(kept.map((c) => c.size))].sort((a, b) => b - a).slice(0, MAX_SECTION_LEVEL);
  const entries: OutlineEntry[] = [];
  const seen = new Set<string>();
  const lastTitleAt = new Map<number, string>(); // level -> latest title
  for (const c of kept) {
    const level = sizes.indexOf(c.size) + 1;
    if (level === 0) continue;
    const key = `${c.page}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Slides repeat a title across consecutive slides ("Active tension" x4);
    // skipping the repeats lets the first one's section run on.
    const title = cleanTitle(c.text);
    if (lastTitleAt.get(level)?.toLowerCase() === title.toLowerCase()) continue;
    lastTitleAt.set(level, title);
    for (const deeper of [...lastTitleAt.keys()]) if (deeper > level) lastTitleAt.delete(deeper);
    entries.push({ title, level, page: c.page });
  }
  return sectionsFromEntries(entries, numPages);
}

// ---------------------------------------------------------------- selection

/** Union of the sections' pages, sorted. */
export function pagesOfSections(sections: Section[]): number[] {
  const pages = new Set<number>();
  for (const s of sections) for (let p = s.startPage; p <= s.endPage; p++) pages.add(p);
  return [...pages].sort((a, b) => a - b);
}

/** Sections that overlap the selected pages, for ConversionResult.sections. */
export function sectionsInSelection(sections: Section[], selected: number[]): Section[] {
  const set = new Set(selected);
  return sections.filter((s) => {
    for (let p = s.startPage; p <= s.endPage; p++) if (set.has(p)) return true;
    return false;
  });
}
