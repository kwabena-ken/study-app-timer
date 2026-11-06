// ── Session structure & constants ──

const BREAK_1HR = {
  name: "Break",
  duration: 3,
  emoji: "☕",
  isBreak: true,
  tip: "Step away. Stretch, grab water, rest your eyes.",
};

const BREAK_2HR = {
  name: "Break",
  duration: 5,
  emoji: "☕",
  isBreak: true,
  tip: "Step away. Stretch, grab water, rest your eyes.",
};

const raw1hr = [
  { name: "Flashcard Review", duration: 10, emoji: "🃏", tip: "Retrieval only — no new material." },
  { name: "Deep Study", duration: 24, emoji: "📖", tip: "Read, understand, annotate. No card making." },
  { name: "Past Question", duration: 12, emoji: "✏️", tip: "Attempt → stuck 5 min max → check → explain why." },
  { name: "Card Making + Review Gaps", duration: 5, emoji: "✍️", tip: "Make cards from what you just studied." },
];

const raw2hr = [
  { name: "Flashcard Review", duration: 10, emoji: "🃏", tip: "Retrieval only — no new material." },
  { name: "Deep Study — Topic 1", duration: 35, emoji: "📖", tip: "Read, understand, annotate. No card making." },
  { name: "Deep Study — Topic 2", duration: 30, emoji: "📗", tip: "New topic or continuation. Stay focused." },
  { name: "Past Question", duration: 20, emoji: "✏️", tip: "Attempt → stuck 5 min max → check → explain why." },
  { name: "Card Making + Review Gaps", duration: 15, emoji: "✍️", tip: "Make cards, flag anything unclear." },
];

function buildPhases(key) {
  if (key === "1hr") {
    const result = [];
    raw1hr.forEach((p, i) => {
      result.push(p);
      if (i < raw1hr.length - 1) result.push({ ...BREAK_1HR });
    });
    return result;
  }
  const result = [];
  raw2hr.forEach((p, i) => {
    result.push(p);
    if (i === 1 || i === 2) result.push({ ...BREAK_2HR });
  });
  return result;
}

export const SESSIONS = {
  "1hr": { label: "1-Hour Session", phases: buildPhases("1hr") },
  "2hr": { label: "2-Hour Session", phases: buildPhases("2hr") },
};

export const studyColors = ["#4f8ef7", "#4caf6e", "#b06ce0", "#e0a030", "#30b8c8"];
export const breakColor = "#778899";
