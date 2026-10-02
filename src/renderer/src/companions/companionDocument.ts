/**
 * Companion renderer document mode — FASE 2 remediation.
 *
 * The companion windows load the same renderer bundle as the main app, whose global
 * stylesheet paints `html, body, #root` cream. In a companion window that turned the
 * transparent BrowserWindow into an opaque 340×340 panel. Companion mode is scoped to
 * `?companion=1`: it tags <html> and injects an override, so the main application's
 * appearance is untouched.
 */

export const COMPANION_DOCUMENT_CLASS = 'lp-companion';
export const COMPANION_STYLE_ID = 'lp-companion-transparent';

export const COMPANION_DOCUMENT_CSS = [
  `html.${COMPANION_DOCUMENT_CLASS},`,
  `html.${COMPANION_DOCUMENT_CLASS} body,`,
  `html.${COMPANION_DOCUMENT_CLASS} #root {`,
  '  background: transparent !important;',
  '  background-color: transparent !important;',
  '  background-image: none !important;',
  '}',
  `html.${COMPANION_DOCUMENT_CLASS} #cth-splash { display: none !important; }`
].join('\n');

export function isCompanionLocation(loc: { search?: string; hash?: string }): boolean {
  return (loc.search ?? '').includes('companion=1') || (loc.hash ?? '').includes('companion');
}

interface DocumentLike {
  documentElement: { classList: { add(name: string): void } };
  head: { appendChild(node: unknown): unknown };
  getElementById(id: string): { remove(): void } | null;
  createElement(tag: 'style'): { id: string; textContent: string | null };
}

/** Make this document a transparent companion surface. Idempotent. */
export function applyCompanionDocument(doc: DocumentLike): void {
  doc.documentElement.classList.add(COMPANION_DOCUMENT_CLASS);
  if (!doc.getElementById(COMPANION_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = COMPANION_STYLE_ID;
    style.textContent = COMPANION_DOCUMENT_CSS;
    doc.head.appendChild(style);
  }
  doc.getElementById('cth-splash')?.remove();
}
