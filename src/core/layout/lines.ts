// TextItems -> Lines.
//
// Items are grouped by geometry rather than trusting pdf.js's content-stream
// order, because many PDFs (especially ones produced by Word or scanned-then-
// OCR'd) write text in an order that does not match reading order.

import { isBoldFontName } from '../extract/extract';
import type { Line, PageContent, PageLines, TextItem } from '../types';

/**
 * Two items are on the same line when their baselines differ by less than
 * this fraction of the larger font size. 0.5 is large enough to keep
 * superscripts/subscripts (offset ~0.3-0.4em) on their line and small enough
 * that normal line spacing (>= ~1.1em) never merges two lines.
 */
const SAME_LINE_TOLERANCE = 0.5;

/** A horizontal gap wider than this fraction of the font size becomes a space. */
const SPACE_GAP = 0.15;

/**
 * Some PDFs fake bold by drawing the same text twice, slightly offset. Items
 * with identical text that start within this fraction of the font size are
 * treated as duplicates.
 */
const DUPLICATE_OFFSET = 0.25;

function dominant<T>(items: TextItem[], key: (item: TextItem) => T): T | undefined {
  // Weighted by character count so a long run outvotes a short one.
  const weights = new Map<T, number>();
  for (const item of items) {
    const k = key(item);
    weights.set(k, (weights.get(k) ?? 0) + item.str.length);
  }
  let best: T | undefined;
  let bestWeight = -1;
  for (const [k, w] of weights) {
    if (w > bestWeight) {
      best = k;
      bestWeight = w;
    }
  }
  return best;
}

/** Round to the nearest 0.5pt so 10.98 and 11.02 count as the same size. */
export function roundSize(size: number): number {
  return Math.round(size * 2) / 2;
}

/** Join items already sorted left to right, adding spaces at visual gaps. */
export function joinItems(items: TextItem[]): string {
  let text = '';
  let prev: TextItem | undefined;
  for (const item of items) {
    if (prev) {
      const gap = item.x - (prev.x + prev.width);
      const size = Math.max(prev.fontSize, item.fontSize);
      const needsSpace =
        gap > SPACE_GAP * size && !text.endsWith(' ') && !item.str.startsWith(' ');
      if (needsSpace) text += ' ';
    }
    text += item.str;
    prev = item;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function makeLine(items: TextItem[]): Line {
  items.sort((a, b) => a.x - b.x);
  // Drop fake-bold duplicates (see DUPLICATE_OFFSET).
  const unique: TextItem[] = [];
  for (const item of items) {
    const last = unique[unique.length - 1];
    if (last?.str === item.str && Math.abs(last.x - item.x) < DUPLICATE_OFFSET * item.fontSize) continue;
    unique.push(item);
  }
  const first = unique[0];
  if (!first) throw new Error('makeLine called with no items');
  const right = Math.max(...unique.map((i) => i.x + i.width));
  const fontSize = dominant(unique, (i) => roundSize(i.fontSize)) ?? roundSize(first.fontSize);
  const boldChars = unique.filter((i) => isBoldFontName(i.fontName)).reduce((n, i) => n + i.str.length, 0);
  const totalChars = unique.reduce((n, i) => n + i.str.length, 0);
  return {
    page: first.page,
    // Use the baseline of the dominant-size text so a superscript does not
    // shift the line.
    y: unique.find((i) => roundSize(i.fontSize) === fontSize)?.y ?? first.y,
    x: first.x,
    width: right - first.x,
    text: joinItems(unique),
    fontSize,
    bold: totalChars > 0 && boldChars / totalChars > 0.5,
    items: unique,
  };
}

/** Group a page's items into lines, sorted top to bottom. */
export function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: TextItem[][] = [];
  let current: TextItem[] = [];
  let currentY = 0;
  let currentSize = 0;
  for (const item of sorted) {
    const tolerance = SAME_LINE_TOLERANCE * Math.max(currentSize, item.fontSize);
    if (current.length > 0 && Math.abs(item.y - currentY) <= tolerance) {
      current.push(item);
      // Track the largest item so a run of small superscripts can't drift the line.
      if (item.fontSize > currentSize) {
        currentSize = item.fontSize;
        currentY = item.y;
      }
    } else {
      if (current.length > 0) groups.push(current);
      current = [item];
      currentY = item.y;
      currentSize = item.fontSize;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map(makeLine).filter((line) => line.text !== '');
}

export function pageToLines(page: PageContent): PageLines {
  return { page: page.page, width: page.width, height: page.height, lines: groupLines(page.items) };
}

/**
 * A gap between items wider than this many ems suggests the "line" actually
 * spans two columns or table cells. Normal word spaces are ~0.25-0.5em, and
 * justified text rarely stretches past ~1em.
 */
const WIDE_GAP_EMS = 2;

export function hasWideGap(line: Line): boolean {
  for (let i = 1; i < line.items.length; i++) {
    const a = line.items[i - 1];
    const b = line.items[i];
    if (a && b && b.x - (a.x + a.width) > WIDE_GAP_EMS * line.fontSize) return true;
  }
  return false;
}

/**
 * Pages where many lines contain wide gaps probably have columns or tables.
 * Phase 1 reads every line straight across, so the reading order there may
 * be wrong; the caller turns this into a warning instead of failing silently.
 */
export function looksMultiColumn(page: PageLines, minLines = 3, minFraction = 0.3): boolean {
  const wide = page.lines.filter(hasWideGap).length;
  return wide >= minLines && wide / Math.max(page.lines.length, 1) >= minFraction;
}
