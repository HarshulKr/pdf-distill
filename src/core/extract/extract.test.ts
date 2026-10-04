import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  countDocumentText,
  extractPages,
  isBoldFontName,
  mapTextItems,
  multiplyTransform,
  resolveFontName,
  type PdfDocumentLike,
  type PdfObjectsLike,
  type PdfPageLike,
  type PdfTextContentItem,
} from './extract';

// pdf.js viewport transform for an unrotated US Letter page at scale 1:
// flips y so it grows downward.
const VIEWPORT = { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] };

function objs(map: Record<string, unknown>): PdfObjectsLike {
  return { has: (id) => id in map, get: (id) => map[id] };
}

type FakePage = PdfPageLike & { cleanups: number };

function fakePage(items: PdfTextContentItem[], fonts: Record<string, unknown> = {}): FakePage {
  const page: FakePage = {
    cleanups: 0,
    getViewport: () => VIEWPORT,
    getTextContent: () => Promise.resolve({ items }),
    getOperatorList: () => Promise.resolve(null),
    commonObjs: objs(fonts),
    cleanup: () => {
      page.cleanups += 1;
    },
  };
  return page;
}

function fakeDoc(pages: PdfPageLike[]): PdfDocumentLike {
  return { numPages: pages.length, getPage: (n) => Promise.resolve(pages[n - 1] as PdfPageLike) };
}

describe('multiplyTransform', () => {
  it('multiplies affine matrices', () => {
    expect(multiplyTransform([1, 0, 0, 1, 10, 20], [2, 0, 0, 2, 5, 5])).toEqual([2, 0, 0, 2, 15, 25]);
  });
});

describe('mapTextItems', () => {
  it('converts to top-down coordinates and derives font size', () => {
    const items = mapTextItems(
      [{ str: 'Hello', transform: [12, 0, 0, 12, 72, 700], width: 30, height: 12, fontName: 'f1' }],
      VIEWPORT,
      3,
    );
    expect(items).toEqual([
      { str: 'Hello', x: 72, y: 92, width: 30, height: 12, fontName: 'f1', fontSize: 12, page: 3 },
    ]);
  });

  it('skips whitespace-only items and marked-content markers', () => {
    const items = mapTextItems(
      [
        { str: '  ', transform: [12, 0, 0, 12, 0, 0], width: 5, height: 12, fontName: 'f1' },
        { type: 'beginMarkedContent' },
        { str: 'x', transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10, fontName: 'f1' },
      ],
      VIEWPORT,
      1,
    );
    expect(items.map((i) => i.str)).toEqual(['x']);
  });

  it('uses the resolver for font names', () => {
    const items = mapTextItems(
      [{ str: 'x', transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10, fontName: 'g_d0_f1' }],
      VIEWPORT,
      1,
      () => 'Times-Bold',
    );
    expect(items[0]?.fontName).toBe('Times-Bold');
  });
});

describe('font names', () => {
  it.each([
    ['Helvetica-Bold', true],
    ['ABCDEF+Minion-Semibold', true],
    ['Arial-BlackItalic', true],
    ['VJFDLE+CMSSBX10', true],
    ['CMBX12', true],
    ['Times-Roman', false],
    ['CMR10', false],
    ['Boxed', false],
    ['g_d0_f1', false],
  ])('isBoldFontName(%s) = %s', (name, expected) => {
    expect(isBoldFontName(name)).toBe(expected);
  });

  it('prefers the real name, then bold/black flags, then the id', () => {
    const o = objs({ a: { name: 'Times-Bold' }, b: { bold: true }, c: { black: true }, d: {}, e: null });
    expect(resolveFontName('a', o)).toBe('Times-Bold');
    expect(resolveFontName('b', o)).toBe('b-Bold');
    expect(resolveFontName('c', o)).toBe('c-Black');
    expect(resolveFontName('d', o)).toBe('d');
    expect(resolveFontName('e', o)).toBe('e');
    expect(resolveFontName('missing', o)).toBe('missing');
  });
});

describe('extractPages', () => {
  const textItem = (str: string): PdfTextContentItem => ({
    str,
    transform: [11, 0, 0, 11, 72, 700],
    width: 50,
    height: 11,
    fontName: 'f1',
  });

  it('extracts pages in order, resolves fonts, reports progress and cleans up', async () => {
    const p1 = fakePage([textItem('one')], { f1: { name: 'Times-Bold' } });
    const p2 = fakePage([textItem('two')]);
    const progress: number[] = [];
    const pages = await extractPages(fakeDoc([p1, p2]), [1, 2], {
      fonts: true,
      onProgress: (p) => progress.push(p.done),
    });
    expect(pages.map((p) => p.items[0]?.str)).toEqual(['one', 'two']);
    expect(pages[0]?.items[0]?.fontName).toBe('Times-Bold');
    expect(progress).toEqual([1, 2]);
    expect(p1.cleanups).toBe(1);
  });

  it('keeps going when the operator list fails (fonts are optional)', async () => {
    const p = fakePage([textItem('x')]);
    p.getOperatorList = () => Promise.reject(new Error('boom'));
    const [out] = await extractPages(fakeDoc([p]), [1], { fonts: true });
    expect(out?.items[0]?.fontName).toBe('f1');
  });

  it('throws CancelledError when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPages(fakeDoc([fakePage([])]), [1], { fonts: false, signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError);
  });
});

describe('countDocumentText', () => {
  it('sums characters and flags pages with almost no text', async () => {
    const long: PdfTextContentItem = { str: 'a'.repeat(30), transform: [], width: 0, height: 0, fontName: 'f', hasEOL: true };
    const doc = fakeDoc([fakePage([long]), fakePage([]), fakePage([long, long])]);
    const count = await countDocumentText(doc);
    expect(count).toMatchObject({ pages: 3, chars: 31 * 3, lowTextPages: [2] });
  });

  it('finds the body size and large-text chapter candidates', async () => {
    const t = (str: string, size: number, y: number): PdfTextContentItem => ({
      str,
      transform: [size, 0, 0, size, 72, y],
      width: 0,
      height: size,
      fontName: 'f',
    });
    const body = Array.from({ length: 10 }, (_, i) => t('Body text that is long enough to dominate the page.', 11, 600 - i * 15));
    const doc = fakeDoc([fakePage([t('Chapter 2', 24, 700), t('Membranes', 24, 700), ...body]), fakePage(body)]);
    const count = await countDocumentText(doc);
    expect(count.bodySize).toBe(11);
    expect(count.headingCandidates).toEqual([{ page: 1, text: 'Chapter 2 Membranes', size: 24 }]);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(countDocumentText(fakeDoc([fakePage([])]), { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });
});
