import { describe, expect, it } from 'vitest';
import { item } from '../testing';
import type { PageContent } from '../types';
import { itemsBodySize, pageTextBlock, removeMarginNotes } from './margins';

/**
 * A page shaped like Russell & Norvig: 11pt body text in a column from x=54
 * to x=458, and an 8pt glossary note at x=466 on some body lines (outer
 * margin on odd pages; on even pages the column is at 118-522 and notes sit
 * on the left at x=36).
 */
function bookPage(n: number, note: string | null): PageContent {
  const odd = n % 2 === 1;
  const left = odd ? 54 : 118;
  const items = Array.from({ length: 24 }, (_, i) =>
    item('word '.repeat(16).trim(), left, 100 + i * 14, 11, 'Times', n),
  ).map((it) => ({ ...it, width: 404 }));
  if (note) items.push(item(note, odd ? 466 : 36, 128, 8, 'CMSS8', n));
  // A page number in the running header, outside the column: must survive.
  items.push(item(String(n), odd ? 530 : 36, 40, 10, 'Times', n));
  return { page: n, width: 576, height: 720, items };
}

describe('itemsBodySize / pageTextBlock', () => {
  it('measures the main column from body-size items', () => {
    const page = bookPage(1, 'Goal formulation');
    expect(itemsBodySize(page.items)).toBe(11);
    expect(pageTextBlock(page.items, 11)).toEqual({ left: 54, right: 458 });
  });
});

describe('removeMarginNotes', () => {
  it('removes small notes beside the column on both odd and even pages', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => bookPage(n, n === 5 ? null : `Note ${n}`));
    const { pages: out, removed } = removeMarginNotes(pages);
    expect(removed).toBe(4);
    for (const page of out) expect(page.items.some((i) => i.str.startsWith('Note'))).toBe(false);
  });

  it('keeps page numbers in the header zone for the header step', () => {
    const pages = [1, 2, 3, 4].map((n) => bookPage(n, 'Note'));
    const { pages: out } = removeMarginNotes(pages);
    for (const page of out) expect(page.items.some((i) => i.str === String(page.page))).toBe(true);
  });

  it('does nothing without a consistent margin (one stray small label)', () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => bookPage(n, n === 3 ? 'Stray' : null));
    expect(removeMarginNotes(pages).removed).toBe(0);
  });

  it('never removes text at body size, even outside the column', () => {
    const pages = [1, 2, 3, 4].map((n) => {
      const page = bookPage(n, null);
      page.items.push(item('Same-size note', 466, 128, 11, 'Times', n));
      return page;
    });
    expect(removeMarginNotes(pages).removed).toBe(0);
  });
});

describe('wide lines are not margin notes', () => {
  it('keeps small text that continues a line from inside the column (captions, algorithm boxes)', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => {
      const page = bookPage(n, 'Note');
      // A 9pt caption line that starts in the column and runs past its right edge.
      page.items.push(item('Distribution of the selected events above', 300, 400, 9, 'Times', n));
      page.items.push(item('150 GeV.', 479, 400, 9, 'Times', n));
      return page;
    });
    const { pages: out, removed } = removeMarginNotes(pages);
    expect(removed).toBe(5); // only the five "Note" items
    for (const page of out) expect(page.items.some((i) => i.str === '150 GeV.')).toBe(true);
  });
});
