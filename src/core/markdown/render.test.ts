import { describe, expect, it } from 'vitest';
import type { Block } from '../types';
import { escapeParagraph, markdownFileName, renderList, renderMarkdown, tidy } from './render';

const blocks: Block[] = [
  { kind: 'pageBreak', page: 3 },
  { kind: 'heading', level: 2, text: 'Transport', page: 3 },
  { kind: 'paragraph', text: '# not a heading', page: 3 },
  {
    kind: 'list',
    items: [
      { text: 'one', depth: 0, number: 1 },
      { text: 'two', depth: 0, number: 2 },
    ],
    page: 3,
  },
  { kind: 'list', items: [{ text: 'a', depth: 0 }], page: 3 },
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

describe('escapeParagraph', () => {
  it('stops body text from turning into headings, lists or quotes', () => {
    expect(escapeParagraph('# 1 priority')).toBe('\\# 1 priority');
    expect(escapeParagraph('1999. That was the year')).toBe('1999\\. That was the year');
    expect(escapeParagraph('2) is the second case')).toBe('2\\) is the second case');
    expect(escapeParagraph('- 5 degrees is cold')).toBe('\\- 5 degrees is cold');
    expect(escapeParagraph('> 40% of cells')).toBe('\\> 40% of cells');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeParagraph('3.2 million cells divide')).toBe('3.2 million cells divide');
    expect(escapeParagraph('Plain text - with a dash')).toBe('Plain text - with a dash');
  });
});

describe('renderList', () => {
  it('indents nested items to the parent text and keeps printed numbers', () => {
    expect(
      renderList([
        { text: 'Muscles', depth: 0 },
        { text: 'Skeletal', depth: 1 },
        { text: 'Smooth', depth: 1 },
        { text: 'Review', depth: 0, number: 10 },
        { text: 'studies', depth: 1 },
        { text: 'Conclusion', depth: 0, number: 11 },
      ]),
    ).toBe(['- Muscles', '  - Skeletal', '  - Smooth', '10. Review', '    - studies', '11. Conclusion'].join('\n'));
  });
  it('never indents deeper than one level below the previous item', () => {
    expect(renderList([{ text: 'a', depth: 2 }])).toBe('- a');
  });
  it('escapes item text', () => {
    expect(renderList([{ text: '# not a heading', depth: 0 }])).toBe('- \\# not a heading');
  });
});
