# Decisions

Non-obvious choices, with the reason and the alternatives considered. Newest phase last.

---

## Phase 0

### D1. Pinned exact dependency versions
All dependencies are pinned to exact versions (`--save-exact`). The project ships to users as a bundled extension, so a silent minor upgrade of pdf.js or WXT could change extraction output and break golden tests. Upgrades should be deliberate, followed by `npm test`.

### D2. TypeScript 6.0, not 7.0
TypeScript 7.0 (the native Go port) is the npm `latest` tag, but `typescript-eslint` 8.71 supports only `>=4.8.4 <6.1.0`. The lint script was approved, so TypeScript is pinned to 6.0.3. Revisit when typescript-eslint supports 7.x.
*Alternative:* TS 7 with linting dropped or run without type-aware rules. Rejected: type-aware lint rules catch real bugs (unhandled promises, unsafe `any`).

### D3. `@types/node` added (types only)
`scripts/` and `tests/` use `node:fs` etc., and TypeScript 6 no longer includes `@types/*` packages automatically, so `npm run typecheck` fails without it. It is a dev-only type package with no runtime code. **Not in the approved list; flagged for approval.**

### D4. `browser.*` instead of `chrome.*` in extension code
WXT provides a typed `browser` global that maps to `chrome.*` in Chrome. Using it avoids a separate `@types/chrome` dependency. It is the same API underneath; no polyfill is added.

### D5. Fixtures are generated, committed, and deterministic
`scripts/make-fixtures.ts` uses fixed creation/modification dates so regenerating produces byte-identical files (verified with md5). The PDFs are committed so tests do not depend on running the generator first.

### D6. The "no text layer" fixture draws text as rectangles
A real scanned page needs an image, and pdf-lib cannot render text to a bitmap without a canvas library (another dependency). Instead page 2 of `no-text-layer.pdf` draws text from a 5x7 bitmap font as filled rectangles: pdf.js finds no text items, but once rendered to a canvas the letters are readable. Whether tesseract reads this blocky font reliably will be checked in Phase 4; if not, Phase 4 will propose a better fixture.

### D7. Hyphenation fixture includes a real compound
`running-headers.pdf` breaks both "phospho-/lipids" (should join to "phospholipids") and "water-/fearing" (should stay "water-fearing"). The spec's rule (join when the continuation is lowercase) would wrongly produce "waterfearing". Phase 1 will propose a rule for this, e.g. keep the hyphen when the same hyphenated compound appears mid-line elsewhere in the document.

### D8. Raw-PDF-upload token estimate: formula and source (used from Phase 1/2)
Agreed with the user: show a second "raw PDF upload" figure, labelled **rough** until Phase 6 measures real counts.

Source: Anthropic's PDF support docs (platform.claude.com/docs/en/build-with-claude/pdf-support, read 2026-10-03). They say each page is converted to an image and its extracted text is sent alongside it, and that text costs typically run about 1,500-3,000 tokens per page depending on density. Image tokens follow the vision docs (platform.claude.com/docs/en/build-with-claude/vision): ceil(w/28) x ceil(h/28) visual tokens, capped at 1,568 per image on the standard tier. A page rendered at typical resolution hits that cap.

**Planned formula:** `rawUploadEstimate = extractedTextTokens(selected pages) + pages x 1,568`.
- 1,568 = the documented per-image cap on the standard tier. This is the per-page constant.
- Using the document's own text tokens, rather than a flat 1,500-3,000, keeps sparse pages (slides, figures) from being overestimated.
- Sanity check: a dense textbook page (~700 text tokens) comes out at about 2,300 tokens, inside the documented 1,500-3,000 range.

Phase 6 will replace this with measured counts and record how close the estimate was.

### D9. Folder layout: `srcDir: 'src'`, icons in root `public/`
The spec's layout (`src/core`, `src/entrypoints`) maps onto WXT via `srcDir: 'src'`. WXT resolves `public/` from the project root, not from `srcDir`, so icons live in `public/icon/`. The icons are simple generated PNGs (a page glyph on a green square), placeholders until there is a real design.

---

## Phase 1

### D10. Bold detection uses real font names, only on converted pages
pdf.js's `getTextContent()` reports internal font ids (`g_d0_f1`), not names. With `fontExtraProperties: true`, the real PostScript name (e.g. `Times-Bold`) is available from `page.commonObjs`, but only after `getOperatorList()` has parsed the page. That costs extra time, so it runs only for pages being converted (plus the ±15-page sample), never in the whole-document count. If the operator list fails, conversion continues without bold information.
*Alternatives:* guess bold from text width (unreliable); skip bold (misses bold body-size subheadings, which are common in textbooks).

### D11. Lines are grouped by geometry, not pdf.js stream order
Items are sorted by baseline then x, and grouped when baselines are within 0.5 × the larger font size. Many PDFs write text in non-reading order, so geometry is more robust for single-column pages. Two-column pages come out interleaved until Phase 2 (see D16).

### D12. Hyphenation uses evidence from the document
A line ending in `word-` followed by a lowercase word is resolved, strongest evidence first:
1. The joined word appears elsewhere → join.
2. The exact compound appears mid-line → keep the hyphen.
3. The first part forms other mid-line compounds (`water-loving` → keep `water-fearing`) → keep the hyphen.
4. Otherwise → join.

This replaces the spec's "join on lowercase continuation" rule, which turns real compounds into non-words. Rule 3 can wrongly keep a hyphen (`under-standing` if `under-represented` exists), which we judged less harmful than the opposite error.

### D13. Header/footer detection samples ±15 pages around the selection (agreed)
Pages within 15 of any selected page are extracted. Repetition is counted over that sample; removal applies to the selected pages. The same sample feeds the document profile (body size, heading sizes, line gap), so a short selection gets the same heading levels as its chapter.

### D14. Data model extensions
- `PageContent`/`PageLines` carry page size, needed for the header/footer zones.
- `Line.width` is used for "short line" paragraph and heading rules.
- `ConversionStats` gains `rawUploadTokensBefore`.
- The three "before" fields are `number | null`: they describe the whole document and are null while the background count is running, so conversion never waits for it.

### D15. Paragraphs are joined across page breaks; page markers are approximate
If a page's last paragraph has no sentence end and the next page starts in lowercase, they become one paragraph. Its `<!-- page N+1 -->` marker then comes after the joined paragraph. A paragraph's start page is always right; a sentence near a page boundary may be cited one page early.

### D16. Columns/tables trigger a warning in Phase 1
Pages where at least 30% of lines (and at least 3) contain gaps wider than 2 em are reported as "seems to have columns or a table". Proper column and table handling is Phase 2; until then the spec's "never garble silently" rule is met with a warning.

### D17. Output starts with a one-line source comment
`<!-- Source: file.pdf, pages 45-70 -->` (~15 tokens) tells the AI what it is reading and which pages, which makes page citations meaningful. It contains the file name; users who mind can delete the line in the preview.

### D18. Roman-numeral page numbers are limited to below 400
Excluding M and D stops words like "mix" (1009) and "dim" from being treated as page numbers in header/footer zones. Front matter never runs to CD pages.

### D19. Bundled pdf.js assets: worker and CMaps only
- The worker (~1.3 MB) and character maps (~1.7 MB) are bundled. Without CMaps, some CJK PDFs extract as garbage.
- Standard font data and pdf.js's WASM image decoders are not needed for text extraction. They will be added in Phase 4, which renders pages for OCR.
- Built extension size: about 2.9 MB.

### D20. How the side panel was verified without the user's Chrome
- Chrome downloads are blocked in the build environment, so the built `sidepanel.html` was served over local HTTP and driven with puppeteer in a Chromium bundled in an npm package. This is scratch tooling only, not added to the project.
- Checked: loading, conversion, Cancel, a full 501-page book (12.5 s to extract, ~0.23 s of blocking Markdown build), error messages (corrupt PDF, password-protected PDF, bad page range), and dark mode.
- Not checked, because they need the real extension context: the side panel itself and `chrome.storage`. Both are in the manual test steps.

### D21. `npm run convert` CLI
`scripts/convert.ts` runs the same pipeline in Node (pdf.js legacy build), useful for checking real PDFs from `tests/fixtures/local/`. Phase 6's eval script reuses `scripts/lib/node-pdf.ts`.

---

## Phase 2

### D22. "Chapter 3" at body size needs typographic support
The chapter pattern alone made any short line starting "Chapter 3…" or "Section 2…" a level-1 heading, including a wrapped sentence such as "Chapter 3 showed how membranes form, and in this". It now also needs one of: bold, ≥1.1× body size, all caps, or the label alone on its line ("Chapter 3", "Appendix B").

### D23. Running headers: frequent OR repeated on nearby pages
D13's "more than 40% of the ±15-page sample" misses headers that change often. A chapter title printed on odd pages of a 20-page chapter is on ~10 of ~31 sampled pages (32%), and section-title headers change every few pages. A line in the edge zone is now also running if it appears on 3 pages within a span of 6 page numbers. 6 covers odd-only headers (n, n+2, n+4) plus one skipped page.
*Risk:* a non-header line repeated near the top or bottom of 3 nearby pages would be removed. Edge zones rarely hold body text, so this was judged acceptable.

### D24. Paragraphs join only across consecutive pages
With a selection like `45-70, 82`, a sentence cut off at the end of page 70 was glued onto page 82. Joining now requires the next page number to follow directly.

### D25. Headline token numbers compare like with like
Phase 1's headline was whole-document text → output. For a 5-page selection of a 500-page book, that mostly measured how few pages were selected, not what cleaning saved. The headline is now **raw text of the selected pages → output**, and the detail line adds:
- a rough upload estimate for just those pages (D8's formula)
- the whole document's text and upload estimate, as context

`ConversionStats` gains `charsSelected`, `tokensSelected` and `rawUploadTokensSelected`. Raw text is counted the same way as the whole-document count (item text plus one newline per line, before cleaning).

### D26. More paragraph-start escaping
Body paragraphs starting with `1. `, `2) `, `- `, `* `, `+ ` or `>` would render as lists or quotes. They are now escaped (`1\. `, `\- `, `\>`), in addition to the existing `# ` escape.

### D27. Chapters: bookmarks first, large headings as a fallback
- **Bookmarks** (`outline/`): read with `getOutline()`, levels 1-2 only (deeper levels made the list too long to scan). Destinations are resolved from names, page references, or a raw 0-based page index (some PDF writers use that). A section ends just before the next entry at the same or a higher level.
- **Fallback**: for PDFs without bookmarks, the background whole-document count now also collects large text runs (≥1.15× the page's usual size, at most 5 per page, so memory stays bounded on big books). Runs ≥1.4× the document's body size that look like titles become chapters, with the two largest sizes as levels 1 and 2. 1.4× is stricter than the 1.2× used for headings inside the output, because a chapter list full of minor headings is useless. The list is labelled "from large headings; check the page ranges".
- **UI**: ticking chapters fills in the page range (the union of their pages). Typing a range clears the ticks, so the two never disagree.
- `ConversionResult.sections` now lists the chapters that overlap the selection.

*Alternative:* run full heading detection (with fonts) over the whole book. Rejected: fonts need `getOperatorList()` on every page, and extracting all 501 pages of Pro Git that way took ~12.5 s (D20). The background count only uses `getTextContent()`.

### D28. Steps 3-5 were re-prioritised from real PDFs
Before building columns, lists and tables, the pipeline was run on three real PDFs: Russell & Norvig *AIMA* 4th ed. (1,166 pages), Stanford CS229 notes (278 pages, pdfTeX) and a 22-page lecture deck (macOS Quartz). None is two-column and none has real tables, but they showed bigger problems: margin notes glued into sentences, odd-page headers surviving, diagram labels turned into headings, broken lists. Those were fixed first (D29-D33). Column and table handling is postponed until there is a real two-column PDF to test against; the "may be in the wrong order" warning stays.

### D29. Margin notes are removed before lines are built
AIMA prints glossary terms in the outer margin at 8pt, on the same baseline as body lines, so they were joined into sentences ("Goals organize Goal formulation behavior"). `layout/margins.ts` measures each page's text column from body-size items (5th/95th percentile of left/right edges) and drops text that is (a) smaller than 0.95× body size, (b) at least 0.5 em outside the column, and (c) part of a consistent margin: on ≥3 pages and ≥15% of the sample. Odd and even pages are measured separately because books mirror their layout. The header/footer zones are left alone, since running headers often put the page number outside the column and D30 needs it.
Margin notes are **dropped**, not kept: in AIMA they repeat a term defined in the adjacent sentence, and keeping them cost tokens for no information. The stats line reports how many were removed. Same-size margin text is never dropped (too risky).

### D30. Headers that carry the page number ("folios")
Headers like "Section 3.1 Problem-Solving Agents 83" change every section, so repetition (D13, D23) can't find them. Instead, a page's first or last line (within the top/bottom 15%) is removed when it starts or ends with a number equal to the PDF page number plus an offset that holds on ≥30% of sampled pages (≥3). The offset handles front matter: CS229 prints "10" on PDF page 11. The zone is wider than 8% because LaTeX puts folios ~13% down the page.

### D31. Figure labels above captions are dropped
Diagram text is extracted like body text: the Romania map became `### Oradea`, `71`, `### Zerind 87`. A run of ≥2 short fragments (≤5 words without sentence-ending punctuation, or lines with wide gaps) directly above a caption ("Figure 3.1 …", "FIG. 2", "Exhibit A") is removed; the caption stays. Numbered section headings stop the run. In AIMA chapter 3 this removed 254 lines.

### D32. Lists: markers, hanging indents, nesting
- Markers: bullet glyphs (•, ◦, ▪, ➢ …), `-`/`–`/`*` + space, `3.`/`3)` + space, `3.Text` when a capital follows (slides), and `(a)`/`(iv)`/`a)` labels (kept in the text, since Markdown has no lettered lists).
- A wrapped line continues an item when it lines up with the item's *text* (hanging indent), or wraps back to the marker mid-sentence and starts lowercase. Aligning with the text, not just "indented", matters: AIMA paragraphs indent to x=72 while bullet text sits at x=79.
- Nesting follows marker x positions; rendering indents each level to its parent's text (CommonMark).
- A marker beats bold/numbered heading rules, but not a clearly larger heading.

### D33. TeX bold fonts and oversized glyphs
- `BX` + design size is "bold extended" in TeX font names (CMBX12, CMSSBX10), so AIMA's "3.1.1 …" subheadings were missed as headings.
- Same-line grouping used 0.5× the *largest* item size as tolerance. AIMA's 25pt pointing-hand icon beside 11pt text widened it enough to merge two lines. The size used is now capped at 1.5× the smaller item.

### D34. Measured result: the saving is against PDF uploads, not raw text
Whole chapters, estimated tokens (chars/4):

| | Raw text of pages | Output | PDF upload (rough, D8) |
|---|---|---|---|
| AIMA ch. 3, 47 pp. | ~33,900 | ~32,800 | ~107,600 |
| CS229 ch. 1, 12 pp. | ~4,650 | ~5,000 | ~23,500 |
| Slides, 22 pp. | ~716 | ~843 | ~35,200 |

Cleaning removes junk (AIMA: 46 header lines, 148 margin notes, 254 figure labels), but Markdown structure (headings, list markers, page markers, paragraph breaks) adds back about as much. So the output costs about the same as pasting the raw text, while being far more readable, and 70-98% less than uploading the PDF. The README's claims should say exactly this; Phase 6 will confirm with real token counts.

### D35. Headline: PDF upload → Markdown
D25 made the headline "raw text of the selected pages → output". On real chapters that reads like "~33,900 → ~32,800", which suggests the tool does nothing, although the actual choice a user makes is between uploading the PDF and pasting the Markdown (D34). The headline is now **rough PDF-upload estimate of the selected pages → output**, labelled as such, and the next line gives the raw-text number of the same pages, so the comparison with copy-pasting stays visible.

### D36. Scanned pages with a watermark
A scanned Selina Physics chapter has a "Downloaded from …" line at the top and bottom of every page and no other text. That was enough raw text to pass the "no text layer" check, and the watermark was then removed as a running header: the output was 18 empty pages with **no warning**. The check now runs on the text left after cleaning, and the warning says "no readable text, apart from any headers or watermarks". OCR (Phase 4) is the real fix.
The same PDF's bookmarks are scanner file names ("IMG", "IMG_0001", …). When ≥80% of bookmark titles look like file names, no chapter list is shown.

### D37. "Chapter 1" + title become one heading
CS229 sets "Chapter 1" and "Linear regression" as two lines; AIMA sets "CHAPTER 3" smaller than "SOLVING PROBLEMS BY SEARCHING", so the label came out as `##` under its own title. A heading that is only a chapter label, directly followed by another heading, is merged into "Chapter 1: Linear regression" at the higher of the two levels.

### D38. Margin notes: a wide line is not a margin note
The ATLAS paper (single column) showed D29 cutting real content: "150 GeV." from a 10pt caption that ran past the text column, and pieces of AIMA's full-width algorithm boxes. A small item outside the column is now a margin note only if no text **of the same size** continues inside the column on the same baseline (a margin note stands beside *body-size* text; a wide caption or table row continues in its own size). The size limit was also lowered from 0.95× to 0.9× body size.

### D39. Tables
`structure/tables.ts`. Tuned on the ATLAS paper (62 pages, ~13 real tables), AIMA, CS229 and two shorter arXiv papers.
- **Cells:** a line splits into cells at gaps wider than 0.9 em (CS229's header uses exactly 1 em).
- **Rows:** a run of ≥3 consecutive multi-cell lines of the same font size, about one line apart (≤2.5 em); short single-cell labels ("Single-top:") may sit inside.
- **Columns:** from gutters, i.e. x ranges no cell covers. Unlike clustering left edges, this works for right-aligned numbers. Columns empty in every row are dropped.
- **Is it really a table?** Several things line up in columns without being tables. Each rule below was added because a real page produced that false positive:
  - plot axis ticks: rejected unless some cell has a word;
  - rows of plot panels: wide grids must be ≥75% filled (narrow ones ≥50%), ≤16 columns;
  - plot legends: rejected when a "Figure N" caption follows with only labels in between (no prose: three or more ordinary lowercase words). Tables have captions above, so they are unaffected;
  - displayed math: rejected when >15% of cells are lone letters or brackets/operators, >10% contain ∂ ∑ ∏ ∫ ∇, or a row ends in an equation number "(2)";
  - "–" (n/a), ". . ." and lone "." are table filler, not math.
- **Result:** ATLAS 11 tables found, all real (table of contents included); AIMA 1 (the A*/uniform-cost comparison); CS229 2 (the housing data, and a one-hot vector display); no false positives left in the two short papers. Plots and matrices stay as text.
- Pages with a recognised table no longer get the "columns or a table" warning; unrecognised grids keep it.

### D40. Two-column layout still postponed
All three arXiv papers supplied for testing are single-column. Column reading order stays unimplemented, with the warning, until a real two-column PDF is available.

### D41. Private Use Area characters are dropped
TeX math fonts draw large brackets from Private Use Area code points (U+E000-U+F8FF), which come out as garbage characters. They never carry meaning as text, so extraction drops them.

### D42. Multi-column pages (supersedes D40)
`layout/columns.ts`, tested on a scanned and OCR'd two-column IEEE paper (pages 1-4 of the PDF), AIMA's three-column bibliography, and every single-column PDF used so far.
- **Gutters:** x ranges between the leftmost and rightmost body text, in the central 70% of the page, at least 1 em wide, that ≤5% of body-size items cross. Gutters that would leave a column narrower than 12 em are dropped: in OCR'd or justified text, word gaps can line up by chance inside a real column.
- **Columns must be running text.** In each column, at least 5 lines, and at least 40% of its lines, must fill ≥60% of the column width with *text*: ≥4 words, ≥60% letters, ≥3 letters per word on average. This was the key rule. The first version only checked line length, and split ATLAS's Table 7, a page of CS229 equations, an appendix heading and AIMA's contents page (dot leaders) as if they were columns. A first fix used "sentence-like" lines (lowercase words) and then rejected bibliographies, which are mostly names.
- **Reading order:** items crossing a gutter (titles, wide figures) form spanning lines that split the page into bands; within a band each column is read top to bottom, left to right.
- **Paragraphs across columns:** moving up the page used to always start a new paragraph. A sentence cut off at the bottom of a column now continues when the next column starts in lowercase.
- **Results:** IEEE paper pages 1-4 detected (plus a multi-column committee list), AIMA bibliography (pp. 1085-1118, three columns) reads entry by entry. Zero pages detected in ATLAS, CS229, the two short papers, the slides and the scan; their outputs are byte-identical to before.
- **Limitation:** index pages (short entries like "A* search, 103") are not recognised as columns and stay interleaved.

### D43. Token counts use the cl100k tokenizer (supersedes the 4-chars rule; updates D34)
`js-tiktoken` 1.0.21 (MIT, pinned) with the `cl100k_base` vocabulary (GPT-4's) is bundled, about 1.1 MB, taking the built extension from 2.9 to 4.0 MB. Claude's tokenizer is not public, so this is still an approximation, labelled as such in the side panel. Phase 6 measures the gap with Claude's token-counting API.
- **Why it matters:** "4 characters per token" undercounted the ATLAS paper by ~30% (~50,400 vs ~71,700 tokens) and CS229 by ~14%, because math and physics notation splits into many tokens. For plain prose (AIMA) it was within ~10%.
- **Cost:** ~0.2 s to build the tokenizer once, then ~1.5-2.5 MB of text per second. Tokenizing every page in the background count adds little: AIMA's 1,166 pages were measured in ~16 s in the browser, about the same as before. Edits in the preview are recounted 250 ms after typing stops.
- The 4-chars rule stays as a fallback if the tokenizer cannot be built, and for a whole-document count that predates this change (`WholeDocumentCount.tokens` missing).
- Test counts are pinned to an external reference (OpenAI's cookbook example "tiktoken is great!" = 6 tokens), not to whatever the code returns.

Re-measured (D34), tokens via cl100k:

| | Raw text of pages | Output | PDF upload (rough) |
|---|---|---|---|
| AIMA ch. 3, 47 pp. | ~35,000 | ~30,100 | ~108,700 |
| CS229 ch. 1, 12 pp. | ~5,800 | ~5,750 | ~24,600 |
| Slides, 22 pp. | ~690 | ~800 | ~35,200 |
| ATLAS paper, 62 pp. | ~76,800 | ~70,500 | ~174,100 |
| IEEE two-column paper, 4 pp. | ~5,900 | ~5,500 | ~12,100 |

With real counts the output is 6-14% *smaller* than the raw text for books and papers, level for lecture notes, and 15% larger for slides (list markers on short bullets). The main saving is still against PDF uploads: 55-98%.

---

## Phase 3

### D44. Phase 3 (question-aware trimming) dropped
Dropped at the user's request: it would add a ~20-50 MB embedding model and a second, fuzzier step between the user and their text, for a saving the chapter picker and page ranges already mostly deliver.

---

## Phase 4

### D45. OCR engine and bundling (agreed choices: bundled, on a button, English only)
- **Engine:** tesseract.js 7.0.0 (Apache-2.0) with the LSTM engine and the `eng` 4.0.0_best_int model (2.95 MB gzipped), all pinned. It runs in a Web Worker inside the extension; nothing is uploaded.
- **Bundled, not downloaded:** the extension still makes zero network requests. Only the two SIMD engine builds ship (relaxed-SIMD and SIMD, ~3.9 MB each); Chrome 116+ always supports SIMD, so the slower non-SIMD fallback is left out. pdf.js's JPEG 2000, JBIG2 and colour-profile decoders and its standard fonts are bundled too: without them the Selina scan rendered as **blank white pages**. Built extension: 4.0 → 16.1 MB.
- **On a button:** after converting, scanned pages produce a "Run OCR on pages 3-4 (~15 s)" button. OCR results are kept per document, so changing the page range does not redo them; Cancel keeps finished pages.
- **Worker setup:** `workerBlobURL: false` (a blob: worker is blocked by the extension's CSP), and every path points at a bundled file. tesseract.js's defaults point at a CDN.

### D46. OCR words become text items; the pipeline is unchanged
Tesseract's lines often run straight across both columns ("…pivoted at (2) The upper circular stone…"), so only **word** boxes are used. Each word becomes a TextItem at its baseline, and the normal layout code rebuilds lines and columns, so headers, columns, lists, tables and hyphen repair all work on OCR'd pages. Tested on the scanned Selina chapter (18 pages, two columns) and a generated scan.
- **Font size** is not reported by Tesseract. It is estimated from each word's box height divided by the box's expected height in ems for its letters (ascenders and descenders: 0.92; ascenders only: 0.7; descenders only: 0.69; x-height only: 0.47), then the median over each run of nearby words is used, so a whole line gets one size.
- **Confidence cut-off 60:** on a scanned textbook page, 487 of 561 words scored 90+, and every word between 40 and 60 was a misread diagram label or speck ("Leis", "Joti.", "©"). A real "(2)" scored 69.
- **300 DPI**, capped at 4,000 px on the long side; ~6-8 s per page (Node and Chrome).

### D47. Column detection, revisited for OCR (refines D42)
OCR gives one item per word, where a text layer gives a few per line, which broke gutter detection on scans:
- **Crossing is counted in text rows**, not items (baselines bucketed to half an em), and the limit is 15% of rows (was 5% of items). Measured: gutters were crossed by 4-7% of rows (headings, diagram labels), column interiors by 25-90%.
- **Minimum gutter 0.6 em** (was 1): OCR word boxes are tight around the ink, and OCR's estimated body size runs large.
- **Running-text share ≥30%** (was 40%): OCR'd columns beside diagrams have more short label lines.
- **List markers hanging into a gutter** ("(2)", "(3)") belong to the column on their right; other items in a gutter go to the side their centre is on, and only an item crossing a whole gutter spans columns.
- **Regression check:** on every text-layer PDF the same pages are detected as before (IEEE pp. 1-4 and 12, AIMA bibliography pp. 1085-1118, nothing elsewhere). Selina: 17 of 18 OCR'd pages are read as two columns; the chapter opening page keeps its warning.

### D48. OCR rendering uses pdf.js's "print" intent
The default "display" intent paces rendering with requestAnimationFrame, which never fires while the panel is hidden, so OCR stalled until the panel was shown again. "print" renders in one pass.

### D49. A realistic scanned fixture (closes D6)
D6's blocky 5x7 shapes OCR poorly ("THE CELL HALL GIVES" for "THE CELL WALL GIVES PLANTS"), as predicted. `scanned.pdf` is page 1 of running-headers.pdf rendered at 200 DPI with pdf.js and embedded as an image only. OCR reads it word-perfectly, including hyphen repair across lines; it is regenerated deterministically (same MD5 on every run) and drives an end-to-end OCR test (~5 s). `no-text-layer.pdf` stays as the "no text at all" fixture.
