import {
  computeDialSegments,
  computeProgress,
  headPoint,
} from "../dialGeometry";

const PHASES = [
  { duration: 10 }, // 0
  { duration: 3 }, // 1 break
  { duration: 30 }, // 2
  { duration: 3 }, // 3 break
  { duration: 15 }, // 4
];

describe("computeDialSegments", () => {
  it("returns one segment per phase", () => {
    const segs = computeDialSegments({ phases: PHASES, radius: 100 });
    expect(segs).toHaveLength(PHASES.length);
  });

  it("each dash array spans the full circumference", () => {
    const radius = 100;
    const C = 2 * Math.PI * radius;
    const segs = computeDialSegments({ phases: PHASES, radius });
    for (const s of segs) {
      expect(s.dashArray[0] + s.dashArray[1]).toBeCloseTo(C, 5);
      expect(s.circumference).toBeCloseTo(C, 5);
    }
  });

  it("segment fractions sum to 1 and are proportional to duration", () => {
    const segs = computeDialSegments({ phases: PHASES, radius: 100 });
    const sum = segs.reduce((a, s) => a + s.fraction, 0);
    expect(sum).toBeCloseTo(1, 5);
    // 30-min phase (index 2) should be 3x the 10-min phase (index 0)
    expect(segs[2].fraction / segs[0].fraction).toBeCloseTo(3, 5);
  });

  it("larger gaps shrink the drawn portion of every segment", () => {
    const wide = computeDialSegments({ phases: PHASES, radius: 100, gapDeg: 10 });
    const tight = computeDialSegments({ phases: PHASES, radius: 100, gapDeg: 1 });
    for (let i = 0; i < wide.length; i++) {
      expect(wide[i].dashArray[0]).toBeLessThan(tight[i].dashArray[0]);
    }
  });

  it("handles empty phases without dividing by zero", () => {
    expect(computeDialSegments({ phases: [], radius: 100 })).toEqual([]);
  });
});

describe("computeProgress", () => {
  it("is 0 at the very start of the first phase", () => {
    const { fraction } = computeProgress({
      phases: PHASES,
      phaseIndex: 0,
      secondsLeft: PHASES[0].duration * 60,
    });
    expect(fraction).toBeCloseTo(0, 5);
  });

  it("is 1 when the last phase hits zero", () => {
    const { fraction } = computeProgress({
      phases: PHASES,
      phaseIndex: PHASES.length - 1,
      secondsLeft: 0,
    });
    expect(fraction).toBeCloseTo(1, 5);
  });

  it("counts whole elapsed phases plus the active phase's progress", () => {
    // Through phases 0+1 (13 min) and halfway into phase 2 (15 of 30 min)
    const { elapsedSecs, totalSecs } = computeProgress({
      phases: PHASES,
      phaseIndex: 2,
      secondsLeft: 15 * 60,
    });
    expect(elapsedSecs).toBe((10 + 3 + 15) * 60);
    expect(totalSecs).toBe((10 + 3 + 30 + 3 + 15) * 60);
  });

  it("never exceeds 1 or drops below 0", () => {
    const over = computeProgress({ phases: PHASES, phaseIndex: 4, secondsLeft: -50 });
    expect(over.fraction).toBeLessThanOrEqual(1);
    const under = computeProgress({ phases: PHASES, phaseIndex: 0, secondsLeft: 999999 });
    expect(under.fraction).toBeGreaterThanOrEqual(0);
  });
});

describe("headPoint", () => {
  const base = { cx: 0, cy: 0, radius: 100 };

  it("places fraction 0 at the top", () => {
    const { x, y } = headPoint({ fraction: 0, ...base });
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(-100, 5);
  });

  it("places fraction 0.25 at the right (3 o'clock)", () => {
    const { x, y } = headPoint({ fraction: 0.25, ...base });
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("places fraction 0.5 at the bottom", () => {
    const { x, y } = headPoint({ fraction: 0.5, ...base });
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(100, 5);
  });
});
