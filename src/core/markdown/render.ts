// Blocks -> Markdown string.

import type { Block, ListItem } from '../types';

export interface RenderOptions {
  /** Emit `<!-- page N -->` before each page so the AI can cite pages. */
  pageMarkers: boolean;
  /** Optional one-line provenance comment at the top; `pages` is e.g. "pages 4-9". */
  source?: { fileName: string; pages: string };
}

/**
 * Escape characters that would change meaning at the start of a paragraph:
 * "# " makes a heading, "1. " / "1) " an ordered list, "- " / "* " / "+ " a
 * bullet list, and ">" a quote.
 */
export function escapeParagraph(text: string): string {
  return text
    .replace(/^(#{1,6})(\s)/, '\\$1$2')
    .replace(/^(\d{1,9})([.)])(\s)/, '$1\\$2$3')
    .replace(/^([-*+])(\s)/, '\\$1$2')
    .replace(/^>/, '\\>');
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Render list items. A nested item is indented to where its parent's text
 * starts ("- " = 2 spaces, "10. " = 4), which is what CommonMark needs to
 * nest it.
 */
export function renderList(items: ListItem[]): string {
  const markerWidths: number[] = []; // by depth: width of the latest marker
  return items
    .map((item) => {
      const depth = Math.min(item.depth, markerWidths.length);
      const marker = item.number === undefined ? '-' : `${item.number}.`;
      const indent = markerWidths.slice(0, depth).reduce((n, w) => n + w, 0);
      markerWidths.length = depth;
      markerWidths.push(marker.length + 1);
      return `${' '.repeat(indent)}${marker} ${escapeParagraph(item.text)}`;
    })
    .join('\n');
}

export function renderBlock(block: Block, options: RenderOptions): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`;
    case 'paragraph':
      return escapeParagraph(block.text);
    case 'list':
      return renderList(block.items);
    case 'table': {
      const [header, ...rows] = block.rows;
      if (!header) return '';
      const line = (cells: string[]): string => `| ${cells.map(escapeTableCell).join(' | ')} |`;
      return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
    }
    case 'pageBreak':
      return options.pageMarkers ? `<!-- page ${block.page} -->` : '';
  }
}

/** Collapse runs of blank lines and trim, so no tokens are wasted on whitespace. */
export function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderMarkdown(blocks: Block[], options: RenderOptions): string {
  const parts: string[] = [];
  if (options.source) {
    parts.push(`<!-- Source: ${options.source.fileName}, ${options.source.pages} -->`);
  }
  for (const block of blocks) {
    const text = renderBlock(block, options);
    if (text) parts.push(text);
  }
  return `${tidy(parts.join('\n\n'))}\n`;
}

/** "Biology Ch3.pdf" + pages 45-70 -> "Biology Ch3 (p45-70).md". */
export function markdownFileName(pdfName: string, pagesText: string | null): string {
  const base = pdfName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  const pages = pagesText ? ` (p${pagesText.replace(/\s+/g, '')})` : '';
  return `${base}${pages}.md`;
}
