// Side panel controller: wires the UI to pdf.js loading (src/lib) and the
// pure pipeline (src/core). All processing happens here, in the panel page,
// never in the service worker.

import { beforeStats, convert, pagesLabel, type WholeDocumentCount } from '@/core/convert';
import { CancelledError, countDocumentText, extractPages } from '@/core/extract/extract';
import { markdownFileName } from '@/core/markdown/render';
import { pagesOfSections, sectionsFromHeadings, sectionsFromOutline } from '@/core/outline/outline';
import { formatPageList, parsePageRange, samplePages } from '@/core/pages/range';
import { estimateTokens, formatTokenEstimate, RAW_PDF_IMAGE_TOKENS_PER_PAGE } from '@/core/tokens/estimate';
import type { ConversionResult, Section } from '@/core/types';
import { loadPdf, PdfLoadError, type LoadedPdf } from '@/lib/pdf';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';

/** Above this many pages, warn that processing will take a while. */
const LARGE_PDF_PAGES = 1000;

/** Look up an element by id and check its type, so markup drift fails loudly. */
function el<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing or wrong element #${id}`);
  return node;
}

const ui = {
  dropZone: el('drop-zone', HTMLLabelElement),
  fileInput: el('file-input', HTMLInputElement),
  error: el('error', HTMLElement),
  doc: el('doc', HTMLElement),
  docTitle: el('doc-title', HTMLElement),
  docMeta: el('doc-meta', HTMLElement),
  changeFile: el('change-file', HTMLButtonElement),
  largeWarning: el('large-warning', HTMLElement),
  countStatus: el('count-status', HTMLElement),
  chapters: el('chapters', HTMLFieldSetElement),
  chapterList: el('chapter-list', HTMLUListElement),
  chaptersSource: el('chapters-source', HTMLElement),
  range: el('range', HTMLInputElement),
  rangeError: el('range-error', HTMLElement),
  pageMarkers: el('page-markers', HTMLInputElement),
  convert: el('convert', HTMLButtonElement),
  cancel: el('cancel', HTMLButtonElement),
  progressWrap: el('progress-wrap', HTMLElement),
  progress: el('progress', HTMLProgressElement),
  progressLabel: el('progress-label', HTMLElement),
  result: el('result', HTMLElement),
  tokensBefore: el('tokens-before', HTMLElement),
  tokensAfter: el('tokens-after', HTMLElement),
  statsDetail: el('stats-detail', HTMLElement),
  warnings: el('warnings', HTMLUListElement),
  preview: el('preview', HTMLTextAreaElement),
  copy: el('copy', HTMLButtonElement),
  download: el('download', HTMLButtonElement),
  copyStatus: el('copy-status', HTMLElement),
};

interface State {
  settings: Settings;
  fileName: string;
  pdf: LoadedPdf | null;
  whole: WholeDocumentCount | null;
  countAbort: AbortController | null;
  convertAbort: AbortController | null;
  result: ConversionResult | null;
  /** Page list of the last conversion, e.g. "45-70, 82" (null = whole document). */
  convertedPages: string | null;
  /** Chapters from bookmarks, or from large headings once the count finishes. */
  sections: Section[];
}

const state: State = {
  settings: { pageMarkers: true },
  fileName: '',
  pdf: null,
  whole: null,
  countAbort: null,
  convertAbort: null,
  result: null,
  convertedPages: null,
  sections: [],
};

// ---------------------------------------------------------------- helpers

function showError(message: string | null): void {
  ui.error.hidden = !message;
  ui.error.textContent = message ?? '';
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function setBusy(busy: boolean): void {
  ui.convert.hidden = busy;
  ui.cancel.hidden = !busy;
  ui.range.disabled = busy;
  ui.pageMarkers.disabled = busy;
  ui.chapters.disabled = busy;
  ui.changeFile.disabled = busy;
  ui.progressWrap.hidden = !busy;
}

function setProgress(done: number, total: number, label: string): void {
  ui.progress.max = Math.max(total, 1);
  ui.progress.value = done;
  ui.progressLabel.textContent = label;
}

async function closeCurrent(): Promise<void> {
  state.countAbort?.abort();
  state.convertAbort?.abort();
  const pdf = state.pdf;
  state.pdf = null;
  state.whole = null;
  state.result = null;
  state.sections = [];
  renderChapters('');
  if (pdf) await pdf.close();
}

// ---------------------------------------------------------------- loading

async function openFile(file: File): Promise<void> {
  showError(null);
  if (!isPdf(file)) {
    showError(`"${file.name}" is not a PDF.`);
    return;
  }
  await closeCurrent();
  ui.result.hidden = true;
  ui.doc.hidden = true;
  state.fileName = file.name;

  try {
    state.pdf = await loadPdf(await file.arrayBuffer());
  } catch (error) {
    showError(error instanceof PdfLoadError ? error.message : `Could not open this PDF: ${String(error)}`);
    return;
  }

  const { doc, title } = state.pdf;
  ui.docTitle.textContent = title ?? file.name;
  const kb = Math.round(file.size / 1024);
  ui.docMeta.textContent = `${doc.numPages.toLocaleString()} ${doc.numPages === 1 ? 'page' : 'pages'} · ${kb.toLocaleString()} KB${title ? ` · ${file.name}` : ''}`;
  ui.largeWarning.hidden = doc.numPages <= LARGE_PDF_PAGES;
  ui.largeWarning.textContent = `This PDF has ${doc.numPages.toLocaleString()} pages. Converting all of it will take a while; selecting the pages you need is much faster.`;
  ui.range.value = '';
  ui.rangeError.hidden = true;
  ui.doc.hidden = false;
  ui.dropZone.hidden = true;
  void loadChapters();
  void countWholeDocument();
}

// ---------------------------------------------------------------- chapters

/** Bookmarks are cheap to read, so they are shown right after opening. */
async function loadChapters(): Promise<void> {
  const pdf = state.pdf;
  if (!pdf) return;
  const sections = await sectionsFromOutline(pdf.doc);
  if (state.pdf !== pdf || sections.length === 0) return;
  state.sections = sections;
  renderChapters('from bookmarks');
}

/** Long outlines are cut off here; the page range still works for the rest. */
const MAX_LISTED_CHAPTERS = 300;

function renderChapters(source: string): void {
  const items = state.sections.slice(0, MAX_LISTED_CHAPTERS).map((section, i) => {
    const li = document.createElement('li');
    li.className = `level-${section.level}`;
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(i);
    const title = document.createElement('span');
    title.className = 'chapter-title';
    title.textContent = section.title;
    const pages = document.createElement('span');
    pages.className = 'chapter-pages';
    pages.textContent =
      section.startPage === section.endPage ? `p. ${section.startPage}` : `pp. ${section.startPage}–${section.endPage}`;
    label.append(box, title, pages);
    li.append(label);
    return li;
  });
  ui.chapterList.replaceChildren(...items);
  ui.chaptersSource.textContent = source ? `(${source})` : '';
  ui.chapters.hidden = items.length === 0;
}

/** Ticking chapters fills in the page range with the union of their pages. */
function applyChapterSelection(): void {
  const ticked = [...ui.chapterList.querySelectorAll<HTMLInputElement>('input:checked')]
    .map((box) => state.sections[Number(box.value)])
    .filter((s): s is Section => s !== undefined);
  ui.range.value = ticked.length ? formatPageList(pagesOfSections(ticked)) : '';
  ui.rangeError.hidden = true;
}

/** Background count of the whole document's text, for the "before" numbers. */
async function countWholeDocument(): Promise<void> {
  const pdf = state.pdf;
  if (!pdf) return;
  const abort = new AbortController();
  state.countAbort = abort;
  const total = pdf.doc.numPages;
  ui.countStatus.textContent = `Measuring the whole document (page 0 of ${total})…`;
  try {
    const count = await countDocumentText(pdf.doc, {
      signal: abort.signal,
      onProgress: ({ done }) => {
        if (done % 10 === 0 || done === total) {
          ui.countStatus.textContent = `Measuring the whole document (page ${done} of ${total})…`;
        }
      },
    });
    if (state.pdf !== pdf) return;
    state.whole = count;
    const tokens = beforeStats(count).tokensBefore ?? 0;
    ui.countStatus.textContent = `Whole document: ${formatTokenEstimate(tokens)} tokens of text (est.).`;
    if (count.lowTextPages.length > 0) {
      const label = pagesLabel(count.lowTextPages);
      const verb = count.lowTextPages.length === 1 ? 'has' : 'have';
      ui.countStatus.textContent += ` ${label.charAt(0).toUpperCase()}${label.slice(1)} ${verb} no text layer.`;
    }
    // No bookmarks: fall back to large headings found while counting.
    if (state.sections.length === 0) {
      state.sections = sectionsFromHeadings(count.headingCandidates, count.bodySize, count.pages);
      renderChapters('from large headings; check the page ranges');
    }
    renderStats();
  } catch (error) {
    if (error instanceof CancelledError || state.pdf !== pdf) return;
    ui.countStatus.textContent = 'Could not measure the whole document.';
  } finally {
    if (state.countAbort === abort) state.countAbort = null;
  }
}

// ---------------------------------------------------------------- converting

async function runConvert(): Promise<void> {
  const pdf = state.pdf;
  if (!pdf) return;
  showError(null);
  const total = pdf.doc.numPages;
  const parsed = parsePageRange(ui.range.value, total);
  if (!parsed.ok) {
    ui.rangeError.textContent = parsed.error;
    ui.rangeError.hidden = false;
    ui.range.focus();
    return;
  }
  ui.rangeError.hidden = true;

  const selected = parsed.pages;
  // Extract the selection plus +/-15 pages so headers/footers can be detected
  // even for a short selection (see DECISIONS.md).
  const toExtract = samplePages(selected, total);
  const abort = new AbortController();
  state.convertAbort = abort;
  setBusy(true);
  setProgress(0, toExtract.length, `Reading page 0 of ${toExtract.length}…`);

  try {
    const pages = await extractPages(pdf.doc, toExtract, {
      fonts: true,
      signal: abort.signal,
      onProgress: ({ done, total: n }) => {
        setProgress(done, n, `Reading page ${done} of ${n}…`);
      },
    });
    setProgress(toExtract.length, toExtract.length, 'Building Markdown…');
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the label paint
    state.result = convert({
      pages,
      selected,
      options: { pageMarkers: ui.pageMarkers.checked },
      fileName: state.fileName,
      wholeDocument: state.whole,
      sections: state.sections,
    });
    state.convertedPages = selected.length === total ? null : formatPageList(selected);
    ui.preview.value = state.result.markdown;
    renderWarnings(state.result.warnings);
    renderStats();
    ui.result.hidden = false;
    ui.copyStatus.textContent = '';
  } catch (error) {
    if (!(error instanceof CancelledError)) {
      showError(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    if (state.convertAbort === abort) state.convertAbort = null;
    setBusy(false);
  }
}

// ---------------------------------------------------------------- result

function renderWarnings(warnings: string[]): void {
  ui.warnings.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
  ui.warnings.hidden = warnings.length === 0;
}

/**
 * Stats bar. The headline compares like with like: raw text of the selected
 * pages -> cleaned output. Whole-document numbers are context only, so a
 * small selection doesn't look like a huge "saving". "After" follows edits in
 * the preview.
 */
function renderStats(): void {
  const result = state.result;
  if (!result) return;
  const { stats } = result;
  const after = estimateTokens(ui.preview.value);
  ui.tokensBefore.textContent = formatTokenEstimate(stats.tokensSelected);
  ui.tokensAfter.textContent = formatTokenEstimate(after);

  const pages = `${stats.pages.toLocaleString()} ${stats.pages === 1 ? 'page' : 'pages'}`;
  const perImage = `~${RAW_PDF_IMAGE_TOKENS_PER_PAGE.toLocaleString('en-US')} per page image`;
  const parts: string[] = [
    `Before = raw text of the ${pages} you selected; ${stats.removedLines.toLocaleString()} header/footer/page-number lines removed.`,
    `Uploading these ${pages} as a PDF would cost roughly ${formatTokenEstimate(stats.rawUploadTokensSelected)} (text + ${perImage}).`,
  ];
  const whole = beforeStats(state.whole);
  if (whole.tokensBefore === null || whole.rawUploadTokensBefore === null) {
    parts.push('Whole document: still measuring.');
  } else {
    parts.push(
      `Whole ${state.whole?.pages.toLocaleString() ?? ''}-page document: ${formatTokenEstimate(whole.tokensBefore)} of text, roughly ${formatTokenEstimate(whole.rawUploadTokensBefore)} as a PDF upload.`,
    );
  }
  ui.statsDetail.textContent = parts.join(' ');
}

async function copyMarkdown(): Promise<void> {
  try {
    await navigator.clipboard.writeText(ui.preview.value);
    ui.copyStatus.textContent = 'Copied.';
  } catch {
    // Fallback: select the text so the user can press Ctrl/Cmd+C.
    ui.preview.focus();
    ui.preview.select();
    ui.copyStatus.textContent = 'Press Ctrl+C (Cmd+C) to copy.';
  }
}

function downloadMarkdown(): void {
  const blob = new Blob([ui.preview.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = markdownFileName(state.fileName, state.convertedPages);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

// ---------------------------------------------------------------- events

ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files?.[0];
  ui.fileInput.value = ''; // allow re-selecting the same file
  if (file) void openFile(file);
});

ui.dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    ui.fileInput.click();
  }
});
ui.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  ui.dropZone.classList.add('dragging');
});
ui.dropZone.addEventListener('dragleave', () => {
  ui.dropZone.classList.remove('dragging');
});
ui.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation(); // the document-level handler below must not open it again
  ui.dropZone.classList.remove('dragging');
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

// Dropping a PDF anywhere on the panel (e.g. after one is loaded) opens it.
document.addEventListener('dragover', (event) => {
  event.preventDefault();
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

ui.changeFile.addEventListener('click', () => {
  ui.fileInput.click();
});
ui.convert.addEventListener('click', () => void runConvert());
ui.cancel.addEventListener('click', () => {
  state.convertAbort?.abort();
});
ui.range.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void runConvert();
});
ui.range.addEventListener('input', () => {
  ui.rangeError.hidden = true;
  // A typed range replaces the chapter selection.
  for (const box of ui.chapterList.querySelectorAll('input')) box.checked = false;
});
ui.chapterList.addEventListener('change', applyChapterSelection);
ui.pageMarkers.addEventListener('change', () => {
  state.settings.pageMarkers = ui.pageMarkers.checked;
  void saveSettings(state.settings);
});
ui.preview.addEventListener('input', renderStats);
ui.copy.addEventListener('click', () => void copyMarkdown());
ui.download.addEventListener('click', downloadMarkdown);

void loadSettings().then((settings) => {
  state.settings = settings;
  ui.pageMarkers.checked = settings.pageMarkers;
});
