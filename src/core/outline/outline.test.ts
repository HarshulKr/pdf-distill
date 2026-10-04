import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  destinationPage,
  pagesOfSections,
  sectionsFromEntries,
  sectionsFromHeadings,
  sectionsFromOutline,
  sectionsInSelection,
  type PdfOutlineDocLike,
  type PdfOutlineNodeLike,
} from './outline';

describe('sectionsFromEntries', () => {
  it('ends each section before the next one at the same or a higher level', () => {
    const sections = sectionsFromEntries(
      [
        { title: 'Chapter 1', level: 1, page: 1 },
        { title: '1.1 Cells', level: 2, page: 2 },
        { title: '1.2 Size', level: 2, page: 5 },
        { title: 'Chapter 2', level: 1, page: 9 },
      ],
      20,
    );
    expect(sections).toEqual([
      { title: 'Chapter 1', level: 1, startPage: 1, endPage: 8 },
      { title: '1.1 Cells', level: 2, startPage: 2, endPage: 4 },
      { title: '1.2 Size', level: 2, startPage: 5, endPage: 8 },
      { title: 'Chapter 2', level: 1, startPage: 9, endPage: 20 },
    ]);
  });

  it('keeps a section that shares its start page with the next one to that page', () => {
    const sections = sectionsFromEntries(
      [
        { title: 'A', level: 1, page: 3 },
        { title: 'B', level: 1, page: 3 },
      ],
      5,
    );
    expect(sections.map((s) => [s.startPage, s.endPage])).toEqual([
      [3, 3],
      [3, 5],
    ]);
  });

  it('drops entries with pages outside the document or empty titles', () => {
    expect(
      sectionsFromEntries(
        [
          { title: 'Ok', level: 1, page: 1 },
          { title: 'Bad', level: 1, page: 99 },
          { title: '  ', level: 1, page: 2 },
        ],
        5,
      ).map((s) => s.title),
    ).toEqual(['Ok']);
  });
});

describe('cleanTitle', () => {
  it('collapses whitespace and control characters', () => {
    expect(cleanTitle(' Chapter\u00001\r\n  Cells ')).toBe('Chapter 1 Cells');
  });
});

/** A fake document: refs are objects {num}, page index = num. Named dests in `names`. */
function fakeDoc(outline: PdfOutlineNodeLike[] | null, numPages = 10, names: Record<string, unknown[]> = {}): PdfOutlineDocLike {
  return {
    numPages,
    getOutline: () => Promise.resolve(outline),
    getDestination: (id) => Promise.resolve(names[id] ?? null),
    getPageIndex: (ref: never) => {
      const r = ref as { num?: number };
      return typeof r.num === 'number' ? Promise.resolve(r.num) : Promise.reject(new Error('bad ref'));
    },
  };
}

const node = (title: string, dest: PdfOutlineNodeLike['dest'], items: PdfOutlineNodeLike[] = []): PdfOutlineNodeLike => ({
  title,
  dest,
  items,
});

describe('destinationPage', () => {
  const doc = fakeDoc(null, 10, { intro: [{ num: 4 }, { name: 'XYZ' }] });
  it('resolves page refs, named destinations and numeric indexes', async () => {
    expect(await destinationPage(doc, [{ num: 2 }, { name: 'Fit' }])).toBe(3);
    expect(await destinationPage(doc, 'intro')).toBe(5);
    expect(await destinationPage(doc, [6, { name: 'Fit' }])).toBe(7);
  });
  it('returns null for missing or broken destinations', async () => {
    expect(await destinationPage(doc, null)).toBeNull();
    expect(await destinationPage(doc, 'missing')).toBeNull();
    expect(await destinationPage(doc, [{ bogus: true }])).toBeNull();
  });
});

describe('sectionsFromOutline', () => {
  it('walks two levels and skips deeper ones and broken entries', async () => {
    const doc = fakeDoc([
      node('Chapter 1', [{ num: 0 }], [node('1.1', [{ num: 1 }], [node('1.1.1 too deep', [{ num: 1 }])])]),
      node('Broken', null),
      node('Chapter 2', [{ num: 5 }]),
    ]);
    expect(await sectionsFromOutline(doc)).toEqual([
      { title: 'Chapter 1', level: 1, startPage: 1, endPage: 5 },
      { title: '1.1', level: 2, startPage: 2, endPage: 5 },
      { title: 'Chapter 2', level: 1, startPage: 6, endPage: 10 },
    ]);
  });
  it('returns [] without an outline or when reading it fails', async () => {
    expect(await sectionsFromOutline(fakeDoc(null))).toEqual([]);
    const failing = { ...fakeDoc(null), getOutline: () => Promise.reject(new Error('x')) };
    expect(await sectionsFromOutline(failing)).toEqual([]);
  });
});

describe('sectionsFromHeadings', () => {
  it('uses the two largest sizes above 1.4x body as levels 1 and 2', () => {
    const sections = sectionsFromHeadings(
      [
        { page: 1, text: 'Chapter 1 Cells', size: 24 },
        { page: 1, text: 'Cells', size: 24 }, // second run on the same page and level: ignored
        { page: 3, text: '1.1 Size', size: 16 },
        { page: 4, text: 'Slightly big', size: 13 }, // under 1.4 x 10
        { page: 6, text: 'Chapter 2 Membranes', size: 24 },
        { page: 7, text: 'A caption that ends.', size: 24 }, // sentence
      ],
      10,
      9,
    );
    expect(sections).toEqual([
      { title: 'Chapter 1 Cells', level: 1, startPage: 1, endPage: 5 },
      { title: '1.1 Size', level: 2, startPage: 3, endPage: 5 },
      { title: 'Chapter 2 Membranes', level: 1, startPage: 6, endPage: 9 },
    ]);
  });
  it('merges a title repeated on consecutive slides into one section', () => {
    const sections = sectionsFromHeadings(
      [
        { page: 1, text: 'Muscles', size: 40 },
        { page: 2, text: 'Active tension', size: 30 },
        { page: 3, text: 'Active tension', size: 30 },
        { page: 4, text: 'Active tension', size: 30 },
        { page: 5, text: 'Total tension', size: 30 },
      ],
      20,
      6,
    );
    expect(sections.map((s) => [s.title, s.startPage, s.endPage])).toEqual([
      ['Muscles', 1, 6],
      ['Active tension', 2, 4],
      ['Total tension', 5, 6],
    ]);
  });

  it('returns [] when nothing stands out', () => {
    expect(sectionsFromHeadings([{ page: 1, text: 'Small', size: 11 }], 10, 3)).toEqual([]);
  });
});

describe('selection helpers', () => {
  const sections = [
    { title: 'A', level: 1, startPage: 1, endPage: 3 },
    { title: 'B', level: 1, startPage: 4, endPage: 6 },
    { title: 'C', level: 1, startPage: 9, endPage: 10 },
  ];
  it('pagesOfSections unions page ranges', () => {
    expect(pagesOfSections(sections.filter((s) => s.title !== 'B'))).toEqual([1, 2, 3, 9, 10]);
  });
  it('sectionsInSelection keeps overlapping sections', () => {
    expect(sectionsInSelection(sections, [3, 4]).map((s) => s.title)).toEqual(['A', 'B']);
  });
});
