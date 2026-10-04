import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const tesseractRoot = dirname(require.resolve('tesseract.js/package.json'));
const tesseractCoreRoot = dirname(require.resolve('tesseract.js-core/package.json'));
const engDataRoot = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'PDF Distill',
    description:
      'Convert PDFs to clean, compact Markdown locally, keep only the part you need, and save AI tokens.',
    // Minimal permissions (see DECISIONS.md). "scripting" lets Insert put the
    // Markdown into a chat tab; access to the chat sites themselves is
    // optional and only requested when Insert is first pressed (D50). Keep
    // optional_host_permissions in sync with CHAT_ORIGINS in
    // src/core/insert/sites.ts.
    permissions: ['sidePanel', 'storage', 'clipboardWrite', 'scripting'],
    optional_host_permissions: ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*'],
    action: {
      default_title: 'Open PDF Distill',
    },
    // 'wasm-unsafe-eval' lets the bundled .wasm files (OCR, pdf.js image
    // decoders) be compiled. It does not allow eval() of JS.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  hooks: {
    // Everything is bundled: MV3 forbids loading code from a CDN, and the
    // extension makes no network requests (see README, Privacy).
    'build:publicAssets': (_wxt, files) => {
      const copy = (from: string, to: string): void => {
        files.push({ absoluteSrc: from, relativeDest: to });
      };
      const copyDir = (dir: string, to: string, keep: (name: string) => boolean = () => true): void => {
        for (const name of readdirSync(dir).filter(keep)) copy(join(dir, name), `${to}/${name}`);
      };

      // pdf.js character maps (~1.7 MB): without them some PDFs, notably CJK
      // ones, extract as garbage.
      copyDir(join(pdfjsRoot, 'cmaps'), 'pdfjs/cmaps');
      // Rendering pages for OCR: standard fonts (~0.8 MB) and the JPEG 2000,
      // JBIG2 and colour-profile decoders (scans often use these formats).
      // quickjs-eval (PDF scripting) is not needed.
      copyDir(join(pdfjsRoot, 'standard_fonts'), 'pdfjs/standard_fonts');
      copyDir(join(pdfjsRoot, 'wasm'), 'pdfjs/wasm', (n) => /^(jbig2|openjpeg|qcms_bg)\.wasm$/.test(n));

      // OCR (DECISIONS.md D44): the tesseract.js worker, the two SIMD LSTM
      // engine builds (Chrome 116+ always has SIMD, so the slower fallback is
      // left out), and the English model.
      copy(join(tesseractRoot, 'dist', 'worker.min.js'), 'ocr/worker.min.js');
      copy(join(tesseractRoot, 'dist', 'worker.min.js.LICENSE.txt'), 'ocr/worker.min.js.LICENSE.txt');
      for (const core of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
        copy(join(tesseractCoreRoot, core), `ocr/core/${core}`);
      }
      copy(join(engDataRoot, '4.0.0_best_int', 'eng.traineddata.gz'), 'ocr/lang/eng.traineddata.gz');
    },
  },
});
