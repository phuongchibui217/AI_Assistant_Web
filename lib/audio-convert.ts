/**
 * Pure audio conversion helpers.
 *
 * No browser/Node coupling - works in both. Ported from the Unity client
 * `AudioConvert.cs` with TypeScript-idiomatic types.
 */

/**
 * Linear-interpolation downsample. Accepts mild aliasing - speech band
 * (< 4 kHz) is fine for downstream STT.
 */
export function downsample(
  src: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate || src.length === 0) return src;
  const ratio = srcRate / dstRate;
  const dstLen = Math.floor(src.length / ratio);
  const dst = new Float32Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const sx = i * ratio;
    const i0 = Math.floor(sx);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const t = sx - i0;
    dst[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  return dst;
}

/**
 * Convert Float32 samples in [-1, 1] to PCM16 little-endian bytes. Used to
 * encode mic audio before sending to Gemini Live.
 */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const s = Math.round(clamped * 32767);
    bytes[i * 2] = s & 0xff;
    bytes[i * 2 + 1] = (s >> 8) & 0xff;
  }
  return bytes;
}

/**
 * Convert PCM16 little-endian bytes to Float32 samples in [-1, 1]. Used to
 * decode server audio chunks into an AudioBuffer.
 */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.length / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    const u16 = (hi << 8) | lo;
    const signed = u16 >= 0x8000 ? u16 - 0x10000 : u16;
    samples[i] = signed / 32768;
  }
  return samples;
}

/**
 * Chunked Uint8Array -> base64. Direct `String.fromCharCode(...bytes)` blows
 * the stack at ~65535 bytes; we slice into 32 KB chunks.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
