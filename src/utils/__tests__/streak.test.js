import { computeStreak, localDayKey, recentStudyDays } from "../streak";

function isoLocal(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h, 0, 0).toISOString();
}

function completed(y, m, d, extra = {}) {
  return {
    completed: true,
    completedAt: isoLocal(y, m, d),
    ...extra,
  };
}

const NOW = new Date(2026, 7, 24, 15, 0, 0); // local Aug 24, 2026

describe("localDayKey", () => {
  it("formats a local calendar day as YYYY-MM-DD", () => {
    expect(localDayKey(new Date(2026, 7, 24, 9, 30))).toBe("2026-08-24");
  });
});

describe("computeStreak", () => {
  it("returns zeros for an empty list", () => {
    expect(computeStreak([], NOW)).toEqual({
      current: 0,
      best: 0,
      lastQualifyingDay: null,
    });
  });

  it("ignores incomplete-only sessions", () => {
    const sessions = [
      { completed: false, completedAt: isoLocal(2026, 8, 24) },
      { completedAt: isoLocal(2026, 8, 23) },
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 0,
      best: 0,
      lastQualifyingDay: null,
    });
  });

  it("counts several sessions on the same day as one day", () => {
    const sessions = [
      completed(2026, 8, 24, { completedAt: isoLocal(2026, 8, 24, 9) }),
      completed(2026, 8, 24, { completedAt: isoLocal(2026, 8, 24, 18) }),
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 1,
      best: 1,
      lastQualifyingDay: "2026-08-24",
    });
  });

  it("counts consecutive days including today", () => {
    const sessions = [
      completed(2026, 8, 22),
      completed(2026, 8, 23),
      completed(2026, 8, 24),
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 3,
      best: 3,
      lastQualifyingDay: "2026-08-24",
    });
  });

  it("keeps current streak if studied yesterday but not today", () => {
    const sessions = [completed(2026, 8, 22), completed(2026, 8, 23)];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 2,
      best: 2,
      lastQualifyingDay: "2026-08-23",
    });
  });

  it("zeros current when last study was two or more days ago, keeping best", () => {
    const sessions = [
      completed(2026, 8, 20),
      completed(2026, 8, 21),
      completed(2026, 8, 22),
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 0,
      best: 3,
      lastQualifyingDay: "2026-08-22",
    });
  });

  it("does not inflate current across a gap; best captures the longer run", () => {
    const sessions = [
      completed(2026, 8, 10),
      completed(2026, 8, 11),
      completed(2026, 8, 12),
      completed(2026, 8, 13),
      completed(2026, 8, 14),
      completed(2026, 8, 23),
      completed(2026, 8, 24),
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 2,
      best: 5,
      lastQualifyingDay: "2026-08-24",
    });
  });

  it("falls back to startedAt when completedAt is missing", () => {
    const sessions = [
      {
        completed: true,
        startedAt: isoLocal(2026, 8, 24),
      },
    ];
    expect(computeStreak(sessions, NOW)).toEqual({
      current: 1,
      best: 1,
      lastQualifyingDay: "2026-08-24",
    });
  });
});

describe("recentStudyDays", () => {
  it("returns `count` booleans, oldest first, last = today", () => {
    const days = recentStudyDays([], 7, NOW);
    expect(days).toHaveLength(7);
    expect(days).toEqual([false, false, false, false, false, false, false]);
  });

  it("marks the days that had a completed session", () => {
    const sessions = [
      completed(2026, 8, 24), // today
      completed(2026, 8, 22), // 2 days ago
      completed(2026, 8, 18), // 6 days ago
    ];
    // indices 0..6 = Aug 18..24
    expect(recentStudyDays(sessions, 7, NOW)).toEqual([
      true, // 18
      false, // 19
      false, // 20
      false, // 21
      true, // 22
      false, // 23
      true, // 24 (today)
    ]);
  });

  it("ignores incomplete sessions and days outside the window", () => {
    const sessions = [
      { completed: false, completedAt: isoLocal(2026, 8, 24) },
      completed(2026, 8, 10), // older than 7 days
    ];
    expect(recentStudyDays(sessions, 7, NOW)).toEqual([
      false, false, false, false, false, false, false,
    ]);
  });
});
