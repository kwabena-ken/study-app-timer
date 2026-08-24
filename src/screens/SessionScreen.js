import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  Vibration,
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { studyColors, breakColor } from "../constants/sessions";
import { formatTime } from "../utils/formatTime";
import { phaseElapsedSecs, minsFromSecs } from "../utils/studyTime";
import { useTimer } from "../hooks/useTimer";
import { useNotifications } from "../hooks/useNotifications";
import { useAlarmSound } from "../hooks/useAlarmSound";
import { loadSettings, saveSettings } from "../utils/storage";
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

  const { scheduleChain, cancelAll } = useNotifications();
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
  const buildChainItems = useCallback(() => {
    const current = phases[phaseIndex];
    if (!current) return [];

    const bodyFor = (completed, idx) => {
      const upNext = phases[idx + 1];
      return upNext
        ? `"${completed.name}" done. Up next: ${upNext.emoji} ${upNext.name}.`
        : `"${completed.name}" done — session complete! 🎉`;
    };

    let offset = secondsLeftRef.current;
    const items = [
      {
        seconds: offset,
        title: "Study Timer ⏰",
        body: bodyFor(current, phaseIndex),
      },
    ];

    if (autoAdvance) {
      for (let i = phaseIndex + 1; i < phases.length; i++) {
        offset += phases[i].duration * 60;
        items.push({
          seconds: offset,
          title: "Study Timer ⏰",
          body: bodyFor(phases[i], i),
        });
      }
    }
    return items;
  }, [phases, phaseIndex, autoAdvance]);

  // ── (Re)schedule or cancel the notification chain ──
  // Re-runs when the timer starts/stops, the phase changes, auto-advance is
  // toggled, or the chosen sound changes.
  useEffect(() => {
    if (running) {
      scheduleChain(buildChainItems(), soundPreset);
    } else {
      cancelAll();
    }
  }, [running, phaseIndex, autoAdvance, soundPreset, buildChainItems, scheduleChain, cancelAll]);

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
  const finishSession = useCallback(() => {
    actualStudySecsRef.current += phaseElapsedSecs(phase, secondsLeft);

    stop();
    cancelAll();

    const actualStudyMins = minsFromSecs(actualStudySecsRef.current);
    onComplete({ startedAt: startedAtRef.current, actualStudyMins });
  }, [phase, secondsLeft, stop, cancelAll, onComplete]);

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
      if (startedAtRef.current && onPartialQuit) {
        const actualStudyMins = minsFromSecs(
          actualStudySecsRef.current + phaseElapsedSecs(phase, secondsLeft)
        );

        const completedStudyPhases = phases
          .slice(0, phaseIndex)
          .filter((p) => !p.isBreak).length;

        if (actualStudyMins > 0) {
          onPartialQuit({
            startedAt: startedAtRef.current,
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
  }, [running, stop, cancelAll, onGoHome, onPartialQuit, phases, phaseIndex, phase, secondsLeft]);

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
    <SafeAreaView style={styles.container}>
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
