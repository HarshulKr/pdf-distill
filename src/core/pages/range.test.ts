import { describe, expect, it } from 'vitest';
import { formatPageList, parsePageRange, samplePages } from './range';

describe('parsePageRange', () => {
  it.each([
    ['', [1, 2, 3, 4, 5]],
    ['all', [1, 2, 3, 4, 5]],
    ['2', [2]],
    ['2-4', [2, 3, 4]],
    ['2–4', [2, 3, 4]],
    ['1, 3-4', [1, 3, 4]],
    ['4 1 2', [1, 2, 4]],
    ['3-', [3, 4, 5]],
    ['-2', [1, 2]],
    ['2 to 3', [2, 3]],
    ['4-9', [4, 5]], // clipped to the document
    ['2,2,2-3', [2, 3]],
  ])('%j -> %j', (input, pages) => {
    expect(parsePageRange(input, 5)).toEqual({ ok: true, pages });
  });

  it.each([
    ['abc', 'is not a page number'],
    ['0', 'start at 1'],
    ['4-2', 'after the last'],
    ['9', 'past the end'],
    ['-', 'is not a page range'],
    [',', 'No pages selected'],
  ])('%j is an error mentioning "%s"', (input, message) => {
    const result = parsePageRange(input, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe('formatPageList', () => {
  it('compacts runs', () => {
    expect(formatPageList([9, 1, 2, 3, 7, 10])).toBe('1-3, 7, 9-10');
    expect(formatPageList([])).toBe('');
  });
});

describe('samplePages', () => {
  it('adds a window around each selected page, clipped to the document', () => {
    expect(samplePages([5], 100, 2)).toEqual([3, 4, 5, 6, 7]);
    expect(samplePages([1, 100], 100, 1)).toEqual([1, 2, 99, 100]);
  });
  it('defaults to +/-15 pages', () => {
    expect(samplePages([50], 500)).toEqual(Array.from({ length: 31 }, (_, i) => 35 + i));
  });
});
