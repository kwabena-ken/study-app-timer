import {
  reconcileTimeline,
  buildNotificationChain,
  defaultChainBody,
  minsStudiedFromResults,
  totalPhaseMs,
  isValidSnapshot,
} from "../sessionTimeline";

const phases = [
  { name: "Study A", duration: 10, emoji: "📖", isBreak: false },
  { name: "Break", duration: 2, emoji: "☕", isBreak: true },
  { name: "Study B", duration: 10, emoji: "📖", isBreak: false },
];

describe("reconcileTimeline", () => {
  it("returns the position unchanged when paused", () => {
    const r = reconcileTimeline({
      phases,
      phaseIndex: 1,
      remainingMs: 60000,
      running: false,
      anchorAt: 1000,
      now: 999999,
      autoAdvance: true,
    });
    expect(r).toMatchObject({
      phaseIndex: 1,
      remainingMs: 60000,
      running: false,
      finished: false,
    });
    expect(r.advancedPhases).toEqual([]);
  });

  it("advances remaining time within the current phase", () => {
    const r = reconcileTimeline({
      phases,
      phaseIndex: 0,
      remainingMs: 600000, // full 10 min
      running: true,
      anchorAt: 0,
      now: 3 * 60000, // 3 min later
      autoAdvance: true,
    });
    expect(r.phaseIndex).toBe(0);
    expect(r.remainingMs).toBe(7 * 60000);
    expect(r.finished).toBe(false);
  });

  it("rolls through multiple boundaries when auto-advance is on", () => {
    // Start 1 minute into study A (9min left), then come back 11 minutes
    // later: study A ends after 9, break ends after 2 → should be deep in B.
    const r = reconcileTimeline({
      phases,
      phaseIndex: 0,
      remainingMs: 9 * 60000,
      running: true,
      anchorAt: 0,
      now: 11 * 60000,
      autoAdvance: true,
    });
    expect(r.phaseIndex).toBe(2);
    expect(r.remainingMs).toBe(10 * 60000); // study B just started (9+2=11 elapsed)
    expect(r.advancedPhases).toEqual([
      { index: 0, completed: true },
      { index: 1, completed: true },
    ]);
  });

  it("finishes the session when all phase time has elapsed (auto-advance)", () => {
    const r = reconcileTimeline({
      phases,
      phaseIndex: 0,
      remainingMs: 600000,
      running: true,
      anchorAt: 0,
      now: 25 * 60000, // total is 22 min
      autoAdvance: true,
    });
    expect(r.finished).toBe(true);
    expect(r.running).toBe(false);
    expect(r.remainingMs).toBe(0);
  });

  it("stops at the first boundary for the user when auto-advance is off", () => {
    const r = reconcileTimeline({
      phases,
      phaseIndex: 0,
      remainingMs: 600000,
      running: true,
      anchorAt: 0,
      now: 15 * 60000, // past A, past the break
      autoAdvance: false,
    });
    expect(r.phaseIndex).toBe(1); // paused at the break, full duration
    expect(r.remainingMs).toBe(2 * 60000);
    expect(r.running).toBe(false);
    expect(r.awaitingNext).toBe(true);
    expect(r.finished).toBe(false);
    expect(r.advancedPhases).toEqual([{ index: 0, completed: true }]);
  });

  it("finishes when the last phase ends in manual mode", () => {
    const r = reconcileTimeline({
      phases,
      phaseIndex: 2,
      remainingMs: 600000,
      running: true,
      anchorAt: 0,
      now: 20 * 60000,
      autoAdvance: false,
    });
    expect(r.finished).toBe(true);
    expect(r.awaitingNext).toBe(false);
  });
});

describe("buildNotificationChain", () => {
  it("schedules every boundary at absolute times when auto-advance is on", () => {
    const items = buildNotificationChain({
      phases,
      phaseIndex: 0,
      remainingMs: 600000,
      now: 1000,
      autoAdvance: true,
      bodyFor: defaultChainBody,
    });
    expect(items.map((i) => i.at)).toEqual([
      1000 + 600000,
      1000 + 720000,
      1000 + 1320000,
    ]);
    expect(items[2].body).toContain("session complete");
  });

  it("schedules only the current phase when auto-advance is off", () => {
    const items = buildNotificationChain({
      phases,
      phaseIndex: 0,
      remainingMs: 600000,
      now: 1000,
      autoAdvance: false,
      bodyFor: defaultChainBody,
    });
    expect(items).toHaveLength(1);
  });
});

describe("minsStudiedFromResults", () => {
  it("sums only study phases and rounds to 0.1", () => {
    expect(
      minsStudiedFromResults([
        { status: "completed", elapsedMs: 600000, isBreak: false },
        { status: "completed", elapsedMs: 120000, isBreak: true },
        { status: "completed", elapsedMs: 300000, isBreak: false },
      ])
    ).toBe(15);
  });
});

describe("totalPhaseMs / isValidSnapshot", () => {
  it("sums phase durations", () => {
    expect(totalPhaseMs(phases)).toBe(22 * 60000);
  });

  it("accepts a well-formed snapshot", () => {
    expect(
      isValidSnapshot({
        id: "abc",
        session: { label: "X", phases },
        subject: "Bio",
        timeline: {
          phaseIndex: 1,
          remainingMs: 5000,
          running: false,
          anchorAt: 123,
          startedAt: "2026-01-01T00:00:00.000Z",
          autoAdvance: true,
          results: [],
        },
      })
    ).toBe(true);
  });

  it("rejects malformed snapshots instead of crashing recovery", () => {
    expect(isValidSnapshot(null)).toBe(false);
    expect(isValidSnapshot({})).toBe(false);
    expect(
      isValidSnapshot({
        id: "x",
        session: { label: "X", phases: [{ name: "A", duration: -1 }] },
        timeline: {
          phaseIndex: 0,
          remainingMs: 0,
          running: false,
          anchorAt: 0,
          startedAt: "t",
        },
      })
    ).toBe(false);
  });
});
