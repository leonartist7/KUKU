// Short, local notification audio only. Re-encoding strips embedded WAV metadata.
export const MAX_WAV_BYTES = 1024 * 1024;
export const MAX_WAV_SECONDS = 5;
export type DecodedSound = Pick<AudioBuffer, "duration" | "length" | "sampleRate" | "numberOfChannels" | "getChannelData">;

export function validateWav(bytes: ArrayBuffer) {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_WAV_BYTES) throw new Error("Choose a WAV file smaller than 1 MB.");
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.byteLength) {
    throw new Error("This isn't a valid WAV file. Export it as PCM WAV and try again.");
  }
  let format = false, data = false, bytesPerSecond = 0, dataBytes = 0, frameBytes = 0;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error("This WAV file is incomplete.");
    const size = view.getUint32(offset + 4, true), end = offset + 8 + size;
    if (end + (size % 2) > bytes.byteLength) throw new Error("This WAV file is incomplete.");
    if (tag(offset) === "fmt ") {
      if (size < 16) throw new Error("This WAV format isn't supported.");
      const encoding = view.getUint16(offset + 8, true), channels = view.getUint16(offset + 10, true);
      const rate = view.getUint32(offset + 12, true), bits = view.getUint16(offset + 22, true);
      const blockAlign = view.getUint16(offset + 20, true), declaredRate = view.getUint32(offset + 16, true);
      if (format || ![1, 3].includes(encoding) || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 ||
          ![8, 16, 24, 32].includes(bits) || (encoding === 3 && bits !== 32) ||
          blockAlign !== channels * bits / 8 || declaredRate !== rate * blockAlign) {
        throw new Error("Use a mono or stereo PCM WAV, up to 96 kHz.");
      }
      format = true; bytesPerSecond = declaredRate; frameBytes = blockAlign;
    }
    if (tag(offset) === "data") {
      // Multiple data chunks or partial frames have inconsistent decoder behavior.
      if (!format || data || size === 0 || size % frameBytes !== 0) throw new Error("This WAV file has invalid audio frames.");
      data = true; dataBytes = size;
    }
    offset = end + (size % 2);
  }
  if (!format || !data) throw new Error("This WAV file has no playable audio.");
  if (dataBytes / bytesPerSecond > MAX_WAV_SECONDS) throw new Error("Choose a notification sound up to 5 seconds long.");
}

export function normalizedWav(audio: DecodedSound): Uint8Array {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_WAV_SECONDS ||
      !Number.isInteger(audio.length) || audio.length <= 0 || audio.length > 480000 ||
      !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 96000 ||
      audio.length > audio.sampleRate * MAX_WAV_SECONDS || Math.abs(audio.duration - audio.length / audio.sampleRate) > 1 / audio.sampleRate ||
      !Number.isInteger(audio.numberOfChannels) || audio.numberOfChannels < 1 || audio.numberOfChannels > 2) {
    throw new Error("Choose a notification sound up to 5 seconds long.");
  }
  const rate = Math.min(48000, audio.sampleRate), length = Math.floor(audio.length * rate / audio.sampleRate);
  const channels = Array.from({length: audio.numberOfChannels}, (_, index) => audio.getChannelData(index));
  const samples = new Float32Array(length);
  let peak = 0;
  for (let index = 0; index < length; index++) {
    const position = index * audio.sampleRate / rate, left = Math.floor(position), fraction = position - left;
    let sample = 0;
    for (const channel of channels) sample += (channel[left] * (1 - fraction) + channel[Math.min(audio.length - 1, left + 1)] * fraction) / channels.length;
    if (!Number.isFinite(sample)) throw new Error("This WAV file contains invalid audio.");
    samples[index] = sample; peak = Math.max(peak, Math.abs(sample));
  }
  if (peak < 0.00001) throw new Error("This file is silent. Choose a sound you can hear.");
  const bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);};
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, length * 2, true);
  const gain = Math.min(16, 0.82 / peak), fade = Math.max(1, Math.floor(rate * 0.005));
  for (let index = 0; index < length; index++) {
    const envelope = Math.min(1, index / fade, (length - 1 - index) / fade);
    view.setInt16(44 + index * 2, Math.round(Math.max(-0.82, Math.min(0.82, samples[index] * gain * envelope)) * 32767), true);
  }
  return bytes;
}

export function soundName(value: string) {
  return value.replace(/\\/g, "/").split("/").pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) || "My sound.wav";
}
