// Browser-side pdf.js setup. Everything is bundled with the extension: the
// worker script and the character maps. Nothing is fetched from the network.

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  title: string | null;
  close: () => Promise<void>;
}

export type PdfLoadErrorKind = 'password' | 'invalid' | 'other';

export class PdfLoadError extends Error {
  constructor(
    public kind: PdfLoadErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  const task = getDocument({
    data: new Uint8Array(data),
    // Real font names (e.g. "Times-Bold") are needed for bold detection.
    fontExtraProperties: true,
    // Same-origin URL of the bundled CMaps (copied there by wxt.config.ts).
    cMapUrl: new URL('/pdfjs/cmaps/', location.origin).href,
    cMapPacked: true,
    // Text extraction never needs fonts installed in the page.
    disableFontFace: true,
    verbosity: 0,
  });
  // Without a handler pdf.js waits forever for a password; fail instead.
  task.onPassword = () => {
    void task.destroy();
  };
  try {
    const doc = await task.promise;
    let title: string | null = null;
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: unknown };
      if (typeof info.Title === 'string' && info.Title.trim()) title = info.Title.trim();
    } catch {
      // Metadata is optional.
    }
    return { doc, title, close: () => task.destroy() };
  } catch (error) {
    const name = errorName(error);
    if (name === 'PasswordException' || task.destroyed) {
      throw new PdfLoadError('password', 'This PDF is password-protected. Open it in a PDF viewer, remove the password (e.g. print to PDF), then try again.');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfLoadError('invalid', 'This file does not look like a valid PDF, or it is damaged.');
    }
    throw new PdfLoadError('other', `Could not open this PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
}
