/**
 * Best-effort persistence of a completed Q&A turn to the admin chat history.
 *
 * Fire-and-forget: the avatar/chat UX must never wait on or break because the
 * history log failed, so every error is swallowed (logged in dev only). The
 * actual write goes through our own `/api/chat-save` proxy so the backend URL
 * stays server-side.
 *
 * Scope: only the RAG/KB text path calls this today. The Gemini Live voice
 * path exposes no transcript, so those turns are not logged yet.
 */

/**
 * A stable session ID generated once per page load. All Q&A turns within the
 * same browser session share this ID so admin can group them into one session
 * view. Refreshing the page produces a new ID → new session.
 */
const SESSION_ID: string = (() => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  // Format as UUID v4 (RFC 4122 §4.4)
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
})();

export type ChatLogTurn = {
  question: string;
  answer: string;
  /** ISO 8601 - when the user's question started processing. */
  questionAt: string;
  /** ISO 8601 - when the answer finished streaming. */
  answerAt: string;
  /** Origin tag stored on the record so admin can tell web from Unity. */
  source?: string;
};

export function logChat(turn: ChatLogTurn): void {
  const question = turn.question.trim();
  const answer = turn.answer.trim();
  // A question with no answer is still worth storing: a skipped/interrupted turn
  // must appear in the admin chat history (the user did ask it). Only a missing
  // question is unloggable. The backend accepts an empty answer_body.
  if (!question) return;

  void fetch("/api/chat-save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: turn.source ?? "web",
      session_id: SESSION_ID,
      question_body: question,
      question_at: turn.questionAt,
      answer_body: answer,
      answer_at: turn.answerAt,
    }),
    keepalive: true,
  })
    .then(async (res) => {
      if (res.ok) return;
      const detail = await res.text().catch(() => "");
      console.warn("[chat-log] persist failed:", res.status, detail.slice(0, 200));
    })
    .catch((err) => {
      console.warn("[chat-log] persist request error:", err);
    });
}
