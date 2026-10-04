// Lines -> Blocks (headings and paragraphs).
//
// Document-level measurements (body font size, typical line gap, heading
// sizes) are computed from a sample of pages wider than the selection, so a
// short selection gets the same heading levels as the surrounding chapter.

import { collectEvidence, joinLines, type HyphenEvidence } from '../clean/hyphenation';
import { roundSize } from '../layout/lines';
import type { Block, Line, ListItem, PageLines, TableBlock } from '../types';

export interface DocumentProfile {
  /** Most common font size, weighted by characters. */
  bodySize: number;
  /** Median baseline-to-baseline distance between consecutive body lines. */
  lineGap: number;
  /** Median width of body lines: a proxy for the text column width. */
  lineWidth: number;
  /** Distinct heading font sizes, largest first (at most 3 levels used). */
  headingSizes: number[];
  /** Evidence for repairing line-end hyphens (see hyphenation.ts). */
  hyphens: HyphenEvidence;
}

/** A line this much larger than body text is a heading by size alone. */
export const HEADING_SIZE_RATIO = 1.2;
/** Numbered patterns ("3.2 Title") need some typographic support: this ratio or bold. */
const NUMBERED_HEADING_RATIO = 1.1;
/** Headings are short. Longer lines are body text even when large or bold. */
const MAX_HEADING_WORDS = 15;
const MAX_HEADING_CHARS = 120;
/** Font sizes within this many points are one heading level (e.g. 15.5 vs 16). */
const SIZE_MERGE_PT = 0.75;
/**
 * A baseline gap this many times the typical gap starts a new paragraph.
 * 1.3 sits between normal leading variation (~1.0-1.15, e.g. lines with
 * superscripts) and the smallest common paragraph spacing (~0.5em extra).
 */
const PARAGRAPH_GAP_RATIO = 1.3;
/** A first line indented by this many ems relative to the previous line starts a paragraph. */
const INDENT_EMS = 0.8;
/** A line shorter than this fraction of the column that ends a sentence ends its paragraph. */
const SHORT_LINE_RATIO = 0.75;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function bodyFontSize(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const size = roundSize(line.fontSize);
    weights.set(size, (weights.get(size) ?? 0) + line.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best || 10;
}

const CHAPTER_RE = /^(chapter|part|unit|lecture|section|appendix|module)\s+([0-9]+|[ivxlcdm]+|[a-z])\b/i;
/** The label alone, e.g. "Chapter 3" or "Appendix B", with nothing after it. */
const CHAPTER_ONLY_RE = /^(chapter|part|unit|lecture|section|appendix|module)\s+([0-9]+|[ivxlcdm]+|[a-z])$/i;

/** All letters uppercase, as in "CHAPTER 3 CELL MEMBRANES". */
function isAllCaps(text: string): boolean {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}
const NUMBERED_RE = /^\d+(\.\d+)*\.?\s+\S/;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function isShortEnough(text: string): boolean {
  return wordCount(text) <= MAX_HEADING_WORDS && text.length <= MAX_HEADING_CHARS;
}

/** Headings don't end like sentences. "?" is allowed ("What is a cell?"). */
function endsLikeSentence(text: string): boolean {
  return /[.,;:]$/.test(text);
}

export type HeadingKind = 'size' | 'bold' | 'chapter' | 'numbered' | null;

/** Why (if at all) a line looks like a heading. */
export function headingKind(line: Line, profile: Pick<DocumentProfile, 'bodySize' | 'lineWidth'>): HeadingKind {
  const text = line.text;
  if (!isShortEnough(text) || !/[A-Za-z]/.test(text)) return null;
  if (endsLikeSentence(text)) return null;
  const ratio = line.fontSize / profile.bodySize;
  // Size first, so a large "Chapter 3" still counts towards heading sizes.
  if (ratio >= HEADING_SIZE_RATIO) return 'size';
  // "Chapter 3" at body size needs typographic support: otherwise a wrapped
  // sentence like "Chapter 3 showed how membranes form, and in this" would
  // become a level-1 heading.
  if (
    CHAPTER_RE.test(text) &&
    (line.bold || ratio >= NUMBERED_HEADING_RATIO || isAllCaps(text) || CHAPTER_ONLY_RE.test(text))
  ) {
    return 'chapter';
  }
  // Bold, body-sized and noticeably shorter than a full line. The width check
  // avoids treating a fully bold sentence that wraps as a heading.
  if (line.bold && line.width < SHORT_LINE_RATIO * profile.lineWidth && wordCount(text) <= 12) return 'bold';
  if (NUMBERED_RE.test(text) && wordCount(text) <= 10 && (ratio >= NUMBERED_HEADING_RATIO || line.bold)) {
    return 'numbered';
  }
  return null;
}

/** Cluster sizes that differ by less than SIZE_MERGE_PT; largest first. */
export function distinctSizes(sizes: number[]): number[] {
  const sorted = [...new Set(sizes)].sort((a, b) => b - a);
  const out: number[] = [];
  for (const size of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || last - size >= SIZE_MERGE_PT) out.push(size);
  }
  return out;
}

export function buildProfile(pages: PageLines[]): DocumentProfile {
  const all = pages.flatMap((p) => p.lines);
  const bodySize = bodyFontSize(all);
  const isBody = (l: Line): boolean => Math.abs(l.fontSize - bodySize) < SIZE_MERGE_PT;

  const gaps: number[] = [];
  for (const page of pages) {
    for (let i = 1; i < page.lines.length; i++) {
      const a = page.lines[i - 1];
      const b = page.lines[i];
      if (!a || !b || !isBody(a) || !isBody(b)) continue;
      const gap = b.y - a.y;
      // Ignore gaps across figures/sections; they would inflate the median.
      if (gap > 0 && gap < 3 * bodySize) gaps.push(gap);
    }
  }
  const lineGap = median(gaps) || bodySize * 1.2;
  const lineWidth = median(all.filter(isBody).map((l) => l.width)) || 400;

  const profileBase = { bodySize, lineWidth };
  const headingSizes = distinctSizes(
    all.filter((l) => headingKind(l, profileBase) === 'size').map((l) => roundSize(l.fontSize)),
  );
  const hyphens = collectEvidence(all.map((l) => l.text));
  return { bodySize, lineGap, lineWidth, headingSizes, hyphens };
}

/** Map a heading line to a level 1-3. */
export function headingLevel(line: Line, kind: Exclude<HeadingKind, null>, profile: DocumentProfile): 1 | 2 | 3 {
  if (kind === 'size') {
    const idx = profile.headingSizes.findIndex((s) => Math.abs(s - line.fontSize) < SIZE_MERGE_PT);
    return clampLevel(idx === -1 ? profile.headingSizes.length + 1 : idx + 1);
  }
  if (kind === 'chapter') return 1;
  // Bold/numbered body-size headings sit below every size-based level.
  // For numbered ones, depth ("3.2.1") can push them further down.
  const below = profile.headingSizes.length + 1;
  if (kind === 'numbered') {
    const depth = (/^\d+(\.\d+)*/.exec(line.text)?.[0].split('.').length ?? 1) - 1;
    return clampLevel(Math.max(below, 1 + depth));
  }
  return clampLevel(below);
}

function clampLevel(n: number): 1 | 2 | 3 {
  return n <= 1 ? 1 : n === 2 ? 2 : 3;
}

const SENTENCE_END_RE = /[.!?:;"”’')\]]$/;

/**
 * Should `line` start a new paragraph after `prev` (both body lines on the
 * same page)?
 */
export function startsParagraph(prev: Line, line: Line, profile: DocumentProfile): boolean {
  const gap = line.y - prev.y;
  if (gap > PARAGRAPH_GAP_RATIO * profile.lineGap) return true;
  // Went back up: a new column (or a float). A sentence cut off at the
  // bottom of the left column continues in lowercase at the top of the right.
  if (gap < 0) return SENTENCE_END_RE.test(prev.text) || !/^[a-z]/.test(line.text);
  if (line.x - prev.x > INDENT_EMS * line.fontSize) return true;
  if (SENTENCE_END_RE.test(prev.text) && prev.width < SHORT_LINE_RATIO * profile.lineWidth) return true;
  return false;
}

interface OpenText {
  text: string;
  last: Line;
}

// ---------------------------------------------------------------- lists

/** Bullet glyphs. Dashes and "*" also count, but only when followed by a space. */
const BULLET_RE = /^([•●◦▪▫■□‣⁃∙○◆◇➢➤►▶✓✔])\s*(\S.*)$/u;
const DASH_BULLET_RE = /^([-–—*])\s+(\S.*)$/;
/** "3. Text", "3) Text", and "3.Text" when a capital follows (slides often omit the space). */
const NUMBERED_ITEM_RE = /^(\d{1,2})[.)](?:\s+|(?=[A-Z(]))(\S.*)$/;
/** "(a) Text", "(iv) Text", "a) Text": kept as bullets with their label, since Markdown has no lettered lists. */
const LABELLED_ITEM_RE = /^(\((?:[a-z]|[ivx]{1,4}|\d{1,2})\)|[a-z]\))\s+(\S.*)$/;

export interface ListMarker {
  /** Item text without the marker. */
  text: string;
  number?: number;
  /** Where the item's text starts; continuation lines align with this. */
  textX: number;
}

/**
 * The list marker a line starts with, if any. The text position comes from
 * the second item when the marker is its own text item (common for bullet
 * glyphs), otherwise it is estimated from the marker's length.
 */
export function listMarker(line: Line): ListMarker | null {
  const text = line.text;
  let m = BULLET_RE.exec(text) ?? DASH_BULLET_RE.exec(text);
  let number: number | undefined;
  let body: string | undefined;
  let markerChars = 0;
  if (m) {
    body = m[2];
    markerChars = text.length - (body?.length ?? 0);
  } else if ((m = NUMBERED_ITEM_RE.exec(text))) {
    number = Number(m[1]);
    body = m[2];
    markerChars = text.length - (body?.length ?? 0);
  } else if ((m = LABELLED_ITEM_RE.exec(text))) {
    body = text; // keep "(a)" in the text
    markerChars = (m[1]?.length ?? 0) + 1;
  }
  if (body === undefined) return null;
  const [first, second] = line.items;
  const separateMarker = first && second && first.str.trim().length < markerChars + 1 && first.str.trim() !== text;
  const textX = separateMarker ? second.x : line.x + markerChars * 0.5 * line.fontSize;
  return { text: body, textX, ...(number === undefined ? {} : { number }) };
}

interface OpenItem {
  text: string;
  depth: number;
  number?: number;
  textX: number;
  /** Where the marker itself starts. */
  markerX: number;
  last: Line;
}

function openItem(marker: ListMarker, line: Line, depth: number): OpenItem {
  return {
    text: marker.text,
    depth,
    textX: marker.textX,
    markerX: line.x,
    last: line,
    ...(marker.number === undefined ? {} : { number: marker.number }),
  };
}

function toListItem(item: OpenItem): ListItem {
  return { text: item.text, depth: item.depth, ...(item.number === undefined ? {} : { number: item.number }) };
}

/**
 * Does `line` continue the open list item? Either it is aligned with the
 * item's text (a hanging indent), or it wraps back to the marker's position
 * mid-sentence: the item so far has no sentence end and the line starts in
 * lowercase.
 */
export function continuesItem(item: OpenItem, line: Line, profile: DocumentProfile): boolean {
  const gap = line.y - item.last.y;
  if (gap <= 0 || gap > Math.max(PARAGRAPH_GAP_RATIO * profile.lineGap, 1.6 * line.fontSize)) return false;
  const tolerance = 0.6 * line.fontSize;
  if (Math.abs(line.x - item.textX) <= tolerance) return true;
  return Math.abs(line.x - item.markerX) <= tolerance && !SENTENCE_END_RE.test(item.text) && /^[a-z(]/.test(line.text);
}

/** Headings and paragraphs of one page, in reading order. */
export function pageBlocks(page: PageLines, profile: DocumentProfile, tables: TableBlock[] = []): Block[] {
  const pendingTables = [...tables].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const blocks: Block[] = [];
  // At most one of these is open at a time.
  const open: {
    para: OpenText | null;
    heading: (OpenText & { level: 1 | 2 | 3 }) | null;
    /** Finished items, the item being built, and the marker x of each nesting level. */
    list: { items: ListItem[]; item: OpenItem; markerXs: number[] } | null;
  } = { para: null, heading: null, list: null };

  const flush = (): void => {
    if (open.para) blocks.push({ kind: 'paragraph', text: open.para.text, page: page.page });
    if (open.heading) {
      blocks.push({ kind: 'heading', level: open.heading.level, text: open.heading.text, page: page.page });
    }
    if (open.list) {
      const { items, item } = open.list;
      blocks.push({ kind: 'list', items: [...items, toListItem(item)], page: page.page });
    }
    open.para = null;
    open.heading = null;
    open.list = null;
  };

  for (const line of page.lines) {
    // Tables were taken out of the lines; put each back where it started.
    while (pendingTables.length && (pendingTables[0]?.y ?? 0) < line.y) {
      flush();
      const table = pendingTables.shift();
      if (table) blocks.push(table);
    }
    const kind = headingKind(line, profile);
    const marker = listMarker(line);
    // A marker wins over bold/numbered heading rules ("1. Introduction" on a
    // slide is an item), but not over a clearly larger heading.
    if (marker && kind !== 'size' && kind !== 'chapter') {
      const tolerance = 0.5 * line.fontSize;
      if (!open.list) {
        flush();
        open.list = { items: [], item: openItem(marker, line, 0), markerXs: [line.x] };
        continue;
      }
      const xs = open.list.markerXs;
      while (xs.length > 1 && line.x < (xs[xs.length - 1] ?? 0) - tolerance) xs.pop();
      if (line.x > (xs[xs.length - 1] ?? 0) + tolerance) xs.push(line.x);
      open.list.items.push(toListItem(open.list.item));
      open.list.item = openItem(marker, line, xs.length - 1);
      continue;
    }
    const item = open.list?.item;
    // A short bold line can be the wrapped end of a bold item ("(body" /
    // "organs)"), so only clearly larger headings interrupt an item.
    if (item && kind !== 'size' && kind !== 'chapter' && continuesItem(item, line, profile)) {
      item.text = joinLines(item.text, line.text, profile.hyphens);
      item.last = line;
      continue;
    }
    if (open.list) flush();
    if (kind) {
      const level = headingLevel(line, kind, profile);
      const h = open.heading;
      // Multi-line heading: same level, directly below the previous line.
      if (h?.level === level && line.y - h.last.y <= 1.6 * line.fontSize) {
        h.text = joinLines(h.text, line.text, profile.hyphens);
        h.last = line;
      } else {
        flush();
        open.heading = { level, text: line.text, last: line };
      }
      continue;
    }
    const p = open.para;
    if (p && !startsParagraph(p.last, line, profile)) {
      p.text = joinLines(p.text, line.text, profile.hyphens);
      p.last = line;
    } else {
      flush();
      open.para = { text: line.text, last: line };
    }
  }
  flush();
  blocks.push(...pendingTables);
  return mergeChapterLabels(blocks);
}

/**
 * "Chapter 1" followed directly by its title ("Linear regression") becomes
 * one heading, "Chapter 1: Linear regression", at the higher of the two
 * levels. Books often set the label smaller than the title, which otherwise
 * puts the label at the wrong level and splits one heading in two.
 */
export function mergeChapterLabels(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (
      block.kind === 'heading' &&
      prev?.kind === 'heading' &&
      CHAPTER_ONLY_RE.test(prev.text) &&
      !CHAPTER_RE.test(block.text)
    ) {
      out[out.length - 1] = {
        ...prev,
        level: Math.min(prev.level, block.level) as 1 | 2 | 3,
        text: `${prev.text}: ${block.text}`,
      };
      continue;
    }
    out.push(block);
  }
  return out;
}

/**
 * Should the first block of a page be joined onto the previous page's last
 * paragraph? Yes when that paragraph has no sentence end and the new text
 * continues in lowercase (or the old one ends mid-word with a hyphen).
 */
export function continuesParagraph(prev: Block | undefined, next: Block | undefined): boolean {
  if (prev?.kind !== 'paragraph' || next?.kind !== 'paragraph') return false;
  if (SENTENCE_END_RE.test(prev.text)) return false;
  return /^[a-z]/.test(next.text);
}

/**
 * Build blocks for the given pages. A pageBreak block precedes each page's
 * content. A paragraph that runs over a page boundary is joined into one
 * paragraph; the next page's marker then follows the joined paragraph, so
 * page markers are approximate at paragraph granularity.
 */
export function buildBlocks(
  pages: PageLines[],
  profile: DocumentProfile,
  tablesByPage: Map<number, TableBlock[]> = new Map(),
): Block[] {
  const blocks: Block[] = [];
  let prevPage: number | null = null;
  for (const page of pages) {
    const own = pageBlocks(page, profile, tablesByPage.get(page.page));
    const last = blocks[blocks.length - 1];
    // Only join across consecutive pages: in a selection like "45-70, 82",
    // the end of page 70 does not continue on page 82.
    const consecutive = prevPage !== null && page.page === prevPage + 1;
    prevPage = page.page;
    if (consecutive && last?.kind === 'paragraph' && continuesParagraph(last, own[0])) {
      const first = own.shift();
      if (first?.kind === 'paragraph') {
        blocks[blocks.length - 1] = { ...last, text: joinLines(last.text, first.text, profile.hyphens) };
      }
    }
    blocks.push({ kind: 'pageBreak', page: page.page }, ...own);
  }
  return blocks;
}
