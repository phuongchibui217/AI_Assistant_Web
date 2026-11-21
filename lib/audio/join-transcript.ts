/**
 * Join two pieces of transcript text.
 *
 * Used both inside one utterance (the streaming engine commits several final
 * segments for a long sentence) and across utterances (the mic appends to
 * whatever is already sitting in the input, so pausing mid-question does not
 * wipe what you already dictated).
 *
 * Japanese does not put spaces between words, so a space is only inserted when
 * the boundary is NOT between two CJK characters. The CJK range includes
 * CJK punctuation (、。！？「」) so "こんにちは。" + "聞こえますか" joins cleanly.
 */

const CJK_RE =
  /[、-〿぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

export function joinTranscript(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const lastA = a[a.length - 1];
  const firstB = b[0];
  if (CJK_RE.test(lastA) && CJK_RE.test(firstB)) return a + b;
  return `${a} ${b}`;
}
