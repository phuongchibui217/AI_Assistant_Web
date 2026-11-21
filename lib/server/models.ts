import "server-only";

/**
 * Gemini model IDs per role, overridable via environment variables so they can
 * be swapped without touching code - edit the env and restart the server, no
 * rebuild needed. Each default preserves the value that was previously
 * hardcoded, so leaving an env var unset changes nothing.
 *
 * Read at module load (same pattern as RAG_SERVICE_URL), which the Node server
 * evaluates at runtime from the container env.
 *
 * Env vars (all optional):
 *   RAG_ANSWER_MODEL     - RAG answer (the main tuned model)
 *   RAG_TRANSLATE_MODEL  - query -> Japanese translation for retrieval
 *   CLASSIFY_MODEL       - KB-vs-chat intent classifier
 *   CHITCHAT_MODEL       - non-KB chit-chat replies
 *   SUGGESTIONS_MODEL    - suggested follow-up questions
 *   NOD_MODEL            - aizuchi / nod cue
 */
export const RAG_ANSWER_MODEL = process.env.RAG_ANSWER_MODEL || "gemini-3.5-flash";
export const RAG_TRANSLATE_MODEL = process.env.RAG_TRANSLATE_MODEL || "gemini-2.5-flash";
export const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || "gemini-2.5-flash-lite";
export const CHITCHAT_MODEL = process.env.CHITCHAT_MODEL || "gemini-2.5-flash";
export const SUGGESTIONS_MODEL = process.env.SUGGESTIONS_MODEL || "gemini-2.5-flash-lite";
export const NOD_MODEL = process.env.NOD_MODEL || "gemini-2.5-flash-lite";
