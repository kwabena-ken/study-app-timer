const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;

function createWavBuffer(numSamples, sampleGenerator) {
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32); // block align: channels * bytes per sample
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const sample = sampleGenerator(t, i, numSamples);
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}

const outDir = path.join(__dirname, "..", "..", "assets");
fs.mkdirSync(outDir, { recursive: true });

// 1. Classic Beep (880 Hz digital beeps)
const classicBuf = createWavBuffer(Math.floor(SAMPLE_RATE * 1.8), (t) => {
  const pattern = t % 0.4;
  if (pattern < 0.22) {
    const env = Math.min(pattern / 0.01, 1) * Math.min((0.22 - pattern) / 0.01, 1);
    return Math.sin(2 * Math.PI * 880 * t) * 0.6 * env;
  }
  return 0;
});
fs.writeFileSync(path.join(outDir, "alarm_classic.wav"), classicBuf);

// 2. Pleasant Chime (Three rising notes: C5, E5, G5)
const chimeBuf = createWavBuffer(Math.floor(SAMPLE_RATE * 2.2), (t) => {
  let note = 523.25; // C5
  let localT = t;
  if (t > 0.4 && t <= 0.8) {
    note = 659.25; // E5
    localT = t - 0.4;
  } else if (t > 0.8) {
    note = 783.99; // G5
    localT = t - 0.8;
  }
  const decay = Math.exp(-localT * 3.5);
  return Math.sin(2 * Math.PI * note * t) * 0.65 * decay;
});
fs.writeFileSync(path.join(outDir, "alarm_chime.wav"), chimeBuf);

// 3. Resonant Bell (A4 note with harmonic overtones and bell decay)
const bellBuf = createWavBuffer(Math.floor(SAMPLE_RATE * 2.5), (t) => {
  const decay = Math.exp(-t * 2.2);
  const f = 440; // A4
  const tone =
    Math.sin(2 * Math.PI * f * t) * 0.5 +
    Math.sin(2 * Math.PI * f * 2 * t) * 0.25 +
    Math.sin(2 * Math.PI * f * 3.01 * t) * 0.15;
  return tone * decay;
});
fs.writeFileSync(path.join(outDir, "alarm_bell.wav"), bellBuf);

// 4. Marimba Melody (Short wooden marimba rhythm)
const marimbaBuf = createWavBuffer(Math.floor(SAMPLE_RATE * 2.0), (t) => {
  const notes = [587.33, 659.25, 783.99, 880.0];
  const idx = Math.floor((t % 1.2) / 0.3);
  const freq = notes[idx % notes.length];
  const localT = (t % 1.2) % 0.3;
  const decay = Math.exp(-localT * 12);
  const tone = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 3 * t);
  return tone * 0.5 * decay;
});
fs.writeFileSync(path.join(outDir, "alarm_marimba.wav"), marimbaBuf);

console.log("All sound assets generated successfully in assets/");
