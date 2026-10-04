// Browser-side OCR: render a page with pdf.js onto an OffscreenCanvas and
// read it with tesseract.js. Every file (worker, engine, English model) is
// bundled with the extension (wxt.config.ts); nothing is fetched from the
// network, and nothing leaves the computer.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { linesFromTesseract, ocrScaleFor, ocrToItems } from '@/core/ocr/ocr';
import type { PageContent } from '@/core/types';

const asset = (path: string): string => new URL(path, location.origin).href;

export interface OcrEngine {
  ocrPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PageContent>;
  close(): Promise<void>;
}

/** Start the OCR engine (~0.5 s: loads the engine and the English model). */
export async function createOcrEngine(): Promise<OcrEngine> {
  const worker: Worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: asset('/ocr/worker.min.js'),
    // A folder: tesseract.js picks the SIMD or relaxed-SIMD build itself.
    corePath: asset('/ocr/core/'),
    langPath: asset('/ocr/lang'),
    // Load the worker from its bundled file; a blob: URL would be blocked
    // by the extension's content security policy.
    workerBlobURL: false,
    gzip: true,
    // The model is bundled, so there is nothing to cache in IndexedDB.
    cacheMethod: 'none',
  });

  return {
    async ocrPage(doc, pageNumber) {
      const page = await doc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = ocrScaleFor(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create a canvas to render the page.');
        // White background: scans with transparent areas would otherwise OCR as black.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          // "print" renders in one go. The default "display" intent paces
          // rendering with requestAnimationFrame, which never fires while
          // the panel is hidden, so OCR would stall until it is shown.
          intent: 'print',
        }).promise;
        const image = await canvas.convertToBlob({ type: 'image/png' });
        const { data } = await worker.recognize(image, {}, { blocks: true });
        const items = ocrToItems(linesFromTesseract(data), scale, pageNumber);
        return { page: pageNumber, width: base.width, height: base.height, items, ocr: true };
      } finally {
        page.cleanup();
      }
    },
    async close() {
      await worker.terminate();
    },
  };
}
