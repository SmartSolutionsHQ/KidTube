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
