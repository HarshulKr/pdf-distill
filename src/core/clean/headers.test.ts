import { describe, expect, it } from 'vitest';
import { line, PAGE_H, pageLines } from '../testing';
import type { PageLines } from '../types';
import {
  edgeZoneOf,
  findRunningLines,
  hasNearbyRun,
  isPageNumberText,
  normalizeEdgeLine,
  removeHeadersAndFooters,
} from './headers';

/** A page with a header at the top, body text, and a footer at the bottom. */
function bookPage(n: number, header: string | null, footer: string | null): PageLines {
  return pageLines(n, [
    ...(header ? [{ text: header, y: 40, size: 9 }] : []),
    { text: `Body text on page ${n} that is long enough to be a real line.`, y: 200 },
    ...(footer ? [{ text: footer, y: 760, size: 9 }] : []),
  ]);
}

describe('normalizeEdgeLine', () => {
  it('replaces digits, lowercases and collapses whitespace', () => {
    expect(normalizeEdgeLine('  Chapter 2   Page 14 ')).toBe('chapter # page #');
  });
});

describe('edgeZoneOf', () => {
  it('detects the top and bottom 8% of the page', () => {
    expect(edgeZoneOf(line('h', { y: 40, fontSize: 9 }), PAGE_H, 0.08)).toBe('top');
    expect(edgeZoneOf(line('f', { y: 760 }), PAGE_H, 0.08)).toBe('bottom');
    expect(edgeZoneOf(line('b', { y: 300 }), PAGE_H, 0.08)).toBeNull();
  });
});

describe('findRunningLines', () => {
  it('finds a header repeated on every page, ignoring changing numbers', () => {
    const pages = [1, 2, 3, 4].map((n) => bookPage(n, `Cell Biology  ${n * 2}`, null));
    expect(findRunningLines(pages)).toEqual(new Set(['top:cell biology #']));
  });

  it('handles alternating even/odd headers (~50% each)', () => {
    const pages = [1, 2, 3, 4, 5, 6].map((n) => bookPage(n, n % 2 ? 'Chapter 2 The Cell' : 'Principles of Biology', null));
    expect(findRunningLines(pages)).toEqual(new Set(['top:chapter # the cell', 'top:principles of biology']));
  });

  it('needs more than 40% of pages', () => {
    // 4 of 10 pages = exactly 40%: not more than 40%. Spread out (pages 1, 2,
    // 9, 10) so the nearby rule does not apply either.
    const on = new Set([1, 2, 9, 10]);
    const pages = Array.from({ length: 10 }, (_, i) => bookPage(i + 1, on.has(i + 1) ? 'Sometimes' : null, null));
    expect(findRunningLines(pages).size).toBe(0);
  });

  it('finds a short chapter\'s odd-page header in a 31-page sample (nearby rule)', () => {
    // Pages 1-31; the chapter runs 10-19 and prints its title on odd pages:
    // 5 of 31 pages (16%), far under 40%.
    const pages = Array.from({ length: 31 }, (_, i) => {
      const n = i + 1;
      const inChapter = n >= 10 && n <= 19;
      return bookPage(n, inChapter && n % 2 ? 'Chapter 4 Membrane Transport' : 'Principles of Biology', null);
    });
    expect(findRunningLines(pages)).toContain('top:chapter # membrane transport');
  });

  it('ignores a line that appears on 3 pages far apart', () => {
    const on = new Set([1, 12, 25]);
    const pages = Array.from({ length: 31 }, (_, i) => bookPage(i + 1, on.has(i + 1) ? 'Exercises' : null, null));
    expect(findRunningLines(pages).size).toBe(0);
  });

  it('needs at least 3 pages, even if that is 100% of the sample', () => {
    const pages = [1, 2].map((n) => bookPage(n, 'Header', null));
    expect(findRunningLines(pages).size).toBe(0);
  });

  it('ignores repeated text outside the edge zones', () => {
    const pages = [1, 2, 3].map((n) => pageLines(n, [{ text: 'Same body line', y: 300 }]));
    expect(findRunningLines(pages).size).toBe(0);
  });

  it('counts a line once per page', () => {
    const p = pageLines(1, [
      { text: 'Dup', y: 30 },
      { text: 'Dup', y: 45 },
    ]);
    expect(findRunningLines([p, bookPage(2, null, null), bookPage(3, null, null)]).size).toBe(0);
  });
});

describe('isPageNumberText', () => {
  it.each(['12', 'xiv', 'IV', 'Page 3', 'page 3 of 40', '3 of 40', '3 / 40', '- 7 -', '— 12 —'])('"%s" is a page number', (t) => {
    expect(isPageNumberText(t)).toBe(true);
  });
  it.each(['', 'Chapter 3', '12 Angry Men', 'mix', 'civil', '12345'])('"%s" is not', (t) => {
    expect(isPageNumberText(t)).toBe(false);
  });
});

describe('removeHeadersAndFooters', () => {
  it('removes running lines and page numbers in edge zones only, and counts them', () => {
    const pages = [1, 2, 3].map((n) => bookPage(n, 'Running Head', String(n)));
    // A page number in the body (e.g. a list item "12") must survive.
    pages[0]?.lines.push(line('12', { y: 400 }));
    const running = findRunningLines(pages);
    const { pages: out, removed } = removeHeadersAndFooters(pages, running);
    expect(removed).toBe(6);
    expect(out[0]?.lines.map((l) => l.text)).toEqual([
      'Body text on page 1 that is long enough to be a real line.',
      '12',
    ]);
  });
});

describe('hasNearbyRun', () => {
  it('checks whether `count` sorted pages fit within `span`', () => {
    expect(hasNearbyRun([10, 12, 14], 3, 6)).toBe(true);
    expect(hasNearbyRun([10, 13, 17], 3, 6)).toBe(false);
    expect(hasNearbyRun([1, 20, 22, 24], 3, 6)).toBe(true);
    expect(hasNearbyRun([1, 2], 3, 6)).toBe(false);
  });
});
