import React, { useState, useCallback } from "react";
import { StatusBar, View } from "react-native";
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
import { saveSession, saveSubject } from "./src/utils/storage";
import { FONT_MAP } from "./src/theme/typography";

// Hold the native splash until fonts resolve, so the first paint already has
// the Space Grotesk / Inter faces (the dial countdown + tab labels need them).
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

  const [fontsLoaded, fontError] = useFonts(FONT_MAP);
  const ready = fontsLoaded || fontError;

  // Active session structure (preset key or custom object)
  const session = sessionKey
    ? SESSIONS[sessionKey]
    : customSession;

  // ── Navigation helpers ──

  const goHome = useCallback(() => {
    setScreen("home");
    setSelectedSubject(null);
    setSubjectColor(null);
    setSessionKey(null);
    setCustomSession(null);
    setSessionMeta(null);
    setPendingSessionKey(null);
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
        setScreen("custom-session-builder");
      } else if (pendingSessionKey && SESSIONS[pendingSessionKey]) {
        setSessionKey(pendingSessionKey);
        setCustomSession(null);
        setSessionMeta(null);
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
  }, []);

  const handleStartSession = useCallback((key) => {
    setSessionKey(key);
    setCustomSession(null);
    setSessionMeta(null);
    setScreen("session");
  }, []);

  const openCustomSessionBuilder = useCallback(() => {
    setScreen("custom-session-builder");
  }, []);

  const handleStartCustomSession = useCallback((customObj) => {
    setSessionKey(null);
    setCustomSession(customObj);
    setSessionMeta(null);
    setScreen("session");
  }, []);

  const goBackToSessionPicker = useCallback(() => {
    setScreen("session-picker");
  }, []);

  // Called when all phases of a session are completed
  const handleComplete = useCallback(
    (meta) => {
      setSessionMeta({
        ...meta,
        sessionKey: sessionKey || "custom",
        subject: selectedSubject,
      });
      setScreen("done");
    },
    [sessionKey, selectedSubject]
  );

  // Called when the user quits a session early — saves partial progress
  const handlePartialQuit = useCallback(
    async (meta) => {
      if (!session) {
        goHome();
        return;
      }

      const studyPhases = session.phases.filter((p) => !p.isBreak);
      const totalStudyMins = studyPhases.reduce((a, p) => a + p.duration, 0);

      try {
        await saveSession({
          sessionType: sessionKey || "custom",
          label: session.label,
          subject: selectedSubject || "Unspecified",
          startedAt: meta.startedAt,
          phasesCompleted: meta.phasesCompleted,
          totalStudyMins,
          actualStudyMins: meta.actualStudyMins,
          completed: false,
        });
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

  // Reveal the app only once fonts are ready, hiding the native splash on the
  // same frame so there's no flash of fallback type.
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
                onGoBack={goBackToSessionPicker}
              />
            )}

            {screen === "session" && session && (
              <SessionScreen
                session={session}
                subject={selectedSubject}
                subjectColor={subjectColor}
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