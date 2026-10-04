/**
 * Convert a PDF to Markdown from the command line with the same pipeline the
 * extension uses. Handy for checking real PDFs (e.g. in tests/fixtures/local/).
 *
 *   npm run convert -- path/to/book.pdf [pages] [--no-markers] [--ocr] [--out file.md]
 *   npm run convert -- tests/fixtures/local/bio.pdf "45-70, 82"
 */
import { writeFile } from 'node:fs/promises';
import { removedSummary } from '../src/core/convert';
import { convertPdf } from './lib/node-pdf';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const pageMarkers = !args.includes('--no-markers');
  const ocr = args.includes('--ocr');
  const positional = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
  const [file, range = ''] = positional;
  if (!file) {
    console.error('Usage: npm run convert -- <file.pdf> [pages] [--no-markers] [--ocr] [--out file.md]');
    process.exit(2);
  }
  const started = performance.now();
  const result = await convertPdf(file, range, { pageMarkers }, { ocr });
  const ms = Math.round(performance.now() - started);
  if (out) await writeFile(out, result.markdown);
  else process.stdout.write(result.markdown);
  const s = result.stats;
  console.error(
    `\n[${s.pages} pages in ${ms} ms] selected pages raw ~${s.tokensSelected} tokens -> output ~${s.tokensAfter} (est.); ` +
      `uploading them as a PDF ~${s.rawUploadTokensSelected} (rough)\n` +
      `removed: ${removedSummary(result.stats)}\n` +
      `whole document: ~${s.tokensBefore ?? '?'} tokens of text, ~${s.rawUploadTokensBefore ?? '?'} as a PDF upload (rough)`,
  );
  for (const w of result.warnings) console.error(`warning: ${w}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
