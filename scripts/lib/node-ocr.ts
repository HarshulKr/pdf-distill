// Node-side OCR: render pages with pdf.js (onto @napi-rs/canvas, which
// pdfjs-dist uses in Node) and read them with tesseract.js, using the same
// bundled English data as the extension.
import { join } from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { linesFromTesseract, ocrScaleFor, ocrToItems } from '../../src/core/ocr/ocr';
import type { PageContent } from '../../src/core/types';

const LANG_PATH = join(import.meta.dirname, '..', '..', 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');

interface CanvasLike {
  toBuffer(type: 'image/png'): Buffer;
}

interface CanvasFactoryLike {
  create(width: number, height: number): { canvas: CanvasLike };
}

export interface NodeOcr {
  ocrPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PageContent>;
  close(): Promise<void>;
}

export async function createNodeOcr(): Promise<NodeOcr> {
  const worker: Worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: LANG_PATH, gzip: true, cacheMethod: 'none' });
  return {
    async ocrPage(doc, pageNumber) {
      const page = await doc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = ocrScaleFor(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const factory = (doc as unknown as { canvasFactory: CanvasFactoryLike }).canvasFactory;
        const { canvas } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
        const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { blocks: true });
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
