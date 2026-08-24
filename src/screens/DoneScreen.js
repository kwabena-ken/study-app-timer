import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { loadSessions, saveSession } from "../utils/storage";
import { computeStreak } from "../utils/streak";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

/**
 * Done screen — shown after completing all phases of a session.
 * Saves the session (with subject) to local storage on mount.
 *
 * @param {{ session: Object, sessionMeta: Object, onGoHome: () => void }} props
 */
export default function DoneScreen({ session, sessionMeta, onGoHome }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const phases = session?.phases || [];
  const [saved, setSaved] = useState(false);
  const [currentStreak, setCurrentStreak] = useState(null);
  const didSaveRef = useRef(false);

  // Save session to local storage (runs once on mount)
  useEffect(() => {
    if (didSaveRef.current) return;
    didSaveRef.current = true;

    const studyPhases = phases.filter((p) => !p.isBreak);
    const totalStudyMins = studyPhases.reduce((a, p) => a + p.duration, 0);

    saveSession({
      sessionType: sessionMeta?.sessionKey || "unknown",
      label: session.label,
      subject: sessionMeta?.subject || "Unspecified",
      startedAt: sessionMeta?.startedAt || new Date().toISOString(),
      phasesCompleted: studyPhases.length,
      totalStudyMins,
      actualStudyMins: sessionMeta?.actualStudyMins != null ? sessionMeta.actualStudyMins : totalStudyMins,
      completed: true,
    })
      .then(() => loadSessions())
      .then((sessions) => {
        setCurrentStreak(computeStreak(sessions).current);
        setSaved(true);
      })
      .catch((e) => console.warn("Failed to save session:", e));
  }, [session, sessionMeta, phases]);

  const subjectName = sessionMeta?.subject;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.wrap}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>Session Complete!</Text>

        {subjectName && (
          <View style={styles.subjectBadge}>
            <Text style={styles.subjectText}>{subjectName}</Text>
          </View>
        )}

        <Text style={styles.subtitle}>
          You finished your full {session.label}. Take a real rest before the
          next one.
        </Text>

        <View style={styles.list}>
          {phases
            .filter((p) => !p.isBreak)
            .map((p, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.check}>✅</Text>
                <Text style={styles.rowText}>{p.name}</Text>
              </View>
            ))}
        </View>

        {saved && (
          <>
            {currentStreak != null && (
              <Text
                style={styles.streakText}
                accessibilityRole="text"
                accessibilityLabel={
                  currentStreak === 1
                    ? "Streak started"
                    : `That's ${currentStreak} days in a row`
                }
              >
                {currentStreak === 1
                  ? "Streak started"
                  : `That's ${currentStreak} days in a row`}
              </Text>
            )}
            <Text style={styles.savedText}>✅ Saved to history</Text>
          </>
        )}

        <TouchableOpacity style={styles.homeButton} onPress={onGoHome}>
          <Icon name="home" size={18} color={theme.onAccent} />
          <Text style={styles.homeButtonText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    wrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 28,
    },
    emoji: { fontSize: 56, marginBottom: 16 },
    title: { color: t.textPrimary, fontSize: 24, fontFamily: FONTS.displayBold },
    subjectBadge: {
      backgroundColor: t.surface,
      borderRadius: 16,
      paddingVertical: 5,
      paddingHorizontal: 14,
      marginTop: 8,
    },
    subjectText: {
      color: t.accent,
      fontSize: 13,
      fontFamily: FONTS.bodyBold,
    },
    subtitle: {
      color: t.textMuted,
      fontSize: 14,
      marginTop: 8,
      textAlign: "center",
      maxWidth: 260,
    },
    list: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 14,
      padding: 18,
      marginTop: 24,
      marginBottom: 28,
      width: "100%",
      maxWidth: 300,
    },
    row: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
    check: { fontSize: 15, marginRight: 10 },
    rowText: { color: t.textTertiary, fontSize: 13 },
    streakText: {
      color: t.warning,
      fontSize: 14,
      fontFamily: FONTS.bodyBold,
      marginBottom: 8,
    },
    savedText: {
      color: t.success,
      fontSize: 12,
      fontFamily: FONTS.bodySemibold,
      marginBottom: 16,
    },
    homeButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 13,
      paddingHorizontal: 34,
    },
    homeButtonText: { color: t.onAccent, fontSize: 14, fontFamily: FONTS.bodyBold },
  });
