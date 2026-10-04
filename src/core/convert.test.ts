import { describe, expect, it } from 'vitest';
import { beforeStats, convert, pagesLabel, removedSummary } from './convert';
import { bodyLines, item, page } from './testing';
import type { PageContent } from './types';

/** A book page with a running header, a page-number footer and body text. */
function bookPage(n: number, body: string[]): PageContent {
  return page(n, [
    { text: 'INTRODUCTION TO BIOLOGY', y: 40, size: 9 },
    ...bodyLines(body, 120),
    { text: String(n), y: 760, size: 9 },
  ]);
}

describe('convert', () => {
  const pages = Array.from({ length: 6 }, (_, i) => bookPage(i + 1, [`Text of page ${i + 1} goes here and is plain body text.`]));

  it('removes headers detected on the sample, even for a 1-page selection', () => {
    const result = convert({ pages, selected: [3], options: { pageMarkers: true }, fileName: 'bio.pdf' });
    expect(result.markdown).toBe(
      '<!-- Source: bio.pdf, page 3 -->\n\n<!-- page 3 -->\n\nText of page 3 goes here and is plain body text.\n',
    );
    expect(result.stats.removedLines).toBe(2);
    expect(result.stats.pages).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('fills "before" stats from the whole-document count when available', () => {
    const result = convert({
      pages,
      selected: [1],
      options: { pageMarkers: false },
      wholeDocument: { pages: 10, chars: 4000 },
    });
    expect(result.stats.tokensBefore).toBe(1000);
    expect(result.stats.rawUploadTokensBefore).toBe(1000 + 10 * 1568);
    expect(result.stats.tokensAfter).toBe(Math.ceil(result.markdown.length / 4));
  });

  it('measures the selected pages raw, so "before" is like-for-like with "after"', () => {
    const result = convert({ pages, selected: [2, 3], options: { pageMarkers: false } });
    // Per page: header (23) + body (50) + footer (1) chars, plus 3 newlines.
    const perPage = 'INTRODUCTION TO BIOLOGY'.length + 'Text of page 2 goes here and is plain body text.'.length + 1 + 3;
    expect(result.stats.charsSelected).toBe(2 * perPage);
    expect(result.stats.tokensSelected).toBe(Math.ceil((2 * perPage) / 4));
    expect(result.stats.rawUploadTokensSelected).toBe(result.stats.tokensSelected + 2 * 1568);
    expect(result.stats.tokensAfter).toBeLessThan(result.stats.tokensSelected);
  });

  it('leaves "before" stats null while the count is running', () => {
    expect(beforeStats(null)).toEqual({ charsBefore: null, tokensBefore: null, rawUploadTokensBefore: null });
  });

  it('warns about pages with no text layer, columns, and unreadable pages', () => {
    const empty: PageContent = { page: 7, width: 612, height: 792, items: [] };
    const columns: PageContent = {
      page: 8,
      width: 612,
      height: 792,
      items: [0, 1, 2, 3].flatMap((i) => [item(`left ${i}`, 72, 200 + i * 15, 11, 'Times', 8), item(`right ${i}`, 330, 200 + i * 15, 11, 'Times', 8)]),
    };
    const result = convert({ pages: [...pages, empty, columns], selected: [7, 8, 9], options: { pageMarkers: false } });
    expect(result.warnings).toEqual([
      'Page 9 could not be read.',
      'Page 7 has no text layer (probably scanned images), so it is missing from the output. OCR support is planned.',
      'Page 8 seems to have columns or a table. Their text may be in the wrong order; check those parts before relying on them.',
    ]);
  });
});

describe('pagesLabel', () => {
  it('uses singular and plural', () => {
    expect(pagesLabel([4])).toBe('page 4');
    expect(pagesLabel([4, 5, 6, 9])).toBe('pages 4-6, 9');
  });
});

describe('removedSummary', () => {
  it('lists non-zero parts with plurals', () => {
    expect(removedSummary({ removedLines: 12, removedMarginNotes: 1, removedFigureLines: 0 })).toBe('12 header/footer lines, 1 margin note');
    expect(removedSummary({ removedLines: 0, removedMarginNotes: 0, removedFigureLines: 0 })).toBe('nothing');
  });
});
