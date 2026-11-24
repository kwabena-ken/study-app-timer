/**
 * Generates a short alarm WAV file for the study timer app.
 * Creates a repeating beep pattern at 880 Hz (A5 note).
 * 
 * Run with: node generate-alarm.js
 */
const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 44100;
const DURATION = 1.8;        // total seconds
const FREQUENCY = 880;       // Hz (A5)
const BEEP_ON = 0.22;        // seconds of tone
const BEEP_OFF = 0.18;       // seconds of silence
const AMPLITUDE = 0.65;
const FADE_MS = 0.01;        // fade in/out to avoid clicks

const numSamples = Math.floor(SAMPLE_RATE * DURATION);
const dataSize = numSamples * 2; // 16-bit mono

// Allocate buffer: 44-byte WAV header + PCM data
const buffer = Buffer.alloc(44 + dataSize);

// ── WAV header ──
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);       // fmt chunk size
buffer.writeUInt16LE(1, 20);        // PCM format
buffer.writeUInt16LE(1, 22);        // mono
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
buffer.writeUInt16LE(2, 32);        // block align
buffer.writeUInt16LE(16, 34);       // bits per sample
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

// ── Generate beep pattern ──
const patternLen = BEEP_ON + BEEP_OFF;

for (let i = 0; i < numSamples; i++) {
  const t = i / SAMPLE_RATE;
  const posInPattern = t % patternLen;
  const isOn = posInPattern < BEEP_ON;

  let sample = 0;
  if (isOn) {
    // Smooth envelope to avoid clicks
    const fadeIn = Math.min(posInPattern / FADE_MS, 1);
    const fadeOut = Math.min((BEEP_ON - posInPattern) / FADE_MS, 1);
    const envelope = fadeIn * fadeOut;
    sample = Math.sin(2 * Math.PI * FREQUENCY * t) * AMPLITUDE * envelope;
  }

  const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  buffer.writeInt16LE(int16, 44 + i * 2);
}

// ── Write file ──
const outDir = path.join(__dirname, "..", "..", "assets");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "alarm.wav");
fs.writeFileSync(outPath, buffer);
console.log(`Generated ${outPath} (${buffer.length} bytes, ${DURATION}s)`);
