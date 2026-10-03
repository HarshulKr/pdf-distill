import { describe, expect, it } from 'vitest';
import type { Block, ConversionResult } from './types';

// Smoke test: proves the core folder is wired into Vitest and the types
// compile. Real unit tests arrive with the code in Phase 1.
describe('core types', () => {
  it('a ConversionResult can be constructed', () => {
    const blocks: Block[] = [{ kind: 'heading', level: 1, text: 'Intro', page: 1 }];
    const result: ConversionResult = {
      markdown: '# Intro',
      sections: [{ title: 'Intro', level: 1, startPage: 1, endPage: 1 }],
      stats: { pages: 1, charsBefore: 7, charsAfter: 7, tokensBefore: 2, tokensAfter: 2, removedLines: 0 },
      warnings: [],
    };
    expect(blocks[0]?.kind).toBe('heading');
    expect(result.sections).toHaveLength(1);
  });
});
