// End-to-end: fixture PDF -> pdf.js (Node) -> core pipeline -> Markdown.
//
// Golden files live in tests/golden/. They are only (re)written when
// UPDATE_GOLDEN=1 is set, so a change in output always shows up as a test
// failure first and goldens are updated deliberately:
//
//   UPDATE_GOLDEN=1 npm test

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertFixture, openFixture } from '../scripts/lib/node-pdf';
import { countDocumentText } from '../src/core/extract/extract';
import { sectionsFromHeadings, sectionsFromOutline } from '../src/core/outline/outline';

const GOLDEN = join(import.meta.dirname, 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

async function expectGolden(name: string, actual: string): Promise<void> {
  const path = join(GOLDEN, name);
  if (UPDATE || !existsSync(path)) {
    if (!UPDATE) throw new Error(`Missing golden ${name}. Run UPDATE_GOLDEN=1 npm test to create it.`);
    await mkdir(GOLDEN, { recursive: true });
    await writeFile(path, actual);
    return;
  }
  expect(actual).toBe(await readFile(path, 'utf8'));
}

describe('golden Markdown', () => {
  it.each([
    ['running-headers.pdf', 'running-headers.md'],
    ['headings.pdf', 'headings.md'],
  ])('%s', async (pdf, golden) => {
    const result = await convertFixture(pdf);
    await expectGolden(golden, result.markdown);
  });
});

describe('running-headers.pdf', () => {
  it('removes the running header and page-number footers, keeps paragraphs intact', async () => {
    const { markdown, stats, warnings } = await convertFixture('running-headers.pdf');
    expect(markdown).not.toContain('PRINCIPLES OF CELL BIOLOGY');
    expect(markdown).not.toMatch(/Page \d/);
    expect(stats.removedLines).toBe(8); // 4 headers + 4 footers
    expect(warnings).toEqual([]);
    // Paragraph text is joined across lines into one paragraph.
    expect(markdown).toContain(
      'The membrane is built mainly from phospholipids, molecules with a water-loving head and two water-fearing tails. In water they assemble into a double layer with the tails hidden inside and the heads facing outward.',
    );
    expect(markdown).toContain('# 2.1 The Cell Membrane');
  });

  it('still detects the header when only one page is selected (sample of +/-15 pages)', async () => {
    const { markdown, stats } = await convertFixture('running-headers.pdf', '2');
    expect(markdown).not.toContain('PRINCIPLES OF CELL BIOLOGY');
    expect(markdown).toContain('<!-- page 2 -->');
    expect(markdown).not.toContain('<!-- page 1 -->');
    expect(stats.pages).toBe(1);
    expect(stats.removedLines).toBe(2);
  });

  it('reports both "before" numbers for the whole document', async () => {
    const { stats } = await convertFixture('running-headers.pdf', '2');
    expect(stats.tokensBefore).toBeGreaterThan(stats.tokensAfter);
    expect(stats.rawUploadTokensBefore).toBe((stats.tokensBefore ?? 0) + 4 * 1568);
  });

  it('can omit page markers', async () => {
    const { markdown } = await convertFixture('running-headers.pdf', '', { pageMarkers: false });
    expect(markdown).not.toContain('<!-- page');
  });
});

describe('headings.pdf', () => {
  it('maps three heading sizes to levels 1-3', async () => {
    const { markdown } = await convertFixture('headings.pdf');
    const headings = markdown.split('\n').filter((l) => l.startsWith('#'));
    expect(headings).toEqual([
      '# Chapter 1 Energy and Matter',
      '## 1.1 Systems and Surroundings',
      '### Open systems',
      '### Isolated systems',
      '## 1.2 Systems and Surroundings Revisited',
      '### Closed systems',
      '### Boundaries',
    ]);
  });
});

describe('outline.pdf', () => {
  it('a page range selects only those pages', async () => {
    const { markdown } = await convertFixture('outline.pdf', '7-9');
    expect(markdown).toContain('# Chapter 3 Energy');
    expect(markdown).not.toContain('chapter 2');
    expect(markdown.match(/<!-- page \d+ -->/g)).toEqual(['<!-- page 7 -->', '<!-- page 8 -->', '<!-- page 9 -->']);
  });
});

describe('warnings', () => {
  it('flags the page with no text layer', async () => {
    const { warnings } = await convertFixture('no-text-layer.pdf');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Page 2 has no readable text/);
  });

  it('flags two-column pages instead of failing silently', async () => {
    const { warnings } = await convertFixture('two-column.pdf');
    expect(warnings).toEqual([expect.stringMatching(/^Page 1 seems to have columns or a table/)]);
  });
});

describe('table.pdf', () => {
  it('renders the table as a Markdown table between its surrounding paragraphs, without a warning', async () => {
    const { markdown, warnings } = await convertFixture('table.pdf');
    expect(warnings).toEqual([]);
    expect(markdown).toContain(
      [
        'The table below compares the main ways substances cross the membrane.',
        '',
        '| Mechanism | Energy needed | Example |',
        '| --- | --- | --- |',
        '| Simple diffusion | No | Oxygen |',
        '| Facilitated diffusion | No | Glucose |',
        '| Active transport | Yes (ATP) | Sodium ions |',
        '| Endocytosis | Yes | Large particles |',
        '',
        'Active transport is the only mechanism',
      ].join('\n'),
    );
  });
});

describe('chapters', () => {
  it('reads bookmarks from outline.pdf as chapters with page ranges', async () => {
    const { doc, close } = await openFixture('outline.pdf');
    try {
      expect(await sectionsFromOutline(doc)).toEqual([
        { title: 'Chapter 1 Cells', level: 1, startPage: 1, endPage: 3 },
        { title: '1.2 Cell Size', level: 2, startPage: 2, endPage: 3 },
        { title: 'Chapter 2 Membranes', level: 1, startPage: 4, endPage: 6 },
        { title: '2.2 Transport', level: 2, startPage: 5, endPage: 6 },
        { title: 'Chapter 3 Energy', level: 1, startPage: 7, endPage: 9 },
        { title: '3.2 Respiration', level: 2, startPage: 8, endPage: 9 },
      ]);
    } finally {
      await close();
    }
  });

  it('falls back to large headings when a PDF has no bookmarks', async () => {
    const { doc, close } = await openFixture('headings.pdf');
    try {
      expect(await sectionsFromOutline(doc)).toEqual([]);
      const count = await countDocumentText(doc);
      const sections = sectionsFromHeadings(count.headingCandidates, count.bodySize, count.pages);
      expect(sections).toEqual([
        { title: 'Chapter 1 Energy and Matter', level: 1, startPage: 1, endPage: 2 },
        { title: '1.1 Systems and Surroundings', level: 2, startPage: 1, endPage: 1 },
        { title: '1.2 Systems and Surroundings Revisited', level: 2, startPage: 2, endPage: 2 },
      ]);
    } finally {
      await close();
    }
  });
});
