// Multi-column pages: read each column top to bottom, left to right.
//
// Grouping items by baseline (lines.ts) reads a two-column page straight
// across, interleaving the columns: "...field fringing can affect Tunneling
// charge leakage is a main constraint on retention the electrostatics of...".
//
// 1. Find gutters: x ranges away from the page edges that body text (almost)
//    never covers. Two-column papers have one; AIMA's bibliography has two.
// 2. Check that every column holds real prose, not table cells.
// 3. Split items into columns, plus spanning items that cross a gutter
//    (titles, full-width figures). Group each set into lines separately.
// 4. Reading order: spanning lines cut the page into bands; within a band,
//    columns are read left to right.

import { groupLines, roundSize } from './lines';
import type { Line, PageContent, PageLines, TextItem } from '../types';

/** Gutters must lie within this central part of the page width (excludes margins). */
const GUTTER_SEARCH = [0.15, 0.85] as const;
/** ...and be at least this many ems wide. */
const MIN_GUTTER_EMS = 0.6;
/** At most this fraction of body text rows may cross a gutter (a full-width title, a wide equation). */
const MAX_CROSSING = 0.15;
/** At most this many columns. */
const MAX_COLUMNS = 4;
/** List markers that may hang into a gutter: "(3)", "3.", "(iv)", "a)", a bullet. */
const LIST_MARKER_RE = /^(?:\(?[0-9a-z]{1,4}[.)]|[•●▪◦–-])$/i;
/** Each column must hold at least this many prose lines... */
const MIN_COLUMN_LINES = 5;
/** ...where a prose line fills at least this fraction of its column. */
const PROSE_LINE_FILL = 0.6;
/** ...and such lines must be at least this share of the column's lines. */
const MIN_PROSE_SHARE = 0.3;
/** A text line is at least this share letters... */
const TEXT_LETTER_SHARE = 0.6;
/** ...with at least this many letters per word on average ("Z VR W VR" has fewer). */
const TEXT_MEAN_WORD_LETTERS = 3;
/** A column narrower than this many ems is a stray alignment of words, not a column. */
const MIN_COLUMN_EMS = 12;

function bodySizeOf(items: TextItem[]): number {
  const weights = new Map<number, number>();
  for (const i of items) weights.set(roundSize(i.fontSize), (weights.get(roundSize(i.fontSize)) ?? 0) + i.str.length);
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weights) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

/** Gutters [left, right] of a multi-column page, left to right (empty if none). */
export function findGutters(page: PageContent): [number, number][] {
  const bodySize = bodySizeOf(page.items);
  if (bodySize === 0) return [];
  const body = page.items.filter((i) => Math.abs(roundSize(i.fontSize) - bodySize) <= 1);
  if (body.length < 2 * MIN_COLUMN_LINES) return [];

  // Only look between the leftmost and rightmost body text, so the page
  // margins never count as gutters.
  const textLeft = Math.min(...body.map((i) => i.x));
  const textRight = Math.max(...body.map((i) => i.x + i.width));
  const from = Math.max(Math.floor(GUTTER_SEARCH[0] * page.width), Math.ceil(textLeft) + 1);
  const to = Math.min(Math.ceil(GUTTER_SEARCH[1] * page.width), Math.floor(textRight) - 1);
  if (to <= from) return [];
  // Coverage counts text *rows* (baselines bucketed to half an em), not
  // items: a text layer has a few items per line, OCR has one per word, and
  // the crossing limit must mean the same thing for both.
  const rowOf = (item: TextItem): number => Math.round(item.y / (0.5 * bodySize));
  const rowsAt = Array.from({ length: to - from + 1 }, () => new Set<number>());
  for (const item of body) {
    const a = Math.max(from, Math.floor(item.x));
    const b = Math.min(to, Math.ceil(item.x + item.width));
    for (let x = a; x <= b; x++) rowsAt[x - from]?.add(rowOf(item));
  }
  const coverage = rowsAt.map((rows) => rows.size);
  const limit = MAX_CROSSING * new Set(body.map(rowOf)).size;
  const gutters: [number, number][] = [];
  let start: number | null = null;
  for (let k = 0; k <= coverage.length; k++) {
    const open = k < coverage.length && (coverage[k] ?? 0) <= limit;
    if (open && start === null) start = k;
    if (!open && start !== null) {
      if (k - 1 - start >= MIN_GUTTER_EMS * bodySize) gutters.push([start + from, k - 1 + from]);
      start = null;
    }
  }
  // Drop gutters that would leave a sliver: OCR'd or justified text can line
  // up word gaps by chance inside a real column.
  let kept = gutters;
  while (kept.length > 0) {
    // Column k runs from the end of gutter k-1 (or the text's left edge) to
    // the start of gutter k (or the text's right edge).
    const widths = [textLeft, ...kept.map(([, b]) => b)].map((left, k) => (kept[k]?.[0] ?? textRight) - left);
    const narrow = widths.findIndex((w) => w < MIN_COLUMN_EMS * bodySize);
    if (narrow === -1) break;
    // Merge the narrow column into its neighbour by dropping a gutter beside
    // it: the one to its right, or for the last column the one to its left.
    const drop = narrow < kept.length ? narrow : narrow - 1;
    kept = kept.filter((_, k) => k !== drop);
  }
  return kept.length < MAX_COLUMNS ? kept : [];
}

/**
 * A line of running text: at least four words, mostly letters, and real
 * words rather than labels. True for prose and for bibliography entries
 * ("Jarrett, K., Kavukcuoglu, K., Ranzato, M., and Le-"); false for table
 * rows ("HT [GeV] ≤ 800 ≤ 800"), contents lines with dot leaders, equations
 * and column headers ("Z VR W VR Top VR").
 */
export function isTextLine(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  const chars = text.replace(/\s/g, '');
  const letters = (chars.match(/\p{L}/gu) ?? []).length;
  if (letters < TEXT_LETTER_SHARE * chars.length) return false;
  return letters / words.length >= TEXT_MEAN_WORD_LETTERS;
}

/**
 * A column of text: enough lines that fill the column with running text,
 * and they are a good share of its lines. Long lines alone are not enough:
 * side-by-side tables, a contents page with dot leaders, or a page of
 * equations also have them.
 */
function isProseColumn(lines: Line[], left: number, right: number): boolean {
  const width = right - left;
  if (width <= 0) return false;
  const prose = lines.filter((l) => l.width >= PROSE_LINE_FILL * width && isTextLine(l.text)).length;
  return prose >= MIN_COLUMN_LINES && prose >= MIN_PROSE_SHARE * lines.length;
}

/**
 * Lines of a page in reading order, handling multiple columns. Single-column
 * pages (no gutter, or a "column" without prose) get the usual top-to-bottom
 * lines.
 */
export function pageToColumnLines(page: PageContent): PageLines & { columns: number } {
  const single = { page: page.page, width: page.width, height: page.height, lines: groupLines(page.items), columns: 1 };
  const gutters = findGutters(page);
  if (gutters.length === 0) return single;
  const cuts = gutters.map(([a, b]) => (a + b) / 2);

  const columnItems: TextItem[][] = cuts.map(() => []).concat([[]]);
  const spanning: TextItem[] = [];
  for (const item of page.items) {
    // Spanning means crossing a whole gutter (a title, a wide figure). Items
    // that only reach into a gutter, like "(2)" list numbers hanging left
    // of a column, belong to the column their centre is on.
    const spans = gutters.some(([a, b]) => item.x < a && item.x + item.width > b);
    if (spans) {
      spanning.push(item);
      continue;
    }
    const centre = item.x + item.width / 2;
    let col = cuts.findIndex((c) => centre < c);
    if (col === -1) col = cuts.length;
    // A list marker inside a gutter labels the text after it: the column to its right.
    const inGutter = gutters.findIndex(([a, b]) => centre >= a && centre <= b);
    if (inGutter !== -1 && LIST_MARKER_RE.test(item.str.trim())) col = inGutter + 1;
    columnItems[col]?.push(item);
  }

  const columns = columnItems.map((items) => groupLines(items));
  const edges = [0, ...gutters.map(([, b]) => b)].map((left, k) => [left, gutters[k]?.[0] ?? page.width] as const);
  for (const [k, items] of columnItems.entries()) {
    if (items.length === 0) return single;
    const [left, right] = edges[k] ?? [0, 0];
    const colLeft = Math.max(left, Math.min(...items.map((i) => i.x)));
    const colRight = Math.min(right, Math.max(...items.map((i) => i.x + i.width)));
    if (!isProseColumn(columns[k] ?? [], colLeft, colRight)) return single;
  }

  // Spanning lines (a title, a full-width figure or equation) split the page
  // into bands; each band is read column by column.
  const ordered: Line[] = [];
  const next = columns.map(() => 0);
  const emitUntil = (y: number): void => {
    columns.forEach((lines, k) => {
      while ((next[k] ?? 0) < lines.length && (lines[next[k] ?? 0]?.y ?? 0) < y) {
        ordered.push(lines[next[k] ?? 0] as Line);
        next[k] = (next[k] ?? 0) + 1;
      }
    });
  };
  for (const band of groupLines(spanning)) {
    emitUntil(band.y);
    ordered.push(band);
  }
  emitUntil(Infinity);
  return { page: page.page, width: page.width, height: page.height, lines: ordered, columns: columns.length };
}
