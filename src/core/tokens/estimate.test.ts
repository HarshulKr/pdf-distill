import { describe, expect, it } from 'vitest';
import {
  countTokens,
  estimateRawPdfUploadTokens,
  estimateTokensFromChars,
  formatTokenEstimate,
  RAW_PDF_IMAGE_TOKENS_PER_PAGE,
} from './estimate';

describe('countTokens (cl100k)', () => {
  it('counts known strings exactly', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('hello world')).toBe(2);
    // The example in OpenAI's tiktoken cookbook: 6 tokens in cl100k_base.
    expect(countTokens('tiktoken is great!')).toBe(6);
  });

  it('counts math-heavy text as more tokens than the 4-chars rule', () => {
    // From the ATLAS paper: symbols and indices split into many tokens.
    const physics = '𝑍(ℓℓ)+jets 13/13.6 Sherpa 2.2.14 NNLO 𝐸Tmiss > 150 GeV, |𝜂| < 2.47';
    expect(countTokens(physics)).toBeGreaterThan(estimateTokensFromChars(physics.length));
  });

  it('treats special-token text as ordinary content', () => {
    expect(countTokens('a <|endoftext|> b')).toBeGreaterThan(3);
  });
});

describe('estimates', () => {
  it('keeps ~4 characters per token as the fallback', () => {
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokensFromChars(5)).toBe(2);
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
