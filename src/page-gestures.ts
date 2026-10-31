/** Browser defaults must not move/scale the game's viewport. Pointer events
 * still reach map gestures, buttons and native panel scrolling unchanged. */
export function suppressBrowserGestures() {
  const abort = new AbortController();
  const options = { signal: abort.signal, capture: true, passive: false };
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  for (const type of ['dblclick', 'contextmenu', 'dragstart', 'gesturestart', 'gesturechange']) {
    // gesture* also covers Safari/WKWebView versions that ignore viewport zoom
    // limits. Do not cancel touchend: that would swallow rapid button clicks.
    document.addEventListener(type, prevent, options);
  }
  document.addEventListener('selectstart', event => {
    if (!(event.target instanceof Element && event.target.closest('.clipboard-buffer'))) prevent(event);
  }, options);
  document.addEventListener('wheel', event => { if (event.ctrlKey) prevent(event); }, options);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0'].includes(event.key)) prevent(event);
  }, options);
  return () => abort.abort();
}
