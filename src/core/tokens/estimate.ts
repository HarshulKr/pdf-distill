// Token counts. All numbers here are ESTIMATES, never exact Claude counts.
//
// Text is counted with the cl100k_base tokenizer (GPT-4's), bundled with the
// extension. Claude's tokenizer is not public, so this is an approximation;
// it is much closer than a characters-per-token rule, which undercounted
// math-heavy text by ~30% (DECISIONS.md D43). Phase 6 measures the
// difference against Claude's token-counting API.

import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';

/** Shown next to counts so users know what they are looking at. */
export const TOKENIZER_NAME = 'cl100k';

/**
 * Fallback rule of thumb for English text: ~4 characters per token. Used
 * only if the tokenizer fails to load, and for quick sizes of text that was
 * not kept (none today).
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

let encoder: Tiktoken | null | undefined;

/** The tokenizer, built on first use (~0.2 s); null if it could not be built. */
function getEncoder(): Tiktoken | null {
  if (encoder === undefined) {
    try {
      encoder = new Tiktoken(cl100k);
    } catch {
      encoder = null;
    }
  }
  return encoder;
}

/**
 * Token count of `text`. Special-token strings such as "<|endoftext|>" are
 * counted as ordinary text: they are document content, not control tokens.
 */
export function countTokens(text: string): number {
  if (text === '') return 0;
  const enc = getEncoder();
  if (!enc) return estimateTokensFromChars(text.length);
  try {
    return enc.encode(text, [], []).length;
  } catch {
    return estimateTokensFromChars(text.length);
  }
}

/**
 * Image tokens per page when a PDF is uploaded raw. Anthropic's PDF support
 * converts each page to an image and sends its text alongside; images cost
 * ceil(w/28) x ceil(h/28) tokens capped at 1,568 on the standard tier, and a
 * page rendered at normal resolution hits that cap. Source and reasoning:
 * DECISIONS.md D8. Phase 6 measures real numbers.
 */
export const RAW_PDF_IMAGE_TOKENS_PER_PAGE = 1568;

/** Rough cost of uploading the raw PDF: its text plus one image per page. */
export function estimateRawPdfUploadTokens(textTokens: number, pages: number): number {
  return textTokens + pages * RAW_PDF_IMAGE_TOKENS_PER_PAGE;
}

/**
 * Display form for an estimate: "~860", "~42,100". Values over 1,000 are
 * rounded to the nearest 100 so the number doesn't look more precise than it is.
 */
export function formatTokenEstimate(tokens: number): string {
  const rounded = tokens >= 1000 ? Math.round(tokens / 100) * 100 : tokens;
  return `~${rounded.toLocaleString('en-US')}`;
}
