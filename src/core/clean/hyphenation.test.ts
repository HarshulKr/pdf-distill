import { describe, expect, it } from 'vitest';
import { collectEvidence, emptyEvidence, joinLines, keepHyphen } from './hyphenation';

describe('collectEvidence', () => {
  it('collects mid-line compounds, their prefixes and all words', () => {
    const ev = collectEvidence(['a water-loving head and two water-', 'Self-Sealing films']);
    expect(ev.compounds).toEqual(new Set(['water-loving', 'self-sealing']));
    expect(ev.prefixes).toEqual(new Set(['water', 'self']));
    expect(ev.words.has('films')).toBe(true);
  });

  it('ignores the hyphen at the end of a line', () => {
    const ev = collectEvidence(['built from phospho-']);
    expect(ev.compounds.size).toBe(0);
  });
});

describe('keepHyphen', () => {
  it('rule 1: joined word seen elsewhere -> join', () => {
    const ev = collectEvidence(['phospholipids are common', 'a phospho-group']);
    expect(keepHyphen('phospho', 'lipids', ev)).toBe(false);
  });
  it('rule 2: exact compound seen mid-line -> keep', () => {
    expect(keepHyphen('water', 'fearing', collectEvidence(['the water-fearing tails']))).toBe(true);
  });
  it('rule 3: first part forms other compounds -> keep', () => {
    expect(keepHyphen('water', 'fearing', collectEvidence(['a water-loving head']))).toBe(true);
  });
  it('rule 4: no evidence -> join', () => {
    expect(keepHyphen('phospho', 'lipids', emptyEvidence())).toBe(false);
  });
});

describe('joinLines', () => {
  const ev = collectEvidence(['a water-loving head']);
  it.each([
    ['built from phospho-', 'lipids, molecules', 'built from phospholipids, molecules'],
    ['two water-', 'fearing tails', 'two water-fearing tails'],
    ['the COVID-', '19 pandemic', 'the COVID-19 pandemic'],
    ['soft hy­', 'phen', 'soft hyphen'],
    ['plain line', 'next line', 'plain line next line'],
    ['ends with dash -', 'next', 'ends with dash - next'],
    ['', 'only next', 'only next'],
    ['only prev', '  ', 'only prev'],
  ])('%j + %j', (a, b, expected) => {
    expect(joinLines(a, b, ev)).toBe(expected);
  });
});
