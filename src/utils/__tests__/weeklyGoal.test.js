import { computeWeeklyProgress, startOfWeek } from "../weeklyGoal";

describe("weekly goals", () => {
  it("starts the week on Monday", () => {
    const start = startOfWeek(new Date(2026, 7, 28)); // Friday
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(24);
  });

  it("counts current-week minutes and distinct study days", () => {
    const sessions = [
      { completedAt: "2026-08-24T10:00:00", actualStudyMins: 30 },
      { completedAt: "2026-08-24T15:00:00", actualStudyMins: 20 },
      { completedAt: "2026-08-26T10:00:00", totalStudyMins: 60 },
      { completedAt: "2026-08-27T10:00:00", actualStudyMins: 0 },
      { completedAt: "2026-08-23T10:00:00", actualStudyMins: 90 },
      { completedAt: "2026-08-29T10:00:00", actualStudyMins: 90 },
    ];
    expect(computeWeeklyProgress(sessions, new Date(2026, 7, 28))).toEqual({
      mins: 110,
      days: 2,
    });
  });
});
