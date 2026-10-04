// Margin notes: small text beside the main text column.
//
// Textbooks such as Russell & Norvig print glossary terms in the outer margin
// ("Goal formulation" next to the paragraph that defines it). They share a
// baseline with body lines, so without this step they are glued into
// sentences: "Goals organize Goal formulation behavior by ...". The terms
// repeat words from the body text, so they are dropped rather than kept.

import type { PageContent, TextItem } from '../types';

export interface TextBlock {
  /** Left edge of the main text column. */
  left: number;
  /** Right edge of the main text column. */
  right: number;
}

export interface MarginOptions {
  /** Margin text must be smaller than this fraction of body size (dropping same-size text is too risky). */
  maxSizeRatio: number;
  /** ...and start/end at least this many ems outside the text block. */
  minGapEms: number;
  /** Margin text must appear on at least this many pages of the sample... */
  minPages: number;
  /** ...and this fraction of pages with body text, so a one-off wide figure label is not a "margin". */
  minFraction: number;
  /**
   * Top and bottom fraction of the page left alone. Running headers often
   * put the page number outside the text column ("Section 3.1 ... 83"); the
   * header step needs that number, so it must not be removed here.
   */
  edgeZone: number;
}

export const DEFAULT_MARGIN_OPTIONS: MarginOptions = {
  maxSizeRatio: 0.95,
  minGapEms: 0.5,
  minPages: 3,
  minFraction: 0.15,
  edgeZone: 0.08,
};

/** Pages need this many body-size items to estimate their text block. */
const MIN_BODY_ITEMS = 20;

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Most common rounded font size, weighted by characters. */
export function itemsBodySize(items: TextItem[]): number {
  const weights = new Map<number, number>();
  for (const item of items) {
    const size = roundHalf(item.fontSize);
    weights.set(size, (weights.get(size) ?? 0) + item.str.length);
  }
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

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] ?? 0;
}

/**
 * The main text column of one page, from its body-size items: the 5th
 * percentile of left edges and the 95th percentile of right edges (robust
 * to a few indented or overhanging items). Null when the page has too little
 * body text to tell.
 */
export function pageTextBlock(items: TextItem[], bodySize: number): TextBlock | null {
  const body = items.filter((i) => Math.abs(roundHalf(i.fontSize) - bodySize) < 0.75);
  if (body.length < MIN_BODY_ITEMS) return null;
  return {
    left: percentile(
      body.map((i) => i.x),
      0.05,
    ),
    right: percentile(
      body.map((i) => i.x + i.width),
      0.95,
    ),
  };
}

function isMarginItem(
  item: TextItem,
  page: PageContent,
  block: TextBlock,
  bodySize: number,
  options: MarginOptions,
): boolean {
  if (item.fontSize >= options.maxSizeRatio * bodySize) return false;
  const top = item.y - item.fontSize;
  if (top <= options.edgeZone * page.height || item.y >= (1 - options.edgeZone) * page.height) return false;
  const gap = options.minGapEms * bodySize;
  return item.x >= block.right + gap || item.x + item.width <= block.left - gap;
}

export interface MarginResult {
  pages: PageContent[];
  /** Number of margin items removed (each is typically one note line). */
  removed: number;
}

/**
 * Remove margin notes when the sample shows a consistent margin: small text
 * outside the text column on enough pages. Pages whose text block can't be
 * measured borrow the block of the nearest measured page with the same
 * parity, since books mirror their layout on odd and even pages.
 */
export function removeMarginNotes(pages: PageContent[], options: MarginOptions = DEFAULT_MARGIN_OPTIONS): MarginResult {
  const bodySize = itemsBodySize(pages.flatMap((p) => p.items));
  if (bodySize === 0) return { pages, removed: 0 };

  const blocks = new Map<number, TextBlock>();
  for (const page of pages) {
    const block = pageTextBlock(page.items, bodySize);
    if (block) blocks.set(page.page, block);
  }
  const blockFor = (pageNumber: number): TextBlock | null => {
    const own = blocks.get(pageNumber);
    if (own) return own;
    let best: TextBlock | null = null;
    let bestDistance = Infinity;
    for (const [p, block] of blocks) {
      const distance = Math.abs(p - pageNumber);
      if ((p - pageNumber) % 2 === 0 && distance < bestDistance) {
        best = block;
        bestDistance = distance;
      }
    }
    return best;
  };

  const marginPages = pages.filter((page) => {
    const block = blocks.get(page.page);
    return block !== undefined && page.items.some((i) => isMarginItem(i, page, block, bodySize, options));
  }).length;
  if (marginPages < options.minPages || marginPages < options.minFraction * blocks.size) {
    return { pages, removed: 0 };
  }

  let removed = 0;
  const out = pages.map((page) => {
    const block = blockFor(page.page);
    if (!block) return page;
    const items = page.items.filter((item) => {
      const margin = isMarginItem(item, page, block, bodySize, options);
      if (margin) removed += 1;
      return !margin;
    });
    return { ...page, items };
  });
  return { pages: out, removed };
}
