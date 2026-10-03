import { describe, expect, it } from 'vitest';
import type { Block } from '../types';
import { markdownFileName, renderMarkdown, tidy } from './render';

const blocks: Block[] = [
  { kind: 'pageBreak', page: 3 },
  { kind: 'heading', level: 2, text: 'Transport', page: 3 },
  { kind: 'paragraph', text: '# not a heading', page: 3 },
  { kind: 'list', ordered: true, items: ['one', 'two'], page: 3 },
  { kind: 'list', ordered: false, items: ['a'], page: 3 },
  { kind: 'table', rows: [['Name', 'Value'], ['a|b', '1']], page: 3 },
];

describe('renderMarkdown', () => {
  it('renders blocks with page markers and a source line', () => {
    expect(renderMarkdown(blocks, { pageMarkers: true, source: { fileName: 'bio.pdf', pages: 'page 3' } })).toBe(
      [
        '<!-- Source: bio.pdf, page 3 -->',
        '<!-- page 3 -->',
        '## Transport',
        '\\# not a heading',
        '1. one\n2. two',
        '- a',
        '| Name | Value |\n| --- | --- |\n| a\\|b | 1 |',
      ].join('\n\n') + '\n',
    );
  });

  it('omits page markers when disabled', () => {
    const md = renderMarkdown(blocks.slice(0, 2), { pageMarkers: false });
    expect(md).toBe('## Transport\n');
  });

  it('renders an empty table as nothing', () => {
    expect(renderMarkdown([{ kind: 'table', rows: [], page: 1 }], { pageMarkers: false })).toBe('\n');
  });
});

describe('tidy', () => {
  it('collapses blank lines and trailing spaces', () => {
    expect(tidy('a  \n\n\n\nb\n\n')).toBe('a\n\nb');
  });
});

describe('markdownFileName', () => {
  it('builds a safe file name with the page list', () => {
    expect(markdownFileName('Biology: Ch3.pdf', '45-70, 82')).toBe('Biology_ Ch3 (p45-70,82).md');
    expect(markdownFileName('notes.PDF', null)).toBe('notes.md');
    expect(markdownFileName('.pdf', null)).toBe('document.md');
  });
});
