/**
 * Script-based language detection for picking the right Cloud TTS voice.
 *
 * Not a real NLP detector - just looks at the Unicode scripts present in the
 * string. That's enough for our use case because Gemini Flash answers in one
 * language at a time, and the question language is set by the prompt.
 *
 * Mixed-script handling: when both Latin letters and CJK ideographs appear
 * in the same string (e.g. an English answer with a JP glossary term in
 * parentheses - "You get annual paid leave (年次有給休暇) based on..."),
 * picks the majority script by character count. Without this, a single
 * parenthetical kanji term would route an EN answer to the cmn-CN voice
 * because plain-CJK was checked before Latin in the priority order.
 *
 * Traditional vs Simplified Chinese: when the text is CJK-dominant (no kana),
 * we look for Traditional-Chinese-exclusive characters (code points that exist
 * in TC but NOT in SC and NOT in the modern Japanese Jōyō kanji list).
 * Reliable TC indicators used: 們 國 學 發 對 來(U+4F86) 體 續
 * Common SC indicators: 们 国 学 发 对 来(U+6765)
 * If TC markers are found and SC markers are absent → `zhTW`.
 *
 * Priority order:
 *   1. Hangul   -> ko (unambiguous Korean script)
 *   2. Kana     -> ja (hiragana / katakana = definitive Japanese signal)
 *   3. Cyrillic -> ru
 *   4. Myanmar  -> my
 *   5. Devanagari -> ne
 *   6. Vietnamese precomposed tone block -> vi (before EN since VI uses Latin)
 *   7. CJK vs Latin majority:
 *      a. CJK dominant + TC markers (no SC markers) -> zhTW
 *      b. CJK dominant -> zh
 *      c. Latin dominant -> en
 *   8. CJK only (no Latin):
 *      a. TC markers (no SC markers) -> zhTW
 *      b. Otherwise -> zh
 *   9. Indonesian stop-word hints -> id
 *  10. Latin letters -> en
 *  11. Default -> ja (product's primary language)
 */

export type SupportedLang =
  | "ja"
  | "en"
  | "ko"
  | "zh"
  | "zhTW"
  | "ru"
  | "vi"
  | "id"
  | "my"
  | "ne"
  | "th"
  | "fil"
  | "pt";

const HANGUL = /[ㄱ-ㆎ가-힯]/;
const KANA_GLOBAL = /[぀-ヿ]/g; // hiragana + katakana
const CJK = /[一-鿿]/;
const CJK_GLOBAL = /[一-鿿]/g;
const LATIN_LETTER_GLOBAL = /[A-Za-z]/g;
const CYRILLIC = /[Ѐ-ӿ]/;
const MYANMAR = /[က-႟]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const THAI = /[฀-๿]/; // Thai has its own unique Unicode block
// Vietnamese: precomposed vowels-with-tone block (U+1EA0-U+1EF9 is essentially
// Vietnamese-exclusive) plus VI-specific base letters đ Đ ơ Ơ ư Ư. ă â ê ô
// can leak from EN loanwords (cafe, deja) but the precomposed block catches
// any sentence with actual Vietnamese tone marks.
const VIETNAMESE = /[Ạ-ỹĂăĐđƠơƯư]/;
const VIETNAMESE_PHRASES = /\b(?:xin chao|chao ban|cam on|tam biet|ban la ai|ban ten (?:la )?gi|ten ban la gi|ban khoe khong|gioi thieu|minh la|toi (?:ten la|la)|cho toi biet|ban co the)\b/i;

function hasVietnamese(text: string): boolean {
  return VIETNAMESE.test(text.normalize("NFC")) ||
    VIETNAMESE_PHRASES.test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

const TRAD_CHARS =
  "\u5011\u570B\u5B78\u767C\u5C0D\u4F86\u9AD4\u7E8C\u8ACB\u554F\u7D04\u8207\u500B\u70BA\u9019\u9EDE\u8AAA\u5BE6\u5340\u842C\u865F\u7063\u9F8D\u61C9\u7D93\u904E\u7A2E\u6A23\u5F9E\u8655\u958B\u95DC\u6703\u7E3D\u64DA\u53C3\u9EBC\u55CE\u5152\u5EE3\u5716\u5C07\u8B49\u8A8D\u8B58\u8A9E\u8B80\u5BEB\u5C6C\u9EE8\u6B72\u6B0A\u6B61\u89C0\u6230\u7FA9\u91AB\u6A02\u6771\u8ECA\u99AC\u9B5A\u9CE5\u98A8\u52D5\u8A71\u9580\u9593\u6642\u52D9\u8CC7\u8A08\u7D71\u8ABF\u52E2\u9322\u7D66\u7D50\u7D42\u7DDA\u7D19\u7D30\u5C08\u8F49\u50B3\u7BC0\u570D\u5834\u9F4A\u55AE\u56B4\u8072\u6200\u611B\u7C21\u9AD4\u50F9\u96BB";
const SIMP_CHARS =
  "\u4EEC\u56FD\u5B66\u53D1\u5BF9\u6765\u4F53\u7EED\u8BF7\u95EE\u7EA6\u4E0E\u4E2A\u4E3A\u8FD9\u70B9\u8BF4\u5B9E\u533A\u4E07\u53F7\u6E7E\u9F99\u5E94\u7ECF\u8FC7\u79CD\u6837\u4ECE\u5904\u5F00\u5173\u4F1A\u603B\u636E\u53C2\u4E48\u5417\u513F\u5E7F\u56FE\u5C06\u8BC1\u8BA4\u8BC6\u8BED\u8BFB\u5199\u5C5E\u515A\u5C81\u6743\u6B22\u89C2\u6218\u4E49\u533B\u4E50\u4E1C\u8F66\u9A6C\u9C7C\u9E1F\u98CE\u52A8\u8BDD\u95E8\u95F4\u65F6\u52A1\u8D44\u8BA1\u7EDF\u8C03\u52BF\u94B1\u7ED9\u7ED3\u7EC8\u7EBF\u7EB8\u7EC6\u4E13\u8F6C\u4F20\u8282\u56F4\u573A\u9F50\u5355\u4E25\u58F0\u604B\u7231\u7B80\u4F53\u4EF7\u53EA";

// Decide Traditional vs Simplified for a CJK-dominant string by counting
// variant-distinctive characters. Ties (and texts with none) fall back to
// Simplified - the more common default - so a stray shared glyph does not
// over-flag Traditional.
function chineseVariant(text: string): "zhTW" | "zh" {
  let trad = 0;
  let simp = 0;
  for (const ch of text) {
    if (TRAD_CHARS.includes(ch)) trad++;
    else if (SIMP_CHARS.includes(ch)) simp++;
  }
  return trad > simp ? "zhTW" : "zh";
}

// Indonesian has no unique script - rely on common stop words AND common
// business/everyday words. Word-boundary matched so short fragments don't
// false-positive. Case-insensitive.
const INDONESIAN_HINTS =
  /\b(yang|dan|saya|ini|itu|untuk|dengan|tidak|adalah|dari|akan|sudah|atau|bukan|tetapi|sebagai|pada|dalam|kami|kita|anda|bagaimana|kapan|dimana|mengapa|berapa|tolong|terima|maaf|selamat|cuti|izin|kantor|pegawai|karyawan|peraturan|prosedur|apakah|silakan|mohon|bisa|boleh|harus|sudah|belum|juga|karena|sehingga|namun|namanya|mereka|kami|kita|sini|sana)\b/i;
// Filipino/Tagalog has no unique script (Latin). Match distinctive function
// words + common business/everyday words; word-boundary matched, case-insensitive.
// Risky 2-letter particles (po/ba/oo) are omitted to avoid false positives.
const FILIPINO_HINTS =
  /\b(ang|mga|ako|ikaw|siya|kami|kayo|sila|niya|natin|namin|hindi|salamat|kumusta|paano|saan|kailan|bakit|magkano|ilan|araw|trabaho|bayad|bakasyon|pwede|puwede|gusto|kailangan|naman|talaga|ngayon|kasi|dahil|nang|ito|iyon|maaari)\b/i;
// Portuguese (Brazil) - Latin with distinctive accented words. The accented
// stop words (não/você/férias/salário) double as a script hint; Vietnamese is
// already matched earlier so its tone marks won't reach here.
const PORTUGUESE_HINTS =
  /\b(você|vocês|não|sim|obrigad[oa]|quantos|quantas|quando|onde|porque|qual|dias|férias|trabalho|salário|posso|preciso|gostaria|também|muito|então|porém|está|estão|são|fazer|tenho|minha|isso|empresa|funcionário|regras|procedimento|saudação|olá)\b/i;
const LATIN_LETTER = /[A-Za-z]/;
const ENGLISH_GREETING = /^(?:(?:hi|hello|hey)(?: there)?|good (?:morning|afternoon|evening|night)|how are you|thank you|thanks|bye|goodbye)[\s\p{P}]*$/iu;

export function detectLang(text: string): SupportedLang {
  if (!text) return "ja";
  if (HANGUL.test(text)) return "ko";
  if (CYRILLIC.test(text)) return "ru";
  if (MYANMAR.test(text)) return "my";
  if (DEVANAGARI.test(text)) return "ne";
  if (THAI.test(text)) return "th";
  if (hasVietnamese(text)) return "vi";
  // Mixed Japanese/CJK + Latin: pick the DOMINANT side by character count.
  // Counting kana here (not just kanji) is what keeps an English answer that
  // mentions a katakana proper noun - e.g. "ワイズプランニング offers paid
  // leave" - voiced as English instead of being short-circuited to "ja" by a
  // single kana char. Conversely a Japanese answer with an English loanword
  // stays "ja" because the Japanese side dominates.
  const kanaCount = (text.match(KANA_GLOBAL) || []).length;
  const cjkCount = (text.match(CJK_GLOBAL) || []).length;
  const latinCount = (text.match(LATIN_LETTER_GLOBAL) || []).length;
  const jpCjkCount = kanaCount + cjkCount;
  if (jpCjkCount > 0 && latinCount > 0) {
    if (jpCjkCount > latinCount) {
      // Japanese/CJK side wins. Kana present => definitely Japanese; otherwise
      // it is Chinese (decide the variant).
      return kanaCount > 0 ? "ja" : chineseVariant(text);
    }
    return "en";
  }
  if (kanaCount > 0) return "ja";
  if (cjkCount > 0) return chineseVariant(text);
  if (PORTUGUESE_HINTS.test(text)) return "pt";
  if (FILIPINO_HINTS.test(text)) return "fil";
  if (INDONESIAN_HINTS.test(text)) return "id";
  if (latinCount > 0) return "en";
  return "ja";
}

export type LangDetection = { lang: SupportedLang; confident: boolean };

/**
 * Like detectLang, but also reports whether the detection is reliable enough
 * to FORCE the answer language. Unambiguous scripts (Hangul, kana, Cyrillic,
 * Myanmar, Devanagari, Vietnamese tone marks) and strong Indonesian stop-word
 * hits are confident. Common English greetings are also recognized directly.
 * For ambiguous Latin text, an English preference confirms the English guess.
 * Other ambiguous text, such as CJK without kana, returns a best guess with
 * `confident=false` so the caller can mirror the current question.
 */
export function detectLangConfident(text: string, preferred?: SupportedLang | null): LangDetection {
  if (!text) return { lang: "ja", confident: false };
  if (HANGUL.test(text)) return { lang: "ko", confident: true };
  if (CYRILLIC.test(text)) return { lang: "ru", confident: true };
  if (MYANMAR.test(text)) return { lang: "my", confident: true };
  if (DEVANAGARI.test(text)) return { lang: "ne", confident: true };
  if (THAI.test(text)) return { lang: "th", confident: true };
  if (hasVietnamese(text)) return { lang: "vi", confident: true };
  const kanaCount = (text.match(KANA_GLOBAL) || []).length;
  const cjkCount = (text.match(CJK_GLOBAL) || []).length;
  const latinCount = (text.match(LATIN_LETTER_GLOBAL) || []).length;
  const jpCjkCount = kanaCount + cjkCount;
  if (jpCjkCount > 0 && latinCount > 0) {
    // Mixed script - decide by the dominant side. Counting kana (not just kanji)
    // stops a single katakana proper noun in an otherwise-English question from
    // forcing a Japanese answer. Japanese side dominant + kana present => a
    // confident Japanese question; everything else stays unforced (mirror).
    if (jpCjkCount > latinCount) {
      return kanaCount > 0
        ? { lang: "ja", confident: true }
        : { lang: chineseVariant(text), confident: false };
    }
    return { lang: "en", confident: false };
  }
  // Kana-only (no Latin) is definitively Japanese.
  if (kanaCount > 0) return { lang: "ja", confident: true };
  // CJK-only kanji without kana is ambiguous between ja / zh / zhTW for short
  // strings, so keep the variant guess but don't hard-force it.
  if (cjkCount > 0) return { lang: chineseVariant(text), confident: false };
  if (PORTUGUESE_HINTS.test(text)) return { lang: "pt", confident: true };
  if (FILIPINO_HINTS.test(text)) return { lang: "fil", confident: true };
  if (INDONESIAN_HINTS.test(text)) return { lang: "id", confident: true };
  // Common English greetings are identifiable even with just one word. For
  // other ambiguous Latin text, the English UI preference can confirm English.
  if (latinCount > 0) {
    return { lang: "en", confident: preferred === "en" || ENGLISH_GREETING.test(text.trim()) };
  }
  // No recognizable script at all (Thai, Arabic, Hebrew, etc. - languages we
  // have no voice for). FORCE the Japanese fallback rather than mirroring: a
  // mirrored answer would be in a language the TTS can't voice, and feeding it
  // to the multilingual Fish voice makes it code-switch (the Thai+Japanese
  // mixed-audio bug). Confident=true so the answer is written in Japanese and
  // read by the Japanese voice cleanly. (Languages we DO add later - th/fil/pt
  // - are detected above this line and keep their own voice.)
  return { lang: "ja", confident: true };
}

/** Prefer recognizable reply text, using the speech input hint for ambiguous text. */
export function detectSpeechLang(reply: string, hint?: SupportedLang | null): SupportedLang {
  const { lang, confident } = detectLangConfident(reply);
  return confident ? lang : (hint ?? lang);
}

export function hasReplyLanguageConflict(reply: string, expected: SupportedLang): boolean {
  // A short Japanese clause can be hidden by a longer English reply's script
  // majority. Small-talk responses in English should use English throughout.
  if (expected === "en" && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(reply)) return true;
  const detected = detectLangConfident(reply);
  return detected.confident && detected.lang !== expected;
}

/**
 * Map a Chirp STT BCP-47 language code (e.g. "th-TH", "cmn-Hans-CN") to one of
 * our SupportedLang codes, or null when we don't voice that language. Used on
 * the mic path: Chirp's spoken-language detection is far more reliable than
 * script-guessing a short transcript (it tells fil/pt/en apart, which share the
 * Latin script), so when it maps to a supported language we trust it over
 * detectLang(). Unmapped codes return null -> caller falls back to detectLang.
 */
export function sttLangToSupported(bcp47: string): SupportedLang | null {
  const code = bcp47.trim().toLowerCase();
  if (!code) return null;
  // Chinese: script subtag (Hans/Hant) or region decides simplified vs
  // traditional. cmn-*/zh-*/yue-* all appear depending on the recognizer.
  if (code.startsWith("zh") || code.startsWith("cmn") || code.startsWith("yue")) {
    if (
      code.includes("hant") ||
      code.includes("tw") ||
      code.includes("hk") ||
      code.includes("mo")
    ) {
      return "zhTW";
    }
    return "zh";
  }
  const prefix = code.split("-")[0];
  const MAP: Record<string, SupportedLang> = {
    ja: "ja",
    en: "en",
    ko: "ko",
    ru: "ru",
    vi: "vi",
    id: "id",
    my: "my",
    ne: "ne",
    th: "th",
    fil: "fil",
    tl: "fil", // Tagalog - Chirp may return either fil-* or tl-*
    pt: "pt", // pt-BR / pt-PT both -> our Brazilian voice
  };
  return MAP[prefix] ?? null;
}


/**
 * Cloud TTS voice + languageCode for each detected language.
 * Voice picks favour Neural2 / WaveNet female voices to match the avatar's
 * persona (Fujisaki Reina = young female). Falls back to Standard for
 * languages where higher tiers are not yet available (my-MM, ne-NP).
 */
export const VOICE_FOR_LANG: Record<
  SupportedLang,
  { voice: string; languageCode: string }
> = {
  ja: { voice: "ja-JP-Neural2-B", languageCode: "ja-JP" },
  en: { voice: "en-US-Neural2-H", languageCode: "en-US" },
  ko: { voice: "ko-KR-Neural2-A", languageCode: "ko-KR" },
  zh: { voice: "cmn-CN-Wavenet-A", languageCode: "cmn-CN" },
  // Traditional Chinese (Taiwan) — cmn-TW-Wavenet-A confirmed in GCP docs.
  zhTW: { voice: "cmn-TW-Wavenet-A", languageCode: "cmn-TW" },
  ru: { voice: "ru-RU-Wavenet-C", languageCode: "ru-RU" },
  vi: { voice: "vi-VN-Neural2-A", languageCode: "vi-VN" },
  id: { voice: "id-ID-Wavenet-D", languageCode: "id-ID" },
  my: { voice: "my-MM-Standard-A", languageCode: "my-MM" },
  ne: { voice: "ne-NP-Standard-A", languageCode: "ne-NP" },
  // Added 2026-06-28. All three verified live against Google Cloud TTS (200 +
  // PCM) and are FEMALE Neural2 voices to match the avatar persona.
  th: { voice: "th-TH-Neural2-C", languageCode: "th-TH" },
  fil: { voice: "fil-PH-Neural2-A", languageCode: "fil-PH" },
  pt: { voice: "pt-BR-Neural2-A", languageCode: "pt-BR" },
};

/**
 * Male-avatar voice overrides (2026-06-28). Only languages with a distinct male
 * voice are listed; `voiceFor()` falls back to the female voice above for any
 * language without one. All Google voices verified live (200 + PCM):
 *   - ja routes to Fish (Eita) when enabled; this Google voice is the no-Fish
 *     fallback.
 *   - th has no male Neural2/Standard voice, so it uses a Chirp3-HD male voice.
 *   - my/ne go through Azure - their male voices live in azure-speech-tts.ts
 *     (picked there from languageCode + gender), so they are NOT listed here;
 *     voiceFor returns their female entry but its `voice` field is ignored on
 *     the Azure path.
 */
const MALE_VOICE_FOR_LANG: Partial<
  Record<SupportedLang, { voice: string; languageCode: string }>
> = {
  ja: { voice: "ja-JP-Neural2-D", languageCode: "ja-JP" },
  en: { voice: "en-US-Neural2-D", languageCode: "en-US" },
  ko: { voice: "ko-KR-Neural2-C", languageCode: "ko-KR" },
  zh: { voice: "cmn-CN-Wavenet-C", languageCode: "cmn-CN" },
  zhTW: { voice: "cmn-TW-Wavenet-C", languageCode: "cmn-TW" },
  ru: { voice: "ru-RU-Wavenet-D", languageCode: "ru-RU" },
  vi: { voice: "vi-VN-Neural2-D", languageCode: "vi-VN" },
  id: { voice: "id-ID-Wavenet-B", languageCode: "id-ID" },
  fil: { voice: "fil-PH-Neural2-D", languageCode: "fil-PH" },
  pt: { voice: "pt-BR-Neural2-B", languageCode: "pt-BR" },
  th: { voice: "th-TH-Chirp3-HD-Charon", languageCode: "th-TH" },
};

/**
 * Resolve the TTS voice for a language + avatar gender. Female is the base set;
 * male uses an override when one exists, otherwise falls back to the female
 * voice (my/ne, whose male voice is Azure-side and re-picked there from the
 * languageCode + gender).
 */
export function voiceFor(
  lang: SupportedLang,
  gender: "male" | "female",
): { voice: string; languageCode: string } {
  if (gender === "male") return MALE_VOICE_FOR_LANG[lang] ?? VOICE_FOR_LANG[lang];
  return VOICE_FOR_LANG[lang];
}

/**
 * Bridge the i18n locale vocabulary to the `SupportedLang` vocabulary.
 *
 * These are two different code sets and the overlap is a trap: `ja` and `en`
 * spell the same in both, so code that conflates them looks correct until
 * Traditional Chinese shows up. The UI locale is BCP-47 (`zh-TW`) while
 * `SupportedLang` uses `zhTW`, so a raw `locale in SOME_LANG_MAP` lookup
 * silently misses for Taiwan only.
 *
 * That exact bug shipped: the mic default did `locale in STREAM_STT_CODE`, so
 * a zh-TW UI fell through to "auto" - losing live interim transcription on the
 * one deployment that had asked for it. Route every locale -> lang conversion
 * through here instead of indexing by the locale string.
 */
/** Every SupportedLang as a runtime array. Derived from the exhaustive
 *  `Record<SupportedLang, ...>` above, so adding a language to the union
 *  forces it in here too - no hand-maintained list to drift. */
export const SUPPORTED_LANGS = Object.keys(VOICE_FOR_LANG) as SupportedLang[];

export function localeToSupportedLang(locale: string): SupportedLang | null {
  const MAP: Record<string, SupportedLang> = {
    ja: "ja",
    en: "en",
    vi: "vi",
    "zh-TW": "zhTW",
  };
  return Object.hasOwn(MAP, locale) ? MAP[locale] : null;
}
