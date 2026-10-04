/**
 * Phase 6 evaluation: exact Claude token counts versus the extension's
 * estimates, on real PDFs.
 *
 *   npm run eval                      # all cases whose PDFs are present
 *   npm run eval -- --model claude-sonnet-5-5
 *
 * For each case (a PDF and a page range) it measures, with Claude's
 * token-counting endpoint (free; it does not run the model):
 *   - PDF upload: just the selected pages, cut into their own PDF and sent
 *     as a document block (text plus page images, exactly as an upload)
 *   - raw text:   the pages' extracted text, i.e. what copy-paste gives
 *   - Markdown:   PDF Distill's output for those pages
 * and sets them beside the extension's own estimates (cl100k text counts,
 * text + ~1,568 tokens per page image for uploads).
 *
 * Needs ANTHROPIC_API_KEY (read from .env, which is git-ignored) or an
 * `ant auth login` profile. Real PDFs live in tests/fixtures/local/ and are
 * never committed; only the numbers are written, to eval/.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { rawText } from '../src/core/convert';
import { extractPages } from '../src/core/extract/extract';
import { pageToLines } from '../src/core/layout/lines';
import { parsePageRange } from '../src/core/pages/range';
import { convertPdf, FIXTURES, openPdf } from './lib/node-pdf';

interface Case {
  name: string;
  file: string;
  pages: string;
  /** Scanned PDFs are OCR'd first, as a user would after pressing Run OCR. */
  ocr?: boolean;
}

const CASES: Case[] = [
  { name: 'Textbook chapter (AIMA ch. 3)', file: 'local/book.pdf', pages: '81-127' },
  { name: 'Research paper with tables (ATLAS)', file: 'local/2507.00296v2.pdf', pages: '1-62' },
  { name: 'Two-column scanned paper (IEEE, OCR text layer)', file: 'local/2003000961.pdf', pages: '1-4' },
  { name: 'Lecture notes (CS229 ch. 1)', file: 'local/Stanford-CS229-All-Notes.pdf', pages: '10-21' },
  { name: 'Short paper (arXiv 2605.01233)', file: 'local/2605.01233v2.pdf', pages: '1-9' },
  { name: 'Slide deck (22 slides)', file: 'local/L5.pdf', pages: '1-22' },
  { name: 'Scanned textbook chapter (Selina, OCR)', file: 'local/selina-class-10-physics-chapter-1-force.pdf', pages: '1-18', ocr: true },
];

interface Row {
  name: string;
  pages: number;
  claude: { pdfUpload: number; rawText: number; markdown: number };
  estimate: { pdfUpload: number; rawText: number; markdown: number };
}

const args = process.argv.slice(2);
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? (args[modelIdx + 1] ?? 'claude-opus-5-5') : 'claude-opus-5-5';
const client = new Anthropic();

async function count(content: Anthropic.MessageParam['content']): Promise<number> {
  const result = await client.messages.countTokens({ model: MODEL, messages: [{ role: 'user', content }] });
  return result.input_tokens;
}

/** Tokens the message wrapper itself costs, subtracted so numbers are content only. */
async function overhead(): Promise<number> {
  return (await count('.')) - 1;
}

/** Just the selected pages, as their own PDF (what a user would upload). */
async function subsetPdf(path: string, pages: number[]): Promise<string> {
  const source = await PDFDocument.load(await readFile(path), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, pages.map((p) => p - 1))) out.addPage(page);
  return Buffer.from(await out.save()).toString('base64');
}

async function rawTextOf(path: string, pages: number[]): Promise<string> {
  const { doc, close } = await openPdf(path);
  try {
    return rawText((await extractPages(doc, pages, { fonts: false })).map(pageToLines));
  } finally {
    await close();
  }
}

async function measure(c: Case, base: number): Promise<Row> {
  const path = join(FIXTURES, c.file);
  const { doc, close } = await openPdf(path);
  const parsed = parsePageRange(c.pages, doc.numPages);
  await close();
  if (!parsed.ok) throw new Error(`${c.name}: ${parsed.error}`);

  const result = await convertPdf(path, c.pages, { pageMarkers: true }, { ocr: c.ocr ?? false });
  const raw = await rawTextOf(path, parsed.pages);
  const pdf = await subsetPdf(path, parsed.pages);

  const pdfUpload = (await count([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }])) - base;
  const rawTokens = (await count(raw || '.')) - base;
  const markdown = (await count(result.markdown)) - base;
  return {
    name: c.name,
    pages: parsed.pages.length,
    claude: { pdfUpload, rawText: rawTokens, markdown },
    estimate: {
      pdfUpload: result.stats.rawUploadTokensSelected,
      rawText: result.stats.tokensSelected,
      markdown: result.stats.tokensAfter,
    },
  };
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const pct = (part: number, whole: number): string => `${Math.round((100 * part) / whole)}%`;
const ratio = (a: number, b: number): string => (b > 0 ? (a / b).toFixed(2) : '–');

function report(rows: Row[]): string {
  const lines = [
    `# Evaluation: exact Claude token counts`,
    '',
    `Measured with \`${MODEL}\` via the token-counting API on ${new Date().toISOString().slice(0, 10)}. Generated by \`npm run eval\`; do not edit by hand.`,
    '',
    '## Savings',
    '',
    '| Case | Pages | PDF upload | Raw text | PDF Distill | Saving vs upload | vs raw text |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.pages} | ${fmt(r.claude.pdfUpload)} | ${fmt(r.claude.rawText)} | ${fmt(r.claude.markdown)} | ${pct(r.claude.pdfUpload - r.claude.markdown, r.claude.pdfUpload)} | ${r.claude.rawText > 0 ? pct(r.claude.rawText - r.claude.markdown, r.claude.rawText) : '–'} |`,
    ),
    '',
    'Positive "vs raw text" means the Markdown is smaller than copy-pasting the raw text.',
    '',
    "## Accuracy of the extension's estimates",
    '',
    'Ratio = Claude count / extension estimate (1.00 = exact; above 1 = the extension undercounts).',
    '',
    '| Case | PDF upload: est. → Claude (ratio) | Markdown: est. → Claude (ratio) | Raw text ratio |',
    '| --- | --- | --- | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${fmt(r.estimate.pdfUpload)} → ${fmt(r.claude.pdfUpload)} (${ratio(r.claude.pdfUpload, r.estimate.pdfUpload)}) | ${fmt(r.estimate.markdown)} → ${fmt(r.claude.markdown)} (${ratio(r.claude.markdown, r.estimate.markdown)}) | ${ratio(r.claude.rawText, r.estimate.rawText)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const hasProfile = existsSync(join(homedir(), '.config', 'anthropic'));
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !hasProfile) {
    console.error(
      'No Anthropic credentials found. Create an API key at https://console.anthropic.com, then put\n' +
        '  ANTHROPIC_API_KEY=your-key\n' +
        'in a file named .env in the project folder (it is git-ignored), or run `ant auth login`.\n' +
        'Token counting is free: it does not run the model.',
    );
    process.exit(1);
  }
  const present = CASES.filter((c) => existsSync(join(FIXTURES, c.file)));
  const missing = CASES.length - present.length;
  if (present.length === 0) throw new Error('No evaluation PDFs found in tests/fixtures/local/.');
  console.error(`Model ${MODEL}; ${present.length} cases${missing ? ` (${missing} skipped: PDF not present)` : ''}.`);
  const base = await overhead();
  const rows: Row[] = [];
  for (const c of present) {
    const started = performance.now();
    rows.push(await measure(c, base));
    const r = rows[rows.length - 1];
    console.error(`  ${c.name}: upload ${fmt(r?.claude.pdfUpload ?? 0)}, markdown ${fmt(r?.claude.markdown ?? 0)} (${Math.round((performance.now() - started) / 1000)} s)`);
  }
  await mkdir('eval', { recursive: true });
  await writeFile(join('eval', 'results.json'), `${JSON.stringify({ model: MODEL, rows }, null, 2)}\n`);
  await writeFile(join('eval', 'RESULTS.md'), report(rows));
  console.log(report(rows));
}

main().catch((error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('No valid Anthropic credentials. Put ANTHROPIC_API_KEY=... in .env (git-ignored), or run `ant auth login`.');
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error('Rate limited by the token-counting API; wait a minute and run again.');
  } else if (error instanceof Anthropic.APIError) {
    console.error(`API error ${String(error.status)}: ${error.message}`);
  } else if (error instanceof Anthropic.AnthropicError) {
    // Raised before any request is sent, e.g. when no credentials are configured.
    console.error(`${error.message}\nPut ANTHROPIC_API_KEY=... in .env (git-ignored), or run \`ant auth login\`.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
