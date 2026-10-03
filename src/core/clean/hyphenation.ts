// Joining lines and repairing words split across lines by hyphenation.
//
// The hard case: a line ends in "water-" and the next starts with "fearing".
// The spec's rule (join on a lowercase continuation) would give "waterfearing".
// A typesetter's hyphen and a real one look identical at a line break, so we
// look for evidence elsewhere in the document, strongest first:
//
//   1. the joined word appears unhyphenated ("phospholipids")      -> join
//   2. the exact compound appears mid-line ("water-fearing")       -> keep "-"
//   3. the first part is used in another mid-line compound
//      ("water-loving", so "water-" is a compound-forming word)    -> keep "-"
//   4. no evidence                                                 -> join
//
// Rule 4 defaults to joining because in justified textbook text most
// line-end hyphens are the typesetter's.

export interface HyphenEvidence {
  /** Lowercased words seen anywhere (for rule 1). */
  words: Set<string>;
  /** Lowercased "left-right" compounds seen mid-line (rule 2). */
  compounds: Set<string>;
  /** Lowercased left parts of those compounds (rule 3). */
  prefixes: Set<string>;
}

export function emptyEvidence(): HyphenEvidence {
  return { words: new Set(), compounds: new Set(), prefixes: new Set() };
}

export function collectEvidence(lines: Iterable<string>): HyphenEvidence {
  const ev = emptyEvidence();
  for (const line of lines) {
    // A hyphen at the very end of the line is the ambiguous case; ignore it.
    const body = line.replace(/[-­]\s*$/, '');
    for (const match of body.matchAll(/([A-Za-z]+)-([A-Za-z]+)/g)) {
      const [, left, right] = match;
      if (!left || !right) continue;
      ev.compounds.add(`${left}-${right}`.toLowerCase());
      ev.prefixes.add(left.toLowerCase());
    }
    for (const match of body.matchAll(/[A-Za-z]+/g)) ev.words.add(match[0].toLowerCase());
  }
  return ev;
}

/** Ends in a letter followed by a hyphen. */
const TRAILING_HYPHEN_RE = /([A-Za-z]+)-$/;
const LEADING_WORD_RE = /^([a-z]+)/;

/** Decide whether "left-" + "right" at a line break keeps its hyphen. */
export function keepHyphen(left: string, right: string, ev: HyphenEvidence): boolean {
  const l = left.toLowerCase();
  const r = right.toLowerCase();
  if (ev.words.has(l + r)) return false;
  if (ev.compounds.has(`${l}-${r}`)) return true;
  if (ev.prefixes.has(l)) return true;
  return false;
}

/**
 * Join two consecutive lines of the same paragraph.
 *
 * - "phospho-" + "lipids are" -> "phospholipids are"
 * - "water-" + "fearing tails" -> "water-fearing tails" (with evidence, above)
 * - "COVID-" + "19 cases" -> "COVID-19 cases" (no lowercase continuation:
 *   keep the hyphen, no space)
 * - soft hyphen (U+00AD) at the end -> always joined
 * - otherwise joined with a single space
 */
export function joinLines(prev: string, next: string, ev: HyphenEvidence): string {
  const a = prev.trimEnd();
  const b = next.trimStart();
  if (a === '') return b;
  if (b === '') return a;
  if (a.endsWith('­')) return a.slice(0, -1) + b;

  const hy = TRAILING_HYPHEN_RE.exec(a);
  if (hy) {
    const word = LEADING_WORD_RE.exec(b);
    if (word) return keepHyphen(hy[1] ?? '', word[1] ?? '', ev) ? a + b : a.slice(0, -1) + b;
    if (/^[A-Z0-9]/.test(b)) return a + b;
  }
  return `${a} ${b}`;
}
