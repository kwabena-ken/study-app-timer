import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Vibration,
  Switch,
  AppState,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { studyColors, breakColor } from "../constants/sessions";
import { formatTime } from "../utils/formatTime";
import { phaseElapsedSecs, minsFromSecs } from "../utils/studyTime";
import { useTimer } from "../hooks/useTimer";
import { useNotifications } from "../hooks/useNotifications";
import { useAlarmSound } from "../hooks/useAlarmSound";
import { loadSettings, saveSettings } from "../utils/storage";
import {
  buildNotificationChain,
  defaultChainBody,
  reconcileTimeline,
} from "../utils/sessionTimeline";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import SessionDial from "../components/SessionDial";
import Icon from "../components/Icon";

// Tag for the imperative keep-awake lock (held only while the timer runs).
const KEEP_AWAKE_TAG = "study-session";
// Vibration pattern for the phase-complete alarm (mirrors the notification channel).
const ALARM_VIBRATION = [0, 500, 250, 500];
// Icy-cyan bloom behind the active dial segment, echoing the app icon.
const DIAL_GLOW = "#22d3ee";

/**
 * Session screen — timer, controls, progress, and tips.
 * Owns its own timer/notification/sound lifecycle; cleans up on unmount.
 *
 * @param {{ session: Object, onGoHome: () => void, onComplete: (meta: Object) => void }} props
 */
export default function SessionScreen({ session, subject, subjectColor, onGoHome, onComplete, onPartialQuit }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const phases = session.phases;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [showTip, setShowTip] = useState(false);
  const phase = phases[phaseIndex] || null;

  // Auto-advance: when on, a finished phase immediately starts the next one.
  // Seeded from saved settings but toggleable live during the session.
  const [autoAdvance, setAutoAdvance] = useState(true);
  // Which bundled alarm sound plays for background/locked notifications.
  const [soundPreset, setSoundPreset] = useState("classic");
  // Honor the user's Settings toggles (seeded on; overwritten once settings load).
  const [vibrate, setVibrate] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);

  // Track when the user first presses play (for session history)
  const startedAtRef = useRef(null);

  // Accumulates actual study seconds across all phases
  // (only counts time actually elapsed, not skipped time)
  const actualStudySecsRef = useRef(0);

  const { scheduleChain, cancelAll, error: notificationError } = useNotifications();
  const { playAlarm } = useAlarmSound();

  // handlePhaseComplete (defined below) depends on goToPhase/finishSession,
  // which in turn need the timer's controls — so route the timer's onComplete
  // through a ref to break the definition-order cycle.
  const onCompleteRef = useRef(() => {});
  const fireComplete = useCallback(() => onCompleteRef.current?.(), []);

  const { secondsLeft, running, setRunning, loadDuration, stop, restart } =
    useTimer({ onComplete: fireComplete });

  // Mirror live remaining time into a ref so the scheduling effect can read it
  // without depending on `secondsLeft` (which would reschedule every tick).
  const secondsLeftRef = useRef(0);
  secondsLeftRef.current = secondsLeft;

  // Track timeline anchor timestamp and remaining duration for background sync
  const timelineAnchorRef = useRef({
    anchorAt: Date.now(),
    remainingMs: (phases[0]?.duration || 0) * 60000,
  });
  const appStateRef = useRef(AppState.currentState);
  const runningRef = useRef(running);
  runningRef.current = running;
  const phaseIndexRef = useRef(phaseIndex);
  phaseIndexRef.current = phaseIndex;
  const autoAdvanceRef = useRef(autoAdvance);
  autoAdvanceRef.current = autoAdvance;

  // Keep timeline anchor up to date with timer ticks when running
  useEffect(() => {
    if (running) {
      timelineAnchorRef.current = {
        anchorAt: Date.now(),
        remainingMs: secondsLeft * 1000,
      };
    }
  }, [running, secondsLeft]);

  // Mirror the vibrate setting into a ref so the haptic helpers below stay
  // stable (they never need to be recreated when the setting flips).
  const vibrateRef = useRef(true);
  vibrateRef.current = vibrate;

  // Haptic helpers — no-ops when the user turned Vibration off in Settings.
  const impact = useCallback(() => {
    if (vibrateRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);
  const selection = useCallback(() => {
    if (vibrateRef.current) Haptics.selectionAsync();
  }, []);

  // Load saved prefs (auto-advance default + chosen sound) once on mount.
  useEffect(() => {
    loadSettings().then((s) => {
      setAutoAdvance(s.autoAdvance !== false);
      setSoundPreset(s.soundPreset || "classic");
      setVibrate(s.vibrate !== false);
      setKeepAwake(s.keepAwake !== false);
    });
  }, []);

  // Hold a keep-awake lock only while the timer is actively running, and only
  // if the user left the setting on. Released on pause, toggle-off, or unmount.
  useEffect(() => {
    if (running && keepAwake) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      return () => {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      };
    }
  }, [running, keepAwake]);

  // Load first phase duration on mount
  useEffect(() => {
    loadDuration(phases[0].duration * 60);
  }, [loadDuration, phases]);

  // Build the notification chain. The current phase always fires at its end;
  // when auto-advance is on we also pre-schedule every subsequent phase
  // boundary at cumulative offsets, so alarms still fire while the app is
  // backgrounded (JS timers are frozen in the background).
  //
  // `buildNotificationChain` returns ABSOLUTE epoch-ms deadlines, which is what
  // the OS scheduler needs — the in-app timer only knows a relative countdown,
  // so the remaining seconds are anchored to "now" here.
  const buildChainItems = useCallback(
    () =>
      buildNotificationChain({
        phases,
        phaseIndex,
        remainingMs: Math.max(0, secondsLeftRef.current) * 1000,
        now: Date.now(),
        autoAdvance,
        bodyFor: defaultChainBody,
      }),
    [phases, phaseIndex, autoAdvance]
  );

  // ── (Re)schedule or cancel the notification chain ──
  // Re-runs when the timer starts/stops, the phase changes, auto-advance is
  // toggled, or the chosen sound/vibration changes.
  useEffect(() => {
    if (running) {
      scheduleChain(buildChainItems(), soundPreset, vibrate);
    } else {
      cancelAll();
    }
  }, [running, phaseIndex, autoAdvance, soundPreset, vibrate, buildChainItems, scheduleChain, cancelAll]);

  // ── Per-phase identity color ──
  // Study phases cycle through studyColors by their study-index; breaks are slate.
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

  const color = useMemo(() => getPhaseColor(phaseIndex), [getPhaseColor, phaseIndex]);

  const isBreakPhase = phase?.isBreak;
  const studyPhaseCount = phases.filter((p) => !p.isBreak).length;
  const currentStudyNum = phases
    .slice(0, phaseIndex + 1)
    .filter((p) => !p.isBreak).length;
  const upNext = phases[phaseIndex + 1] || null;

  // ── Phase navigation ──
  const goToPhase = useCallback(
    (idx, autoStart = false) => {
      // Accumulate actual study time from the current phase before switching
      // (0 for breaks; only real elapsed time, not the full phase length).
      actualStudySecsRef.current += phaseElapsedSecs(phase, secondsLeft);

      setPhaseIndex(idx);
      setShowTip(false);

      if (autoStart) {
        // Roll straight into the next phase; the scheduling effect reschedules
        // the notification chain off the new phaseIndex.
        restart(phases[idx].duration * 60);
      } else {
        cancelAll();
        loadDuration(phases[idx].duration * 60);
      }
    },
    [cancelAll, loadDuration, restart, phases, phase, secondsLeft]
  );

  // Finish the whole session (last phase done, or the final phase was skipped).
  const finishSession = useCallback(
    (alreadyCredited = false) => {
      if (!alreadyCredited) {
        const curPhase = phases[phaseIndexRef.current] || phase;
        actualStudySecsRef.current += phaseElapsedSecs(curPhase, secondsLeftRef.current);
      }

      stop();
      cancelAll();

      const actualStudyMins = minsFromSecs(actualStudySecsRef.current);
      onComplete({
        startedAt: startedAtRef.current || new Date().toISOString(),
        actualStudyMins,
      });
    },
    [phases, phase, stop, cancelAll, onComplete]
  );
  const finishSessionRef = useRef(finishSession);
  finishSessionRef.current = finishSession;

  const nextPhase = useCallback(() => {
    if (phaseIndex + 1 < phases.length) {
      goToPhase(phaseIndex + 1);
    } else {
      finishSession();
    }
  }, [phaseIndex, phases.length, goToPhase, finishSession]);

  // Called by the timer when a phase hits 0. Always sounds the alarm; when
  // auto-advance is on, roll into the next phase (or finish the session).
  const handlePhaseComplete = useCallback(() => {
    playAlarm(soundPreset);
    if (vibrateRef.current) Vibration.vibrate(ALARM_VIBRATION);
    if (!autoAdvance) return;
    if (phaseIndex + 1 < phases.length) {
      goToPhase(phaseIndex + 1, true);
    } else {
      finishSession();
    }
  }, [playAlarm, soundPreset, autoAdvance, phaseIndex, phases.length, goToPhase, finishSession]);

  // Keep the timer's completion callback pointing at the latest closure.
  onCompleteRef.current = handlePhaseComplete;

  // Synchronize session timing across background states and screen locks
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      const prevAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (prevAppState === "active" && nextAppState.match(/inactive|background/)) {
        timelineAnchorRef.current = {
          anchorAt: Date.now(),
          remainingMs: secondsLeftRef.current * 1000,
        };
      }

      if (
        (prevAppState === "background" || prevAppState === "inactive" || prevAppState !== "active") &&
        nextAppState === "active"
      ) {
        if (!runningRef.current) return;

        const reconciled = reconcileTimeline({
          phases,
          phaseIndex: phaseIndexRef.current,
          remainingMs: timelineAnchorRef.current.remainingMs,
          running: runningRef.current,
          anchorAt: timelineAnchorRef.current.anchorAt,
          now: Date.now(),
          autoAdvance: autoAdvanceRef.current,
        });

        // Credit elapsed study time for completed study phases in background
        if (reconciled.advancedPhases && reconciled.advancedPhases.length > 0) {
          for (const adv of reconciled.advancedPhases) {
            const p = phases[adv.index];
            if (adv.completed && p && !p.isBreak) {
              actualStudySecsRef.current += p.duration * 60;
            }
          }
        }

        if (reconciled.finished) {
          timelineAnchorRef.current = { anchorAt: Date.now(), remainingMs: 0 };
          finishSessionRef.current(true);
        } else if (reconciled.awaitingNext) {
          setPhaseIndex(reconciled.phaseIndex);
          loadDuration(phases[reconciled.phaseIndex].duration * 60);
          timelineAnchorRef.current = {
            anchorAt: Date.now(),
            remainingMs: phases[reconciled.phaseIndex].duration * 60 * 1000,
          };
        } else {
          if (reconciled.phaseIndex !== phaseIndexRef.current) {
            setPhaseIndex(reconciled.phaseIndex);
          }
          const remainingSecs = Math.max(1, Math.ceil(reconciled.remainingMs / 1000));
          restart(remainingSecs);
          timelineAnchorRef.current = {
            anchorAt: Date.now(),
            remainingMs: reconciled.remainingMs,
          };
        }
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      if (sub && typeof sub.remove === "function") {
        sub.remove();
      } else if (AppState.removeEventListener) {
        AppState.removeEventListener("change", handleAppStateChange);
      }
    };
  }, [phases, loadDuration, restart]);

  const resetPhase = useCallback(() => {
    cancelAll();
    loadDuration(phase.duration * 60);
  }, [cancelAll, loadDuration, phase]);

  // ── Handlers with haptics & confirmation ──
  const handlePlayPause = useCallback(() => {
    impact();
    // Record the start time on the very first play press
    if (!startedAtRef.current) {
      startedAtRef.current = new Date().toISOString();
    }
    setRunning((r) => !r);
  }, [impact, setRunning]);

  const handleSkip = useCallback(() => {
    if (running) {
      Alert.alert(
        "Skip Phase?",
        "Are you sure you want to skip to the next phase?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Skip",
            onPress: () => {
              impact();
              nextPhase();
            },
          },
        ]
      );
    } else {
      impact();
      nextPhase();
    }
  }, [impact, running, nextPhase]);

  const handleReset = useCallback(() => {
    impact();
    resetPhase();
  }, [impact, resetPhase]);

  // Flip auto-advance live and persist the new default for next time.
  const toggleAutoAdvance = useCallback(() => {
    selection();
    setAutoAdvance((prev) => {
      const next = !prev;
      saveSettings({ autoAdvance: next });
      return next;
    });
  }, [selection]);

  const handleGoHome = useCallback(() => {
    const doLeave = () => {
      stop();
      cancelAll();

      // Calculate actual study time for partial save. Use the same
      // accumulated-elapsed basis as finishSession, so quitting credits exactly
      // what a normal finish would for the same elapsed time — phases skipped
      // early are not credited their full nominal length.
      if (onPartialQuit) {
        const curPhase = phases[phaseIndexRef.current] || phase;
        const actualStudyMins = minsFromSecs(
          actualStudySecsRef.current + phaseElapsedSecs(curPhase, secondsLeftRef.current)
        );

        const completedStudyPhases = phases
          .slice(0, phaseIndexRef.current)
          .filter((p) => !p.isBreak).length;

        if (actualStudyMins > 0) {
          onPartialQuit({
            startedAt: startedAtRef.current || new Date().toISOString(),
            actualStudyMins,
            phasesCompleted: completedStudyPhases,
          });
          return;
        }
      }

      onGoHome();
    };

    if (running) {
      Alert.alert(
        "Leave Session?",
        "Your timer is still running. Your progress will be saved.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: doLeave,
          },
        ]
      );
    } else {
      doLeave();
    }
  }, [running, stop, cancelAll, onGoHome, onPartialQuit, phases, phase]);

  const handleGoHomeRef = useRef(handleGoHome);
  handleGoHomeRef.current = handleGoHome;

  // Intercept Android hardware back button and gesture navigation
  useEffect(() => {
    const onBackPress = () => {
      handleGoHomeRef.current();
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => {
      if (sub && typeof sub.remove === "function") {
        sub.remove();
      } else if (BackHandler.removeEventListener) {
        BackHandler.removeEventListener("hardwareBackPress", onBackPress);
      }
    };
  }, []);

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
    <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
      {/* ── Header ── */}
      <View style={styles.sessionTop}>
        <TouchableOpacity
          onPress={handleGoHome}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Leave session and go home"
        >
          <Icon name="chevron-left" size={20} color={theme.textSecondary} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.sessionLabel}>{session.label}</Text>
        <View style={styles.spacer} />
      </View>

      {/* ── Subject badge ── */}
      {subject && (
        <View style={styles.subjectBadge}>
          <View style={[styles.subjectDot, { backgroundColor: subjectColor || theme.accent }]} />
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
            <View style={[styles.legDot, { backgroundColor: getPhaseColor(phaseIndex + 1) }]} />
            <Text style={styles.legendText}>
              Up next · {upNext.isBreak ? `${upNext.duration}-min break` : upNext.name}
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
          <Icon name="reset" size={22} color={theme.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity
          style={playBtnStyle}
          onPress={handlePlayPause}
          accessibilityRole="button"
          accessibilityLabel={running ? "Pause timer" : "Start timer"}
          accessibilityState={{ selected: running }}
        >
          <Icon name={running ? "pause" : "play"} size={30} color={theme.onAccent} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.circleBtnSmall}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip to next phase"
        >
          <Icon name="skip" size={22} color={theme.textPrimary} strokeWidth={2} />
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

      {/* ── Background alarm warning ── */}
      {/* Scheduling can fail (denied permission, OS limit). The in-app alarm
          still sounds, so say so instead of failing silently. */}
      {notificationError && (
        <View style={styles.alarmWarning}>
          <Icon name="clock" size={16} color={theme.warning} />
          <Text style={styles.alarmWarningText}>
            Background alarms unavailable. The timer and in-app alarm still work.
          </Text>
        </View>
      )}

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
    </SafeAreaView>
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
    alarmWarning: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginHorizontal: 22,
      marginTop: 16,
      padding: 11,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.warning,
      backgroundColor: t.surface,
    },
    alarmWarningText: {
      flex: 1,
      color: t.textSecondary,
      fontFamily: FONTS.body,
      fontSize: 11.5,
      lineHeight: 16,
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
