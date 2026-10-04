// The conversion pipeline over already-extracted pages.
//
// Extraction (async, talks to pdf.js) is separate so this step stays a pure,
// synchronous function that is easy to test.

import { LOW_TEXT_CHARS } from './extract/extract';
import { findRunningLines, removeHeadersAndFooters } from './clean/headers';
import { looksMultiColumn, pageToLines } from './layout/lines';
import { renderMarkdown } from './markdown/render';
import { formatPageList } from './pages/range';
import { buildBlocks, buildProfile } from './structure/structure';
import { estimateRawPdfUploadTokens, estimateTokens, estimateTokensFromChars } from './tokens/estimate';
import type { ConversionResult, PageContent, PageLines } from './types';

export interface ConvertOptions {
  pageMarkers: boolean;
}

export interface WholeDocumentCount {
  pages: number;
  chars: number;
}

export interface ConvertInput {
  /**
   * Extracted pages: the selection plus the surrounding sample used for
   * header/footer detection and the document profile. Must include every
   * selected page.
   */
  pages: PageContent[];
  /** Pages to convert (1-based, sorted). */
  selected: number[];
  options: ConvertOptions;
  fileName?: string;
  /** Whole-document text count, if the background count has finished. */
  wholeDocument?: WholeDocumentCount | null;
}

/** "page 12" or "pages 4-9, 12". */
export function pagesLabel(pages: number[]): string {
  return `${pages.length === 1 ? 'page' : 'pages'} ${formatPageList(pages)}`;
}

/** Capitalised form for the start of a warning sentence. */
function capitalisedPagesLabel(pages: number[]): string {
  const label = pagesLabel(pages);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function beforeStats(whole: WholeDocumentCount | null | undefined): {
  charsBefore: number | null;
  tokensBefore: number | null;
  rawUploadTokensBefore: number | null;
} {
  if (!whole) return { charsBefore: null, tokensBefore: null, rawUploadTokensBefore: null };
  const tokensBefore = estimateTokensFromChars(whole.chars);
  return {
    charsBefore: whole.chars,
    tokensBefore,
    rawUploadTokensBefore: estimateRawPdfUploadTokens(tokensBefore, whole.pages),
  };
}

/**
 * Characters of raw extracted text, counted like countDocumentText: every
 * item's text plus one newline per line, before any cleaning.
 */
export function rawTextChars(pages: PageLines[]): number {
  let chars = 0;
  for (const page of pages) {
    for (const line of page.lines) {
      chars += 1;
      for (const item of line.items) chars += item.str.length;
    }
  }
  return chars;
}

export function convert(input: ConvertInput): ConversionResult {
  const selectedSet = new Set(input.selected);
  const allLines = input.pages.map(pageToLines);

  // Header/footer detection and the profile use the whole sample.
  const running = findRunningLines(allLines);
  const cleanedAll = removeHeadersAndFooters(allLines, running);
  const profile = buildProfile(cleanedAll.pages);

  const selectedLines = allLines.filter((p) => selectedSet.has(p.page));
  const cleaned = removeHeadersAndFooters(selectedLines, running);
  const blocks = buildBlocks(cleaned.pages, profile);

  const markdown = renderMarkdown(blocks, {
    pageMarkers: input.options.pageMarkers,
    ...(input.fileName ? { source: { fileName: input.fileName, pages: pagesLabel(input.selected) } } : {}),
  });

  const warnings: string[] = [];
  const found = new Set(input.pages.map((p) => p.page));
  const missing = input.selected.filter((p) => !found.has(p));
  if (missing.length) warnings.push(`${capitalisedPagesLabel(missing)} could not be read.`);
  const lowText = input.pages
    .filter((p) => selectedSet.has(p.page))
    .filter((p) => p.items.reduce((n, i) => n + i.str.length, 0) < LOW_TEXT_CHARS)
    .map((p) => p.page);
  if (lowText.length) {
    const one = lowText.length === 1;
    warnings.push(
      `${capitalisedPagesLabel(lowText)} ${one ? 'has' : 'have'} no text layer (probably scanned images), so ${one ? 'it is' : 'they are'} missing from the output. OCR support is planned.`,
    );
  }
  const columns = selectedLines.filter((p) => looksMultiColumn(p)).map((p) => p.page);
  if (columns.length) {
    warnings.push(
      `${capitalisedPagesLabel(columns)} ${columns.length === 1 ? 'seems' : 'seem'} to have columns or a table. Their text may be in the wrong order; check those parts before relying on them.`,
    );
  }

  const charsSelected = rawTextChars(selectedLines);
  const tokensSelected = estimateTokensFromChars(charsSelected);

  return {
    markdown,
    sections: [],
    stats: {
      pages: input.selected.length,
      charsSelected,
      tokensSelected,
      rawUploadTokensSelected: estimateRawPdfUploadTokens(tokensSelected, input.selected.length),
      ...beforeStats(input.wholeDocument),
      charsAfter: markdown.length,
      tokensAfter: estimateTokens(markdown),
      removedLines: cleaned.removed,
    },
    warnings,
  };
}
