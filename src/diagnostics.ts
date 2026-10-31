/** Called directly from a user gesture; the fallback also works inside a modal. */
export async function copyDiagnostics(text: string, host: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text; field.readOnly = true; field.className = 'clipboard-buffer';
    const previous = document.activeElement as HTMLElement | null;
    host.append(field); field.focus({ preventScroll: true }); field.select();
    field.setSelectionRange(0, field.value.length);
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { field.remove(); previous?.focus({ preventScroll: true }); }
  }
}

export function diagnosticContext() {
  return { time: new Date().toISOString(), browser: navigator.userAgent,
    page: location.origin + location.pathname, online: navigator.onLine, visibility: document.visibilityState,
    modulePreloadSupported: document.createElement('link').relList.supports?.('modulepreload') ?? false,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
}
