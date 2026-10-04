import { describe, expect, it } from 'vitest';
import { emptyEvidence } from '../clean/hyphenation';
import { bodyLines, line, pageLines } from '../testing';
import {
  bodyFontSize,
  buildBlocks,
  buildProfile,
  continuesParagraph,
  distinctSizes,
  headingKind,
  headingLevel,
  startsParagraph,
  type DocumentProfile,
} from './structure';

const profile: DocumentProfile = {
  bodySize: 11,
  lineGap: 15,
  lineWidth: 468,
  headingSizes: [24, 16],
  hyphens: emptyEvidence(),
};

describe('bodyFontSize', () => {
  it('is the most common size weighted by characters', () => {
    const lines = [
      line('A big heading', { fontSize: 24 }),
      line('a long line of body text that outweighs the heading', { fontSize: 11 }),
      line('another body line', { fontSize: 11 }),
    ];
    expect(bodyFontSize(lines)).toBe(11);
  });
});

describe('headingKind', () => {
  it('size: >= 1.2x body', () => {
    expect(headingKind(line('Membranes', { fontSize: 14 }), profile)).toBe('size');
    expect(headingKind(line('Membranes', { fontSize: 12.5 }), profile)).toBeNull();
  });
  it('bold: short bold line', () => {
    expect(headingKind(line('Open systems', { bold: true, width: 80 }), profile)).toBe('bold');
  });
  it('bold full-width line is body text (a wrapped bold sentence)', () => {
    expect(headingKind(line('A bold sentence that wraps across the full width', { bold: true, width: 460 }), profile)).toBeNull();
  });
  it('chapter patterns', () => {
    expect(headingKind(line('Chapter 3'), profile)).toBe('chapter');
    expect(headingKind(line('CHAPTER III'), profile)).toBe('chapter');
    expect(headingKind(line('Appendix B'), profile)).toBe('chapter');
    expect(headingKind(line('CHAPTER 3 CELL MEMBRANES'), profile)).toBe('chapter');
    expect(headingKind(line('Chapter 3 Cell Membranes', { bold: true, width: 200 }), profile)).toBe('chapter');
  });
  it('a body-size sentence that starts with "Chapter 3" is not a heading', () => {
    expect(headingKind(line('Chapter 3 showed how membranes form, and in this'), profile)).toBeNull();
    expect(headingKind(line('Section 2 of the Act provides that no person'), profile)).toBeNull();
  });
  it('numbered pattern needs bold or a slightly larger size', () => {
    expect(headingKind(line('3.2 Transport', { fontSize: 12.5 }), profile)).toBe('numbered');
    expect(headingKind(line('3.2 Transport'), profile)).toBeNull();
  });
  it('rejects sentence-like and long lines', () => {
    expect(headingKind(line('This ends with a period.', { fontSize: 20 }), profile)).toBeNull();
    expect(headingKind(line('word '.repeat(16).trim(), { fontSize: 20 }), profile)).toBeNull();
    expect(headingKind(line('12345', { fontSize: 20 }), profile)).toBeNull();
  });
  it('allows question headings', () => {
    expect(headingKind(line('What is a cell?', { fontSize: 16 }), profile)).toBe('size');
  });
});

describe('distinctSizes', () => {
  it('merges sizes closer than 0.75pt, largest first', () => {
    expect(distinctSizes([16, 24, 15.5, 12])).toEqual([24, 16, 12]);
  });
});

describe('headingLevel', () => {
  it('maps sizes to levels and puts bold/numbered below them', () => {
    expect(headingLevel(line('A', { fontSize: 24 }), 'size', profile)).toBe(1);
    expect(headingLevel(line('B', { fontSize: 16 }), 'size', profile)).toBe(2);
    expect(headingLevel(line('C', { bold: true }), 'bold', profile)).toBe(3);
    expect(headingLevel(line('Chapter 2'), 'chapter', profile)).toBe(1);
  });
  it('numbered depth with no size levels', () => {
    const flat = { ...profile, headingSizes: [] };
    expect(headingLevel(line('3 Cells'), 'numbered', flat)).toBe(1);
    expect(headingLevel(line('3.2 Membranes'), 'numbered', flat)).toBe(2);
    expect(headingLevel(line('3.2.1 Lipids'), 'numbered', flat)).toBe(3);
  });
});

describe('startsParagraph', () => {
  const prev = line('a full line of text in the middle of a paragraph', { y: 100 });
  it('no: normal next line', () => {
    expect(startsParagraph(prev, line('continues here', { y: 115 }), profile)).toBe(false);
  });
  it('yes: larger vertical gap', () => {
    expect(startsParagraph(prev, line('new paragraph', { y: 122 }), profile)).toBe(true);
  });
  it('yes: indented first line', () => {
    expect(startsParagraph(prev, line('new paragraph', { y: 115, x: 90 }), profile)).toBe(true);
  });
  it('yes: previous line was short and ended a sentence', () => {
    const short = line('End of paragraph.', { y: 100, width: 120 });
    expect(startsParagraph(short, line('Next one', { y: 115 }), profile)).toBe(true);
  });
  it('yes: moved back up the page', () => {
    expect(startsParagraph(prev, line('top of column', { y: 50 }), profile)).toBe(true);
  });
});

describe('buildProfile', () => {
  it('measures body size, line gap, width and heading sizes', () => {
    const p = buildProfile([
      pageLines(1, [{ text: 'Big Title', y: 60, size: 24 }, ...bodyLines(['one line of body', 'two', 'three'])]),
    ]);
    expect(p.bodySize).toBe(11);
    expect(p.lineGap).toBe(15);
    expect(p.headingSizes).toEqual([24]);
  });
});

describe('buildBlocks', () => {
  it('produces page breaks, headings and paragraphs', () => {
    const pages = [
      pageLines(1, [
        { text: 'Chapter 1 Cells', y: 60, size: 24 },
        ...bodyLines(['Cells are the basic unit of life and every', 'organism is made of them.'], 100),
        ...bodyLines(['A second paragraph starts after a gap.'], 150),
      ]),
    ];
    const blocks = buildBlocks(pages, buildProfile(pages));
    expect(blocks).toEqual([
      { kind: 'pageBreak', page: 1 },
      { kind: 'heading', level: 1, text: 'Chapter 1 Cells', page: 1 },
      { kind: 'paragraph', text: 'Cells are the basic unit of life and every organism is made of them.', page: 1 },
      { kind: 'paragraph', text: 'A second paragraph starts after a gap.', page: 1 },
    ]);
  });

  it('merges a two-line heading', () => {
    const pages = [
      pageLines(1, [
        { text: 'A Very Long Chapter Title That', y: 60, size: 20 },
        { text: 'Wraps Onto Two Lines', y: 84, size: 20 },
        ...bodyLines(['Body text that is longer than the heading so that 11pt', 'is clearly the body size of this small test page.'], 120),
      ]),
    ];
    const blocks = buildBlocks(pages, buildProfile(pages));
    expect(blocks[1]).toEqual({ kind: 'heading', level: 1, text: 'A Very Long Chapter Title That Wraps Onto Two Lines', page: 1 });
  });

  it('joins a paragraph that continues on the next page; the marker follows it', () => {
    const pages = [
      pageLines(1, bodyLines(['The membrane is built from phospho-'], 700)),
      pageLines(2, bodyLines(['lipids, which form a bilayer.'], 80)),
    ];
    const blocks = buildBlocks(pages, buildProfile(pages));
    expect(blocks).toEqual([
      { kind: 'pageBreak', page: 1 },
      { kind: 'paragraph', text: 'The membrane is built from phospholipids, which form a bilayer.', page: 1 },
      { kind: 'pageBreak', page: 2 },
    ]);
  });

  it('does not join across pages after a sentence end', () => {
    const pages = [
      pageLines(1, bodyLines(['First page ends here.'], 700)),
      pageLines(2, bodyLines(['lowercase start but new paragraph'], 80)),
    ];
    expect(buildBlocks(pages, buildProfile(pages)).filter((b) => b.kind === 'paragraph')).toHaveLength(2);
  });

  it('does not join across a gap in the selection (page 70 -> page 82)', () => {
    const pages = [
      pageLines(70, bodyLines(['The membrane is built from'], 700)),
      pageLines(82, bodyLines(['proteins that span the bilayer.'], 80)),
    ];
    expect(buildBlocks(pages, buildProfile(pages))).toEqual([
      { kind: 'pageBreak', page: 70 },
      { kind: 'paragraph', text: 'The membrane is built from', page: 70 },
      { kind: 'pageBreak', page: 82 },
      { kind: 'paragraph', text: 'proteins that span the bilayer.', page: 82 },
    ]);
  });
});

describe('continuesParagraph', () => {
  it('requires paragraph -> paragraph with a lowercase continuation', () => {
    const p = (text: string) => ({ kind: 'paragraph' as const, text, page: 1 });
    expect(continuesParagraph(p('and so'), p('on'))).toBe(true);
    expect(continuesParagraph(p('and so'), p('On'))).toBe(false);
    expect(continuesParagraph(p('done.'), p('on'))).toBe(false);
    expect(continuesParagraph(undefined, p('on'))).toBe(false);
  });
});
