// The conversion pipeline over already-extracted pages.
//
// Extraction (async, talks to pdf.js) is separate so this step stays a pure,
// synchronous function that is easy to test.

import { LOW_TEXT_CHARS } from './extract/extract';
import { removeFigureLabels } from './clean/figures';
import { findFolioOffsets, findRunningLines, removeHeadersAndFooters } from './clean/headers';
import { removeMarginNotes } from './layout/margins';
import { looksMultiColumn, pageToLines } from './layout/lines';
import { renderMarkdown } from './markdown/render';
import { sectionsInSelection } from './outline/outline';
import { formatPageList } from './pages/range';
import { buildBlocks, buildProfile } from './structure/structure';
import { estimateRawPdfUploadTokens, estimateTokens, estimateTokensFromChars } from './tokens/estimate';
import type { ConversionResult, ConversionStats, PageContent, PageLines, Section } from './types';

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
  /** The document's chapters, if known; the ones overlapping the selection are returned. */
  sections?: Section[];
}

/** "12 header/footer lines, 30 margin notes, 25 figure labels" (non-zero parts only). */
export function removedSummary(stats: Pick<ConversionStats, 'removedLines' | 'removedMarginNotes' | 'removedFigureLines'>): string {
  const parts = [
    [stats.removedLines, 'header/footer line'],
    [stats.removedMarginNotes, 'margin note'],
    [stats.removedFigureLines, 'figure label'],
  ] as const;
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`)
    .join(', ');
  return text || 'nothing';
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
  const isSelected = (p: { page: number }): boolean => selectedSet.has(p.page);

  // Margin notes go first: they share baselines with body text, so they must
  // be removed before items are grouped into lines.
  const margins = removeMarginNotes(input.pages);
  const itemsBefore = new Map(input.pages.map((p) => [p.page, p.items.length]));
  const marginNotes = margins.pages
    .filter(isSelected)
    .reduce((n, p) => n + (itemsBefore.get(p.page) ?? 0) - p.items.length, 0);
  const allLines = margins.pages.map(pageToLines);

  // Header/footer detection and the profile use the whole sample.
  const running = findRunningLines(allLines);
  const folios = findFolioOffsets(allLines);
  const cleanedAll = removeFigureLabels(removeHeadersAndFooters(allLines, running, folios).pages);
  const profile = buildProfile(cleanedAll.pages);

  const selectedLines = allLines.filter(isSelected);
  const headers = removeHeadersAndFooters(selectedLines, running, folios);
  const figures = removeFigureLabels(headers.pages);
  const blocks = buildBlocks(figures.pages, profile);

  const markdown = renderMarkdown(blocks, {
    pageMarkers: input.options.pageMarkers,
    ...(input.fileName ? { source: { fileName: input.fileName, pages: pagesLabel(input.selected) } } : {}),
  });

  const warnings: string[] = [];
  const found = new Set(input.pages.map((p) => p.page));
  const missing = input.selected.filter((p) => !found.has(p));
  if (missing.length) warnings.push(`${capitalisedPagesLabel(missing)} could not be read.`);
  // Measured after cleaning: a scanned book often has a one-line watermark
  // ("Downloaded from ...") on every page. That is enough raw text to look
  // like a text layer, but it is removed as a running header, which would
  // otherwise leave empty pages with no warning.
  const lowText = figures.pages
    .filter((p) => p.lines.reduce((n, l) => n + l.text.length, 0) < LOW_TEXT_CHARS)
    .map((p) => p.page);
  if (lowText.length) {
    const one = lowText.length === 1;
    warnings.push(
      `${capitalisedPagesLabel(lowText)} ${one ? 'has' : 'have'} no readable text, apart from any headers or watermarks (probably scanned images), so ${one ? 'it is' : 'they are'} missing from the output. OCR support is planned.`,
    );
  }
  const columns = figures.pages.filter((p) => looksMultiColumn(p)).map((p) => p.page);
  if (columns.length) {
    warnings.push(
      `${capitalisedPagesLabel(columns)} ${columns.length === 1 ? 'seems' : 'seem'} to have columns or a table. Their text may be in the wrong order; check those parts before relying on them.`,
    );
  }

  // Raw = as extracted, margin notes included.
  const charsSelected = rawTextChars(input.pages.filter(isSelected).map(pageToLines));
  const tokensSelected = estimateTokensFromChars(charsSelected);

  return {
    markdown,
    sections: sectionsInSelection(input.sections ?? [], input.selected),
    stats: {
      pages: input.selected.length,
      charsSelected,
      tokensSelected,
      rawUploadTokensSelected: estimateRawPdfUploadTokens(tokensSelected, input.selected.length),
      ...beforeStats(input.wholeDocument),
      charsAfter: markdown.length,
      tokensAfter: estimateTokens(markdown),
      removedLines: headers.removed,
      removedMarginNotes: marginNotes,
      removedFigureLines: figures.removed,
    },
    warnings,
  };
}
