import fs from "fs";
import path from "path";

const ASSETS_DIR = path.join(__dirname, "..", "..", "..", "assets");
const WAV_FILES = [
  "alarm_classic.wav",
  "alarm_chime.wav",
  "alarm_bell.wav",
  "alarm_marimba.wav",
  "alarm.wav",
];

describe("bundled alarm WAV headers", () => {
  test.each(WAV_FILES)("%s has a valid 16-bit mono 44.1kHz PCM RIFF header", (filename) => {
    const filePath = path.join(ASSETS_DIR, filename);
    const buf = fs.readFileSync(filePath);

    expect(buf.length).toBeGreaterThan(44);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buf.toString("ascii", 12, 16)).toBe("fmt ");
    expect(buf.toString("ascii", 36, 40)).toBe("data");

    const chunkSize = buf.readUInt32LE(4);
    const fmtSize = buf.readUInt32LE(16);
    const audioFormat = buf.readUInt16LE(20);
    const numChannels = buf.readUInt16LE(22);
    const sampleRate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28);
    const blockAlign = buf.readUInt16LE(32);
    const bitsPerSample = buf.readUInt16LE(34);
    const dataSize = buf.readUInt32LE(40);

    expect(fmtSize).toBe(16);
    expect(audioFormat).toBe(1); // PCM
    expect(numChannels).toBe(1); // mono
    expect(sampleRate).toBe(44100);
    expect(byteRate).toBe(88200);
    expect(blockAlign).toBe(2);
    expect(bitsPerSample).toBe(16);
    expect(dataSize).toBeGreaterThan(0);
    expect(chunkSize).toBe(36 + dataSize);
    expect(buf.length).toBe(44 + dataSize);
  });
});
