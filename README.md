# PDF Distill

A Chrome extension that converts PDFs into clean, compact Markdown **locally in your browser**. Keep only the part you need (a chapter, a page range, or the sections relevant to your question), see a before/after token estimate, and paste the result into Claude, ChatGPT or another AI chat.

> **Status: Phase 0 (project setup).** The side panel opens and accepts a PDF, but conversion is not implemented yet. See [Roadmap](#roadmap).

## Why

Uploading a whole PDF to an AI assistant is expensive. Many assistants process every page as an image plus its text, so a 40-page chapter can cost tens of thousands of tokens even if you only need 5 pages. Sending clean Markdown of just the relevant part uses a fraction of that, which stretches your usage limits further.

## Privacy

- PDFs are processed entirely inside the extension. **Document content is never uploaded anywhere.**
- The extension makes no network requests today.
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

## How it works

Planned pipeline (each step is pure TypeScript in `src/core/`, unit tested in Node):

1. **Extract** text items with positions and font sizes using pdf.js (worker bundled locally).
2. **Lines**: group items into lines; detect two-column pages.
3. **Clean**: remove running headers/footers and page numbers; rejoin hyphenated words.
4. **Structure**: detect headings, paragraphs, lists and simple tables.
5. **Outline**: chapters from the PDF's bookmarks, or from detected headings.
6. **Select** chapters / page ranges, render **Markdown** (optional `<!-- page N -->` markers).
7. **Estimate tokens** before vs after (clearly labelled estimates).
8. Optional: **trim** to sections relevant to a question (local embeddings); **OCR** for scanned pages.

## Project layout

```
src/core/          pure logic (no Chrome APIs, no DOM)
src/entrypoints/   background.ts (opens side panel), sidepanel/ (UI)
public/icon/       extension icons
scripts/           fixture generator, later the eval script
tests/fixtures/    generated test PDFs; put your own PDFs in tests/fixtures/local/ (git-ignored)
```

## Limitations

To be filled in as features land. Known non-goals: perfect table and math reconstruction, understanding images/diagrams, Firefox/Safari.

## Roadmap

- [x] Phase 0: setup
- [ ] Phase 1: PDF to clean Markdown (MVP)
- [ ] Phase 2: chapters and structure quality
- [ ] Phase 3: question-aware trimming
- [ ] Phase 4: OCR fallback
- [ ] Phase 5: insert into Claude / ChatGPT
- [ ] Phase 6: evaluation with exact token counts

## Eval results

Filled in after Phase 6.

## Decisions

See [DECISIONS.md](DECISIONS.md).
