// Sample-rate conversions. Cheap and good-enough for speech.

/** 48 kHz → 16 kHz: decimate by 3 via group-average. */
export function downsample48to16(int16: Int16Array): Int16Array {
  const outLen = Math.floor(int16.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0, j = 0; j < outLen; i += 3, j++) {
    out[j] = ((int16[i] + int16[i + 1] + int16[i + 2]) / 3) | 0;
  }
  return out;
}

/** 24 kHz → 48 kHz: ×2 linear interpolation. */
export function upsample24to48(int16: Int16Array): Int16Array {
  const n = int16.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = int16[i];
    const b = i + 1 < n ? int16[i + 1] : a;
    out[2 * i] = a;
    out[2 * i + 1] = ((a + b) / 2) | 0;
  }
  return out;
}

/** General linear resampler between arbitrary rates. */
export function resampleLinear(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.floor(input.length * ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = (input[i0] * (1 - frac) + input[i1] * frac) | 0;
  }
  return out;
}

/** Generic integer-factor ×N linear upsample (for arbitrary TTS rates). */
export function upsampleInt(int16: Int16Array, factor: number): Int16Array {
  if (factor <= 1) return int16;
  const n = int16.length;
  const out = new Int16Array(n * factor);
  for (let i = 0; i < n; i++) {
    const a = int16[i];
    const b = i + 1 < n ? int16[i + 1] : a;
    for (let k = 0; k < factor; k++) {
      out[i * factor + k] = (a + ((b - a) * k) / factor) | 0;
    }
  }
  return out;
}
