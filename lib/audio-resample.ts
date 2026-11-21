/**
 * Stateful stream resampler.
 *
 * Why this exists (2026-09-22, client "ビー" beep root cause): the playback
 * `AudioContext` runs at the device rate (48 kHz on mobile) while every TTS
 * chunk arrives as 24 kHz PCM. Chrome resamples each `AudioBufferSourceNode`
 * INDEPENDENTLY at playback time, and its interpolator carries no state across
 * separately scheduled buffers - so it corrupts the samples at every chunk
 * edge. Measured in a real Chrome 153 `OfflineAudioContext`: splitting one
 * contiguous PCM stream into 1460-byte fragments (one TCP MSS) put 100% of the
 * error energy exactly on the seams, peaking at 1.01x the signal's own RMS,
 * while Firefox 155 produced a bit-identical result. Because the chunk count is
 * decided by how the HTTP body fragments, a long-haul mobile link turns that
 * into a click train (~33 Hz at 1460 B) that is audible as a buzz.
 *
 * The fix is to never let the rates disagree. `AudioStreamPlayer` only reaches
 * for this class when it could not get a context at the PCM's own rate; the
 * normal path does no resampling at all.
 *
 * NOT the same as `downsample()` in `audio-convert.ts` - that one is stateless
 * and single-shot (fine for the mic path, which hands it a whole buffer at
 * once). Resampling a stream with it chunk-by-chunk would reintroduce exactly
 * the seam discontinuity described above.
 */

/**
 * Linear-interpolation resampler that carries interpolation state between
 * calls, so feeding a stream in N chunks yields byte-for-byte the same output
 * as feeding it in one call.
 *
 * It buys that by holding the final input sample back in {@link carry} until
 * the next call supplies its right-hand neighbour - the interpolator is never
 * asked to guess what lies past the end of a chunk, which is precisely the
 * guess Chrome gets wrong.
 *
 * Linear (not windowed-sinc) is deliberate: this path only runs on a device
 * that refused an `AudioContext` at the source rate, which no current major
 * engine does. Continuity across seams matters far more here than stopband
 * rejection - a seam artifact is broadband and audible, mild interpolation
 * imaging is neither.
 */
export class LinearResampler {
  /** Input samples consumed per output sample. */
  private readonly ratio: number;
  /** Unconsumed input tail, prepended to the next call's chunk. */
  private carry: Float32Array = new Float32Array(0);
  /** Fractional read position within `carry ++ input`, in [0, 1). */
  private phase = 0;

  constructor(srcRate: number, dstRate: number) {
    if (srcRate <= 0 || dstRate <= 0) {
      throw new Error(`Invalid resample rates: ${srcRate} -> ${dstRate}`);
    }
    this.ratio = srcRate / dstRate;
  }

  /**
   * Resample one chunk. May return an empty array if the chunk was too short
   * to produce a whole output sample - the input is not lost, it stays in
   * `carry` and emerges on a later call.
   */
  process(input: Float32Array): Float32Array {
    const joined = this.join(input);
    // An output sample at position p needs joined[floor(p)] and
    // joined[floor(p)+1], so p must stay strictly below joined.length - 1.
    const usable = joined.length - 1 - this.phase;
    const count = usable > 0 ? Math.ceil(usable / this.ratio) : 0;
    const out = new Float32Array(count);

    let p = this.phase;
    for (let i = 0; i < count; i++) {
      const i0 = Math.floor(p);
      const t = p - i0;
      out[i] = joined[i0] * (1 - t) + joined[i0 + 1] * t;
      p += this.ratio;
    }

    const consumed = Math.floor(p);
    this.carry = joined.slice(consumed);
    this.phase = p - consumed;
    return out;
  }

  /**
   * Drop all carried state. Call when playback is cancelled, so an interrupted
   * turn's trailing samples don't bleed into the start of the next one.
   */
  reset(): void {
    this.carry = new Float32Array(0);
    this.phase = 0;
  }

  private join(input: Float32Array): Float32Array {
    if (this.carry.length === 0) return input;
    const joined = new Float32Array(this.carry.length + input.length);
    joined.set(this.carry, 0);
    joined.set(input, this.carry.length);
    return joined;
  }
}
