// Runs INSIDE the chat tab (claude.ai / chatgpt.com) via
// chrome.scripting.executeScript. Chrome serialises the function, so it must
// be self-contained: no imports, no outside variables, plain DOM only.
//
// It only puts text into the message box. It never presses Send.

export type InsertMethod = 'paste' | 'typed';

export type InsertResult = { ok: true; method: InsertMethod } | { ok: false; reason: 'no-composer' | 'rejected' };

export function insertIntoComposer(text: string): InsertResult {
  // Message boxes, most specific first: ChatGPT's and Claude's editors, then
  // any visible rich-text box, then a plain textarea.
  const selectors = [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea',
  ];
  const visible = (el: Element): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  let composer: HTMLElement | null = null;
  for (const selector of selectors) {
    composer = [...document.querySelectorAll(selector)].find(visible) ?? null;
    if (composer) break;
  }
  if (!composer) return { ok: false, reason: 'no-composer' };

  composer.focus();
  const textarea = composer instanceof HTMLTextAreaElement ? composer : null;
  if (!textarea) {
    // Put the caret at the end, after anything the user already typed.
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const before = textarea ? textarea.value : composer.textContent;

  // 1. A paste event: the path both apps handle best (Claude turns a long
  //    paste into an attachment card). If the app handles it, it calls
  //    preventDefault.
  const data = new DataTransfer();
  data.setData('text/plain', text);
  const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  composer.dispatchEvent(paste);
  if (paste.defaultPrevented) return { ok: true, method: 'paste' };

  // 2. Otherwise type it in, which editors treat like user input.
  if (textarea) {
    textarea.setRangeText(text, textarea.value.length, textarea.value.length, 'end');
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
  } else {
    // Deprecated, but still the only way to type into a rich-text editor
    // that the editor itself notices (it fires real beforeinput/input
    // events). Every current browser supports it.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('insertText', false, text);
  }
  const after = textarea ? textarea.value : composer.textContent;
  return after !== before ? { ok: true, method: 'typed' } : { ok: false, reason: 'rejected' };
}
