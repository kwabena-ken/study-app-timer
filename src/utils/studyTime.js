/**
 * Pure study-time accounting & timeline reconciliation helpers.
 *
 * Kept free of React/React-Native imports so both the session UI and the unit
 * tests can share exactly one definition of "how much study time counts" and
 * how elapsed wall-clock background time advances across phase boundaries.
 */

/**
 * Actual study seconds elapsed within a phase.
 *
 * Returns 0 for break phases or a missing phase, and never returns a negative
 * value (guards against secondsLeft briefly exceeding the phase length).
 *
 * @param {{ duration: number, isBreak?: boolean } | null | undefined} phase
 * @param {number} secondsLeft - Seconds remaining on the current phase timer
 * @returns {number} Whole/partial seconds of study actually elapsed
 */
export function phaseElapsedSecs(phase, secondsLeft) {
  if (!phase || phase.isBreak) return 0;
  return Math.max(0, phase.duration * 60 - secondsLeft);
}

/**
 * Convert seconds to minutes, rounded to one decimal place (0.1 min).
 * Any positive study time (>= 1 second) returns at least 0.1 min so brief
 * 1s–2s study intervals are preserved instead of vanishing to 0.
 *
 * @param {number} secs
 * @returns {number} Minutes rounded to the nearest 0.1 (minimum 0.1 if secs >= 1)
 */
export function minsFromSecs(secs) {
  if (!secs || secs <= 0) return 0;
  const rounded = Math.round((secs / 60) * 10) / 10;
  return secs >= 1 ? Math.max(0.1, rounded) : rounded;
}

/**
 * Format a minute count for display across Home, Stats, History, and WeeklyGoalCard.
 * Sub-minute positive values (0 < mins < 1) format as "<1m" instead of "0m".
 *
 * @param {number} mins
 * @returns {string}
 */
export function formatStudyDuration(mins) {
  const value = Number(mins) || 0;
  if (value <= 0) return "0m";
  if (value < 1) return "<1m";
  const total = Math.round(value);
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

/**
 * Reconcile a running session against wall-clock time (`nowMs`), advancing
 * across as many phase boundaries as have elapsed in the background or while
 * the app was closed.
 *
 * `actualStudySecs` is the study time already banked from earlier phases (or
 * resets); elapsed time inside the active phase is computed from remaining time
 * or credited in full when that phase crosses `phaseEndMs`.
 *
 * @param {Object} params
 * @param {Array<{ duration: number, isBreak?: boolean }>} params.phases
 * @param {number} params.phaseIndex
 * @param {number | null | undefined} params.phaseEndMs
 * @param {number} [params.actualStudySecs=0]
 * @param {number} [params.studyPhasesCompleted=0]
 * @param {boolean} [params.autoAdvance=true]
 * @param {number} [params.nowMs=Date.now()]
 * @returns {{
 *   phaseIndex: number,
 *   secondsLeft: number,
 *   phaseEndMs: number | null,
 *   running: boolean,
 *   actualStudySecs: number,
 *   totalStudySecs: number,
 *   studyPhasesCompleted: number,
 *   completedAll: boolean,
 *   phaseEndedWaiting: boolean,
 *   phasesAdvanced: number,
 *   completedAtMs: number | null,
 * }}
 */
export function reconcileSessionTimeline({
  phases,
  phaseIndex = 0,
  phaseEndMs,
  actualStudySecs = 0,
  studyPhasesCompleted = 0,
  autoAdvance = true,
  nowMs = Date.now(),
}) {
  if (!Array.isArray(phases) || phases.length === 0) {
    return {
      phaseIndex: 0,
      secondsLeft: 0,
      phaseEndMs: null,
      running: false,
      actualStudySecs: Math.max(0, actualStudySecs || 0),
      totalStudySecs: Math.max(0, actualStudySecs || 0),
      studyPhasesCompleted: Math.max(0, studyPhasesCompleted || 0),
      completedAll: true,
      phaseEndedWaiting: false,
      phasesAdvanced: 0,
      completedAtMs: nowMs,
    };
  }

  let idx = Math.max(0, Math.min(phaseIndex || 0, phases.length - 1));
  let bankedSecs = Math.max(0, actualStudySecs || 0);
  let completedStudyCount = Math.max(0, studyPhasesCompleted || 0);

  if (phaseEndMs == null) {
    const durSecs = Math.max(0, (phases[idx]?.duration || 0) * 60);
    return {
      phaseIndex: idx,
      secondsLeft: durSecs,
      phaseEndMs: null,
      running: false,
      actualStudySecs: bankedSecs,
      totalStudySecs: bankedSecs,
      studyPhasesCompleted: completedStudyCount,
      completedAll: false,
      phaseEndedWaiting: false,
      phasesAdvanced: 0,
      completedAtMs: null,
    };
  }

  let cursorEndMs = phaseEndMs;
  let phasesAdvanced = 0;
  let lastCompletedAtMs = null;

  while (nowMs >= cursorEndMs) {
    const current = phases[idx];
    const durSecs = Math.max(0, (current?.duration || 0) * 60);

    if (current && !current.isBreak && durSecs > 0) {
      bankedSecs += durSecs;
      completedStudyCount += 1;
    }

    phasesAdvanced += 1;
    lastCompletedAtMs = cursorEndMs;

    // Final phase finished — whole session is complete.
    if (idx + 1 >= phases.length) {
      return {
        phaseIndex: idx,
        secondsLeft: 0,
        phaseEndMs: null,
        running: false,
        actualStudySecs: bankedSecs,
        totalStudySecs: bankedSecs,
        studyPhasesCompleted: completedStudyCount,
        completedAll: true,
        phaseEndedWaiting: false,
        phasesAdvanced,
        completedAtMs: lastCompletedAtMs,
      };
    }

    // Auto-advance disabled: pause at the start of the next phase.
    if (!autoAdvance) {
      const nextIdx = idx + 1;
      const nextDurSecs = Math.max(0, (phases[nextIdx]?.duration || 0) * 60);
      return {
        phaseIndex: nextIdx,
        secondsLeft: nextDurSecs,
        phaseEndMs: null,
        running: false,
        actualStudySecs: bankedSecs,
        totalStudySecs: bankedSecs,
        studyPhasesCompleted: completedStudyCount,
        completedAll: false,
        phaseEndedWaiting: true,
        phasesAdvanced,
        completedAtMs: lastCompletedAtMs,
      };
    }

    idx += 1;
    const nextDurMs = Math.max(0, (phases[idx]?.duration || 0) * 60 * 1000);
    cursorEndMs += nextDurMs;
  }

  const current = phases[idx];
  const durSecs = Math.max(0, (current?.duration || 0) * 60);
  const remainingSecs = Math.min(
    durSecs,
    Math.max(1, Math.ceil((cursorEndMs - nowMs) / 1000))
  );
  const currentElapsedSecs = phaseElapsedSecs(current, remainingSecs);

  return {
    phaseIndex: idx,
    secondsLeft: remainingSecs,
    phaseEndMs: cursorEndMs,
    running: true,
    actualStudySecs: bankedSecs,
    totalStudySecs: bankedSecs + currentElapsedSecs,
    studyPhasesCompleted: completedStudyCount,
    completedAll: false,
    phaseEndedWaiting: false,
    phasesAdvanced,
    completedAtMs: lastCompletedAtMs,
  };
}
