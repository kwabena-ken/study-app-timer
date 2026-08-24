/**
 * Pure study-streak helpers.
 *
 * Kept free of React/React-Native imports so screens and unit tests share one
 * definition of consecutive local-calendar days with a fully completed session.
 */

/**
 * Local calendar day key (device timezone), YYYY-MM-DD.
 *
 * @param {Date} date
 * @returns {string}
 */
export function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfLocalDayMs(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addLocalDaysMs(ms, n) {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return startOfLocalDayMs(d);
}

function qualifyingDaySet(sessions) {
  const days = new Set();
  for (const s of sessions || []) {
    if (!s || s.completed !== true) continue;
    const raw = s.completedAt || s.startedAt;
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) continue;
    days.add(startOfLocalDayMs(date));
  }
  return days;
}

/**
 * Current and best consecutive-day streaks from completed sessions.
 *
 * A study day is a local calendar day with at least one `completed: true`
 * record. Current streak includes today if studied today, otherwise yesterday
 * if studied yesterday (grace until midnight). Best is the longest run in
 * history.
 *
 * @param {Array<{ completed?: boolean, completedAt?: string, startedAt?: string }>} sessions
 * @param {Date} [now]
 * @returns {{ current: number, best: number, lastQualifyingDay: string | null }}
 */
export function computeStreak(sessions, now = new Date()) {
  const days = qualifyingDaySet(sessions);
  const sorted = [...days].sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let prev = null;
  for (const ms of sorted) {
    if (prev != null && ms === addLocalDaysMs(prev, 1)) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = ms;
  }

  const today = startOfLocalDayMs(now);
  const yesterday = addLocalDaysMs(today, -1);
  let current = 0;
  let cursor = null;
  if (days.has(today)) cursor = today;
  else if (days.has(yesterday)) cursor = yesterday;

  while (cursor != null && days.has(cursor)) {
    current += 1;
    cursor = addLocalDaysMs(cursor, -1);
  }

  const lastMs = sorted.length ? sorted[sorted.length - 1] : null;
  const lastQualifyingDay = lastMs != null ? localDayKey(new Date(lastMs)) : null;

  return { current, best, lastQualifyingDay };
}
