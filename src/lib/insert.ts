// Insert the Markdown into the chat open in the current tab.
//
// Permissions: claude.ai and chatgpt.com are *optional* host permissions.
// Chrome asks the user the first time Insert is pressed; nothing else is
// ever requested, and the user can revoke access in chrome://extensions.

import { chatSiteForUrl, chatSiteNames, CHAT_ORIGINS, type ChatSite } from '@/core/insert/sites';
import { insertIntoComposer, type InsertMethod, type InsertResult } from './insert-page';

export type InsertOutcome = { ok: true; site: ChatSite; method: InsertMethod } | { ok: false; message: string };

/**
 * Must be called straight from the click handler: Chrome only shows the
 * permission prompt during a user gesture, so nothing may be awaited first.
 */
export async function insertIntoActiveChat(markdown: string): Promise<InsertOutcome> {
  const granted = await browser.permissions.request({ origins: CHAT_ORIGINS });
  if (!granted) {
    return { ok: false, message: `Access to ${chatSiteNames()} was not allowed, so nothing was inserted. Use Copy instead.` };
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const site = chatSiteForUrl(tab?.url);
  if (!tab?.id || !site) {
    return { ok: false, message: `Open ${chatSiteNames()} in this tab, then press Insert again.` };
  }

  let result: InsertResult | undefined;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: insertIntoComposer,
      args: [markdown],
    });
    result = injection?.result;
  } catch (error) {
    return { ok: false, message: `Could not reach the ${site.name} page: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!result?.ok) {
    return {
      ok: false,
      message: `Couldn't find the message box on this ${site.name} page. Open a chat (not settings or a project page) and try again, or use Copy.`,
    };
  }
  return { ok: true, site, method: result.method };
}
