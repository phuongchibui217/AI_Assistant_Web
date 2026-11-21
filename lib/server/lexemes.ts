/**
 * Server-side fetch (fresh every call, with a last-known-good fallback on a
 * transient failure) for admin-managed lexemes (admin → /api/lexeme).
 * Lexemes adjust Cloud TTS pronunciation:
 *
 *   - `lexeme_type === 0` (phoneme override): wrap each occurrence of
 *     `grapheme` in `<phoneme alphabet="ipa" ph="...">` so the engine reads
 *     it with the operator-supplied IPA string.
 *   - `lexeme_type === 1` (alias / canonical override): replace `grapheme`
 *     with `canonical_grapheme` verbatim - useful for hard-to-read company
 *     names ("株式会社" -> "かぶしきがいしゃ") that the engine mispronounces
 *     in the original orthography.
 *
 * Both effects are applied at synthesis time by `applyLexemes()`. This
 * module just owns the fetch + cache. Falls back to `[]` on any error so
 * the TTS pipeline keeps working with engine defaults.
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

export type Lexeme = {
  grapheme: string;
  lexeme_type: 0 | 1;
  phoneme: string | null;
  canonical_grapheme: string | null;
};

function alias(grapheme: string, reading: string): Lexeme {
  return { grapheme, lexeme_type: 1, phoneme: null, canonical_grapheme: reading };
}

/**
 * Built-in readings for the avatar's OWN name (see persona.ts /
 * persona-male.ts). These are our product constants, not customer KB terms,
 * so they must read correctly out of the box - without an operator
 * remembering to add a dictionary entry, and surviving a KB wipe or a
 * rag-api hiccup. Client confirmed the official reading of 富士崎玲奈 is
 * "ふじさきれいな" (2026-07-15).
 *
 * Each name is listed in every surface form that can reach TTS:
 *   - spaced, as persona.ts + the system prompt write it ("富士崎 玲奈"),
 *   - unspaced, as the model may emit it ("富士崎玲奈"),
 *   - bare surname, as the greeting uses it ("富士崎です").
 * applyLexemes sorts by grapheme length, so a full name always matches before
 * the bare surname (no "ふじさき玲奈" splicing).
 *
 * Deliberately limited to the persona names. Customer/KB proper nouns (staff,
 * document terms) belong in the admin dictionary - guessing their readings
 * here would bake in a WRONG pronunciation. Admin entries override these
 * (see withBuiltins), so the operator can always correct us.
 */
const BUILTIN_LEXEMES: Lexeme[] = [
  alias("富士崎 玲奈", "ふじさき れいな"),
  alias("富士崎玲奈", "ふじさきれいな"),
  alias("富士崎", "ふじさき"),
  alias("一ノ瀬 瑛太", "いちのせ えいた"),
  alias("一ノ瀬瑛太", "いちのせえいた"),
  alias("一ノ瀬", "いちのせ"),
];

/** Admin-managed entries win over a built-in with the same grapheme. */
function withBuiltins(admin: Lexeme[]): Lexeme[] {
  const overridden = new Set(admin.map((lx) => lx.grapheme));
  return [
    ...admin,
    ...BUILTIN_LEXEMES.filter((b) => !overridden.has(b.grapheme)),
  ];
}

let inflight: Promise<Lexeme[]> | null = null;
// Last successfully fetched list. On a transient fetch failure we reuse this
// instead of returning [], so a brief rag-api hiccup mid-answer does not
// silently drop the dictionary for one sentence (feedback #48: "the
// dictionary sometimes does not apply"). null until the first success.
// Holds the ADMIN list only; built-ins are merged in on the way out.
let lastGood: Lexeme[] | null = null;

/** Returns the parsed lexeme list, or `null` when the fetch itself failed
 *  (network / non-200 / bad shape) - distinct from a genuinely empty list. */
async function fetchOnce(): Promise<Lexeme[] | null> {
  try {
    const res = await fetch(`${RAG_SERVICE_URL}/api/lexeme`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      lexemes?: Array<{
        grapheme?: unknown;
        lexeme_type?: unknown;
        phoneme?: unknown;
        canonical_grapheme?: unknown;
      }>;
    };
    if (!Array.isArray(json.lexemes)) return null;
    const out: Lexeme[] = [];
    for (const lx of json.lexemes) {
      if (typeof lx.grapheme !== "string" || lx.grapheme.length === 0) continue;
      const type = lx.lexeme_type === 1 ? 1 : 0;
      if (type === 0) {
        if (typeof lx.phoneme !== "string" || lx.phoneme.trim().length === 0) {
          continue;
        }
        out.push({
          grapheme: lx.grapheme,
          lexeme_type: 0,
          phoneme: lx.phoneme.trim(),
          canonical_grapheme: null,
        });
      } else {
        if (
          typeof lx.canonical_grapheme !== "string" ||
          lx.canonical_grapheme.trim().length === 0
        ) {
          continue;
        }
        out.push({
          grapheme: lx.grapheme,
          lexeme_type: 1,
          phoneme: null,
          canonical_grapheme: lx.canonical_grapheme.trim(),
        });
      }
    }
    return out;
  } catch {
    return null;
  }
}

export async function getLexemes(): Promise<Lexeme[]> {
  if (inflight) return inflight;
  inflight = fetchOnce()
    .then((result) => {
      // Genuine fetch (even an empty list) refreshes the cache so newly added
      // or deleted lexemes take effect immediately - no TTL staleness. Only a
      // failed fetch (null) falls back to the last good list. Either way the
      // built-in persona readings are merged in, so the avatar's own name
      // reads correctly even with an empty dictionary or a dead rag-api.
      if (result === null) return withBuiltins(lastGood ?? []);
      lastGood = result;
      return withBuiltins(result);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Plain-text alias substitution for TTS engines that can't parse SSML (Fish
 * Audio, Azure). Applies ONLY `lexeme_type === 1` (alias) entries, replacing
 * each grapheme with its canonical reading - e.g. a kanji name -> its kana
 * reading ("浅利" -> "あさと") - so a neural voice reads it correctly.
 *
 * `lexeme_type === 0` (IPA phoneme) entries are skipped: they need the
 * `<phoneme>` SSML tag the engine doesn't support. JP reading overrides are
 * naturally aliases (kanji -> kana), which is what the admin dictionary uses
 * for the mispronounced names this fixes. Returns the text unchanged when no
 * alias matches (Fish then reads the original answer).
 */
export function applyLexemesAlias(text: string, lexemes: Lexeme[]): string {
  const aliases = lexemes.filter(
    (lx) => lx.lexeme_type === 1 && lx.canonical_grapheme,
  );
  if (aliases.length === 0) return text;
  // Longer graphemes first so "松下幸之助" wins over a shorter "松下" entry.
  const sorted = [...aliases].sort(
    (a, b) => b.grapheme.length - a.grapheme.length,
  );
  const pattern = new RegExp(
    sorted.map((lx) => escapeRegex(lx.grapheme)).join("|"),
    "g",
  );
  return text.replace(
    pattern,
    (m) => sorted.find((l) => l.grapheme === m)?.canonical_grapheme ?? m,
  );
}

/**
 * Apply lexemes to a plain text sentence and return either:
 *   - `{ ssml: "<speak>...</speak>" }` if any lexeme matched, or
 *   - `null` if no lexeme matched (caller should fall back to plain text).
 *
 * Replacement order matters: longer graphemes first, so "株式会社" wins over a
 * shorter "会社" lexeme. Phoneme matches are wrapped; alias matches are
 * substituted with the canonical grapheme. Each non-match span is escaped
 * as plain XML text and concatenated into the final SSML body.
 */
export function applyLexemes(
  text: string,
  lexemes: Lexeme[],
): { ssml: string } | null {
  if (lexemes.length === 0) return null;
  const sorted = [...lexemes].sort(
    (a, b) => b.grapheme.length - a.grapheme.length,
  );
  const pattern = new RegExp(
    sorted.map((lx) => escapeRegex(lx.grapheme)).join("|"),
    "g",
  );

  let out = "";
  let cursor = 0;
  let matched = false;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > cursor) out += escapeXml(text.slice(cursor, idx));
    const grapheme = m[0];
    const lx = sorted.find((l) => l.grapheme === grapheme);
    if (!lx) {
      out += escapeXml(grapheme);
    } else if (lx.lexeme_type === 0 && lx.phoneme) {
      out += `<phoneme alphabet="ipa" ph="${escapeXml(lx.phoneme)}">${escapeXml(grapheme)}</phoneme>`;
      matched = true;
    } else if (lx.lexeme_type === 1 && lx.canonical_grapheme) {
      out += escapeXml(lx.canonical_grapheme);
      matched = true;
    } else {
      out += escapeXml(grapheme);
    }
    cursor = idx + grapheme.length;
  }
  if (cursor < text.length) out += escapeXml(text.slice(cursor));
  if (!matched) return null;
  return { ssml: `<speak>${out}</speak>` };
}
