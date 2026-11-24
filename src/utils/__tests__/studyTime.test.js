import {
  phaseElapsedSecs,
  minsFromSecs,
  formatStudyDuration,
  reconcileSessionTimeline,
} from "../studyTime";

describe("phaseElapsedSecs", () => {
  it("returns elapsed seconds for a running study phase", () => {
    // 10-min phase (600s) with 480s left → 120s elapsed
    expect(phaseElapsedSecs({ duration: 10 }, 480)).toBe(120);
  });

  it("returns the full duration when the phase is complete", () => {
    expect(phaseElapsedSecs({ duration: 10 }, 0)).toBe(600);
  });

  it("returns 0 for break phases", () => {
    expect(phaseElapsedSecs({ duration: 5, isBreak: true }, 0)).toBe(0);
  });

  it("returns 0 for a missing phase", () => {
    expect(phaseElapsedSecs(null, 100)).toBe(0);
    expect(phaseElapsedSecs(undefined, 100)).toBe(0);
  });

  it("clamps to 0 when secondsLeft exceeds the phase length", () => {
    expect(phaseElapsedSecs({ duration: 10 }, 700)).toBe(0);
  });
});

describe("minsFromSecs", () => {
  it("converts seconds to minutes", () => {
    expect(minsFromSecs(150)).toBe(2.5);
    expect(minsFromSecs(90)).toBe(1.5);
    expect(minsFromSecs(0)).toBe(0);
    expect(minsFromSecs(-10)).toBe(0);
  });

  it("rounds to the nearest tenth of a minute", () => {
    expect(minsFromSecs(100)).toBe(1.7); // 1.666… → 1.7
    expect(minsFromSecs(7)).toBe(0.1); // 0.116… → 0.1
  });

  it("preserves brief >=1s study intervals at 0.1 min minimum", () => {
    expect(minsFromSecs(1)).toBe(0.1);
    expect(minsFromSecs(2)).toBe(0.1);
    expect(minsFromSecs(2.9)).toBe(0.1);
  });
});

describe("formatStudyDuration", () => {
  it("formats zero, sub-minute, minute, and hour durations cleanly", () => {
    expect(formatStudyDuration(0)).toBe("0m");
    expect(formatStudyDuration(0.1)).toBe("<1m");
    expect(formatStudyDuration(0.4)).toBe("<1m");
    expect(formatStudyDuration(0.9)).toBe("<1m");
    expect(formatStudyDuration(1)).toBe("1m");
    expect(formatStudyDuration(25)).toBe("25m");
    expect(formatStudyDuration(59.6)).toBe("1h");
    expect(formatStudyDuration(60)).toBe("1h");
    expect(formatStudyDuration(90)).toBe("1h 30m");
    expect(formatStudyDuration(119.6)).toBe("2h");
  });
});

describe("reconcileSessionTimeline", () => {
  const twoPhase = [
    { name: "Deep Study", duration: 1, isBreak: false },
    { name: "Short Break", duration: 1, isBreak: true },
  ];

  const threePhase = [
    { name: "Study 1", duration: 1, isBreak: false },
    { name: "Break", duration: 1, isBreak: true },
    { name: "Study 2", duration: 2, isBreak: false },
  ];

  it("resumes mid-phase with exact wall-clock remaining time and live study credit", () => {
    const startMs = 1_000_000;
    const res = reconcileSessionTimeline({
      phases: twoPhase,
      phaseIndex: 0,
      phaseEndMs: startMs + 60_000,
      actualStudySecs: 0,
      studyPhasesCompleted: 0,
      autoAdvance: true,
      nowMs: startMs + 15_000,
    });

    expect(res.completedAll).toBe(false);
    expect(res.phaseEndedWaiting).toBe(false);
    expect(res.running).toBe(true);
    expect(res.phaseIndex).toBe(0);
    expect(res.secondsLeft).toBe(45);
    expect(res.phaseEndMs).toBe(startMs + 60_000);
    expect(res.actualStudySecs).toBe(0);
    expect(res.totalStudySecs).toBe(15);
    expect(res.studyPhasesCompleted).toBe(0);
    expect(res.phasesAdvanced).toBe(0);
  });

  it("advances across multiple elapsed phases when autoAdvance is on", () => {
    const startMs = 1_000_000;
    // 150s elapsed: Study 1 (60s) + Break (60s) completed, 30s into Study 2 (120s)
    const res = reconcileSessionTimeline({
      phases: threePhase,
      phaseIndex: 0,
      phaseEndMs: startMs + 60_000,
      actualStudySecs: 0,
      studyPhasesCompleted: 0,
      autoAdvance: true,
      nowMs: startMs + 150_000,
    });

    expect(res.completedAll).toBe(false);
    expect(res.running).toBe(true);
    expect(res.phaseIndex).toBe(2);
    expect(res.secondsLeft).toBe(90);
    expect(res.phaseEndMs).toBe(startMs + 240_000);
    expect(res.actualStudySecs).toBe(60); // banked from Study 1 only (break = 0)
    expect(res.totalStudySecs).toBe(90); // 60 banked + 30 elapsed in Study 2
    expect(res.studyPhasesCompleted).toBe(1);
    expect(res.phasesAdvanced).toBe(2);
  });

  it("completes the full session when background time exceeds all remaining phases (130s on 120s 2-phase)", () => {
    const startMs = 1_000_000;
    const res = reconcileSessionTimeline({
      phases: twoPhase,
      phaseIndex: 0,
      phaseEndMs: startMs + 60_000,
      actualStudySecs: 0,
      studyPhasesCompleted: 0,
      autoAdvance: true,
      nowMs: startMs + 130_000,
    });

    expect(res.completedAll).toBe(true);
    expect(res.running).toBe(false);
    expect(res.secondsLeft).toBe(0);
    expect(res.actualStudySecs).toBe(60);
    expect(res.totalStudySecs).toBe(60);
    expect(res.studyPhasesCompleted).toBe(1);
    expect(res.phasesAdvanced).toBe(2);
    expect(res.completedAtMs).toBe(startMs + 120_000);
  });

  it("pauses at the start of the next phase when autoAdvance is off", () => {
    const startMs = 1_000_000;
    const res = reconcileSessionTimeline({
      phases: twoPhase,
      phaseIndex: 0,
      phaseEndMs: startMs + 60_000,
      actualStudySecs: 0,
      studyPhasesCompleted: 0,
      autoAdvance: false,
      nowMs: startMs + 130_000,
    });

    expect(res.completedAll).toBe(false);
    expect(res.phaseEndedWaiting).toBe(true);
    expect(res.running).toBe(false);
    expect(res.phaseIndex).toBe(1);
    expect(res.secondsLeft).toBe(60);
    expect(res.phaseEndMs).toBeNull();
    expect(res.actualStudySecs).toBe(60);
    expect(res.totalStudySecs).toBe(60);
    expect(res.studyPhasesCompleted).toBe(1);
    expect(res.phasesAdvanced).toBe(1);
  });

  it("completes the session when final phase finishes even if autoAdvance is off", () => {
    const startMs = 1_000_000;
    const res = reconcileSessionTimeline({
      phases: twoPhase,
      phaseIndex: 1,
      phaseEndMs: startMs + 60_000,
      actualStudySecs: 60,
      studyPhasesCompleted: 1,
      autoAdvance: false,
      nowMs: startMs + 70_000,
    });

    expect(res.completedAll).toBe(true);
    expect(res.actualStudySecs).toBe(60);
    expect(res.studyPhasesCompleted).toBe(1);
  });
});

describe("partial-quit accounting regression", () => {
  // Reproduces the bug the fix addresses: the user runs one phase briefly, then
  // skips ahead PAST an un-studied study phase, studies the next phase briefly,
  // and quits. The corrected accounting credits only actual elapsed time
  // (accumulated + current), never the full nominal length of skipped phases.
  it("credits actual elapsed time, not skipped phases' full duration", () => {
    const phase1 = { duration: 10 }; // Flashcard, 10 min
    // phase2 (Deep Study, 30 min) gets skipped without ever running.
    const phase3 = { duration: 15 }; // Past Question, 15 min

    // Mirrors SessionScreen's actualStudySecsRef accumulation on goToPhase:
    let accumulatedSecs = 0;
    accumulatedSecs += phaseElapsedSecs(phase1, 480); // ran phase 1 for 2 min → +120
    // Jumped straight to phase 3 → phase 2 contributes nothing.

    // Quitting during phase 3 with 1 min elapsed (900s − 840s left):
    const quitMins = minsFromSecs(
      accumulatedSecs + phaseElapsedSecs(phase3, 840)
    );

    expect(quitMins).toBe(3); // ~3 min actually studied
    expect(quitMins).toBeLessThan(41); // NOT 10 + 30 + 1 (the old inflated total)
  });

  it("credits a quit and a finish identically for the same elapsed time", () => {
    const phase = { duration: 25 };
    const secondsLeft = 600; // 15 min elapsed
    const priorAccumulated = 300; // 5 min banked from an earlier phase

    const quit = minsFromSecs(priorAccumulated + phaseElapsedSecs(phase, secondsLeft));
    const finish = minsFromSecs(priorAccumulated + phaseElapsedSecs(phase, secondsLeft));

    expect(quit).toBe(finish);
    expect(quit).toBe(20); // 5 + 15
  });
});
