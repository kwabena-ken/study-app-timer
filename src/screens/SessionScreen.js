import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  Switch,
  AppState,
  BackHandler,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { studyColors, breakColor } from "../constants/sessions";
import { formatTime } from "../utils/formatTime";
import {
  phaseElapsedSecs,
  minsFromSecs,
  reconcileSessionTimeline,
} from "../utils/studyTime";
import { generateId } from "../utils/generateId";
import { confirmDialog } from "../utils/confirm";
import { useTimer } from "../hooks/useTimer";
import { useNotifications } from "../hooks/useNotifications";
import { useAlarmSound } from "../hooks/useAlarmSound";
import {
  loadSettings,
  saveSettings,
  upsertSession,
  deleteSession,
  saveActiveSession,
  clearActiveSession,
  flushWebSessionSync,
} from "../utils/storage";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import ScreenContainer from "../components/ScreenContainer";
import SessionDial from "../components/SessionDial";
import Icon from "../components/Icon";

// Tag for the imperative keep-awake lock (held only while the timer runs).
const KEEP_AWAKE_TAG = "study-session";
// Vibration pattern for the phase-complete alarm (mirrors the notification channel).
const ALARM_VIBRATION = [0, 500, 250, 500];
// Icy-cyan bloom behind the active dial segment, echoing the app icon.
const DIAL_GLOW = "#22d3ee";

/**
 * Session screen — timer, controls, progress, tips, continuous checkpointing,
 * wall-clock background reconciliation, and Option A auto-resume.
 */
export default function SessionScreen({
  session,
  sessionKey,
  subject,
  subjectColor,
  resumeState,
  onGoHome,
  onComplete,
  onPartialQuit,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const phases = session.phases;
  const totalStudyMins = useMemo(
    () =>
      phases
        .filter((p) => !p.isBreak)
        .reduce((a, p) => a + (p.duration || 0), 0),
    [phases]
  );

  const initialPhaseIndex = resumeState?.phaseIndex ?? 0;
  const [phaseIndex, setPhaseIndex] = useState(initialPhaseIndex);
  const [showTip, setShowTip] = useState(false);
  const phase = phases[phaseIndex] || null;

  // Auto-advance: when on, a finished phase immediately starts the next one.
  // Seeded from resumeState (when resuming) or saved settings, toggleable live.
  const [autoAdvance, setAutoAdvance] = useState(
    resumeState?.autoAdvance != null ? resumeState.autoAdvance : true
  );
  // Which bundled alarm sound plays for foreground & background alarms.
  const [soundPreset, setSoundPreset] = useState("classic");
  // Honor the user's Settings toggles (seeded on; overwritten once settings load).
  const [vibrate, setVibrate] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);

  // Stable session id + start timestamp created on first Play (or restored via Option A).
  const sessionIdRef = useRef(resumeState?.sessionId || null);
  const startedAtRef = useRef(resumeState?.startedAt || null);

  // Accumulates banked study seconds from prior phases/resets (only real elapsed time).
  const actualStudySecsRef = useRef(resumeState?.actualStudySecs || 0);
  // Tracks study phases where >0s actually elapsed (never counts 0s-skipped phases).
  const completedStudyPhasesRef = useRef(resumeState?.studyPhasesCompleted || 0);

  // Guard so unmount / beforeunload doesn't re-create a checkpoint after Leave or Finish.
  const finalizedRef = useRef(false);
  const initializedRef = useRef(false);
  const lastFlushedStudyMinsRef = useRef(null);

  const { scheduleChain, cancelAll } = useNotifications();
  const { playAlarm } = useAlarmSound();

  // Route the timer's completion callback through a ref to break definition-order cycle.
  const onCompleteRef = useRef(() => {});
  const fireComplete = useCallback(
    (finishedAtMs) => onCompleteRef.current?.(finishedAtMs),
    []
  );

  const {
    secondsLeft,
    running,
    setRunning,
    loadDuration,
    stop,
    restart,
    startWithTarget,
    targetEndRef,
  } = useTimer({ onComplete: fireComplete });

  // Mirror live state into refs so async / AppState / unload callbacks never read stale values.
  const secondsLeftRef = useRef(
    resumeState?.secondsLeft ?? (phases[initialPhaseIndex]?.duration || 0) * 60
  );
  secondsLeftRef.current = secondsLeft;

  const runningRef = useRef(false);
  runningRef.current = running;

  const phaseIndexRef = useRef(phaseIndex);
  phaseIndexRef.current = phaseIndex;

  const autoAdvanceRef = useRef(autoAdvance);
  autoAdvanceRef.current = autoAdvance;

  const soundPresetRef = useRef(soundPreset);
  soundPresetRef.current = soundPreset;

  const vibrateRef = useRef(true);
  vibrateRef.current = vibrate;

  const getLiveSecondsLeft = useCallback(() => {
    if (runningRef.current && targetEndRef.current != null) {
      return Math.max(0, Math.ceil((targetEndRef.current - Date.now()) / 1000));
    }
    return secondsLeftRef.current;
  }, [targetEndRef]);

  // Build snapshot + draft history payload for checkpointing.
  const buildCheckpointPayload = useCallback(
    (overrides = {}) => {
      if (!sessionIdRef.current || !startedAtRef.current) return null;

      const idx = overrides.phaseIndex ?? phaseIndexRef.current;
      const isRunning = overrides.running ?? runningRef.current;
      const phaseEndMs =
        overrides.phaseEndMs !== undefined
          ? overrides.phaseEndMs
          : isRunning
          ? targetEndRef.current
          : null;
      const secsLeft =
        overrides.secondsLeft !== undefined
          ? overrides.secondsLeft
          : isRunning && phaseEndMs != null
          ? Math.max(0, Math.ceil((phaseEndMs - Date.now()) / 1000))
          : secondsLeftRef.current;
      const bankedSecs = overrides.actualStudySecs ?? actualStudySecsRef.current;
      const completedPhases =
        overrides.studyPhasesCompleted ?? completedStudyPhasesRef.current;
      const autoAdv = overrides.autoAdvance ?? autoAdvanceRef.current;

      const currentPhase = phases[idx];
      const totalStudySecs = bankedSecs + phaseElapsedSecs(currentPhase, secsLeft);
      const actualStudyMins = minsFromSecs(totalStudySecs);
      const nowIso = new Date().toISOString();

      const snapshot = {
        sessionId: sessionIdRef.current,
        sessionKey: sessionKey || null,
        session,
        subject: subject || null,
        subjectColor: subjectColor || null,
        startedAt: startedAtRef.current,
        phaseIndex: idx,
        secondsLeft: secsLeft,
        running: isRunning,
        phaseEndMs: isRunning ? phaseEndMs : null,
        actualStudySecs: bankedSecs,
        studyPhasesCompleted: completedPhases,
        autoAdvance: autoAdv,
        updatedAt: Date.now(),
      };

      const draftRecord = {
        id: sessionIdRef.current,
        sessionType: sessionKey || "custom",
        label: session.label,
        subject: subject || "Unspecified",
        startedAt: startedAtRef.current,
        completedAt: nowIso,
        phasesCompleted: completedPhases,
        totalStudyMins,
        actualStudyMins,
        completed: false,
      };

      return { snapshot, draftRecord, actualStudyMins };
    },
    [phases, session, sessionKey, subject, subjectColor, totalStudyMins, targetEndRef]
  );

  // Persist active session checkpoint and upsert draft History entry.
  const checkpointProgress = useCallback(
    (overrides = {}) => {
      if (finalizedRef.current) return;
      const payload = buildCheckpointPayload(overrides);
      if (!payload) return;

      lastFlushedStudyMinsRef.current = payload.actualStudyMins;
      saveActiveSession(payload.snapshot).catch(() => {});
      upsertSession(payload.draftRecord).catch(() => {});
    },
    [buildCheckpointPayload]
  );

  // Haptic helpers — no-ops when the user turned Vibration off in Settings.
  const impact = useCallback(() => {
    if (vibrateRef.current && Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, []);
  const selection = useCallback(() => {
    if (vibrateRef.current && Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  // Load saved prefs once on mount (preserving resumeState.autoAdvance if present).
  useEffect(() => {
    let mounted = true;
    loadSettings().then((s) => {
      if (!mounted) return;
      if (resumeState?.autoAdvance == null) {
        setAutoAdvance(s.autoAdvance !== false);
      }
      setSoundPreset(s.soundPreset || "classic");
      setVibrate(s.vibrate !== false);
      setKeepAwake(s.keepAwake !== false);
    });
    return () => {
      mounted = false;
    };
  }, [resumeState]);

  // Hold a keep-awake lock only while the timer is actively running, and only
  // if the user left the setting on. Released on pause, toggle-off, or unmount.
  useEffect(() => {
    if (running && keepAwake && Platform.OS !== "web") {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      return () => {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      };
    }
  }, [running, keepAwake]);

  // Initialize timer duration (or Option A wall-clock resume target) once on mount.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (resumeState?.running && resumeState?.phaseEndMs != null) {
      startWithTarget(resumeState.phaseEndMs);
    } else if (resumeState?.secondsLeft != null) {
      loadDuration(resumeState.secondsLeft);
    } else {
      loadDuration((phases[0]?.duration || 0) * 60);
    }
  }, [loadDuration, startWithTarget, phases, resumeState]);

  // Periodically flush draft study minutes as they advance (captures the very
  // first >=1s study tick immediately, then every 0.1 min / ~6s while running).
  useEffect(() => {
    if (!running || finalizedRef.current || !sessionIdRef.current) return;
    const totalSecs =
      actualStudySecsRef.current + phaseElapsedSecs(phase, secondsLeft);
    const currentMins = minsFromSecs(totalSecs);
    if (currentMins > 0 && currentMins !== lastFlushedStudyMinsRef.current) {
      checkpointProgress();
    }
  }, [running, secondsLeft, phase, checkpointProgress]);

  // Build the wall-clock DATE notification chain for all upcoming phase ends.
  const buildChainItems = useCallback(() => {
    const current = phases[phaseIndex];
    if (!current) return [];

    const bodyFor = (completed, idx) => {
      const upNextPhase = phases[idx + 1];
      return upNextPhase
        ? `"${completed.name}" done. Up next: ${upNextPhase.emoji} ${upNextPhase.name}.`
        : `"${completed.name}" done — session complete! 🎉`;
    };

    let targetMs =
      targetEndRef.current != null
        ? targetEndRef.current
        : Date.now() + secondsLeftRef.current * 1000;

    const items = [
      {
        targetMs,
        title: "Study Timer ⏰",
        body: bodyFor(current, phaseIndex),
      },
    ];

    if (autoAdvance) {
      for (let i = phaseIndex + 1; i < phases.length; i++) {
        targetMs += phases[i].duration * 60 * 1000;
        items.push({
          targetMs,
          title: "Study Timer ⏰",
          body: bodyFor(phases[i], i),
        });
      }
    }
    return items;
  }, [phases, phaseIndex, autoAdvance, targetEndRef]);

  // ── (Re)schedule or cancel the notification chain ──
  useEffect(() => {
    if (running) {
      scheduleChain(buildChainItems(), soundPreset, { vibrate });
    } else {
      cancelAll();
    }
  }, [
    running,
    phaseIndex,
    autoAdvance,
    soundPreset,
    vibrate,
    buildChainItems,
    scheduleChain,
    cancelAll,
  ]);

  // ── Per-phase identity color ──
  const getPhaseColor = useCallback(
    (i) => {
      const p = phases[i];
      if (!p) return studyColors[0];
      if (p.isBreak) return breakColor;
      const studyIdx =
        phases.slice(0, i + 1).filter((x) => !x.isBreak).length - 1;
      return studyColors[studyIdx % studyColors.length];
    },
    [phases]
  );

  const color = useMemo(
    () => getPhaseColor(phaseIndex),
    [getPhaseColor, phaseIndex]
  );

  const isBreakPhase = phase?.isBreak;
  const studyPhaseCount = phases.filter((p) => !p.isBreak).length;
  const currentStudyNum = phases
    .slice(0, phaseIndex + 1)
    .filter((p) => !p.isBreak).length;
  const upNext = phases[phaseIndex + 1] || null;

  // Finish the whole session (last phase done, or final phase skipped).
  const finishSession = useCallback(
    (overrideMeta = null) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;

      let totalStudySecs;
      let completedPhases;
      let completedAt;

      if (overrideMeta) {
        totalStudySecs = overrideMeta.totalStudySecs;
        completedPhases = overrideMeta.studyPhasesCompleted;
        completedAt = overrideMeta.completedAt;
      } else {
        const currentPhase = phases[phaseIndexRef.current];
        const elapsed = phaseElapsedSecs(currentPhase, getLiveSecondsLeft());
        actualStudySecsRef.current += elapsed;
        if (currentPhase && !currentPhase.isBreak && elapsed > 0) {
          completedStudyPhasesRef.current += 1;
        }
        totalStudySecs = actualStudySecsRef.current;
        completedPhases = completedStudyPhasesRef.current;
        completedAt = new Date().toISOString();
      }

      stop();
      cancelAll();
      clearActiveSession().catch(() => {});

      const actualStudyMins = minsFromSecs(totalStudySecs);
      onComplete({
        sessionId: sessionIdRef.current,
        startedAt: startedAtRef.current,
        completedAt,
        actualStudyMins,
        phasesCompleted: completedPhases,
      });
    },
    [phases, getLiveSecondsLeft, stop, cancelAll, onComplete]
  );

  // Manual phase switch (skip forward). Only credits study phases where >0s elapsed.
  const goToPhase = useCallback(
    (idx, autoStart = false, explicitTargetEndMs = null) => {
      const currentPhase = phases[phaseIndexRef.current];
      const elapsed = phaseElapsedSecs(currentPhase, getLiveSecondsLeft());
      actualStudySecsRef.current += elapsed;
      if (currentPhase && !currentPhase.isBreak && elapsed > 0) {
        completedStudyPhasesRef.current += 1;
      }

      phaseIndexRef.current = idx;
      setPhaseIndex(idx);
      setShowTip(false);

      const nextDurSecs = (phases[idx]?.duration || 0) * 60;
      if (autoStart) {
        const nextEndMs = explicitTargetEndMs ?? Date.now() + nextDurSecs * 1000;
        restart(nextDurSecs, nextEndMs);
        checkpointProgress({
          phaseIndex: idx,
          running: true,
          phaseEndMs: nextEndMs,
          secondsLeft: Math.max(0, Math.ceil((nextEndMs - Date.now()) / 1000)),
        });
      } else {
        cancelAll();
        loadDuration(nextDurSecs);
        checkpointProgress({
          phaseIndex: idx,
          running: false,
          phaseEndMs: null,
          secondsLeft: nextDurSecs,
        });
      }
    },
    [phases, getLiveSecondsLeft, restart, cancelAll, loadDuration, checkpointProgress]
  );

  const nextPhase = useCallback(() => {
    if (phaseIndexRef.current + 1 < phases.length) {
      goToPhase(phaseIndexRef.current + 1);
    } else {
      finishSession();
    }
  }, [phases.length, goToPhase, finishSession]);

  // Reconcile wall-clock elapsed phases (used on timer completion AND foreground resume).
  const reconcileRunningTimeline = useCallback(
    (phaseEndMs, { playAlarmOnAdvance = true } = {}) => {
      if (finalizedRef.current || phaseEndMs == null) return;

      const rec = reconcileSessionTimeline({
        phases,
        phaseIndex: phaseIndexRef.current,
        phaseEndMs,
        actualStudySecs: actualStudySecsRef.current,
        studyPhasesCompleted: completedStudyPhasesRef.current,
        autoAdvance: autoAdvanceRef.current,
        nowMs: Date.now(),
      });

      if (rec.phasesAdvanced === 0) {
        checkpointProgress({
          phaseIndex: rec.phaseIndex,
          running: true,
          phaseEndMs: rec.phaseEndMs,
          secondsLeft: rec.secondsLeft,
        });
        return;
      }

      if (playAlarmOnAdvance) {
        playAlarm(soundPresetRef.current);
        if (vibrateRef.current && Platform.OS !== "web") {
          Vibration.vibrate(ALARM_VIBRATION);
        }
      }

      actualStudySecsRef.current = rec.actualStudySecs;
      completedStudyPhasesRef.current = rec.studyPhasesCompleted;

      if (rec.completedAll) {
        finishSession({
          totalStudySecs: rec.totalStudySecs,
          studyPhasesCompleted: rec.studyPhasesCompleted,
          completedAt: rec.completedAtMs
            ? new Date(rec.completedAtMs).toISOString()
            : new Date().toISOString(),
        });
        return;
      }

      phaseIndexRef.current = rec.phaseIndex;
      setPhaseIndex(rec.phaseIndex);
      setShowTip(false);

      if (rec.phaseEndedWaiting) {
        cancelAll();
        loadDuration(rec.secondsLeft);
        checkpointProgress({
          phaseIndex: rec.phaseIndex,
          running: false,
          phaseEndMs: null,
          secondsLeft: rec.secondsLeft,
          actualStudySecs: rec.actualStudySecs,
          studyPhasesCompleted: rec.studyPhasesCompleted,
        });
        return;
      }

      // Still inside a subsequent phase with autoAdvance enabled — preserve exact wall-clock end.
      restart(rec.secondsLeft, rec.phaseEndMs);
      checkpointProgress({
        phaseIndex: rec.phaseIndex,
        running: true,
        phaseEndMs: rec.phaseEndMs,
        secondsLeft: rec.secondsLeft,
        actualStudySecs: rec.actualStudySecs,
        studyPhasesCompleted: rec.studyPhasesCompleted,
      });
    },
    [phases, playAlarm, finishSession, cancelAll, loadDuration, restart, checkpointProgress]
  );

  // Called by useTimer whenever the current phase's wall-clock target expires.
  const handlePhaseComplete = useCallback(
    (finishedAtMs) => {
      reconcileRunningTimeline(finishedAtMs ?? Date.now(), {
        playAlarmOnAdvance: true,
      });
    },
    [reconcileRunningTimeline]
  );

  onCompleteRef.current = handlePhaseComplete;

  // Flush checkpoints on background/inactive and reconcile wall-clock time on foreground active.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (finalizedRef.current) return;
      if (nextState === "background" || nextState === "inactive") {
        checkpointProgress();
      } else if (nextState === "active") {
        if (runningRef.current && targetEndRef.current != null) {
          reconcileRunningTimeline(targetEndRef.current, {
            playAlarmOnAdvance: true,
          });
        }
      }
    });
    return () => sub?.remove?.();
  }, [checkpointProgress, reconcileRunningTimeline, targetEndRef]);

  // Web: synchronously flush active checkpoint + draft history on pagehide/beforeunload/visibilitychange.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handlePageHide = () => {
      if (finalizedRef.current) return;
      const payload = buildCheckpointPayload();
      if (payload) {
        flushWebSessionSync(payload.snapshot, payload.draftRecord);
      }
    };

    const handleVisibilityChange = () => {
      if (finalizedRef.current) return;
      if (document.visibilityState === "hidden") {
        handlePageHide();
      } else if (document.visibilityState === "visible") {
        if (runningRef.current && targetEndRef.current != null) {
          reconcileRunningTimeline(targetEndRef.current, {
            playAlarmOnAdvance: true,
          });
        }
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [buildCheckpointPayload, reconcileRunningTimeline, targetEndRef]);

  // Flush progress if SessionScreen unmounts unexpectedly without finalizing.
  useEffect(() => {
    return () => {
      if (!finalizedRef.current) {
        const payload = buildCheckpointPayload();
        if (payload) {
          if (Platform.OS === "web") {
            flushWebSessionSync(payload.snapshot, payload.draftRecord);
          }
          saveActiveSession(payload.snapshot).catch(() => {});
          upsertSession(payload.draftRecord).catch(() => {});
        }
      }
    };
  }, [buildCheckpointPayload]);

  const resetPhase = useCallback(() => {
    if (!phase) return;
    // Bank any study seconds already elapsed before resetting the current phase timer.
    const elapsed = phaseElapsedSecs(phase, getLiveSecondsLeft());
    if (elapsed > 0) {
      actualStudySecsRef.current += elapsed;
    }

    const fullSecs = phase.duration * 60;
    cancelAll();
    loadDuration(fullSecs);
    checkpointProgress({
      running: false,
      phaseEndMs: null,
      secondsLeft: fullSecs,
      actualStudySecs: actualStudySecsRef.current,
    });
  }, [phase, getLiveSecondsLeft, cancelAll, loadDuration, checkpointProgress]);

  // ── Handlers with haptics & cross-platform confirmations ──
  const handlePlayPause = useCallback(() => {
    impact();
    if (!runningRef.current) {
      if (!sessionIdRef.current) {
        sessionIdRef.current = generateId();
      }
      if (!startedAtRef.current) {
        startedAtRef.current = new Date().toISOString();
      }
      const nextTargetMs = Date.now() + secondsLeftRef.current * 1000;
      startWithTarget(nextTargetMs);
      checkpointProgress({
        running: true,
        phaseEndMs: nextTargetMs,
        secondsLeft: secondsLeftRef.current,
      });
    } else {
      const remaining = getLiveSecondsLeft();
      setRunning(false);
      checkpointProgress({
        running: false,
        phaseEndMs: null,
        secondsLeft: remaining,
      });
    }
  }, [impact, startWithTarget, setRunning, getLiveSecondsLeft, checkpointProgress]);

  const handleSkip = useCallback(async () => {
    if (runningRef.current) {
      const confirmed = await confirmDialog({
        title: "Skip Phase?",
        message: "Are you sure you want to skip to the next phase?",
        confirmText: "Skip",
      });
      if (!confirmed) return;
    }
    impact();
    nextPhase();
  }, [impact, nextPhase]);

  const handleReset = useCallback(async () => {
    if (!phase) return;
    const fullSecs = phase.duration * 60;
    const isMidPhase = runningRef.current || getLiveSecondsLeft() < fullSecs;

    if (isMidPhase) {
      const confirmed = await confirmDialog({
        title: "Reset Phase?",
        message:
          "Restart this phase timer from the beginning? Any study time already elapsed will still be saved.",
        confirmText: "Reset",
        destructive: true,
      });
      if (!confirmed) return;
    }

    impact();
    resetPhase();
  }, [phase, getLiveSecondsLeft, impact, resetPhase]);

  // Flip auto-advance live and persist the new default for next time.
  const toggleAutoAdvance = useCallback(() => {
    selection();
    setAutoAdvance((prev) => {
      const next = !prev;
      autoAdvanceRef.current = next;
      saveSettings({ autoAdvance: next });
      checkpointProgress({ autoAdvance: next });
      return next;
    });
  }, [selection, checkpointProgress]);

  const handleGoHome = useCallback(async () => {
    const doLeave = async () => {
      finalizedRef.current = true;
      const liveSecs = getLiveSecondsLeft();
      stop();
      cancelAll();

      const currentPhase = phases[phaseIndexRef.current];
      const totalSecs =
        actualStudySecsRef.current + phaseElapsedSecs(currentPhase, liveSecs);
      const actualStudyMins = minsFromSecs(totalSecs);

      await clearActiveSession().catch(() => {});

      if (startedAtRef.current && actualStudyMins > 0 && onPartialQuit) {
        onPartialQuit({
          sessionId: sessionIdRef.current,
          startedAt: startedAtRef.current,
          actualStudyMins,
          phasesCompleted: completedStudyPhasesRef.current,
        });
        return;
      }

      // Clean up any 0m draft created on Play before even 1s elapsed.
      if (sessionIdRef.current) {
        await deleteSession(sessionIdRef.current).catch(() => {});
      }

      onGoHome();
    };

    if (runningRef.current) {
      const confirmed = await confirmDialog({
        title: "Leave Session?",
        message: "Your timer is still running. Your progress will be saved.",
        confirmText: "Leave",
        destructive: true,
      });
      if (!confirmed) return;
    }

    await doLeave();
  }, [getLiveSecondsLeft, stop, cancelAll, phases, onPartialQuit, onGoHome]);

  // Wire Android hardware back button to the Leave Session flow.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleGoHome();
      return true;
    });
    return () => sub.remove();
  }, [handleGoHome]);

  // ── Memoized dynamic styles ──
  const playBtnStyle = useMemo(
    () => [styles.circleBtnBig, { backgroundColor: color, shadowColor: color }],
    [styles, color]
  );

  const tipBtnStyle = useMemo(
    () => [styles.tipBtn, { borderColor: color + "66" }],
    [styles, color]
  );

  const tipBtnTextStyle = useMemo(
    () => [styles.tipBtnText, { color }],
    [styles, color]
  );

  const tipBoxStyle = useMemo(
    () => [styles.tipBox, { borderColor: color + "44" }],
    [styles, color]
  );

  const glowColor = theme.isDark ? DIAL_GLOW : color;

  return (
    <ScreenContainer style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.sessionTop}>
        <TouchableOpacity
          onPress={handleGoHome}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Leave session and go home"
        >
          <Icon
            name="chevron-left"
            size={20}
            color={theme.textSecondary}
            strokeWidth={2.2}
          />
        </TouchableOpacity>
        <Text style={styles.sessionLabel}>{session.label}</Text>
        <View style={styles.spacer} />
      </View>

      {/* ── Subject badge ── */}
      {subject && (
        <View style={styles.subjectBadge}>
          <View
            style={[
              styles.subjectDot,
              { backgroundColor: subjectColor || theme.accent },
            ]}
          />
          <Text style={styles.subjectBadgeText}>{subject}</Text>
        </View>
      )}

      {/* ── Session Dial (signature) ── */}
      <View style={styles.dialWrap}>
        <SessionDial
          phases={phases}
          phaseIndex={phaseIndex}
          secondsLeft={secondsLeft}
          getPhaseColor={getPhaseColor}
          activeColor={color}
          glowColor={glowColor}
          trackColor={theme.progressTrack}
          size={264}
          strokeWidth={16}
        >
          <Text style={[styles.phaseName, { color }]} numberOfLines={1}>
            {phase?.name}
          </Text>
          <Text style={styles.count}>{formatTime(secondsLeft)}</Text>
          <Text style={styles.meta}>
            {isBreakPhase
              ? "BREAK"
              : `STUDY BLOCK ${currentStudyNum} OF ${studyPhaseCount}`}
          </Text>
        </SessionDial>
      </View>

      {/* ── Up next ── */}
      <View style={styles.legend}>
        {upNext ? (
          <>
            <View
              style={[
                styles.legDot,
                { backgroundColor: getPhaseColor(phaseIndex + 1) },
              ]}
            />
            <Text style={styles.legendText}>
              Up next ·{" "}
              {upNext.isBreak ? `${upNext.duration}-min break` : upNext.name}
            </Text>
          </>
        ) : (
          <Text style={styles.legendText}>Final phase · finish strong</Text>
        )}
      </View>

      {/* ── Controls ── */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.circleBtnSmall}
          onPress={handleReset}
          accessibilityRole="button"
          accessibilityLabel="Reset timer"
        >
          <Icon
            name="reset"
            size={22}
            color={theme.textPrimary}
            strokeWidth={2}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={playBtnStyle}
          onPress={handlePlayPause}
          accessibilityRole="button"
          accessibilityLabel={running ? "Pause timer" : "Start timer"}
          accessibilityState={{ selected: running }}
        >
          <Icon
            name={running ? "pause" : "play"}
            size={30}
            color={theme.onAccent}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.circleBtnSmall}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip to next phase"
        >
          <Icon
            name="skip"
            size={22}
            color={theme.textPrimary}
            strokeWidth={2}
          />
        </TouchableOpacity>
      </View>

      {/* ── Auto-advance toggle ── */}
      <View style={styles.autoAdvanceRow}>
        <View style={styles.autoAdvanceTextWrap}>
          <Text style={styles.autoAdvanceLabel}>Auto-advance phases</Text>
          <Text style={styles.autoAdvanceHint}>
            {autoAdvance
              ? "Next phase starts automatically"
              : "Pauses at the end of each phase"}
          </Text>
        </View>
        <Switch
          value={autoAdvance}
          onValueChange={toggleAutoAdvance}
          trackColor={{ false: theme.border, true: color }}
          thumbColor={theme.onAccent}
          accessibilityLabel="Auto-advance phases"
          accessibilityState={{ checked: autoAdvance }}
        />
      </View>

      {/* ── Tip ── */}
      <TouchableOpacity
        style={tipBtnStyle}
        onPress={() => setShowTip((t) => !t)}
        accessibilityRole="button"
        accessibilityLabel={showTip ? "Hide tip" : "Show tip for this phase"}
      >
        <Text style={tipBtnTextStyle}>
          {showTip ? "Hide tip" : "What should I do now?"}
        </Text>
      </TouchableOpacity>
      {showTip && (
        <View style={tipBoxStyle}>
          <Text style={styles.tipBoxText}>{phase?.tip}</Text>
        </View>
      )}
    </ScreenContainer>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bgSession },
    sessionTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    backBtn: {
      backgroundColor: t.overlayBtn,
      borderRadius: 11,
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
    },
    sessionLabel: {
      color: t.textFaint,
      fontFamily: FONTS.displayMedium,
      fontSize: 12,
      letterSpacing: 2,
      textTransform: "uppercase",
    },
    spacer: { width: 38 },
    subjectBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: t.surface,
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 12,
      marginTop: 10,
    },
    subjectDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 7,
    },
    subjectBadgeText: {
      color: t.textTertiary,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11.5,
    },
    dialWrap: {
      alignItems: "center",
      marginTop: 22,
    },
    phaseName: {
      fontFamily: FONTS.display,
      fontSize: 15,
    },
    count: {
      color: t.timerText,
      fontFamily: FONTS.displayBold,
      fontSize: 50,
      fontVariant: ["tabular-nums"],
      marginTop: 4,
      marginBottom: 2,
    },
    meta: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 10.5,
      letterSpacing: 1,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 14,
    },
    legDot: { width: 7, height: 7, borderRadius: 4 },
    legendText: {
      color: t.textSecondary,
      fontFamily: FONTS.body,
      fontSize: 12.5,
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      marginTop: 24,
    },
    circleBtnSmall: {
      backgroundColor: t.overlayBtn,
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: "center",
      justifyContent: "center",
    },
    circleBtnBig: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 16,
      elevation: 8,
    },
    autoAdvanceRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      alignSelf: "center",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      paddingVertical: 11,
      paddingHorizontal: 16,
      marginTop: 26,
      width: "86%",
    },
    autoAdvanceTextWrap: { flex: 1, paddingRight: 12 },
    autoAdvanceLabel: {
      color: t.textPrimary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 14,
    },
    autoAdvanceHint: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 11,
      marginTop: 2,
    },
    tipBtn: {
      alignSelf: "center",
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 7,
      paddingHorizontal: 16,
      marginTop: 18,
    },
    tipBtnText: { fontFamily: FONTS.bodyMedium, fontSize: 12 },
    tipBox: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      marginHorizontal: 22,
      marginTop: 10,
    },
    tipBoxText: {
      color: t.textPrimary,
      fontFamily: FONTS.body,
      fontSize: 13,
      lineHeight: 20,
    },
  });
