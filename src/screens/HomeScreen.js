import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { loadSessions } from "../utils/storage";
import { computeStreak } from "../utils/streak";

/**
 * Home screen — landing page with Start, Stats, History, and Settings buttons.
 *
 * @param {{ onStartStudying: () => void, onViewStats: () => void, onViewHistory: () => void, onViewSettings: () => void }} props
 */
export default function HomeScreen({
  onStartStudying,
  onViewStats,
  onViewHistory,
  onViewSettings,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [currentStreak, setCurrentStreak] = useState(null);

  useEffect(() => {
    loadSessions()
      .then((sessions) => setCurrentStreak(computeStreak(sessions).current))
      .catch(() => setCurrentStreak(0));
  }, []);

  const streakLabel =
    currentStreak > 0
      ? `${currentStreak}-day streak`
      : "Start a streak today";
  const streakA11y =
    currentStreak > 0
      ? `Current study streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`
      : "No study streak yet. Complete a session to start one today.";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.wrap}>
        <Text style={styles.emoji}>⏱️</Text>
        <Text style={styles.title}>Study Timer</Text>
        <Text style={styles.subtitle}>
          Track your learning, one session at a time
        </Text>
        <View style={styles.streakWrap}>
          {currentStreak != null && (
            <Text
              style={styles.streak}
              accessibilityRole="text"
              accessibilityLabel={streakA11y}
            >
              {streakLabel}
            </Text>
          )}
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={onStartStudying}>
          <Text style={styles.startBtnText}>Start Studying</Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onViewStats}>
            <Text style={styles.secondaryBtnText}>📊 Stats</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onViewHistory}>
            <Text style={styles.secondaryBtnText}>📋 History</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onViewSettings}>
            <Text style={styles.secondaryBtnText}>⚙️ Settings</Text>
          </TouchableOpacity>
        </View>
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
    emoji: { fontSize: 56, marginBottom: 12 },
    title: { color: t.textPrimary, fontSize: 28, fontWeight: "800" },
    subtitle: {
      color: t.textMuted,
      fontSize: 14,
      marginTop: 8,
      textAlign: "center",
      maxWidth: 260,
    },
    streakWrap: {
      marginTop: 10,
      marginBottom: 36,
      minHeight: 20,
    },
    streak: {
      color: t.warning,
      fontSize: 14,
      fontWeight: "700",
    },
    startBtn: {
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 48,
      marginBottom: 20,
    },
    startBtnText: {
      color: t.onAccent,
      fontSize: 17,
      fontWeight: "700",
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 10,
    },
    secondaryBtn: {
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    secondaryBtnText: {
      color: t.textTertiary,
      fontSize: 13,
      fontWeight: "600",
    },
  });
