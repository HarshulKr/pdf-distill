// Core data model shared by the whole pipeline.
//
// Everything in src/core/ is pure: no Chrome APIs and no DOM, so it can be
// unit tested in Node.

/** One positioned run of text from pdf.js, normalised so y grows downward. */
export interface TextItem {
  str: string;
  /** Left edge, in PDF points from the left of the page. */
  x: number;
  /** Baseline, in PDF points from the top of the page. */
  y: number;
  width: number;
  height: number;
  /** Real font name when pdf.js exposes it (e.g. "Helvetica-Bold"), else pdf.js's internal id. */
  fontName: string;
  /** Derived from the pdf.js transform matrix. */
  fontSize: number;
  /** 1-based page number. */
  page: number;
}

/** Extracted content of one page, before any interpretation. */
export interface PageContent {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

/** Items on the same page and baseline, joined left to right. */
export interface Line {
  page: number;
  /** Baseline, from the top of the page. */
  y: number;
  /** Left edge. */
  x: number;
  /** Horizontal extent from x to the end of the last item. */
  width: number;
  text: string;
  fontSize: number;
  bold: boolean;
  items: TextItem[];
}

/** Lines of one page, top to bottom. */
export interface PageLines {
  page: number;
  width: number;
  height: number;
  lines: Line[];
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
  /** Number of pages converted. */
  pages: number;
  /**
   * Raw extracted text of the SELECTED pages, before cleaning (headers,
   * footers and page numbers included). This is the like-for-like "before"
   * for `tokensAfter`: comparing against the whole document would mostly
   * measure how few pages were selected, not what cleaning saved.
   */
  charsSelected: number;
  tokensSelected: number;
  /** Rough estimate of uploading just the selected pages as a PDF. */
  rawUploadTokensSelected: number;
  /**
   * "Before" numbers describe the WHOLE document. They are null while the
   * background whole-document count is still running.
   */
  charsBefore: number | null;
  tokensBefore: number | null;
  /** Rough estimate of uploading the whole PDF (text + one image per page). */
  rawUploadTokensBefore: number | null;
  charsAfter: number;
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
