import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'PDF Distill',
    description:
      'Convert PDFs to clean, compact Markdown locally, keep only the part you need, and save AI tokens.',
    // Minimal permissions (see DECISIONS.md). Host permissions for claude.ai /
    // chatgpt.com are added only in Phase 5.
    permissions: ['sidePanel', 'storage', 'clipboardWrite'],
    action: {
      default_title: 'Open PDF Distill',
    },
    // 'wasm-unsafe-eval' is needed later for WASM (OCR, embeddings). It allows
    // compiling bundled .wasm files only; it does not allow eval() of JS.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  hooks: {
    // Bundle pdf.js character maps (~1.7 MB). Some PDFs, notably CJK ones,
    // use predefined CMaps; without them pdf.js cannot map glyphs to text.
    // MV3 forbids loading them from a CDN, so they ship inside the extension.
    'build:publicAssets': (_wxt, files) => {
      const cmapDir = join(pdfjsRoot, 'cmaps');
      for (const name of readdirSync(cmapDir)) {
        files.push({ absoluteSrc: join(cmapDir, name), relativeDest: `pdfjs/cmaps/${name}` });
      }
    },
  },
});
