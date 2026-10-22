// The product's identity lives only here, so the planned rename is a one-file change.
export const BRAND_NAME = 'KidTube';
export const WORDMARK = BRAND_NAME.toUpperCase();
export const TAGLINE = 'A little channel. A big imagination.';
export const ENDORSEMENT = 'by Smart Solutions';
export const DEFAULT_ACCENT = '#FF5C2B';

// What {{brand.<name>}} tokens in served HTML become.
export const BRAND_TOKENS = Object.freeze({
  name: BRAND_NAME, wordmark: WORDMARK, tagline: TAGLINE, endorsement: ENDORSEMENT, accent: DEFAULT_ACCENT,
});

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Fills the {{brand.<name>}} tokens in a page; an unknown token is left as it is.
export const fillBrand = html => html.replace(/\{\{brand\.(\w+)\}\}/g,
  (token, name) => Object.hasOwn(BRAND_TOKENS, name) ? escapeHtml(BRAND_TOKENS[name]) : token);
