import { useState, useEffect, useRef, useCallback } from "react";
import { AppState } from "react-native";

/**
 * Wall-clock timestamp-based countdown timer hook.
 *
 * Uses an explicit epoch-ms `targetEndRef` so background suspension, JS timer
 * throttling, or Option A reloads stay synced to wall-clock time. Immediately
 * ticks when `AppState` returns to `"active"`.
 *
 * @param {Object} options
 * @param {(finishedAtMs: number) => void} options.onComplete - Called when timer reaches 0
 */
export function useTimer({ onComplete } = {}) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [running, setRunningState] = useState(false);
  // Bumped by restart()/startWithTarget() to force the countdown effect to
  // re-run even when `running` was already true.
  const [runToken, setRunToken] = useState(0);

  const targetEndRef = useRef(null);
  const intervalRef = useRef(null);
  const secondsLeftRef = useRef(0);
  const runningRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // ── Timestamp-based countdown loop ──
  useEffect(() => {
    if (!running) {
      clearInterval(intervalRef.current);
      targetEndRef.current = null;
      return;
    }

    if (targetEndRef.current == null) {
      targetEndRef.current = Date.now() + secondsLeftRef.current * 1000;
    }

    const tick = () => {
      if (targetEndRef.current == null) return;
      const diffMs = targetEndRef.current - Date.now();
      if (diffMs <= 0) {
        const finishedAtMs = targetEndRef.current;
        targetEndRef.current = null;
        clearInterval(intervalRef.current);
        secondsLeftRef.current = 0;
        runningRef.current = false;
        setSecondsLeft(0);
        setRunningState(false);
        onCompleteRef.current?.(finishedAtMs);
      } else {
        const remaining = Math.ceil(diffMs / 1000);
        if (remaining !== secondsLeftRef.current) {
          secondsLeftRef.current = remaining;
          setSecondsLeft(remaining);
        }
      }
    };

    intervalRef.current = setInterval(tick, 250);
    tick();

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        tick();
      }
    });

    return () => {
      clearInterval(intervalRef.current);
      appStateSub?.remove?.();
    };
  }, [running, runToken]);

  /**
   * Toggle or set running state. When pausing, snapshots exact wall-clock
   * remaining seconds before clearing `targetEndRef`.
   */
  const setRunning = useCallback((nextOrUpdater) => {
    const next =
      typeof nextOrUpdater === "function"
        ? nextOrUpdater(runningRef.current)
        : nextOrUpdater;

    if (!next) {
      clearInterval(intervalRef.current);
      if (targetEndRef.current != null) {
        const remaining = Math.max(
          0,
          Math.ceil((targetEndRef.current - Date.now()) / 1000)
        );
        secondsLeftRef.current = remaining;
        setSecondsLeft(remaining);
        targetEndRef.current = null;
      }
    }

    runningRef.current = next;
    setRunningState(next);
  }, []);

  /**
   * Set the timer to a new duration (in seconds) and pause it.
   * Used when switching phases, loading initial duration, or resetting.
   */
  const loadDuration = useCallback((secs) => {
    clearInterval(intervalRef.current);
    targetEndRef.current = null;
    secondsLeftRef.current = secs;
    runningRef.current = false;
    setSecondsLeft(secs);
    setRunningState(false);
  }, []);

  /**
   * Stop the timer without resetting the remaining time.
   */
  const stop = useCallback(() => {
    clearInterval(intervalRef.current);
    if (targetEndRef.current != null) {
      const remaining = Math.max(
        0,
        Math.ceil((targetEndRef.current - Date.now()) / 1000)
      );
      secondsLeftRef.current = remaining;
      setSecondsLeft(remaining);
      targetEndRef.current = null;
    }
    runningRef.current = false;
    setRunningState(false);
  }, []);

  /**
   * Set a new duration (in seconds) — or an explicit wall-clock `targetEndMs` —
   * and immediately start the countdown. Bumps runToken so the effect restarts
   * even if `running` was already true.
   */
  const restart = useCallback((secs, explicitTargetEndMs = null) => {
    clearInterval(intervalRef.current);
    const nextTarget =
      explicitTargetEndMs != null
        ? explicitTargetEndMs
        : Date.now() + secs * 1000;
    targetEndRef.current = nextTarget;
    const nextSecs =
      explicitTargetEndMs != null
        ? Math.max(0, Math.ceil((nextTarget - Date.now()) / 1000))
        : secs;
    secondsLeftRef.current = nextSecs;
    runningRef.current = true;
    setSecondsLeft(nextSecs);
    setRunningState(true);
    setRunToken((t) => t + 1);
  }, []);

  /**
   * Start counting down directly toward an explicit wall-clock target timestamp.
   */
  const startWithTarget = useCallback(
    (targetEndMs) => {
      const remaining = Math.max(
        0,
        Math.ceil((targetEndMs - Date.now()) / 1000)
      );
      restart(remaining, targetEndMs);
    },
    [restart]
  );

  return {
    secondsLeft,
    running,
    setRunning,
    loadDuration,
    stop,
    restart,
    startWithTarget,
    targetEndRef,
  };
}
