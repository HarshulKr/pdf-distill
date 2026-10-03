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
