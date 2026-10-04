import { describe, expect, it } from 'vitest';
import { item, pageLines } from '../testing';
import type { Line, PageLines } from '../types';
import { extractTables, findColumnBoundaries, isProse, looksLikeTable, splitCells } from './tables';
import { groupLines } from '../layout/lines';

/** One line made of cells at the given x positions (6pt text, like ATLAS tables). */
function row(y: number, cells: [number, string][], size = 6): Line {
  const [line] = groupLines(cells.map(([x, text]) => item(text, x, y, size)));
  if (!line) throw new Error('empty row');
  return line;
}

function pageOf(lines: Line[]): PageLines {
  return { page: 7, width: 595, height: 842, lines };
}

describe('splitCells', () => {
  it('splits a line at gaps wider than ~1em', () => {
    const cells = splitCells(row(100, [[80, 'Physics process'], [159, 'Generator'], [253, 'Parton Shower']]));
    expect(cells.map((c) => c.text)).toEqual(['Physics process', 'Generator', 'Parton Shower']);
  });
});

describe('findColumnBoundaries', () => {
  it('finds gutters even when numbers are right-aligned', () => {
    // Column 2 holds right-aligned numbers: "5" starts further right than "1234".
    const rows = [
      [
        { x: 80, right: 120, text: 'Alpha' },
        { x: 200, right: 224, text: '1234' },
      ],
      [
        { x: 80, right: 110, text: 'Beta' },
        { x: 218, right: 224, text: '5' },
      ],
    ];
    const boundaries = findColumnBoundaries(rows, 6);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toBeGreaterThan(120);
    expect(boundaries[0]).toBeLessThan(200);
  });
});

describe('looksLikeTable', () => {
  it('accepts a dense grid with words, dashes and comparisons (ATLAS selection table)', () => {
    expect(
      looksLikeTable([
        ['Requirement', 'Multijet', 'Z(ll)', 'W(mu nu)'],
        ['N leptons', '= 0', '= 2', '= 1'],
        ['N taus', '≥ 1', '–', '= 1'],
        ['MET [GeV]', '> 150', '–', '–'],
      ]),
    ).toBe(true);
  });

  it('accepts a numeric table with a header and vertical-ellipsis rows (CS229 housing data)', () => {
    expect(
      looksLikeTable([
        ['Living area (feet2)', '#bedrooms', 'Price (1000$s)'],
        ['2104', '3', '400'],
        ['1600', '3', '330'],
        ['.', '.', '.'],
      ]),
    ).toBe(true);
  });

  it('rejects plot axis ticks (numbers only)', () => {
    expect(looksLikeTable([['0', '0', '0'], ['20', '20', '20'], ['40', '40', '40']])).toBe(false);
  });

  it('rejects displayed math: lone letters and brackets, equation numbers, calculus', () => {
    expect(looksLikeTable([['(', 'T', ')'], ['x', '=', 'y'], ['A11', 'A12', 'T']])).toBe(false);
    expect(looksLikeTable([['n = p × k', 'r = p − k cos θ', ''], ['sin θ', 'sin θ', '(2)'], ['a b', 'c d', '']])).toBe(false);
    expect(looksLikeTable([['∂f/∂A11', '∂f/∂A12'], ['∂f/∂A21', '∂f/∂A22'], ['grad of', 'matrix']])).toBe(false);
  });

  it('rejects wide sparse grids (rows of plot panels)', () => {
    const sparse = Array.from({ length: 4 }, (_, r) => Array.from({ length: 9 }, (_, c) => (c % 3 === 0 ? `ATLAS ${r}` : '')));
    expect(looksLikeTable(sparse)).toBe(false);
  });
});

describe('extractTables', () => {
  const header = row(138, [[80, 'Physics process'], [159, 'Generator'], [253, 'Parton Shower'], [319, 'Accuracy']]);
  const body = [
    row(148, [[80, 'Z(ll)+jets'], [159, 'Sherpa 2.2.11'], [253, 'Sherpa 2.2.11'], [319, 'NNLO']]),
    row(155, [[159, 'Sherpa 2.2.14'], [253, 'Sherpa 2.2.14'], [319, 'NNLO']]), // continuation row
    row(162, [[80, 'Single-top:']]), // group label inside the table
    row(169, [[80, 'Wt'], [159, 'Powheg Box v2'], [253, 'Pythia 8'], [319, 'NLO+NNLL']]),
  ];

  it('turns an aligned grid into a table block and removes its lines', () => {
    const intro = row(120, [[80, 'Table 1: Summary of the generators used to simulate the processes.']]);
    const after = row(200, [[80, 'The reconstruction algorithms described in this section are harmonised.']]);
    const { page, tables } = extractTables(pageOf([intro, header, ...body, after]));
    expect(page.lines.map((l) => l.text)).toEqual([intro.text, after.text]);
    expect(tables).toEqual([
      {
        kind: 'table',
        page: 7,
        y: 138,
        rows: [
          ['Physics process', 'Generator', 'Parton Shower', 'Accuracy'],
          ['Z(ll)+jets', 'Sherpa 2.2.11', 'Sherpa 2.2.11', 'NNLO'],
          ['', 'Sherpa 2.2.14', 'Sherpa 2.2.14', 'NNLO'],
          ['Single-top:', '', '', ''],
          ['Wt', 'Powheg Box v2', 'Pythia 8', 'NLO+NNLL'],
        ],
      },
    ]);
  });

  it('leaves a plot legend alone when a figure caption follows (through axis labels)', () => {
    const lines = [
      header,
      ...body,
      row(190, [[80, '2 1 0 −1 −2 Significance']]),
      row(205, [[80, 'Figure 11: A comparison of the observed and expected yields in the bins.']]),
    ];
    expect(extractTables(pageOf(lines)).tables).toEqual([]);
  });

  it('stops before text of a different size (an exponent line below the table)', () => {
    const exponent = row(176, [[300, '2'], [330, '(i)']], 4);
    const { tables, page } = extractTables(pageOf([header, ...body, exponent]));
    expect(tables[0]?.rows).toHaveLength(5);
    expect(page.lines.map((l) => l.text)).toEqual([exponent.text]);
  });

  it('ignores ordinary prose pages', () => {
    const prose = pageLines(3, [
      { text: 'An ordinary paragraph of text that runs across the page.', y: 100 },
      { text: 'Another line of the same paragraph continues here as well.', y: 115 },
      { text: 'And a third line finishes the paragraph neatly.', y: 130 },
    ]);
    expect(extractTables(prose).tables).toEqual([]);
  });
});

describe('isProse', () => {
  it('needs three ordinary lowercase words', () => {
    expect(isProse('A comparison of the observed and expected yields')).toBe(true);
    expect(isProse('MLSR1 1tau0lepMLSR2 1tau0lepMLSR3')).toBe(false);
    expect(isProse('2 1 0 −1 −2 Significance')).toBe(false);
  });
});
