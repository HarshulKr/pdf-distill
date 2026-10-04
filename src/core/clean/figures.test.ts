import { describe, expect, it } from 'vitest';
import { line, pageLines } from '../testing';
import { CAPTION_RE, isFragment, removeFigureLabels } from './figures';

describe('CAPTION_RE', () => {
  it('matches figure captions', () => {
    expect(CAPTION_RE.test('Figure 3.1 A simplified road map of part of Romania')).toBe(true);
    expect(CAPTION_RE.test('Fig. 2 Results')).toBe(true);
    expect(CAPTION_RE.test('FIGURE 2.4 Results')).toBe(true);
    expect(CAPTION_RE.test('Exhibit A Contract')).toBe(true);
    expect(CAPTION_RE.test('Figures show that')).toBe(false);
    expect(CAPTION_RE.test('Figure shows the map')).toBe(false);
  });
});

describe('isFragment', () => {
  it('is a short label, not a sentence end or a section heading', () => {
    expect(isFragment(line('Oradea'))).toBe(true);
    expect(isFragment(line('Zerind 87'))).toBe(true);
    expect(isFragment(line('the end.'))).toBe(false);
    expect(isFragment(line('3.2 Example Problems'))).toBe(false);
    expect(isFragment(line('a long line of ordinary body text that keeps going'))).toBe(false);
  });
});

describe('removeFigureLabels', () => {
  it('drops the run of labels above a caption and keeps the caption and body', () => {
    const page = pageLines(82, [
      { text: 'Body text ends here.', y: 80 },
      { text: 'Oradea', y: 110 },
      { text: '71', y: 125 },
      { text: 'Zerind 87', y: 140 },
      { text: 'Figure 3.1 A simplified road map of part of Romania.', y: 170 },
      { text: 'More body text follows the figure.', y: 200 },
    ]);
    const { pages, removed } = removeFigureLabels([page]);
    expect(removed).toBe(3);
    expect(pages[0]?.lines.map((l) => l.text)).toEqual([
      'Body text ends here.',
      'Figure 3.1 A simplified road map of part of Romania.',
      'More body text follows the figure.',
    ]);
  });

  it('keeps a single short line before a caption', () => {
    const page = pageLines(1, [
      { text: 'Standardized problems', y: 100 },
      { text: 'Figure 1 Something.', y: 130 },
    ]);
    expect(removeFigureLabels([page]).removed).toBe(0);
  });
});
