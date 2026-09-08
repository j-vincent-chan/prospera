/**
 * The HTML named character references, in one table.
 *
 * Six decoders in this repo each carried their own subset — `nih-guide/parse.ts`
 * knew twenty-eight names, `announcement/text.ts` thirteen, `formatting/html.ts`
 * and `ai/source-document-url-enrichment.ts` six, `ucsf-news-ingest.ts` five and
 * `fit/goldset/excerpt.ts` two — so which characters survived into text depended
 * on which pipeline had read the page. Measured on the 74 open NSF solicitations
 * while PR 5.4 was being built, 72 references survived verbatim into the sectioned
 * announcement text the fit extractor reads: `&sect;` sixty of them, most of those
 * `25 U.S.C. &sect;&sect; 5130-5131` in an eligibility block, then `&reg;`,
 * `&shy;`, `&deg;` and `&trade;`.
 *
 * The table is the HTML 4.01 entity sets — Latin-1, symbols, special — plus
 * `apos`, which XHTML added and every browser accepts: 253 names. It stops short
 * of the WHATWG's 2,231 deliberately. The remainder are mathematical and
 * typographic references a funding announcement does not carry, and a table a
 * reviewer can read in one screen is worth more here than exhaustiveness; a name
 * that is missing survives verbatim, exactly as it does today, so the failure mode
 * of stopping early is the one we already have. Values were taken from the WHATWG
 * named-character-reference table rather than typed by hand — the Latin-1 block is
 * U+00A0–U+00FF in DTD order, which is how to check it — and characters that are
 * invisible in an editor are written as escapes.
 *
 * Decoding *policy* is not in here. `decodeEntityReferences` resolves a reference
 * to the character the standard says it is; a caller that wants something else
 * passes `overrides`. The announcement pipeline folds curly quotes to ASCII and
 * drops soft hyphens because it is preparing text for a model rather than for a
 * reader, and that belongs to the pipeline, not to the table.
 *
 * `ingestion/nih-guide/parse.ts` keeps its own 28 names on purpose. The Guide's
 * sectioned text is what `announcementTextHash` hashes for every NIH notice, and
 * `npm run fit:nih-invariant` exists to hold that output still; widening it is a
 * change with its own evidence to produce, not a side effect of this one.
 */

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** Name → the single character it stands for. Exact case: `&Alpha;` is Α and `&alpha;` is α. */
export const HTML_ENTITIES: Readonly<Record<string, string>> = {
  // HTMLlat1 — U+00A0 to U+00FF, in order.
  nbsp: "\u00a0", iexcl: "¡", cent: "¢", pound: "£", curren: "¤", yen: "¥", brvbar: "¦", sect: "§",
  uml: "¨", copy: "©", ordf: "ª", laquo: "«", not: "¬", shy: "\u00ad", reg: "®", macr: "¯",
  deg: "°", plusmn: "±", sup2: "²", sup3: "³", acute: "´", micro: "µ", para: "¶", middot: "·",
  cedil: "¸", sup1: "¹", ordm: "º", raquo: "»", frac14: "¼", frac12: "½", frac34: "¾", iquest: "¿",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ", Ccedil: "Ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë", Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  ETH: "Ð", Ntilde: "Ñ", Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", times: "×",
  Oslash: "Ø", Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý", THORN: "Þ", szlig: "ß",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ", ccedil: "ç",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë", igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  eth: "ð", ntilde: "ñ", ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", divide: "÷",
  oslash: "ø", ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", thorn: "þ", yuml: "ÿ",
  // HTMLsymbol — Greek, mathematics, arrows, and the typographic marks HTML 4.01 grouped with them.
  fnof: "ƒ", Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ", Eta: "Η",
  Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ", Nu: "Ν", Xi: "Ξ", Omicron: "Ο",
  Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ", Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ",
  Omega: "Ω", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο",
  pi: "π", rho: "ρ", sigma: "σ", sigmaf: "ς", tau: "τ", upsilon: "υ", phi: "φ", chi: "χ",
  psi: "ψ", omega: "ω", thetasym: "ϑ", upsih: "ϒ", piv: "ϖ", bull: "•", hellip: "…", prime: "′",
  Prime: "″", oline: "‾", frasl: "⁄", weierp: "℘", image: "ℑ", real: "ℜ", trade: "™", alefsym: "ℵ",
  larr: "←", uarr: "↑", rarr: "→", darr: "↓", harr: "↔", crarr: "↵", lArr: "⇐", uArr: "⇑",
  rArr: "⇒", dArr: "⇓", hArr: "⇔", forall: "∀", part: "∂", exist: "∃", empty: "∅", nabla: "∇",
  isin: "∈", notin: "∉", ni: "∋", prod: "∏", sum: "∑", minus: "−", lowast: "∗", radic: "√",
  prop: "∝", infin: "∞", ang: "∠", and: "∧", or: "∨", cap: "∩", cup: "∪", int: "∫",
  there4: "∴", sim: "∼", cong: "≅", asymp: "≈", ne: "≠", equiv: "≡", le: "≤", ge: "≥",
  sub: "⊂", sup: "⊃", nsub: "⊄", sube: "⊆", supe: "⊇", oplus: "⊕", otimes: "⊗", perp: "⊥",
  sdot: "⋅", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", lang: "⟨", rang: "⟩", loz: "◊",
  spades: "♠", clubs: "♣", hearts: "♥", diams: "♦",
  // HTMLspecial — markup-significant characters, internationalisation, and dashes and quotes; `apos` is XHTML's.
  quot: "\"", amp: "&", apos: "'", lt: "<", gt: ">", OElig: "Œ", oelig: "œ", Scaron: "Š",
  scaron: "š", Yuml: "Ÿ", circ: "ˆ", tilde: "˜", ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c",
  zwj: "\u200d", lrm: "\u200e", rlm: "\u200f", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", dagger: "†", Dagger: "‡", permil: "‰", lsaquo: "‹", rsaquo: "›",
  euro: "€",
};

/**
 * Numeric references in 0x80–0x9F name Windows-1252 characters, not the C1
 * controls their code points are — what HTML5 § 13.2.5.80 requires, and what
 * `nih-guide/parse.ts` already does for the `&#147;` … `&#151;` the Guide emits.
 * Without this a curly quote written numerically decodes to an invisible control
 * character and travels the whole way into the extractor's prompt.
 */
const CP1252: Readonly<Record<number, string>> = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ",
  137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž", 145: "‘", 146: "’", 147: "“",
  148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›",
  156: "œ", 158: "ž", 159: "Ÿ",
};

/**
 * Lowercase name → the one entity that folds to it, for the names where that is
 * unambiguous. HTML entity names are case-sensitive, but the tables this replaces
 * matched case-insensitively, so `&NBSP;` and `&MDASH;` decoded and must go on
 * decoding. Derived rather than listed: a fold shared by two entities (`Alpha` and
 * `alpha`, `Prime` and `prime`, `ETH` and `eth`) is dropped, so `&ALPHA;` resolves
 * to neither and survives verbatim rather than silently becoming the wrong letter.
 */
const BY_FOLDED_NAME: ReadonlyMap<string, string> = (() => {
  const seen = new Map<string, string | null>();
  for (const name of Object.keys(HTML_ENTITIES)) {
    const folded = name.toLowerCase();
    seen.set(folded, seen.has(folded) ? null : name);
  }
  const out = new Map<string, string>();
  for (const [folded, name] of seen) if (name !== null) out.set(folded, name);
  return out;
})();

/** The table's name for a reference as written, or `undefined` when nothing matches. */
function canonicalName(name: string): string | undefined {
  if (hasOwn(HTML_ENTITIES, name)) return name;
  return BY_FOLDED_NAME.get(name.toLowerCase());
}

/**
 * A named reference is `&` + a letter + up to 31 more letters or digits + `;`.
 * The terminating semicolon is required. HTML5 does resolve a short legacy list
 * without one, but guessing costs more than it recovers in this text: `AT&T` and
 * `R&D` are how announcements are actually written, and `&not` inside `AT&notice`
 * is a likelier read than a malformed reference. Every reference in every page
 * measured for PR 5.4 was terminated.
 */
const REFERENCE = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{0,31});/g;

/**
 * Resolve every character reference in one pass.
 *
 * One pass is the point: replacing `&amp;` and then `&sect;` in sequence turns the
 * literal text `&amp;sect;` into `§`, which is a different document from the one
 * the funder published. Scanning once and never re-reading the output leaves it as
 * the `&sect;` it says.
 *
 * `overrides` is consulted first, by the table's own name for the reference, so a
 * caller can say what `nbsp` or `rsquo` should become in *its* text without
 * forking the table. An override to `""` deletes the character.
 *
 * A reference this table does not know — a name outside HTML 4.01, a code point
 * outside Unicode, a lone surrogate — is left exactly as it was written. That is
 * the same outcome as not having decoded it, which is the behaviour every caller
 * already tolerates, and it never invents a character.
 */
export function decodeEntityReferences(input: string, overrides: Readonly<Record<string, string>> = {}): string {
  return input.replace(REFERENCE, (reference: string, body: string) => {
    if (body.charCodeAt(0) === 0x23 /* # */) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code)) return reference;
      if (hasOwn(CP1252, String(code))) return CP1252[code]!;
      if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return reference;
      return String.fromCodePoint(code);
    }
    const name = canonicalName(body);
    if (name === undefined) return reference;
    return hasOwn(overrides, name) ? overrides[name]! : HTML_ENTITIES[name]!;
  });
}
