// Test helpers for building synthetic pages. Only imported by *.test.ts files.

import { groupLines } from './layout/lines';
import type { Line, PageContent, PageLines, TextItem } from './types';

export const PAGE_W = 612;
export const PAGE_H = 792;

/** A text item; `fontName` defaults to a regular font. Width ~0.5em per char. */
export function item(str: string, x: number, y: number, size = 11, fontName = 'Times-Roman', page = 1): TextItem {
  return { str, x, y, width: str.length * size * 0.5, height: size, fontName, fontSize: size, page };
}

export interface LineSpec {
  text: string;
  x?: number;
  y: number;
  size?: number;
  bold?: boolean;
}

/** Build a page from simple line specs (one item per line). */
export function page(pageNumber: number, specs: LineSpec[]): PageContent {
  return {
    page: pageNumber,
    width: PAGE_W,
    height: PAGE_H,
    items: specs.map((s) =>
      item(s.text, s.x ?? 72, s.y, s.size ?? 11, s.bold ? 'Helvetica-Bold' : 'Times-Roman', pageNumber),
    ),
  };
}

export function pageLines(pageNumber: number, specs: LineSpec[]): PageLines {
  const p = page(pageNumber, specs);
  return { page: p.page, width: p.width, height: p.height, lines: groupLines(p.items) };
}

export function line(text: string, overrides: Partial<Line> = {}): Line {
  return {
    page: 1,
    y: 100,
    x: 72,
    width: 468,
    text,
    fontSize: 11,
    bold: false,
    items: [],
    ...overrides,
  };
}

/** Body lines at 11pt with 15pt leading, starting at `y`. */
export function bodyLines(texts: string[], y = 100, x = 72): LineSpec[] {
  return texts.map((text, i) => ({ text, x, y: y + i * 15 }));
}
