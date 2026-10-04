import { describe, expect, it } from 'vitest';
import { chatSiteForUrl, chatSiteNames, CHAT_ORIGINS, CHAT_SITES } from './sites';

describe('chatSiteForUrl', () => {
  it('recognises Claude and ChatGPT pages', () => {
    expect(chatSiteForUrl('https://claude.ai/new')?.id).toBe('claude');
    expect(chatSiteForUrl('https://claude.ai/chat/0b1c')?.id).toBe('claude');
    expect(chatSiteForUrl('https://chatgpt.com/')?.id).toBe('chatgpt');
    expect(chatSiteForUrl('https://chat.openai.com/c/123')?.id).toBe('chatgpt');
  });

  it('rejects other sites, look-alikes, http and junk', () => {
    expect(chatSiteForUrl('https://example.com/')).toBeNull();
    expect(chatSiteForUrl('https://claude.ai.evil.com/')).toBeNull();
    expect(chatSiteForUrl('https://notclaude.ai/')).toBeNull();
    expect(chatSiteForUrl('http://claude.ai/')).toBeNull();
    expect(chatSiteForUrl('chrome://extensions')).toBeNull();
    expect(chatSiteForUrl('not a url')).toBeNull();
    expect(chatSiteForUrl(undefined)).toBeNull();
  });
});

describe('origins', () => {
  it('cover every host of every site', () => {
    for (const site of CHAT_SITES) {
      for (const host of site.hosts) expect(CHAT_ORIGINS).toContain(`https://${host}/*`);
    }
  });
  it('names read naturally', () => {
    expect(chatSiteNames()).toBe('Claude or ChatGPT');
  });
});
