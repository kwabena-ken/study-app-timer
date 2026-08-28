const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the current Monday-to-Sunday week in local time. */
export function startOfWeek(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** Calculate focused minutes and distinct active days in the current week. */
export function computeWeeklyProgress(sessions, now = new Date()) {
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = Math.min(now.getTime() + 1, weekStart + 7 * DAY_MS);
  const activeDays = new Set();
  let mins = 0;

  for (const session of sessions || []) {
    const when = new Date(session.completedAt || session.startedAt);
    const time = when.getTime();
    if (Number.isNaN(time) || time < weekStart || time >= weekEnd) continue;

    const sessionMins =
      session.actualStudyMins != null
        ? session.actualStudyMins
        : session.totalStudyMins || 0;
    if (sessionMins <= 0) continue;

    mins += sessionMins;
    activeDays.add(
      `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`
    );
  }

  return { mins, days: activeDays.size };
}
