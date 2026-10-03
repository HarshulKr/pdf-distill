import { describe, expect, it } from 'vitest';
import { item, pageLines } from '../testing';
import { groupLines, hasWideGap, joinItems, looksMultiColumn, roundSize } from './lines';

describe('groupLines', () => {
  it('groups items by baseline and sorts lines top to bottom', () => {
    const lines = groupLines([
      item('second', 72, 120),
      item('world', 110, 100),
      item('Hello', 72, 100),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'second']);
    expect(lines[0]?.y).toBe(100);
  });

  it('keeps a superscript on its line and uses the main text baseline', () => {
    const lines = groupLines([item('E = mc', 72, 100, 11), item('2', 105, 96, 7)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('E = mc2');
    expect(lines[0]?.y).toBe(100);
    expect(lines[0]?.fontSize).toBe(11);
  });

  it('does not merge lines at normal line spacing', () => {
    const lines = groupLines([item('one', 72, 100), item('two', 72, 113)]);
    expect(lines).toHaveLength(2);
  });

  it('marks a line bold when most characters are bold', () => {
    const [l] = groupLines([item('Bold heading', 72, 100, 11, 'Helvetica-Bold'), item('x', 200, 100)]);
    expect(l?.bold).toBe(true);
  });

  it('drops fake-bold duplicates drawn twice with a tiny offset', () => {
    const [l] = groupLines([item('Title', 72, 100), item('Title', 72.5, 100)]);
    expect(l?.text).toBe('Title');
  });
});

describe('joinItems', () => {
  it('adds a space only at visual gaps', () => {
    // "Hel" ends at 72 + 3*5.5 = 88.5; "lo" starts right there (one word),
    // "world" starts 5pt later (a word gap).
    expect(joinItems([item('Hel', 72, 0), item('lo', 88.5, 0), item('world', 104.5, 0)])).toBe('Hello world');
  });

  it('does not double spaces that are already in the text', () => {
    expect(joinItems([item('Hello ', 72, 0), item('world', 120, 0)])).toBe('Hello world');
  });
});

describe('roundSize', () => {
  it('rounds to the nearest half point', () => {
    expect(roundSize(10.98)).toBe(11);
    expect(roundSize(11.3)).toBe(11.5);
  });
});

describe('column/table detection', () => {
  it('flags lines with gaps wider than 2em', () => {
    const [l] = groupLines([item('Left column', 72, 100), item('Right column', 330, 100)]);
    expect(l && hasWideGap(l)).toBe(true);
    const [normal] = groupLines([item('Just a line', 72, 100)]);
    expect(normal && hasWideGap(normal)).toBe(false);
  });

  it('flags pages where many lines have wide gaps', () => {
    const twoCol = pageLines(1, []);
    twoCol.lines = groupLines(
      [0, 1, 2, 3].flatMap((i) => [item(`left ${i}`, 72, 100 + i * 15), item(`right ${i}`, 330, 100 + i * 15)]),
    );
    expect(looksMultiColumn(twoCol)).toBe(true);
    const single = pageLines(1, [0, 1, 2, 3].map((i) => ({ text: `line ${i}`, y: 100 + i * 15 })));
    expect(looksMultiColumn(single)).toBe(false);
  });
});
