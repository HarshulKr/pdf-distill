import { describe, expect, it } from 'vitest';
import { item } from '../testing';
import type { PageContent, TextItem } from '../types';
import { findGutters, isTextLine, pageToColumnLines } from './columns';

const SENTENCES = [
  'the electrostatics of nanocapacitors can be minimized by',
  'keeping the dielectric thickness small in this simulation',
  'we use an even distribution of charge in the dielectric',
  'layer to simulate average defects and the metal electrodes',
  'which are connected to the ambient via their contacts',
  'that can be viewed as electron reservoirs for charge',
  'stored in the capacitor at any instant of the cycle',
  'and the tunneling current determines the leakage rate',
];

/** Prose lines in a column at x from `left`, 8pt, ~215pt wide (IEEE layout). */
function column(left: number, label: string, top = 300, rows = SENTENCES.length): TextItem[] {
  return Array.from({ length: rows }, (_, i) => ({
    ...item(i === 0 ? `${label} ${SENTENCES[i]}` : (SENTENCES[i % SENTENCES.length] ?? ''), left, top + i * 10, 8),
    width: 210,
  }));
}

function page(items: TextItem[]): PageContent {
  return { page: 1, width: 595, height: 841, items };
}

describe('isTextLine', () => {
  it('is running text, including bibliography entries', () => {
    expect(isTextLine('keeping the dielectric thickness small in this')).toBe(true);
    expect(isTextLine('Jarrett, K., Kavukcuoglu, K., Ranzato, M., and Le-')).toBe(true);
  });
  it('is not table rows, column headers, dot leaders or equations', () => {
    expect(isTextLine('HT [GeV] ≤ 800 ≤ 800 ≤ 800')).toBe(false);
    expect(isTextLine('Z VR W VR Top VR')).toBe(false);
    expect(isTextLine('1.1 What Is AI? . . . . . . . . . . . . 1')).toBe(false);
    expect(isTextLine('EBO = Eo r y u (6)')).toBe(false);
  });
});

describe('findGutters', () => {
  it('finds the gutter of a two-column page', () => {
    const gutters = findGutters(page([...column(77, 'LEFT'), ...column(308, 'RIGHT')]));
    expect(gutters).toHaveLength(1);
    const [g] = gutters;
    expect(g?.[0]).toBeGreaterThanOrEqual(287);
    expect(g?.[1]).toBeLessThanOrEqual(308);
  });
  it('finds nothing on a single-column page', () => {
    const wide = column(72, 'ONLY').map((i) => ({ ...i, width: 450 }));
    expect(findGutters(page(wide))).toEqual([]);
  });
  it('ignores a sliver where word gaps line up by chance', () => {
    // Right column with a 6pt gap at x=488-494 in every line (OCR'd text).
    const right = column(308, 'RIGHT').flatMap((i) => [
      { ...i, width: 180 },
      { ...i, str: 'end', x: 494, width: 24 },
    ]);
    expect(findGutters(page([...column(77, 'LEFT'), ...right]))).toHaveLength(1);
  });
});

describe('pageToColumnLines', () => {
  it('reads the left column, then the right, with a full-width title first', () => {
    const title = { ...item('Quantum electrical characteristics of nanocapacitors', 80, 145, 21), width: 425 };
    const lines = pageToColumnLines(page([title, ...column(77, 'LEFT'), ...column(308, 'RIGHT')]));
    expect(lines.columns).toBe(2);
    const texts = lines.lines.map((l) => l.text);
    expect(texts[0]).toBe(title.str);
    const leftStart = texts.findIndex((t) => t.startsWith('LEFT'));
    const rightStart = texts.findIndex((t) => t.startsWith('RIGHT'));
    expect(leftStart).toBe(1);
    expect(rightStart).toBe(1 + SENTENCES.length);
  });

  it('reads three columns left to right (a bibliography)', () => {
    const items = [36, 203, 371].flatMap((x, k) => column(x, `COL${k}`).map((i) => ({ ...i, width: 150 })));
    const lines = pageToColumnLines(page(items));
    expect(lines.columns).toBe(3);
    const starts = ['COL0', 'COL1', 'COL2'].map((c) => lines.lines.findIndex((l) => l.text.startsWith(c)));
    expect(starts).toEqual([0, SENTENCES.length, 2 * SENTENCES.length]);
  });

  it('keeps side-by-side table cells as one page (no prose on one side)', () => {
    const cells = Array.from({ length: 8 }, (_, i) => [
      { ...item(`Row label ${i} with words here`, 76, 300 + i * 10, 8), width: 200 },
      { ...item('≤ 800 [600, 1000]', 400, 300 + i * 10, 8), width: 120 },
    ]).flat();
    const lines = pageToColumnLines(page(cells));
    expect(lines.columns).toBe(1);
    expect(lines.lines).toHaveLength(8);
  });
});
