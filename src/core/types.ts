// Core data model shared by the whole pipeline.
//
// Everything in src/core/ is pure: no Chrome APIs and no DOM, so it can be
// unit tested in Node.

/** One positioned run of text from pdf.js, normalised so y grows downward. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  /** Derived from the pdf.js transform matrix. */
  fontSize: number;
  /** 1-based page number. */
  page: number;
}

/** Items on the same page and baseline, joined left to right. */
export interface Line {
  page: number;
  y: number;
  x: number;
  text: string;
  fontSize: number;
  bold: boolean;
  items: TextItem[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; page: number }
  | { kind: 'paragraph'; text: string; page: number }
  | { kind: 'list'; ordered: boolean; items: string[]; page: number }
  | { kind: 'table'; rows: string[][]; page: number }
  | { kind: 'pageBreak'; page: number };

export interface Section {
  title: string;
  level: number;
  startPage: number;
  endPage: number;
}

export interface ConversionStats {
  pages: number;
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  removedLines: number;
}

export interface ConversionResult {
  markdown: string;
  sections: Section[];
  stats: ConversionStats;
  /** Human-readable, e.g. "Pages 4-9 have no text layer". */
  warnings: string[];
}
