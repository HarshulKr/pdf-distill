// Phase 0 checks that the fixture PDFs exist and contain what later phases'
// tests will rely on. pdf.js is loaded through its "legacy" build, which is
// the one intended for Node.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it } from 'vitest';

const FIXTURES = join(import.meta.dirname, 'fixtures');

async function open(name: string): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(await readFile(join(FIXTURES, name)));
  return getDocument({ data, verbosity: 0 }).promise;
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('fixtures', () => {
  it('running-headers.pdf repeats the header and numbers every page', async () => {
    const doc = await open('running-headers.pdf');
    expect(doc.numPages).toBe(4);
    for (let p = 1; p <= doc.numPages; p++) {
      const text = await pageText(doc, p);
      expect(text).toContain('PRINCIPLES OF CELL BIOLOGY');
      expect(text).toContain(`Page ${p}`);
      expect(text).toContain('phospho-');
    }
  });

  it('outline.pdf has 3 top-level bookmarks with one child each', async () => {
    const doc = await open('outline.pdf');
    expect(doc.numPages).toBe(9);
    const outline = await doc.getOutline();
    expect(outline.map((o) => o.title)).toEqual([
      'Chapter 1 Cells',
      'Chapter 2 Membranes',
      'Chapter 3 Energy',
    ]);
    expect(outline.map((o) => o.items.length)).toEqual([1, 1, 1]);
  });

  it('no-text-layer.pdf has text on page 1 and none on page 2', async () => {
    const doc = await open('no-text-layer.pdf');
    expect(await pageText(doc, 1)).toContain('real text layer');
    expect((await pageText(doc, 2)).trim()).toBe('');
  });

  it.each(['headings.pdf', 'two-column.pdf', 'table.pdf'])('%s opens and has text', async (name) => {
    const doc = await open(name);
    expect((await pageText(doc, 1)).length).toBeGreaterThan(50);
  });
});
