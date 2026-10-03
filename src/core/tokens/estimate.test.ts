import { describe, expect, it } from 'vitest';
import {
  estimateRawPdfUploadTokens,
  estimateTokens,
  estimateTokensFromChars,
  formatTokenEstimate,
  RAW_PDF_IMAGE_TOKENS_PER_PAGE,
} from './estimate';

describe('token estimates', () => {
  it('uses ~4 characters per token, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokensFromChars(400)).toBe(100);
  });

  it('raw PDF upload = text tokens + one image per page', () => {
    expect(RAW_PDF_IMAGE_TOKENS_PER_PAGE).toBe(1568);
    expect(estimateRawPdfUploadTokens(700, 1)).toBe(2268);
    expect(estimateRawPdfUploadTokens(0, 10)).toBe(15680);
  });

  it('formats with a tilde, rounding large values to the nearest 100', () => {
    expect(formatTokenEstimate(860)).toBe('~860');
    expect(formatTokenEstimate(42_149)).toBe('~42,100');
    expect(formatTokenEstimate(1_002_943)).toBe('~1,002,900');
  });
});
