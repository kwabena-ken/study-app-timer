import React, { useState, useCallback, useEffect } from "react";
import { StatusBar, View, BackHandler, Platform } from "react-native";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import HomeScreen from "./src/screens/HomeScreen";
import SubjectPickerScreen from "./src/screens/SubjectPickerScreen";
import SessionPickerScreen from "./src/screens/SessionPickerScreen";
import CustomSessionScreen from "./src/screens/CustomSessionScreen";
import SessionScreen from "./src/screens/SessionScreen";
import DoneScreen from "./src/screens/DoneScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import StatsScreen from "./src/screens/StatsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import TabBar from "./src/components/TabBar";
import { SESSIONS } from "./src/constants/sessions";
import {
  upsertSession,
  saveSubject,
  loadActiveSession,
  saveActiveSession,
  clearActiveSession,
} from "./src/utils/storage";
import {
  reconcileSessionTimeline,
  minsFromSecs,
  phaseElapsedSecs,
} from "./src/utils/studyTime";
import { FONT_MAP } from "./src/theme/typography";

// Hold the native splash until fonts and any Option A active-session recovery
// resolve, so the first paint lands directly on the right screen with loaded fonts.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Which screens show the bottom tab bar. The session flow (picking a subject,
// building/running a session, the done screen) stays full-bleed and tab-free.
const TAB_SCREENS = ["home", "stats", "history", "settings"];

export default function App() {
  const [screen, setScreen] = useState("home");
  const [sessionKey, setSessionKey] = useState(null);
  const [customSession, setCustomSession] = useState(null);
  const [sessionMeta, setSessionMeta] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [subjectColor, setSubjectColor] = useState(null);
  // When a Home quick-start chip is tapped, remember its target so we can jump
  // straight past the session picker once a subject is chosen.
  const [pendingSessionKey, setPendingSessionKey] = useState(null);
  // Remember where CustomSessionScreen was launched from so Back returns to the
  // right screen (SubjectPicker when launched via Quick-Start Custom, else SessionPicker).
  const [customReturnScreen, setCustomReturnScreen] = useState("session-picker");
  // Option A startup recovery state passed into SessionScreen when auto-resuming.
  const [resumeState, setResumeState] = useState(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  const [fontsLoaded, fontError] = useFonts(FONT_MAP);
  const ready = (fontsLoaded || fontError) && recoveryChecked;

  // Active session structure (preset key or custom object)
  const session = sessionKey ? SESSIONS[sessionKey] : customSession;

  // ── Option A startup reconciliation ──
  // Restore an interrupted session at its exact wall-clock phase & remaining
  // time if still active (or paused mid-session), or finalize to DoneScreen if
  // all phases finished while the app was closed.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const snapshot = await loadActiveSession();
        if (!active || !snapshot || !snapshot.session?.phases?.length) {
          return;
        }

        const phases = snapshot.session.phases;
        const studyPhases = phases.filter((p) => !p.isBreak);
        const totalStudyMins = studyPhases.reduce(
          (a, p) => a + (p.duration || 0),
          0
        );

        const restoreTargetSession = () => {
          if (snapshot.sessionKey && SESSIONS[snapshot.sessionKey]) {
            setSessionKey(snapshot.sessionKey);
            setCustomSession(null);
          } else {
            setSessionKey(null);
            setCustomSession(snapshot.session);
          }
          setSelectedSubject(snapshot.subject || null);
          setSubjectColor(snapshot.subjectColor || null);
        };

        // Paused mid-session when closed: restore SessionScreen paused in place.
        if (!snapshot.running || snapshot.phaseEndMs == null) {
          const idx = Math.max(
            0,
            Math.min(snapshot.phaseIndex || 0, phases.length - 1)
          );
          const secsLeft =
            snapshot.secondsLeft != null
              ? snapshot.secondsLeft
              : (phases[idx]?.duration || 0) * 60;
          const totalSecs =
            (snapshot.actualStudySecs || 0) +
            phaseElapsedSecs(phases[idx], secsLeft);
          const actualStudyMins = minsFromSecs(totalSecs);

          if (snapshot.sessionId && snapshot.startedAt) {
            await upsertSession({
              id: snapshot.sessionId,
              sessionType: snapshot.sessionKey || "custom",
              label: snapshot.session.label,
              subject: snapshot.subject || "Unspecified",
              startedAt: snapshot.startedAt,
              phasesCompleted: snapshot.studyPhasesCompleted || 0,
              totalStudyMins,
              actualStudyMins,
              completed: false,
            }).catch(() => {});
          }

          if (!active) return;
          restoreTargetSession();
          setResumeState({ ...snapshot, phaseIndex: idx, secondsLeft: secsLeft, running: false, phaseEndMs: null });
          setScreen("session");
          return;
        }

        // Running when closed: reconcile wall-clock time across elapsed phases.
        const rec = reconcileSessionTimeline({
          phases,
          phaseIndex: snapshot.phaseIndex,
          phaseEndMs: snapshot.phaseEndMs,
          actualStudySecs: snapshot.actualStudySecs,
          studyPhasesCompleted: snapshot.studyPhasesCompleted,
          autoAdvance: snapshot.autoAdvance !== false,
          nowMs: Date.now(),
        });

        const actualStudyMins = minsFromSecs(rec.totalStudySecs);
        const completedAtIso = rec.completedAtMs
          ? new Date(rec.completedAtMs).toISOString()
          : new Date().toISOString();

        if (rec.completedAll) {
          await upsertSession({
            id: snapshot.sessionId,
            sessionType: snapshot.sessionKey || "custom",
            label: snapshot.session.label,
            subject: snapshot.subject || "Unspecified",
            startedAt: snapshot.startedAt,
            completedAt: completedAtIso,
            phasesCompleted: rec.studyPhasesCompleted,
            totalStudyMins,
            actualStudyMins,
            completed: actualStudyMins > 0,
          }).catch(() => {});
          await clearActiveSession().catch(() => {});

          if (!active) return;
          restoreTargetSession();
          setResumeState(null);
          setSessionMeta({
            sessionId: snapshot.sessionId,
            startedAt: snapshot.startedAt,
            completedAt: completedAtIso,
            actualStudyMins,
            phasesCompleted: rec.studyPhasesCompleted,
            sessionKey: snapshot.sessionKey || "custom",
            subject: snapshot.subject,
          });
          setScreen("done");
          return;
        }

        // Still inside session window (either running or paused at next phase when autoAdvance=false).
        const nextSnapshot = {
          ...snapshot,
          phaseIndex: rec.phaseIndex,
          secondsLeft: rec.secondsLeft,
          running: rec.running,
          phaseEndMs: rec.phaseEndMs,
          actualStudySecs: rec.actualStudySecs,
          studyPhasesCompleted: rec.studyPhasesCompleted,
          updatedAt: Date.now(),
        };

        await Promise.all([
          saveActiveSession(nextSnapshot).catch(() => {}),
          upsertSession({
            id: snapshot.sessionId,
            sessionType: snapshot.sessionKey || "custom",
            label: snapshot.session.label,
            subject: snapshot.subject || "Unspecified",
            startedAt: snapshot.startedAt,
            phasesCompleted: rec.studyPhasesCompleted,
            totalStudyMins,
            actualStudyMins,
            completed: false,
          }).catch(() => {}),
        ]);

        if (!active) return;
        restoreTargetSession();
        setResumeState(nextSnapshot);
        setScreen("session");
      } catch (e) {
        console.warn("Failed to reconcile active session on startup:", e);
      } finally {
        if (active) setRecoveryChecked(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // ── Navigation helpers ──

  const goHome = useCallback(() => {
    setScreen("home");
    setSelectedSubject(null);
    setSubjectColor(null);
    setSessionKey(null);
    setCustomSession(null);
    setSessionMeta(null);
    setPendingSessionKey(null);
    setResumeState(null);
    setCustomReturnScreen("session-picker");
  }, []);

  const startStudying = useCallback(() => {
    setPendingSessionKey(null);
    setScreen("subject-picker");
  }, []);

  // Home quick-start: remember the chosen length/builder, then pick a subject.
  // "1hr"/"2hr" launch that preset after the subject; "custom" opens the builder.
  const quickStart = useCallback((key) => {
    setPendingSessionKey(key);
    setScreen("subject-picker");
  }, []);

  const handleSelectSubject = useCallback(
    async (name) => {
      const subject = await saveSubject(name);
      setSelectedSubject(subject.name);
      setSubjectColor(subject.color);

      // Honor a pending quick-start, otherwise land on the session picker.
      if (pendingSessionKey === "custom") {
        setCustomReturnScreen("subject-picker");
        setScreen("custom-session-builder");
      } else if (pendingSessionKey && SESSIONS[pendingSessionKey]) {
        setSessionKey(pendingSessionKey);
        setCustomSession(null);
        setSessionMeta(null);
        setResumeState(null);
        setScreen("session");
      } else {
        setScreen("session-picker");
      }
      setPendingSessionKey(null);
    },
    [pendingSessionKey]
  );

  const goBackToSubjectPicker = useCallback(() => {
    setScreen("subject-picker");
    setSessionKey(null);
    setCustomSession(null);
    setResumeState(null);
  }, []);

  const handleStartSession = useCallback((key) => {
    setSessionKey(key);
    setCustomSession(null);
    setSessionMeta(null);
    setResumeState(null);
    setScreen("session");
  }, []);

  const openCustomSessionBuilder = useCallback(() => {
    setCustomReturnScreen("session-picker");
    setScreen("custom-session-builder");
  }, []);

  const handleStartCustomSession = useCallback((customObj) => {
    setSessionKey(null);
    setCustomSession(customObj);
    setSessionMeta(null);
    setResumeState(null);
    setScreen("session");
  }, []);

  const goBackToSessionPicker = useCallback(() => {
    setScreen("session-picker");
  }, []);

  const goBackFromCustomBuilder = useCallback(() => {
    if (customReturnScreen === "subject-picker") {
      setPendingSessionKey("custom");
      setScreen("subject-picker");
    } else {
      setScreen("session-picker");
    }
  }, [customReturnScreen]);

  // Called when all phases of a session are completed
  const handleComplete = useCallback(
    (meta) => {
      setResumeState(null);
      setSessionMeta({
        ...meta,
        sessionKey: sessionKey || "custom",
        subject: selectedSubject,
      });
      setScreen("done");
    },
    [sessionKey, selectedSubject]
  );

  // Called when the user quits a session early — upserts partial progress
  const handlePartialQuit = useCallback(
    async (meta) => {
      if (!session) {
        await clearActiveSession().catch(() => {});
        goHome();
        return;
      }

      const studyPhases = session.phases.filter((p) => !p.isBreak);
      const totalStudyMins = studyPhases.reduce((a, p) => a + p.duration, 0);

      try {
        await upsertSession({
          id: meta.sessionId,
          sessionType: sessionKey || "custom",
          label: session.label,
          subject: selectedSubject || "Unspecified",
          startedAt: meta.startedAt,
          phasesCompleted: meta.phasesCompleted,
          totalStudyMins,
          actualStudyMins: meta.actualStudyMins,
          completed: false,
        });
        await clearActiveSession();
      } catch (e) {
        console.warn("Failed to save partial session:", e);
      }

      goHome();
    },
    [session, sessionKey, selectedSubject, goHome]
  );

  const viewHistory = useCallback(() => setScreen("history"), []);
  const viewStats = useCallback(() => setScreen("stats"), []);
  const viewSettings = useCallback(() => setScreen("settings"), []);

  // Bottom-tab navigation between the four top-level destinations.
  const handleTabChange = useCallback((key) => setScreen(key), []);

  // Wire Android hardware back button across all non-home screens
  // (SessionScreen handles its own BackHandler with the Leave confirmation).
  useEffect(() => {
    if (Platform.OS !== "android" || screen === "home" || screen === "session") {
      return;
    }

    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen === "session-picker") {
        goBackToSubjectPicker();
      } else if (screen === "custom-session-builder") {
        goBackFromCustomBuilder();
      } else {
        goHome();
      }
      return true;
    });

    return () => sub.remove();
  }, [screen, goBackToSubjectPicker, goBackFromCustomBuilder, goHome]);

  // Reveal the app only once fonts and recovery check are ready, hiding the
  // native splash on the same frame so there's no flash of fallback type.
  const onLayoutRoot = useCallback(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  // ── Render ──

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ThemedStatusBar />
        <View style={{ flex: 1 }} onLayout={onLayoutRoot}>
          <View style={{ flex: 1 }}>
            {screen === "home" && (
              <HomeScreen
                onStartStudying={startStudying}
                onQuickStart={quickStart}
                onViewStats={viewStats}
                onViewHistory={viewHistory}
                onViewSettings={viewSettings}
              />
            )}

            {screen === "subject-picker" && (
              <SubjectPickerScreen
                onSelectSubject={handleSelectSubject}
                onGoHome={goHome}
              />
            )}

            {screen === "session-picker" && (
              <SessionPickerScreen
                subject={selectedSubject}
                subjectColor={subjectColor}
                onStartSession={handleStartSession}
                onOpenCustomSession={openCustomSessionBuilder}
                onStartTemplate={handleStartCustomSession}
                onGoBack={goBackToSubjectPicker}
              />
            )}

            {screen === "custom-session-builder" && (
              <CustomSessionScreen
                subject={selectedSubject}
                subjectColor={subjectColor}
                onStartCustomSession={handleStartCustomSession}
                onGoBack={goBackFromCustomBuilder}
              />
            )}

            {screen === "session" && session && (
              <SessionScreen
                session={session}
                sessionKey={sessionKey}
                subject={selectedSubject}
                subjectColor={subjectColor}
                resumeState={resumeState}
                onGoHome={goHome}
                onComplete={handleComplete}
                onPartialQuit={handlePartialQuit}
              />
            )}

            {screen === "done" && session && (
              <DoneScreen
                session={session}
                sessionMeta={sessionMeta}
                onGoHome={goHome}
              />
            )}

            {screen === "history" && <HistoryScreen onGoHome={goHome} />}

            {screen === "stats" && <StatsScreen onGoHome={goHome} />}

            {screen === "settings" && <SettingsScreen onGoHome={goHome} />}
          </View>

          {TAB_SCREENS.includes(screen) && (
            <TabBar active={screen} onChange={handleTabChange} />
          )}
        </View>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

// Drives the OS status-bar glyphs from the active theme so the clock/battery
// stay legible in light mode. Lives inside ThemeProvider so it can read it.
function ThemedStatusBar() {
  const { theme } = useTheme();
  return (
    <StatusBar
      barStyle={theme.isDark ? "light-content" : "dark-content"}
      backgroundColor={theme.bg}
    />
  );
}