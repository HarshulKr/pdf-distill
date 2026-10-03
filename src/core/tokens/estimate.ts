// Token estimation. All numbers here are ESTIMATES, never exact Claude counts.

/**
 * Rough rule of thumb for English text: ~4 characters per token. Phase 2
 * replaces this with js-tiktoken (cl100k) as a closer approximation and keeps
 * this as the fallback.
 */
export const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateTokens(text: string): number {
  return estimateTokensFromChars(text.length);
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
