'use strict';
// Text folding + tokenizing + keyword matching (SPEC section 5).

const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };

// Returns the folded (lowercase, accent-free) string. Non-alphanumerics are kept.
function normalize(text) {
  let s = String(text == null ? '' : text).replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();
  s = s.replace(/[çğıöşüâîû]/g, (c) => FOLD[c]);
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenize(text) {
  return normalize(text).match(/[a-z0-9]+/g) || [];
}

// Compile a keyword once: { raw, toks, exact } or null when it has no tokens.
function compileKeyword(kw) {
  let s = String(kw == null ? '' : kw).trim();
  let exact = false;
  if (s.startsWith('=')) { exact = true; s = s.slice(1); }
  const toks = tokenize(s);
  if (!toks.length) return null;
  return { raw: String(kw).trim(), toks, exact };
}

// Short keywords (< 4 letters) only match exactly, except when the rest of the token is a
// common inflectional suffix (Turkish plural/case/possessive, English plural). This lets
// "kol" match "kollar"/"kolu" and "arm" match "arms" without "kol" matching "kolay".
// Suffixes are in folded form (ı→i, ü→u, ...).
const SHORT_SUFFIXES = new Set([
  's', 'es',
  'lar', 'ler', 'lari', 'leri', 'larin', 'lerin', 'larda', 'lerde', 'lardan', 'lerden', 'lara', 'lere',
  'i', 'u', 'a', 'e', 'in', 'un', 'nin', 'nun', 'yi', 'yu', 'ya', 'ye',
  'da', 'de', 'ta', 'te', 'dan', 'den', 'tan', 'ten',
  'la', 'le', 'yla', 'yle', 'si', 'su', 'im', 'um', 'imiz', 'umuz', 'in', 'ini', 'unu', 'li', 'lu',
]);

function shortMatch(token, k) {
  if (token === k) return true;
  if (token.length <= k.length || !token.startsWith(k)) return false;
  return SHORT_SUFFIXES.has(token.slice(k.length));
}

function tokenMatches(token, kwTok, exact) {
  if (exact) return token === kwTok;
  if (kwTok.length < 4) return shortMatch(token, kwTok);
  return token.startsWith(kwTok);
}

// tokens: array of text tokens; set: optional Set(tokens) for a fast exact path.
function matchKeyword(ck, tokens, set) {
  if (!ck) return false;
  const { toks, exact } = ck;
  if (toks.length === 1) {
    const k = toks[0];
    if (exact) return set ? set.has(k) : tokens.includes(k);
    if (k.length < 4) {
      if (set ? set.has(k) : tokens.includes(k)) return true;
      for (let i = 0; i < tokens.length; i++) if (shortMatch(tokens[i], k)) return true;
      return false;
    }
    for (let i = 0; i < tokens.length; i++) if (tokens[i].startsWith(k)) return true;
    return false;
  }
  const n = tokens.length - toks.length;
  for (let i = 0; i <= n; i++) {
    let ok = true;
    for (let j = 0; j < toks.length; j++) {
      if (!tokenMatches(tokens[i + j], toks[j], exact)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

module.exports = { normalize, fold: normalize, tokenize, tokens: tokenize, compileKeyword, matchKeyword, tokenMatches };
