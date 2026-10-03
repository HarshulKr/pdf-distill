// Background service worker. (`browser` is WXT's typed alias for the chrome.* APIs.)
//
// Its only job is to make the toolbar button open the side panel. No document
// content is ever processed here: MV3 service workers can be terminated at any
// time, which would kill a long conversion. Heavy work runs in the side panel.
export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('PDF Distill: could not set side panel behaviour', error);
    });
});
