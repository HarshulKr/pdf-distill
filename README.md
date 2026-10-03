# PDF Distill

A Chrome extension that converts PDFs into clean, compact Markdown **locally in your browser**. Keep only the part you need (a chapter, a page range, or the sections relevant to your question), see a before/after token estimate, and paste the result into Claude, ChatGPT or another AI chat.

> **Status: Phase 1 (MVP).** Converts a PDF or a page range to clean Markdown with headers, footers and page numbers removed. Chapter selection, lists, tables and columns come in Phase 2. See [Roadmap](#roadmap).

## Why

Uploading a whole PDF to an AI assistant is expensive. Many assistants process every page as an image plus its text, so a 40-page chapter can cost tens of thousands of tokens even if you only need 5 pages. Sending clean Markdown of just the relevant part uses a fraction of that, which stretches your usage limits further.

## Privacy

- PDFs are processed entirely inside the extension. **Document content is never uploaded anywhere.**
- The extension makes no network requests today. pdf.js, its worker and its character maps are bundled inside the extension.
- Optional later features (question-aware trimming, OCR) will download **model weights / OCR language data only** (data, not code). This happens on first use, only when you turn the feature on, with pinned versions and a visible progress bar. Downloaded data is cached locally. This section will list the exact files and sources when those phases land.

## Install (unpacked, for development)

Requirements: Node.js 22.13+ and Chrome 116+ (for the side panel API).

```bash
npm install
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
4. Pin PDF Distill from the puzzle-piece menu, then click its toolbar icon. The side panel opens.

For live reload while developing: `npm run dev` (WXT opens a Chrome instance with the extension loaded).

## Using it

1. Click the PDF Distill toolbar icon to open the side panel.
2. Drop a PDF on the panel (or click to choose one). The panel shows its title and page count, and measures the whole document's text in the background.
3. Optionally type pages, e.g. `45-70, 82`, `100-` (to the end), or leave it empty for all pages.
4. Click **Convert**. A progress bar shows "Reading page X of Y"; **Cancel** stops it.
5. Check the Markdown preview (you can edit it), then **Copy** or **Download .md** and paste it into your AI chat.

The stats bar shows `~before → ~after tokens (est.)`:
- **Before** is the text of the whole document.
- Underneath is a **rough** estimate of uploading the raw PDF: its text plus about 1,568 tokens per page image, because AI apps also send each page as an image. Phase 6 will replace this with measured numbers.
- All numbers are estimates (about 4 characters per token for now), not exact Claude counts.

From the command line, the same pipeline runs in Node:

```bash
npm run convert -- tests/fixtures/local/book.pdf "45-70" --out chapter.md
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `.output/chrome-mv3` |
| `npm run dev` | Dev build with hot reload |
| `npm run typecheck` | TypeScript strict type check |
| `npm run lint` | ESLint (type-aware) |
| `npm test` | Unit tests (Vitest) |
| `npm run coverage` | Tests with coverage for `src/core/` |
| `npm run fixtures` | Regenerate test PDFs in `tests/fixtures/` |
| `npm run convert -- <pdf> [pages]` | Convert a PDF from the command line |

Golden Markdown files in `tests/golden/` are only rewritten deliberately: `UPDATE_GOLDEN=1 npm test`.

## How it works

Each step is pure TypeScript in `src/core/`, unit tested in Node. Steps marked *(later)* arrive in later phases.

1. **Extract** (`extract/`): pdf.js text items with positions, font sizes and real font names (for bold). Pages with almost no text are flagged.
2. **Lines** (`layout/`): items are grouped into lines by baseline and sorted top to bottom, with spaces inserted at visual gaps. Two-column handling is *(later)*; for now such pages get a warning.
3. **Clean** (`clean/`):
   - Running headers and footers are lines in the top or bottom 8% of the page that repeat on more than 40% of the pages within ±15 of your selection.
   - Page numbers ("12", "xiv", "Page 3 of 40") in those zones are removed.
   - Words split across lines are rejoined, using evidence from the document to keep real compounds like "water-fearing".
4. **Structure** (`structure/`):
   - Body font size is the most common size.
   - Headings are lines ≥1.2× that size, or short bold lines, or "Chapter 3" / "3.2 Title" patterns; sizes map to levels 1–3.
   - Paragraphs are split on larger vertical gaps or indented first lines, and joined across page breaks.
   - Lists and tables are *(later)*.
5. **Outline**: chapters from bookmarks or headings *(later)*.
6. **Markdown** (`markdown/`): a source line, optional `<!-- page N -->` markers, headings and paragraphs, with blank lines collapsed.
7. **Tokens** (`tokens/`): before/after estimates.
8. **Trim** to a question (local embeddings) and **OCR** for scanned pages *(later)*.

## Project layout

```
src/core/          pure logic (no Chrome APIs, no DOM)
src/entrypoints/   background.ts (opens side panel), sidepanel/ (UI)
src/lib/           browser glue: pdf.js loading, settings
public/icon/       extension icons
scripts/           fixture generator, convert CLI, later the eval script
tests/fixtures/    generated test PDFs; put your own PDFs in tests/fixtures/local/ (git-ignored)
tests/golden/      expected Markdown for fixtures
```

## Limitations

Current (Phase 1):

- **Two-column pages and tables are read straight across**, so their text can be interleaved. These pages get a warning. Phase 2 adds column and table handling.
- **Lists** become paragraphs, and list items with hanging indents may split. Phase 2 fixes this.
- **Code blocks** (monospace text) are merged into paragraphs, losing their line breaks.
- **Scanned pages** (no text layer) are skipped with a warning. OCR is Phase 4.
- **Page markers** are exact for where a paragraph starts, but a paragraph that runs onto the next page is kept whole before the next page's marker.
- **Token numbers** are estimates: about 4 characters per token, and a rough per-page image cost for raw uploads.
- **Converting a whole large book** extracts every page (Pro Git, 501 pages, takes about 12 s). Selecting pages is much faster.

Known non-goals: perfect table and math reconstruction, understanding images/diagrams, Firefox/Safari.

## Roadmap

- [x] Phase 0: setup
- [x] Phase 1: PDF to clean Markdown (MVP)
- [ ] Phase 2: chapters and structure quality
- [ ] Phase 3: question-aware trimming
- [ ] Phase 4: OCR fallback
- [ ] Phase 5: insert into Claude / ChatGPT
- [ ] Phase 6: evaluation with exact token counts

## Eval results

Filled in after Phase 6.

## Decisions

See [DECISIONS.md](DECISIONS.md).
