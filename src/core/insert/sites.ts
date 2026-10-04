// Chat sites the Markdown can be inserted into.
//
// Access to these sites is an *optional* permission: nothing is granted at
// install time, and Chrome asks the user the first time they press Insert
// (DECISIONS.md D50).

export interface ChatSite {
  id: 'claude' | 'chatgpt';
  name: string;
  /** Match pattern for the optional host permission. */
  origin: string;
  hosts: string[];
}

export const CHAT_SITES: ChatSite[] = [
  { id: 'claude', name: 'Claude', origin: 'https://claude.ai/*', hosts: ['claude.ai'] },
  { id: 'chatgpt', name: 'ChatGPT', origin: 'https://chatgpt.com/*', hosts: ['chatgpt.com', 'chat.openai.com'] },
];

/** Every origin the extension may ask for (keep in sync with the manifest). */
export const CHAT_ORIGINS = ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*'];

/** The chat site a tab URL belongs to, or null. Only https is accepted. */
export function chatSiteForUrl(url: string | undefined): ChatSite | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return CHAT_SITES.find((s) => s.hosts.includes(parsed.hostname)) ?? null;
}

/** "Claude or ChatGPT", for messages. */
export function chatSiteNames(): string {
  const names = CHAT_SITES.map((s) => s.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}` : (names[0] ?? '');
}
