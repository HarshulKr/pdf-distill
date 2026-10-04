import { describe, expect, it } from 'vitest';
import { linesFromTesseract, MIN_WORD_CONFIDENCE, ocrScaleFor, ocrToItems, wordHeightEms, type OcrLine, type OcrWord } from './ocr';

const SCALE = 300 / 72;

/** A word at (x, y) in points with a box `heightPt` tall, converted to pixels. */
function word(text: string, xPt: number, baselinePt: number, heightPt: number, confidence = 95): OcrWord {
  const width = text.length * 5;
  return {
    text,
    confidence,
    bbox: {
      x0: xPt * SCALE,
      y0: (baselinePt - heightPt) * SCALE,
      x1: (xPt + width) * SCALE,
      y1: baselinePt * SCALE,
    },
  };
}

function lineOf(words: OcrWord[], baselinePt: number): OcrLine {
  return { words, baseline: { x0: 0, y0: baselinePt * SCALE, x1: 2000, y1: baselinePt * SCALE } };
}

describe('wordHeightEms', () => {
  it('depends on ascenders and descenders', () => {
    expect(wordHeightEms('one')).toBe(0.47);
    expect(wordHeightEms('the')).toBe(0.7);
    expect(wordHeightEms('gap')).toBe(0.69);
    expect(wordHeightEms('Fig')).toBe(0.92);
  });
});

describe('ocrToItems', () => {
  it('converts pixel boxes to points on the line baseline, with one font size per run', () => {
    // 12pt text: "moment" box ~0.7em tall, "one" ~0.47em, "gap" ~0.69em.
    const items = ocrToItems([lineOf([word('moment', 25, 100, 8.4), word('one', 60, 100, 5.64), word('gap', 80, 100, 8.28)], 100)], SCALE, 3);
    expect(items.map((i) => i.str)).toEqual(['moment', 'one', 'gap']);
    for (const i of items) {
      expect(i.y).toBeCloseTo(100, 5);
      expect(i.fontSize).toBeCloseTo(12, 0);
      expect(i.page).toBe(3);
      expect(i.fontName).toBe('OCR');
    }
    expect(items[0]?.x).toBeCloseTo(25, 5);
  });

  it('gives each side of a line that crosses a gutter its own size', () => {
    // "Heat": ascenders only (0.7 em) at 20pt; "come": x-height only (0.47 em) at 10pt.
    const items = ocrToItems([lineOf([word('Heat', 25, 100, 14), word('come', 300, 100, 4.7)], 100)], SCALE, 1);
    expect(items[0]?.fontSize).toBeCloseTo(20, 0);
    expect(items[1]?.fontSize).toBeCloseTo(10, 0);
  });

  it('drops low-confidence words and symbol-only specks', () => {
    const items = ocrToItems(
      [lineOf([word('Leis', 25, 100, 8, MIN_WORD_CONFIDENCE - 1), word('©', 60, 100, 8), word('force', 80, 100, 8)], 100)],
      SCALE,
      1,
    );
    expect(items.map((i) => i.str)).toEqual(['force']);
  });
});

describe('linesFromTesseract', () => {
  it('flattens blocks and paragraphs into lines', () => {
    const line = lineOf([word('a', 1, 10, 5)], 10);
    expect(linesFromTesseract({ blocks: [{ paragraphs: [{ lines: [line] }, { lines: [line] }] }] })).toHaveLength(2);
    expect(linesFromTesseract({ blocks: null })).toEqual([]);
  });
});

describe('ocrScaleFor', () => {
  it('renders at 300 DPI, capped for very large pages', () => {
    expect(ocrScaleFor(595, 842)).toBeCloseTo(SCALE, 5);
    expect(ocrScaleFor(2000, 3000)).toBeCloseTo(4000 / 3000, 5);
  });
});
