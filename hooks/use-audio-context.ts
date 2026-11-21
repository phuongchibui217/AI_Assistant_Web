"use client";

import { useCallback, useEffect, useRef } from "react";

import { PLAYBACK_RATE } from "@/lib/audio-stream-player";

/**
 * Create the playback context at the rate our PCM chunks already use.
 *
 * This is the whole fix for the client's "ビー" beep: when the context rate
 * differs from the buffer rate, Chrome resamples each scheduled buffer
 * independently and corrupts the samples at every chunk seam (measured at up
 * to 1.01x the signal's own RMS on a fragmented network; Firefox is unaffected,
 * which is exactly the browser split the client reported). Matching the rates
 * removes the resampling entirely - the OS mixer still converts to the device
 * rate, but once, continuously, with no per-chunk seams.
 *
 * A context is spec'd to throw NotSupportedError for a rate it cannot honour.
 * No current major engine refuses 24 kHz, but if one does we fall back to the
 * default rate and `AudioStreamPlayer` resamples with continuity itself.
 */
export function createPlaybackContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: PLAYBACK_RATE });
  } catch {
    return new AudioContext();
  }
}

/**
 * Owns a single AudioContext for the lifetime of the page. Browsers require
 * a user gesture before audio can play, so the context is created lazily and
 * `ensure()` resumes it - call from a click / keydown handler.
 *
 * Returns a ref (stable across renders) rather than the context itself,
 * because audio code reads it inside callbacks that should not re-bind every
 * time React rerenders.
 */
export function useAudioContext(): {
  ctxRef: React.MutableRefObject<AudioContext | null>;
  ensure: () => Promise<AudioContext>;
} {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensure = useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = createPlaybackContext();
    }
    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  return { ctxRef, ensure };
}
