/**
 * Generates the small test PDFs in tests/fixtures/.
 *
 *   npm run fixtures
 *
 * Output is deterministic (fixed dates, no random IDs) so regenerating does not
 * create spurious git diffs. All text is original filler written for tests.
 *
 * Fixtures:
 *   running-headers.pdf  running header + "Page N" footer on 4 pages, hyphenation
 *   headings.pdf         three heading sizes over body text
 *   outline.pdf          9 pages, 3 chapters, bookmarked outline with nested entries
 *   two-column.pdf       full-width title, then two text columns
 *   table.pdf            a simple 3-column table between paragraphs
 *   no-text-layer.pdf    page 1 has text; page 2 has text drawn as shapes only
 *   scanned.pdf          page 1 of running-headers.pdf as an image only (a "scan")
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPage,
  PDFRef,
  StandardFonts,
  rgb,
} from 'pdf-lib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

// US Letter in PDF points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const BODY_SIZE = 11;
const LEADING = 1.35; // line height as a multiple of font size

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

async function newDoc(title: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('PDF Distill test fixtures');
  doc.setProducer('scripts/make-fixtures.ts');
  doc.setCreator('scripts/make-fixtures.ts');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, fonts: { regular, bold } };
}

async function save(doc: PDFDocument, name: string): Promise<void> {
  // useObjectStreams: false keeps the files simple to inspect by hand.
  const bytes = await doc.save({ useObjectStreams: false });
  await writeFile(join(OUT_DIR, name), bytes);
  console.log(`  ${name} (${doc.getPageCount()} pages, ${bytes.length.toLocaleString()} bytes)`);
}

/** Greedy word wrap to a maximum width. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Writes text top-down on a page, tracking the current y (pdf-lib's y grows
 * upward, so the cursor decreases).
 */
class Cursor {
  y: number;
  constructor(
    public page: PDFPage,
    public left = MARGIN,
    public width = PAGE_W - 2 * MARGIN,
    top = PAGE_H - MARGIN,
  ) {
    this.y = top;
  }

  line(text: string, font: PDFFont, size: number, x = this.left): void {
    this.y -= size * LEADING;
    this.page.drawText(text, { x, y: this.y, size, font });
  }

  /** Wrapped paragraph; an optional first-line indent marks paragraph starts. */
  paragraph(text: string, font: PDFFont, size = BODY_SIZE, indent = 0): void {
    const lines = wrap(text, font, size, this.width - indent);
    lines.forEach((l, i) => {
      this.line(l, font, size, this.left + (i === 0 ? indent : 0));
    });
    this.gap(size * 0.6);
  }

  /** Pre-broken lines, used where the exact line break matters (hyphenation). */
  lines(lines: string[], font: PDFFont, size = BODY_SIZE): void {
    for (const l of lines) this.line(l, font, size);
    this.gap(size * 0.6);
  }

  heading(text: string, font: PDFFont, size: number): void {
    this.gap(size * 0.4);
    this.line(text, font, size);
    this.gap(size * 0.3);
  }

  gap(points: number): void {
    this.y -= points;
  }
}

const FILLER = [
  'Every living cell is separated from its surroundings by a thin boundary that controls what enters and what leaves. This boundary is not a rigid wall but a flexible, self-sealing film that constantly rearranges itself as the cell grows, divides and responds to signals.',
  'Researchers first described the boundary as a simple film of oil, but careful measurements in the twentieth century showed that it has a defined thickness and a layered structure. Those measurements led to the models that are still taught in introductory courses today.',
  'Proteins embedded in the boundary act as channels, pumps and receptors. Some span the full width of the film, while others sit on only one face. Their arrangement explains why the two faces of the boundary behave differently.',
  'Small, uncharged molecules such as oxygen cross the boundary easily, whereas ions and large molecules need help. The cell spends a large share of its energy budget on moving these substances against their natural direction of flow.',
  'When the balance of water on either side changes, the cell may swell or shrink. Plants, fungi and many bacteria resist bursting because a stiff outer wall surrounds the softer inner boundary.',
];

// ---------------------------------------------------------------------------

async function runningHeaders(): Promise<void> {
  const { doc, fonts } = await newDoc('Running headers fixture');
  const header = 'PRINCIPLES OF CELL BIOLOGY - SECOND EDITION';
  const pages = 4;
  for (let p = 1; p <= pages; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    // Header and footer sit inside the top/bottom ~8% of the page.
    page.drawText(header, { x: MARGIN, y: PAGE_H - 40, size: 9, font: fonts.bold });
    const footer = `Page ${p}`;
    const fw = fonts.regular.widthOfTextAtSize(footer, 9);
    page.drawText(footer, { x: (PAGE_W - fw) / 2, y: 36, size: 9, font: fonts.regular });

    const c = new Cursor(page);
    if (p === 1) c.heading('2.1 The Cell Membrane', fonts.bold, 16);
    c.paragraph(FILLER[(p - 1) % FILLER.length] ?? '', fonts.regular, BODY_SIZE, 18);
    // Deliberate line-end hyphenation, two cases:
    //   "phospho-" + "lipids" is a word split by the typesetter -> "phospholipids"
    //   "water-" + "fearing" is a real compound -> should stay "water-fearing".
    // The spec's simple rule (join on lowercase continuation) gets the second
    // case wrong; the fixture exists so Phase 1 handles it deliberately.
    c.lines(
      [
        'The membrane is built mainly from phospho-',
        'lipids, molecules with a water-loving head and two water-',
        'fearing tails. In water they assemble into a double layer with',
        'the tails hidden inside and the heads facing outward.',
      ],
      fonts.regular,
    );
    c.paragraph(FILLER[p % FILLER.length] ?? '', fonts.regular, BODY_SIZE, 18);
  }
  await save(doc, 'running-headers.pdf');
}

async function headings(): Promise<void> {
  const { doc, fonts } = await newDoc('Headings fixture');
  for (let p = 1; p <= 2; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const c = new Cursor(page);
    if (p === 1) {
      c.heading('Chapter 1 Energy and Matter', fonts.bold, 24);
      c.paragraph(FILLER[0] ?? '', fonts.regular);
    }
    c.heading(`1.${p} Systems and Surroundings ${p === 1 ? '' : 'Revisited'}`.trim(), fonts.bold, 16);
    c.paragraph(FILLER[1] ?? '', fonts.regular);
    c.heading(p === 1 ? 'Open systems' : 'Closed systems', fonts.bold, 12.5);
    c.paragraph(FILLER[2] ?? '', fonts.regular);
    c.heading(p === 1 ? 'Isolated systems' : 'Boundaries', fonts.bold, 12.5);
    c.paragraph(FILLER[3] ?? '', fonts.regular);
  }
  await save(doc, 'headings.pdf');
}

interface OutlineEntry {
  title: string;
  pageIndex: number; // 0-based
  children?: OutlineEntry[];
}

/**
 * pdf-lib has no high-level outline API, so build the /Outlines tree by hand.
 * Each item gets /Title, /Parent, /Prev, /Next, /First, /Last, /Count and an
 * explicit /Dest of the form [pageRef /XYZ null null null].
 */
function addOutline(doc: PDFDocument, entries: OutlineEntry[]): void {
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);
  const rootRef = ctx.nextRef();

  function build(items: OutlineEntry[], parentRef: PDFRef): { first: PDFRef; last: PDFRef; count: number } {
    const refs = items.map(() => ctx.nextRef());
    let count = 0;
    items.forEach((item, i) => {
      const pageRef = pageRefs[item.pageIndex];
      const ref = refs[i];
      if (!pageRef || !ref) throw new Error(`Bad outline entry ${item.title}`);
      const dest = PDFArray.withContext(ctx);
      dest.push(pageRef);
      dest.push(PDFName.of('XYZ'));
      dest.push(PDFNull);
      dest.push(PDFNull);
      dest.push(PDFNull);
      const dict = PDFDict.withContext(ctx);
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      dict.set(PDFName.of('Parent'), parentRef);
      dict.set(PDFName.of('Dest'), dest);
      const prev = refs[i - 1];
      const next = refs[i + 1];
      if (prev) dict.set(PDFName.of('Prev'), prev);
      if (next) dict.set(PDFName.of('Next'), next);
      count += 1;
      if (item.children?.length) {
        const sub = build(item.children, ref);
        dict.set(PDFName.of('First'), sub.first);
        dict.set(PDFName.of('Last'), sub.last);
        // Positive count = open in the viewer's bookmark pane.
        dict.set(PDFName.of('Count'), PDFNumber.of(sub.count));
        count += sub.count;
      }
      ctx.assign(ref, dict);
    });
    const first = refs[0];
    const last = refs[refs.length - 1];
    if (!first || !last) throw new Error('Empty outline level');
    return { first, last, count };
  }

  const top = build(entries, rootRef);
  const root = PDFDict.withContext(ctx);
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), top.first);
  root.set(PDFName.of('Last'), top.last);
  root.set(PDFName.of('Count'), PDFNumber.of(top.count));
  ctx.assign(rootRef, root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

async function outline(): Promise<void> {
  const { doc, fonts } = await newDoc('Outline fixture');
  const chapters = [
    { title: 'Chapter 1 Cells', sub: '1.2 Cell Size' },
    { title: 'Chapter 2 Membranes', sub: '2.2 Transport' },
    { title: 'Chapter 3 Energy', sub: '3.2 Respiration' },
  ];
  const entries: OutlineEntry[] = [];
  chapters.forEach((ch, ci) => {
    const start = ci * 3;
    for (let k = 0; k < 3; k++) {
      const page = doc.addPage([PAGE_W, PAGE_H]);
      const c = new Cursor(page);
      if (k === 0) c.heading(ch.title, fonts.bold, 24);
      if (k === 1) c.heading(ch.sub, fonts.bold, 16);
      // Body text names the chapter so tests can check "chapter 3 only".
      c.paragraph(
        `This page belongs to ${ch.title.toLowerCase()}, page ${k + 1} of 3. ${FILLER[(ci + k) % FILLER.length] ?? ''}`,
        fonts.regular,
      );
    }
    entries.push({ title: ch.title, pageIndex: start, children: [{ title: ch.sub, pageIndex: start + 1 }] });
  });
  addOutline(doc, entries);
  await save(doc, 'outline.pdf');
}

async function twoColumn(): Promise<void> {
  const { doc, fonts } = await newDoc('Two-column fixture');
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const title = new Cursor(page);
  title.heading('Membrane Transport in Brief', fonts.bold, 18);

  // Two 222pt columns with a 24pt gutter between them.
  const gutter = 24;
  const colW = (PAGE_W - 2 * MARGIN - gutter) / 2;
  const top = title.y - 8;
  const left = new Cursor(page, MARGIN, colW, top);
  const right = new Cursor(page, MARGIN + colW + gutter, colW, top);
  left.paragraph(`LEFT COLUMN START. ${FILLER[0] ?? ''} ${FILLER[1] ?? ''}`, fonts.regular);
  left.paragraph(`${FILLER[2] ?? ''} LEFT COLUMN END.`, fonts.regular);
  right.paragraph(`RIGHT COLUMN START. ${FILLER[3] ?? ''} ${FILLER[4] ?? ''}`, fonts.regular);
  right.paragraph(`${FILLER[1] ?? ''} RIGHT COLUMN END.`, fonts.regular);
  await save(doc, 'two-column.pdf');
}

async function table(): Promise<void> {
  const { doc, fonts } = await newDoc('Table fixture');
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page);
  c.heading('Table 4.1 Transport Mechanisms', fonts.bold, 16);
  c.paragraph('The table below compares the main ways substances cross the membrane.', fonts.regular);

  const cols = [MARGIN, MARGIN + 150, MARGIN + 310];
  const rows = [
    ['Mechanism', 'Energy needed', 'Example'],
    ['Simple diffusion', 'No', 'Oxygen'],
    ['Facilitated diffusion', 'No', 'Glucose'],
    ['Active transport', 'Yes (ATP)', 'Sodium ions'],
    ['Endocytosis', 'Yes', 'Large particles'],
  ];
  rows.forEach((row, ri) => {
    c.y -= BODY_SIZE * 1.6;
    row.forEach((cell, ci) => {
      page.drawText(cell, {
        x: cols[ci] ?? MARGIN,
        y: c.y,
        size: BODY_SIZE,
        font: ri === 0 ? fonts.bold : fonts.regular,
      });
    });
  });
  c.gap(BODY_SIZE);
  c.paragraph('Active transport is the only mechanism in the table that moves substances against their gradient.', fonts.regular);
  await save(doc, 'table.pdf');
}

/**
 * 5x7 bitmap glyphs (rows top to bottom, '#' = filled). Page 2 of
 * no-text-layer.pdf draws text as filled rectangles, so pdf.js finds no text
 * items there but OCR (Phase 4) can still read it once rendered.
 */
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function drawBitmapText(page: PDFPage, text: string, x: number, yTop: number, pixel: number): void {
  let cx = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`No bitmap glyph for "${ch}"`);
    glyph.forEach((row, r) => {
      row.split('').forEach((cell, col) => { // glyph rows are ASCII only
        if (cell === '#') {
          page.drawRectangle({
            x: cx + col * pixel,
            y: yTop - (r + 1) * pixel,
            width: pixel,
            height: pixel,
            color: rgb(0, 0, 0),
          });
        }
      });
    });
    cx += 6 * pixel; // 5 columns + 1 column spacing
  }
}

async function noTextLayer(): Promise<void> {
  const { doc, fonts } = await newDoc('No text layer fixture');
  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(p1);
  c.heading('A Normal Page', fonts.bold, 16);
  c.paragraph('This page has a real text layer. The next page only contains shapes that look like letters.', fonts.regular);

  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  const lines = ['SCANNED PAGE', 'THE CELL WALL', 'GIVES PLANTS', 'THEIR SHAPE.'];
  lines.forEach((l, i) => {
    drawBitmapText(p2, l, MARGIN, PAGE_H - MARGIN - i * 40, 4);
  });
  await save(doc, 'no-text-layer.pdf');
}

/**
 * A realistic scan: page 1 of running-headers.pdf rendered to a 200 DPI
 * greyscale-looking PNG with pdf.js, then embedded as the only content of a
 * new page. Unlike no-text-layer.pdf's blocky shapes, OCR can read this
 * reliably (DECISIONS.md D6, D45).
 */
async function scanned(): Promise<void> {
  const { openPdf } = await import('./lib/node-pdf');
  const source = await openPdf(join(OUT_DIR, 'running-headers.pdf'));
  try {
    const page = await source.doc.getPage(1);
    const viewport = page.getViewport({ scale: 200 / 72 });
    const factory = (source.doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(t: 'image/png'): Buffer } } } }).canvasFactory;
    const { canvas } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvas, viewport, intent: 'print' } as unknown as Parameters<typeof page.render>[0]).promise;
    const { doc } = await newDoc('Scanned fixture');
    const image = await doc.embedPng(canvas.toBuffer('image/png'));
    const p = doc.addPage([PAGE_W, PAGE_H]);
    p.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    await save(doc, 'scanned.pdf');
  } finally {
    await source.close();
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(OUT_DIR, 'local'), { recursive: true });
  console.log(`Writing fixtures to ${OUT_DIR}`);
  await runningHeaders();
  await headings();
  await outline();
  await twoColumn();
  await table();
  await noTextLayer();
  await scanned();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
