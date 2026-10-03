// User settings persisted in chrome.storage.local (the `storage` permission).

export interface Settings {
  pageMarkers: boolean;
}

const DEFAULTS: Settings = { pageMarkers: true };
const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await browser.storage.local.set({ [KEY]: settings });
  } catch {
    // Not critical: the setting just won't be remembered.
  }
}
