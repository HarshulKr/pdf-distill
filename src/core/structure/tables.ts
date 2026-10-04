// Tables: runs of lines whose text sits in aligned cells.
//
// Without this step a table is read row by row with its cells run together,
// e.g. "Z(ll)+jets 13 Sherpa 2.2.11 [81] Sherpa 2.2.11 [82] NNLO ...".
//
// 1. Split each line into cells at gaps wider than CELL_GAP_EMS.
// 2. A table is a run of >= MIN_ROWS consecutive multi-cell lines (short
//    single-cell lines may sit inside it, e.g. a "Single-top:" group label).
// 3. Columns are found from gutters: x ranges that no cell in the run
//    covers. This works for right-aligned numbers, whose left edges vary.
// 4. Each cell goes to the column its start falls in.
// A run that doesn't form a consistent grid is left as text, and the page
// keeps its "columns or a table" warning.

import { CAPTION_RE, isFragment } from '../clean/figures';
import { joinItems } from '../layout/lines';
import type { Line, PageLines, TableBlock, TextItem } from '../types';

/**
 * A gap wider than this many ems separates two cells. Word spaces are
 * ~0.25-0.5em; CS229's table header uses gaps of exactly 1em.
 */
export const CELL_GAP_EMS = 0.9;
const MIN_ROWS = 3;
/** Gutters narrower than this many ems are ignored. */
const MIN_GUTTER_EMS = 0.5;
/** Cells wider than this fraction of the table (spanning headers) don't take part in finding gutters. */
const SPANNING_CELL_FRACTION = 0.4;
/** Table cells are short; longer cells mean prose or display math, not a table. */
const MAX_AVG_CELL_WORDS = 6;
/** Single-cell lines inside a table must be short labels. */
const MAX_LABEL_WORDS = 6;
/**
 * Table rows are about one line apart. Plot axis labels also line up in
 * columns but are spread far apart, so a run whose typical row gap exceeds
 * this many ems is not a table.
 */
const MAX_ROW_SPACING_EMS = 2.5;
/** Rows further apart than this many times the run's typical row gap end the table. */
const MAX_ROW_GAP_RATIO = 2.5;

export interface Cell {
  x: number;
  right: number;
  text: string;
}

/** Split a line into cells at wide gaps. */
export function splitCells(line: Line): Cell[] {
  const cells: Cell[] = [];
  let current: TextItem[] = [];
  const close = (): void => {
    const first = current[0];
    if (!first) return;
    // Same spacing rules as whole lines: "13" "." "6" written touching stay "13.6".
    const text = joinItems(current);
    if (text) cells.push({ x: first.x, right: Math.max(...current.map((i) => i.x + i.width)), text });
    current = [];
  };
  for (const item of line.items) {
    const prev = current[current.length - 1];
    if (prev && item.x - (prev.x + prev.width) > CELL_GAP_EMS * line.fontSize) close();
    current.push(item);
  }
  close();
  return cells;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Column boundaries: midpoints of x ranges that no (non-spanning) cell covers. */
export function findColumnBoundaries(rows: Cell[][], emSize: number): number[] {
  const cells = rows.flat();
  if (cells.length === 0) return [];
  const left = Math.min(...cells.map((c) => c.x));
  const right = Math.max(...cells.map((c) => c.right));
  const narrow = cells.filter((c) => c.right - c.x <= SPANNING_CELL_FRACTION * (right - left));
  const spans = narrow.map((c) => [c.x, c.right] as const).sort((a, b) => a[0] - b[0]);
  const boundaries: number[] = [];
  let reach = spans[0]?.[1] ?? left;
  for (const [x, r] of spans.slice(1)) {
    if (x - reach >= MIN_GUTTER_EMS * emSize) boundaries.push((reach + x) / 2);
    reach = Math.max(reach, r);
  }
  return boundaries;
}

function columnOf(x: number, boundaries: number[]): number {
  let col = 0;
  while (col < boundaries.length && x > (boundaries[col] ?? Infinity)) col++;
  return col;
}

/** Build table rows from cells, or null if they don't form a consistent grid. */
export function buildTable(rows: Cell[][], emSize: number): string[][] | null {
  const boundaries = findColumnBoundaries(rows, emSize);
  const columns = boundaries.length + 1;
  if (columns < 2) return null;
  const table = rows.map((cells) => {
    const row: string[] = Array.from({ length: columns }, () => '');
    for (const cell of cells) {
      const col = columnOf(cell.x, boundaries);
      row[col] = row[col] ? `${row[col]} ${cell.text}` : cell.text;
    }
    return row;
  });
  // Columns that are empty in every row come from stray gutters; drop them.
  const keep = Array.from({ length: columns }, (_, c) => table.some((row) => row[c])).flatMap((k, c) => (k ? [c] : []));
  const grid = table.map((row) => keep.map((c) => row[c] ?? ''));
  return looksLikeTable(grid) ? grid : null;
}

/** Placeholders that fill table cells: "–" (n/a), ". . .", "…", a lone "." of a vertical ellipsis. Not math. */
const FILLER_CELL_RE = /^(?:[-–—.⋮]|(?:\.\s?){2,}\.?|…|(?:·\s?)+·|n\/a)$/i;
/** Pieces of displayed math: a lone letter ("T", "y") or only brackets/operators ("(", "=", "∑"). */
const MATH_PIECE_RE = /^(?:\p{L}|[()[\]{}⟨⟩|‖.,;:∑∏∫∂∇=+−×·<>√]+)$/u;
/** An equation number at the end of a row: "(2)", "(2.9)", "(3a)". */
const EQUATION_NUMBER_RE = /^\(\d+(?:\.\d+)?[a-z]?\)$/;
/** Calculus operators: a table cell rarely has them, displayed math often does. */
const CALCULUS_RE = /[∂∑∏∫∇]/u;
/** Rows that must fill at least two columns. */
const MIN_FILLED_ROWS = 0.7;
/** Required share of non-empty cells: narrow tables vs wide ones (rows of plot panels are wide and sparse). */
const MIN_FILL = 0.5;
const MIN_FILL_WIDE = 0.75;
const WIDE_COLUMNS = 6;
/** Share of cells that may be math pieces or contain calculus operators. */
const MAX_MATH_CELLS = 0.15;
const MAX_CALCULUS_CELLS = 0.1;
/** More columns than this is a row of plot panels, not a table. */
const MAX_COLUMNS = 16;

/**
 * Checks that separate tables from other things that line up in columns:
 * displayed math (matrices, aligned equations) and plot axis labels. Tuned
 * on AIMA, CS229 and an ATLAS paper (DECISIONS.md D39).
 */
export function looksLikeTable(grid: string[][]): boolean {
  const columns = grid[0]?.length ?? 0;
  if (columns < 2 || columns > MAX_COLUMNS) return false;
  const filledRows = grid.filter((row) => row.filter(Boolean).length >= 2).length;
  if (filledRows < MIN_ROWS || filledRows < MIN_FILLED_ROWS * grid.length) return false;
  const cells = grid.flat();
  const nonEmpty = cells.filter(Boolean);
  if (nonEmpty.length < (columns >= WIDE_COLUMNS ? MIN_FILL_WIDE : MIN_FILL) * cells.length) return false;
  // Plot ticks are all numbers; a real table has words somewhere (a header, row labels).
  if (!nonEmpty.some((c) => /\p{L}{2}/u.test(c))) return false;
  const content = nonEmpty.filter((c) => !FILLER_CELL_RE.test(c));
  if (content.length < 0.5 * nonEmpty.length) return false;
  // Displayed equations end in an equation number: "(2)", "(2.9)".
  if (grid.some((row) => EQUATION_NUMBER_RE.test(row.filter(Boolean).at(-1) ?? ''))) return false;
  const mathPieces = content.filter((c) => MATH_PIECE_RE.test(c)).length;
  if (mathPieces > MAX_MATH_CELLS * content.length) return false;
  const calculus = content.filter((c) => CALCULUS_RE.test(c)).length;
  if (calculus > MAX_CALCULUS_CELLS * content.length) return false;
  const avgWords = content.reduce((n, c) => n + wordCount(c), 0) / Math.max(content.length, 1);
  return avgWords <= MAX_AVG_CELL_WORDS;
}

/**
 * Is the run ending before line `next` part of a figure? Plots have legends
 * and axis labels that line up like table cells, but they sit above a
 * "Figure N" caption with only more labels in between. (Tables have their
 * caption above, so this does not affect them.)
 */
export function insideFigure(lines: Line[], cellsByLine: Cell[][], next: number): boolean {
  for (let k = next; k < lines.length; k++) {
    const line = lines[k];
    if (!line) return false;
    if (CAPTION_RE.test(line.text)) return true;
    if ((cellsByLine[k]?.length ?? 0) < 2 && !isFragment(line) && isProse(line.text)) return false;
  }
  return false;
}

/**
 * Sentence-like text: at least three ordinary lowercase words ("the", "and",
 * "events"). Plot labels such as "MLSR1 1tau0lepMLSR2 ..." or "2 1 0 −1
 * Significance" are not, so the search for a figure caption passes them.
 */
export function isProse(text: string): boolean {
  return (text.match(/(?:^|\s)[a-z]{3,}[,.;:]?(?=\s|$)/g)?.length ?? 0) >= 3;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export interface TableResult {
  page: PageLines;
  tables: TableBlock[];
}

/**
 * Find tables on a page. Their lines are removed from the page and returned
 * as table blocks, positioned by the y of their first row.
 */
export function extractTables(page: PageLines): TableResult {
  const cellsByLine = page.lines.map(splitCells);
  const tables: TableBlock[] = [];
  const used = new Set<number>();
  let i = 0;
  while (i < page.lines.length) {
    if ((cellsByLine[i]?.length ?? 0) < 2) {
      i++;
      continue;
    }
    // Grow a run of multi-cell lines, allowing short single-cell labels inside.
    const run = [i];
    let j = i + 1;
    while (j < page.lines.length) {
      const line = page.lines[j];
      const prev = page.lines[run[run.length - 1] ?? i];
      if (!line || !prev) break;
      const gaps = run.slice(1).map((k, n) => (page.lines[k]?.y ?? 0) - (page.lines[run[n] ?? 0]?.y ?? 0));
      const typical = gaps.length ? median(gaps) : 2 * line.fontSize;
      if (line.y - prev.y > MAX_ROW_GAP_RATIO * typical) break;
      // Text of another size (an exponent line of the next equation) is not a row.
      if (Math.abs(line.fontSize - (page.lines[i]?.fontSize ?? line.fontSize)) > 0.2 * line.fontSize) break;
      const cells = cellsByLine[j] ?? [];
      const nextMulti = (cellsByLine[j + 1]?.length ?? 0) >= 2;
      if (cells.length >= 2 || (cells.length === 1 && nextMulti && wordCount(line.text) <= MAX_LABEL_WORDS)) {
        run.push(j);
        j++;
      } else break;
    }
    const multi = run.filter((k) => (cellsByLine[k]?.length ?? 0) >= 2).length;
    const first = page.lines[i];
    const spacing = median(run.slice(1).map((k, n) => (page.lines[k]?.y ?? 0) - (page.lines[run[n] ?? 0]?.y ?? 0)));
    const tight = first !== undefined && spacing <= MAX_ROW_SPACING_EMS * first.fontSize;
    const rows = multi >= MIN_ROWS && first && tight && !insideFigure(page.lines, cellsByLine, j) ? buildTable(run.map((k) => cellsByLine[k] ?? []), first.fontSize) : null;
    if (rows && first) {
      tables.push({ kind: 'table', rows, page: page.page, y: first.y });
      for (const k of run) used.add(k);
    }
    i = j;
  }
  if (!tables.length) return { page, tables };
  return { page: { ...page, lines: page.lines.filter((_, k) => !used.has(k)) }, tables };
}
