# PDF Distill

A Chrome extension that converts PDFs into clean, compact Markdown **locally in your browser**. Keep only the part you need (a chapter, a page range, or the sections relevant to your question), see a before/after token estimate, and paste the result into Claude, ChatGPT or another AI chat.

> **Status: all phases done** (Phase 3 dropped; exact Claude token counts pending an API key, see [Eval results](#eval-results)). Converts a PDF, a page range or chosen chapters to clean Markdown with headers, footers and page numbers removed, reads scanned pages with on-device OCR, and inserts the result into Claude or ChatGPT. See [Roadmap](#roadmap).

## Why

Uploading a whole PDF to an AI assistant is expensive. Many assistants process every page as an image plus its text, so a 40-page chapter can cost tens of thousands of tokens even if you only need 5 pages. Sending clean Markdown of just the relevant part uses a fraction of that, which stretches your usage limits further.

Estimated on real PDFs (cl100k tokenizer, not exact Claude counts; see [Eval results](#eval-results)):

| | PDF upload (rough) | PDF Distill output |
| --- | --- | --- |
| Textbook chapter (AIMA ch. 3, 47 pages) | ~108,700 tokens | ~30,100 tokens |
| Research paper (ATLAS, 62 pages, 11 tables) | ~174,100 tokens | ~70,500 tokens |
| Two-column paper (IEEE, 4 pages) | ~12,100 tokens | ~5,500 tokens |
| Lecture notes (CS229 ch. 1, 12 pages) | ~24,600 tokens | ~5,750 tokens |
| Slide deck (22 slides) | ~35,200 tokens | ~800 tokens |

Compared with copy-pasting the raw text, the output is 6-14% smaller for books and papers and about the same for notes and slides, and it is clean: running headers, page numbers, margin notes and figure labels are removed, columns are put in reading order, and headings, paragraphs, lists and tables are restored.

## Privacy

- PDFs are processed entirely inside the extension. **Document content is never uploaded anywhere.**
- The extension makes **no network requests**. Everything it uses is bundled inside it:
  - pdf.js, its worker, character maps, standard fonts and image decoders;
  - the cl100k tokenizer;
  - OCR: tesseract.js 7.0.0, its WebAssembly engine and the English model (`eng` 4.0.0_best_int).
- OCR runs only when you press **Run OCR**, on this computer.
- **Permissions:** `sidePanel`, `storage`, `clipboardWrite` and `scripting`. Access to claude.ai and chatgpt.com is *optional*: Chrome asks the first time you press **Insert into chat**, and you can revoke it in `chrome://extensions`. The extension only touches those sites when you press Insert, and only to put text in the message box.

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
3. Optionally tick chapters in the **Chapters** list (shown when the PDF has bookmarks or clear chapter headings), or type pages, e.g. `45-70, 82`, `100-` (to the end), or leave it empty for all pages.
4. Click **Convert**. A progress bar shows "Reading page X of Y"; **Cancel** stops it.
5. If some pages are scanned images, a **Run OCR on pages … (~time)** button appears. Press it to read them on this computer (about 6-8 s per page; **Cancel** keeps the pages finished so far).
6. Check the Markdown preview (you can edit it), then:
   - **Insert into chat**: with Claude or ChatGPT open in the current tab, puts the Markdown into the message box. It never presses Send. The first time, Chrome asks you to allow access to claude.ai and chatgpt.com.
   - or **Copy** / **Download .md** and paste it wherever you like.

The stats bar shows `~before → ~after tokens (est.)`:
- **Before** is a **rough** estimate of uploading the pages you selected as a PDF: their text plus about 1,568 tokens per page image, because AI apps also send each page as an image. `npm run eval` can measure the real number with an API key (see [Eval results](#eval-results)). **After** is the Markdown. This is the choice you are making: upload the PDF, or paste the Markdown.
- Underneath is the raw text of the same pages. The Markdown usually costs about the same as that raw text: cleaning removes junk, and headings, lists and page markers add a little back. The difference is that the Markdown is clean and structured.
- For context, the same numbers are shown for the whole document.
- Text is counted with the cl100k tokenizer (GPT-4's). Claude's tokenizer is not public, so these are estimates, not exact Claude counts; Anthropic notes cl100k undercounts Claude tokens.

From the command line, the same pipeline runs in Node:

```bash
npm run convert -- tests/fixtures/local/book.pdf "45-70" --out chapter.md
npm run convert -- tests/fixtures/local/scan.pdf "" --ocr   # OCR scanned pages
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
| `npm run convert -- <pdf> [pages] [--ocr]` | Convert a PDF from the command line |
| `npm run eval` | Measure exact Claude token counts on real PDFs (needs an API key in `.env`; see `eval/`) |
| `npm run eval -- --estimates-only` | The same comparison with the extension's own estimates (no API key) |

Golden Markdown files in `tests/golden/` are only rewritten deliberately: `UPDATE_GOLDEN=1 npm test`.

## How it works

Each step is pure TypeScript in `src/core/`, unit tested in Node. Steps marked *(later)* arrive in later phases.

1. **Extract** (`extract/`): pdf.js text items with positions, font sizes and real font names (for bold). Pages with almost no text are flagged.
2. **Lines** (`layout/`):
   - Margin notes (small text beside the main column on many pages, like a textbook's glossary terms) are removed first.
   - Items are grouped into lines by baseline and sorted top to bottom, with spaces inserted at visual gaps.
   - Multi-column pages (two-column papers, three-column bibliographies) are read column by column, left to right; titles and figures that span the columns stay in place.
3. **Clean** (`clean/`):
   - Running headers and footers are lines in the top or bottom 8% of the page that repeat on more than 40% of the pages within ±15 of your selection, or on 3 pages close together (for headers that change every chapter or section).
   - Page numbers ("12", "xiv", "Page 3 of 40") in those zones are removed, and so are headers that carry the page number ("Section 3.1 Problem-Solving Agents 83") even when their text changes every section.
   - Labels inside diagrams (a run of short fragments directly above a "Figure 3.1" caption) are removed; the caption stays.
   - Words split across lines are rejoined, using evidence from the document to keep real compounds like "water-fearing".
4. **Structure** (`structure/`):
   - Body font size is the most common size.
   - Headings are lines ≥1.2× that size, or short bold lines, or "Chapter 3" / "3.2 Title" patterns; sizes map to levels 1–3.
   - Paragraphs are split on larger vertical gaps or indented first lines, and joined across page breaks.
   - Bulleted and numbered lists, including nested ones and items whose lines wrap with a hanging indent.
   - Tables: lines whose text sits in aligned cells become Markdown tables. Plots, matrices and equations, which also line up in columns, are told apart and left as text.
5. **Chapters** (`outline/`): from the PDF's bookmarks, or, without bookmarks, from large headings found during the whole-document count. Ticking chapters fills in the page range.
6. **Markdown** (`markdown/`): a source line, optional `<!-- page N -->` markers, headings and paragraphs, with blank lines collapsed.
7. **Tokens** (`tokens/`): counted with the bundled cl100k tokenizer; the PDF-upload estimate adds ~1,568 tokens per page image.
8. **OCR** (`ocr/`, on request): scanned pages are rendered at 300 DPI and read with tesseract.js. Each word's position becomes a text item, so OCR'd pages go through steps 2-7 like any other page (columns, headers, lists, tables). Words OCR is less than 60% sure of are dropped.

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

Current:

- **Columns of short entries** (an index) are not recognised as columns and are read straight across. Pages that look like columns or a table but could not be handled get a warning.
- **Tables** with merged cells or multi-line cells come out with one row per printed line. Tables the detector is unsure about stay as text, with a warning.
- **Margin notes are dropped.** In the textbooks tested they repeat a nearby term, but a book whose margin holds unique content will lose it. Margin text in the body font size is never dropped.
- **Math** comes out as flattened text (e.g. `J(θ) = (hθ(x(i)) − y(i))2`).
- **Footnotes** stay where they are printed, as plain paragraphs.
- **Code blocks** (monospace text) are merged into paragraphs, losing their line breaks.
- **OCR** reads English only, takes ~6-8 s per page, and is weakest on formulas and diagram labels (e.g. "0.3 m" can come out as "03m"). OCR'd pages are marked with a warning. Bold text is not detected on OCR'd pages.
- **Page markers** are exact for where a paragraph starts, but a paragraph that runs onto the next page is kept whole before the next page's marker.
- **Token numbers** are estimates: text is counted with GPT-4's cl100k tokenizer (Claude's is not public), and raw uploads use a rough per-page image cost.
- **Converting a whole large book** extracts every page (Pro Git, 501 pages, takes about 12 s). Selecting pages is much faster.

Known non-goals: perfect table and math reconstruction, understanding images/diagrams, Firefox/Safari.

## Roadmap

- [x] Phase 0: setup
- [x] Phase 1: PDF to clean Markdown (MVP)
- [x] Phase 2: chapters and structure quality
- ~~Phase 3: question-aware trimming~~ (dropped: not worth the complexity for this tool)
- [x] Phase 4: OCR for scanned pages
- [x] Phase 5: insert into Claude / ChatGPT (checked on both live sites)
- [x] Phase 6: evaluation (`npm run eval`): estimates published; exact Claude counts ready to run with an API key

## Eval results

`npm run eval` measures seven real PDFs (a textbook chapter, a 62-page paper with tables, a scanned two-column paper, lecture notes, a short paper, a slide deck and a scanned textbook chapter) three ways: uploading the selected pages as a PDF, copy-pasting their raw text, and PDF Distill's Markdown.

**These are estimates, not Claude's exact counts.** Text is counted with the cl100k tokenizer (GPT-4's), and a PDF upload is estimated as text + ~1,568 tokens per page image. Anthropic notes that cl100k undercounts Claude tokens, so absolute numbers are likely low. The comparisons between columns use the same method throughout, so the savings percentages are more reliable than the absolute counts. Full table: [eval/ESTIMATES.md](eval/ESTIMATES.md) (`npm run eval -- --estimates-only`).

| Case | Pages | PDF upload | PDF Distill | Saving vs upload | vs raw text |
| --- | ---: | ---: | ---: | ---: | ---: |
| Textbook chapter (AIMA ch. 3) | 47 | ~108,700 | ~30,100 | 72% | 14% smaller |
| Research paper with tables (ATLAS) | 62 | ~174,100 | ~70,500 | 60% | 8% smaller |
| Two-column scanned paper (IEEE) | 4 | ~12,100 | ~5,500 | 54% | 6% smaller |
| Lecture notes (CS229 ch. 1) | 12 | ~24,600 | ~5,750 | 77% | 1% smaller |
| Short paper (arXiv) | 9 | ~20,500 | ~5,600 | 72% | 11% smaller |
| Slide deck | 22 | ~35,200 | ~800 | 98% | 15% larger |
| Scanned textbook chapter (Selina, OCR) | 18 | ~41,600 | ~13,200 | 68% | 1% smaller |

**Exact counts.** The same script measures with Claude's own tokenizer through Anthropic's free token-counting API: the selected pages are cut into their own PDF and counted as a real upload (page images included), and the raw text and Markdown are counted as messages. It writes [eval/RESULTS.md](eval/RESULTS.md), including how far off each estimate was. It needs an Anthropic API key in `.env` (git-ignored); this has not been run yet, because the author has no API account (a Claude subscription does not include API access).

## Decisions

See [DECISIONS.md](DECISIONS.md).
