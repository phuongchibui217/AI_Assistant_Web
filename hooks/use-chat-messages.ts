"use client";

import { useCallback, useRef, useState } from "react";

import type { Citation } from "@/lib/citations";

export type ChatRole = "user" | "model";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  /** Optional citation footnote. Only model messages set this. */
  citations?: Citation[];
  /** Optional follow-up question suggestions attached after the answer
   *  finishes streaming. Only model messages set this. */
  suggestions?: string[];
};

/**
 * Chat message log with fragment accumulation.
 *
 * Gemini Live streams transcripts in small chunks; consecutive chunks of the
 * same role merge into one bubble. The "current bubble id per role" lives in
 * refs (mutable, not React state) so successive `appendChunk` calls within
 * the same render cycle agree on which bubble to extend.
 *
 * `pushFull` is for user-typed messages: one bubble, end of story. After it,
 * the user-bubble accumulator is reset so the next streamed user transcript
 * starts a new bubble.
 *
 * `endTurn` is called on `turnComplete`: both accumulators reset so the next
 * exchange starts cleanly.
 */
export function useChatMessages(): {
  messages: ChatMessage[];
  appendUserChunk: (text: string) => void;
  appendModelChunk: (text: string) => void;
  pushFullUser: (text: string) => void;
  /** Append a fully-formed model bubble (e.g. the initial greeting). Returns
   *  the new message id so the caller can attach suggestions later. */
  pushFullModel: (text: string, citations?: Citation[]) => string;
  /** Attach citations to the in-flight model bubble. Called once per turn. */
  setCurrentModelCitations: (citations: Citation[]) => void;
  /** Overwrite the text of an existing model bubble (e.g. swap the raw
   *  streamed markdown for the formatted display version after the stream
   *  finishes). No-op if the id is unknown. */
  replaceModelText: (id: string, text: string) => void;
  /** Remove a bubble entirely (e.g. discard Live's provisional answer once a
   *  voice question is re-routed to RAG). No-op if the id is unknown. */
  removeMessage: (id: string) => void;
  /** Attach follow-up suggestions to a specific (already-rendered) model
   *  bubble. No-op if the id is unknown. */
  setSuggestionsForMessage: (id: string, suggestions: string[]) => void;
  /** Return the id of the most recent model bubble, or null if there isn't
   *  one yet. Used by the Live path which only sees the bubble after streaming
   *  has finished. */
  latestModelMessageId: () => string | null;
  /** Return the id of the model bubble the CURRENT turn is streaming into
   *  (set synchronously by appendModelChunk), or null before the first chunk.
   *  Unlike latestModelMessageId this does not depend on a render having
   *  flushed, so finalising a fast stream can't accidentally target the
   *  previous turn's bubble. */
  currentModelMessageId: () => string | null;
  /** Return the last n messages as [{role, text}] ordered oldest → newest.
   *  Reads from the stable messagesRef so safe to call inside closures that
   *  were created before the latest render. */
  getRecentHistory: (n: number) => Array<{ role: "user" | "model"; text: string }>;
  endTurn: () => void;
  clear: () => void;
} {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const currentUserIdRef = useRef<string | null>(null);
  const currentModelIdRef = useRef<string | null>(null);

  const newId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const appendChunk = useCallback(
    (role: ChatRole, text: string, idRef: React.MutableRefObject<string | null>) => {
      if (idRef.current === null) {
        const id = newId();
        // CRITICAL: mutate ref BEFORE setState so the next chunk in the same
        // tick sees the correct id (React StrictMode double-invokes updaters).
        idRef.current = id;
        setMessages((prev) => [...prev, { id, role, text }]);
      } else {
        const id = idRef.current;
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, text: m.text + text } : m)),
        );
      }
    },
    [],
  );

  const appendUserChunk = useCallback(
    (text: string) => appendChunk("user", text, currentUserIdRef),
    [appendChunk],
  );
  const appendModelChunk = useCallback(
    (text: string) => appendChunk("model", text, currentModelIdRef),
    [appendChunk],
  );

  const pushFullUser = useCallback((text: string) => {
    const id = newId();
    setMessages((prev) => [...prev, { id, role: "user", text }]);
    currentUserIdRef.current = null;
  }, []);

  const pushFullModel = useCallback(
    (text: string, citations?: Citation[]): string => {
      const id = newId();
      setMessages((prev) => [...prev, { id, role: "model", text, citations }]);
      // This bubble is closed; the next streaming reply opens a fresh one.
      currentModelIdRef.current = null;
      return id;
    },
    [],
  );

  const setSuggestionsForMessage = useCallback(
    (id: string, suggestions: string[]) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, suggestions } : m)),
      );
    },
    [],
  );

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const latestModelMessageId = useCallback((): string | null => {
    const all = messagesRef.current;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].role === "model") return all[i].id;
    }
    return null;
  }, []);

  const currentModelMessageId = useCallback(
    (): string | null => currentModelIdRef.current,
    [],
  );

  const replaceModelText = useCallback((id: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text } : m)),
    );
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    // If the bubble being removed was the in-flight model/user bubble, clear
    // the ref so the next chunk opens a fresh one instead of trying to extend
    // a bubble that no longer exists.
    if (currentModelIdRef.current === id) currentModelIdRef.current = null;
    if (currentUserIdRef.current === id) currentUserIdRef.current = null;
  }, []);

  const setCurrentModelCitations = useCallback((citations: Citation[]) => {
    const id = currentModelIdRef.current;
    if (id === null) {
      // No model bubble yet - stash on the next chunk by creating an empty one.
      const newBubbleId = newId();
      currentModelIdRef.current = newBubbleId;
      setMessages((prev) => [
        ...prev,
        { id: newBubbleId, role: "model", text: "", citations },
      ]);
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, citations } : m)),
    );
  }, []);

  const getRecentHistory = useCallback(
    (n: number): Array<{ role: "user" | "model"; text: string }> => {
      return messagesRef.current
        .slice(-n)
        .map((m) => ({ role: m.role as "user" | "model", text: m.text }));
    },
    [],
  );

  const endTurn = useCallback(() => {
    currentUserIdRef.current = null;
    currentModelIdRef.current = null;
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    currentUserIdRef.current = null;
    currentModelIdRef.current = null;
  }, []);

  return {
    messages,
    appendUserChunk,
    appendModelChunk,
    pushFullUser,
    pushFullModel,
    setCurrentModelCitations,
    setSuggestionsForMessage,
    replaceModelText,
    removeMessage,
    latestModelMessageId,
    currentModelMessageId,
    getRecentHistory,
    endTurn,
    clear,
  };
}
