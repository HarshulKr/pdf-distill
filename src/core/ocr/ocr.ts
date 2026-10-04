// OCR results -> TextItems, so scanned pages go through the same pipeline
// (headers, columns, lists, tables) as pages with a text layer.
//
// Tesseract reports words with pixel bounding boxes on the rendered page
// image, grouped into lines with a baseline. It does not report font sizes,
// and its "lines" often run across both columns of a two-column page, so
// only word positions are used: lines and columns are rebuilt by the usual
// layout code.

import type { TextItem } from '../types';

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** 0-100. */
  confidence: number;
  bbox: OcrBox;
}

export interface OcrLine {
  words: OcrWord[];
  /** Baseline from (x0, y0) to (x1, y1), in pixels. */
  baseline: OcrBox;
}

/**
 * Words below this confidence are dropped. On a scanned textbook page, 487
 * of 561 words scored 90+, and every word between 40 and 60 was a misread
 * diagram label or speck ("Leis", "Joti.", "©"); a real "(2)" scored 69.
 */
export const MIN_WORD_CONFIDENCE = 60;
/** Font name given to OCR'd text (bold is not detected). */
export const OCR_FONT = 'OCR';

/**
 * Typical heights of a word's bounding box in ems, by the letters it has:
 * ascenders (b, d, f, h, k, l, t, capitals, digits) reach ~0.7 em above the
 * baseline, descenders (g, j, p, q, y) ~0.22 em below, and x-height letters
 * are ~0.47 em tall. Used to turn box heights into font sizes.
 */
export function wordHeightEms(text: string): number {
  const ascender = /[bdfhklt0-9A-Z(){}[\]|/\\!?'"]/.test(text);
  const descender = /[gjpqy(){}[\]|,;]/.test(text);
  if (ascender && descender) return 0.92;
  if (ascender) return 0.7;
  if (descender) return 0.69;
  return 0.47;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** y of the baseline at x, by linear interpolation along the line's baseline. */
function baselineAt(baseline: OcrBox, x: number): number {
  const dx = baseline.x1 - baseline.x0;
  if (dx === 0) return baseline.y0;
  return baseline.y0 + ((x - baseline.x0) / dx) * (baseline.y1 - baseline.y0);
}

/**
 * Split a Tesseract line into runs of nearby words. A line that crosses a
 * column gutter or a figure becomes several runs, so each gets its own
 * font size.
 */
function runs(words: OcrWord[]): OcrWord[][] {
  const out: OcrWord[][] = [];
  const typicalHeight = median(words.map((w) => w.bbox.y1 - w.bbox.y0));
  for (const word of [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const run = out[out.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && word.bbox.x0 - prev.bbox.x1 <= 2 * typicalHeight) run.push(word);
    else out.push([word]);
  }
  return out;
}

/**
 * Convert OCR lines from an image rendered at `scale` pixels per PDF point
 * into TextItems in page coordinates (points, y down, y = baseline).
 */
export function ocrToItems(lines: OcrLine[], scale: number, page: number): TextItem[] {
  const items: TextItem[] = [];
  for (const line of lines) {
    const words = line.words.filter((w) => w.confidence >= MIN_WORD_CONFIDENCE && /[\p{L}\p{N}]/u.test(w.text));
    for (const run of runs(words)) {
      // One size per run: the median of per-word estimates is robust to a
      // word whose letters fool wordHeightEms.
      const size = median(run.map((w) => (w.bbox.y1 - w.bbox.y0) / wordHeightEms(w.text))) / scale;
      for (const word of run) {
        items.push({
          str: word.text,
          x: word.bbox.x0 / scale,
          y: baselineAt(line.baseline, word.bbox.x0) / scale,
          width: (word.bbox.x1 - word.bbox.x0) / scale,
          height: size,
          fontName: OCR_FONT,
          fontSize: size,
          page,
        });
      }
    }
  }
  return items;
}

/** Tesseract's `blocks` output, reduced to the fields used here. */
export interface TesseractBlocksLike {
  blocks?: { paragraphs: { lines: { words: OcrWord[]; baseline: OcrBox }[] }[] }[] | null;
}

export function linesFromTesseract(data: TesseractBlocksLike): OcrLine[] {
  return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => ({ words: l.words, baseline: l.baseline }))));
}

/** Render scale for OCR: 300 DPI, the resolution Tesseract is tuned for. */
export const OCR_SCALE = 300 / 72;
/** ...capped so a poster-sized page does not produce a huge image. */
export const MAX_OCR_PIXELS = 4000;

export function ocrScaleFor(width: number, height: number): number {
  return Math.min(OCR_SCALE, MAX_OCR_PIXELS / Math.max(width, height));
}
