import { defineConfig } from 'wxt';

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
});
