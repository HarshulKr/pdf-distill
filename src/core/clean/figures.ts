// Text inside figures: labels of diagrams, maps and charts.
//
// pdf.js extracts a diagram's labels as text, so a road map becomes lines
// like "Oradea", "71", "Zerind 87" and, if the labels are large, bogus
// headings. In books the figure sits directly above its caption
// ("Figure 3.1 A simplified road map ..."), so a run of short fragments
// right before a caption is dropped; the caption itself is kept, since it
// says what the figure shows.

import { hasWideGap } from '../layout/lines';
import type { Line, PageLines } from '../types';

/** "Figure 3.1", "FIG. 2", "Exhibit A". The label is a number or one capital, so "Figures show" doesn't match. */
export const CAPTION_RE = /^(?:[Ff]igure|FIGURE|[Ff]ig\.|FIG\.|[Ee]xhibit|[Cc]hart|[Dd]iagram)\s+(?:\d+|[A-Z])(?:[.\-–]\d+)*\b/;

/** At most this many words for a figure label. */
const MAX_LABEL_WORDS = 5;
/** A run needs at least this many fragments, so a lone short line before a caption survives. */
const MIN_RUN = 2;
/** Numbered section headings ("3.2 Example Problems") are never figure labels. */
const SECTION_HEADING_RE = /^\d+(\.\d+)+\s+[A-Z]/;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A short piece of text that does not read like the end of a sentence. */
export function isFragment(line: Line): boolean {
  if (SECTION_HEADING_RE.test(line.text) || CAPTION_RE.test(line.text)) return false;
  if (hasWideGap(line)) return true;
  return wordCount(line.text) <= MAX_LABEL_WORDS && !/[.?!:;]["”’)]?$/.test(line.text);
}

export interface FigureResult {
  pages: PageLines[];
  removed: number;
}

/** Drop runs of fragments directly above figure captions. */
export function removeFigureLabels(pages: PageLines[]): FigureResult {
  let removed = 0;
  const out = pages.map((page) => {
    const drop = new Set<number>();
    page.lines.forEach((line, i) => {
      if (!CAPTION_RE.test(line.text)) return;
      let start = i;
      while (start > 0) {
        const prev = page.lines[start - 1];
        if (!prev || drop.has(start - 1) || !isFragment(prev)) break;
        start -= 1;
      }
      if (i - start >= MIN_RUN) for (let k = start; k < i; k++) drop.add(k);
    });
    removed += drop.size;
    return drop.size ? { ...page, lines: page.lines.filter((_, i) => !drop.has(i)) } : page;
  });
  return { pages: out, removed };
}
