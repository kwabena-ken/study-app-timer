/**
 * Pure session-timeline math shared by the timer UI, interrupted-session
 * recovery, and notification scheduling. No React/Expo imports so it can be
 * unit-tested in isolation.
 *
 * Core idea: instead of trusting in-memory `secondsLeft`, a running session is
 * described by (phaseIndex, remainingMs, anchorAt, autoAdvance). From that +
 * the current wall-clock time we can always recompute where the session
 * should be — including after the OS froze JS timers across several phase
 * boundaries while the app was backgrounded.
 */

/**
 * Total duration of a phase list in milliseconds.
 */
export function totalPhaseMs(phases) {
  return (phases || []).reduce(
    (sum, p) => sum + Math.max(0, p.duration || 0) * 60000,
    0
  );
}

/**
 * Study minutes (rounded to 0.1) for a per-phase results array.
 * Each result: { status, elapsedMs, isBreak }. Break entries never count.
 */
export function minsStudiedFromResults(results) {
  const ms = (results || []).reduce((sum, r) => {
    if (!r || r.isBreak) return sum;
    return sum + Math.max(0, r.elapsedMs || 0);
  }, 0);
  return Math.round((ms / 60000) * 10) / 10;
}

/**
 * Walk a timeline forward from `anchorAt` to `now`, consuming elapsed phases.
 *
 * Behavior:
 * - autoAdvance: crossing a completed phase rolls into the next one; crossing
 *   the final boundary finishes the session.
 * - manual (autoAdvance off): progression stops at the end of the anchored
 *   phase. The session reports `awaitingNext: true` with the phase the user
 *   must explicitly start — it never silently skips ahead.
 *
 * @param {Object} args
 * @param {Array} args.phases
 * @param {number} args.phaseIndex
 * @param {number} args.remainingMs - ms left in the anchored phase at anchorAt
 * @param {boolean} args.running - false → nothing moves (returns as-is)
 * @param {number} args.anchorAt - epoch ms when remainingMs was captured
 * @param {number} args.now - epoch ms to reconcile against
 * @param {boolean} args.autoAdvance
 * @returns {{
 *   phaseIndex: number, remainingMs: number, running: boolean,
 *   finished: boolean, awaitingNext: boolean,
 *   advancedPhases: Array<{ index: number, completed: boolean }>
 * }}
 */
export function reconcileTimeline({
  phases,
  phaseIndex,
  remainingMs,
  running,
  anchorAt,
  now,
  autoAdvance,
}) {
  const result = {
    phaseIndex,
    remainingMs: Math.max(0, remainingMs),
    running,
    finished: false,
    awaitingNext: false,
    advancedPhases: [],
  };

  if (!running || !phases.length || phaseIndex >= phases.length) {
    if (phaseIndex >= phases.length) result.finished = true;
    return result;
  }

  let elapsedMs = Math.max(0, now - anchorAt);
  let idx = phaseIndex;
  let remaining = result.remainingMs;

  while (elapsedMs > 0 && idx < phases.length) {
    if (elapsedMs < remaining) {
      remaining -= elapsedMs;
      return { ...result, phaseIndex: idx, remainingMs: remaining };
    }

    // Boundary crossed: the anchored/phase ended.
    elapsedMs -= remaining;
    result.advancedPhases.push({ index: idx, completed: true });
    idx += 1;

    if (!autoAdvance) {
      // Manual mode: stop at the boundary and wait for the user.
      return {
        ...result,
        phaseIndex: idx < phases.length ? idx : phases.length - 1,
        remainingMs:
          idx < phases.length
            ? Math.max(0, phases[idx].duration * 60000)
            : 0,
        running: false,
        finished: idx >= phases.length,
        awaitingNext: idx < phases.length,
      };
    }

    if (idx >= phases.length) {
      return {
        ...result,
        phaseIndex: phases.length - 1,
        remainingMs: 0,
        running: false,
        finished: true,
      };
    }
    remaining = Math.max(0, phases[idx].duration * 60000);
  }

  return { ...result, phaseIndex: idx, remainingMs: remaining };
}

/**
 * Build absolute notification deadlines from a reconciled timeline position.
 *
 * @param {Object} args
 * @param {Array} args.phases
 * @param {number} args.phaseIndex
 * @param {number} args.remainingMs
 * @param {number} args.now - epoch ms the chain is anchored to
 * @param {boolean} args.autoAdvance - false → only the current phase end
 * @param {(completed: Object, idx: number, phases: Array) => string} bodyFor
 * @returns {Array<{ at: number, title: string, body: string }>}
 */
export function buildNotificationChain({
  phases,
  phaseIndex,
  remainingMs,
  now,
  autoAdvance,
  bodyFor,
}) {
  if (!phases.length || phaseIndex >= phases.length) return [];
  const items = [];
  let at = now + Math.max(0, remainingMs);

  items.push({
    at,
    title: "Study Timer ⏰",
    body: bodyFor(phases[phaseIndex], phaseIndex, phases),
  });

  if (autoAdvance) {
    for (let i = phaseIndex + 1; i < phases.length; i++) {
      at += Math.max(0, phases[i].duration || 0) * 60000;
      items.push({
        at,
        title: "Study Timer ⏰",
        body: bodyFor(phases[i], i, phases),
      });
    }
  }
  return items;
}

/**
 * Default notification body text for a completed phase.
 */
export function defaultChainBody(completed, idx, phases) {
  const upNext = phases[idx + 1];
  return upNext
    ? `"${completed.name}" done. Up next: ${upNext.emoji} ${upNext.name}.`
    : `"${completed.name}" done — session complete! 🎉`;
}

/**
 * Sanity-check a persisted active-session snapshot. Returns true only if
 * resume would be safe — recovery screens should discard anything failing
 * this rather than crashing on half-written data.
 */
export function isValidSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== "object") return false;
    if (typeof snapshot.id !== "string" || !snapshot.id) return false;
    const session = snapshot.session;
    if (!session || typeof session.label !== "string") return false;
    if (!Array.isArray(session.phases)) return false;
    for (const p of session.phases) {
      if (!p || typeof p.name !== "string") return false;
      if (!Number.isFinite(p.duration) || p.duration <= 0) return false;
    }
    const t = snapshot.timeline;
    if (!t || typeof t !== "object") return false;
    if (!Number.isInteger(t.phaseIndex) || t.phaseIndex < 0) return false;
    if (t.phaseIndex >= session.phases.length && !t.finished) return false;
    if (!Number.isFinite(t.remainingMs) || t.remainingMs < 0) return false;
    if (typeof t.running !== "boolean") return false;
    if (!Number.isFinite(t.anchorAt)) return false;
    if (typeof t.startedAt !== "string") return false;
    if (t.results && !Array.isArray(t.results)) return false;
    return true;
  } catch {
    return false;
  }
}
