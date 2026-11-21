/**
 * Server-side fetch + 60s cache for the currently active Assistant record
 * (admin → /assistants) AND its currently active Stance (admin → /assistant-
 * stances). Returns a normalised shape with the three fields the runtime
 * actually reads: `display_name` (avatar label), `greeting` (boot bubble),
 * and `system_instruction` (prepended to RAG + chitchat system prompts).
 *
 * `system_instruction` is the persona's instruction with the active stance's
 * tone/attitude/lexicon/precision/boundaries appended as a "# Active stance"
 * block - so the downstream callers (rag/ask, chitchat) don't need to know
 * anything about stances. Pick rule for active stance: highest `stance_id`
 * with `state === 1`. Falls back to `stance_id === 1` (default) if no other
 * is active. If neither, no stance block is appended.
 *
 * Falls back to `null` on any failure - callers should keep their own
 * hard-coded persona as a safety net so the AI never goes mute because
 * the admin DB hiccupped.
 */

const RAG_SERVICE_URL =
  process.env.RAG_SERVICE_URL?.replace(/\/+$/, "") || "http://127.0.0.1";

export type ActiveAssistant = {
  id: number;
  display_name: string;
  greeting: string | null;
  system_instruction: string | null;
  /** Full replacement for the hardcoded chitchat self-intro base prompt, read
   *  straight off this persona's `persona` JSON blob (key `chitchat_override`)
   *  so it travels with whichever assistant is active - unlike
   *  `system_instruction`, this is the BASE prompt itself, not an appended
   *  override layer. One template shared across both avatar genders: write
   *  `{{nameReading}}`/`{{profile}}`/`{{selfIntro}}` placeholders instead of
   *  hardcoding a name, and the caller fills them in per gender (avatar
   *  name/age/self-intro are a fixed per-gender fact, not persona-specific -
   *  no reason to duplicate the whole prompt twice per persona). null = no
   *  override, caller falls back to its own hardcoded default. */
  chitchat_override: string | null;
};

let inflight: Promise<ActiveAssistant | null> | null = null;

type StanceShape = {
  name?: unknown;
  state?: unknown;
  tone?: unknown;
  attitude?: unknown;
  lexicon_and_rhythm?: unknown;
  precision_and_brevity?: unknown;
  boundaries?: unknown;
};

function pickActiveStance(
  stances: Record<string, StanceShape>,
): { id: number; data: StanceShape } | null {
  const candidates: Array<{ id: number; data: StanceShape }> = [];
  for (const [idStr, data] of Object.entries(stances)) {
    const id = Number(idStr);
    if (Number.isNaN(id)) continue;
    if (data.state !== 1) continue;
    candidates.push({ id, data });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.id === 1 && b.id !== 1) return 1;
    if (b.id === 1 && a.id !== 1) return -1;
    return b.id - a.id;
  });
  return candidates[0];
}

function buildStanceBlock(stance: StanceShape): string | null {
  const fields: Array<[string, unknown]> = [
    ["Tone", stance.tone],
    ["Attitude", stance.attitude],
    ["Lexicon and rhythm", stance.lexicon_and_rhythm],
    ["Precision and brevity", stance.precision_and_brevity],
    ["Boundaries", stance.boundaries],
  ];
  const lines = fields
    .filter(([, v]) => typeof v === "string" && (v as string).trim().length > 0)
    .map(([k, v]) => `- ${k}: ${(v as string).trim()}`);
  if (lines.length === 0) return null;
  return `# Active stance\n${lines.join("\n")}`;
}

async function fetchStances(
  assistantId: number,
): Promise<Record<string, StanceShape> | null> {
  try {
    const res = await fetch(
      `${RAG_SERVICE_URL}/api/assistant-stances?assistant_id=${assistantId}`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, StanceShape>;
  } catch {
    return null;
  }
}

async function fetchOnce(): Promise<ActiveAssistant | null> {
  try {
    const res = await fetch(`${RAG_SERVICE_URL}/api/assistants`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, Record<string, unknown>>;
    const entries = Object.entries(json);
    if (entries.length === 0) return null;
    const [idStr, persona] = entries[0];
    const id = Number(idStr);
    if (Number.isNaN(id)) return null;
    const display = typeof persona.identity === "string" ? persona.identity : "";
    const greeting =
      typeof persona.greeting === "string" && persona.greeting.trim().length > 0
        ? persona.greeting.trim()
        : null;
    const baseInstruction =
      typeof persona.system_instruction === "string" &&
      persona.system_instruction.trim().length > 0
        ? persona.system_instruction.trim()
        : null;
    const chitchatOverride =
      typeof persona.chitchat_override === "string" &&
      persona.chitchat_override.trim().length > 0
        ? persona.chitchat_override.trim()
        : null;

    const stances = await fetchStances(id);
    let stanceBlock: string | null = null;
    if (stances) {
      const picked = pickActiveStance(stances);
      if (picked) stanceBlock = buildStanceBlock(picked.data);
    }

    const combined =
      baseInstruction && stanceBlock
        ? `${baseInstruction}\n\n${stanceBlock}`
        : (stanceBlock ?? baseInstruction);

    return {
      id,
      display_name: display,
      greeting,
      system_instruction: combined,
      chitchat_override: chitchatOverride,
    };
  } catch {
    return null;
  }
}

export async function getActiveAssistant(): Promise<ActiveAssistant | null> {
  // Coalesce concurrent calls into a single upstream fetch so a burst of
  // requests (RAG + chitchat + TTS firing in the same turn) doesn't fan
  // out to three duplicate hits on rag-api.
  if (inflight) return inflight;
  inflight = fetchOnce().finally(() => {
    inflight = null;
  });
  return inflight;
}
