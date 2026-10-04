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
