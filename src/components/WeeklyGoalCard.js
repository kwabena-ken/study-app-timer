import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import { computeWeeklyProgress } from "../utils/weeklyGoal";

function formatGoalMins(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remainder = Math.round(mins % 60);
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export default function WeeklyGoalCard({ sessions, settings, now }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const progress = useMemo(
    () => computeWeeklyProgress(sessions, now),
    [sessions, now]
  );

  if (!settings?.weeklyGoalEnabled) return null;

  const minsGoal = Math.max(1, settings.weeklyGoalMins || 1);
  const daysGoal = Math.max(1, settings.weeklyGoalDays || 1);
  const minsPct = Math.min(100, Math.round((progress.mins / minsGoal) * 100));
  const daysPct = Math.min(100, Math.round((progress.days / daysGoal) * 100));
  const complete = progress.mins >= minsGoal && progress.days >= daysGoal;

  return (
    <View
      style={[styles.card, complete && styles.cardComplete]}
      accessibilityRole="summary"
      accessibilityLabel={`Weekly goal: ${formatGoalMins(progress.mins)} of ${formatGoalMins(minsGoal)}, and ${progress.days} of ${daysGoal} study days.`}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>WEEKLY GOAL</Text>
          <Text style={styles.title}>
            {complete ? "Goal complete" : `${minsPct}% focused`}
          </Text>
        </View>
        <Text style={[styles.badge, complete && styles.badgeComplete]}>
          {complete ? "Complete" : `${progress.days}/${daysGoal} days`}
        </Text>
      </View>

      <View style={styles.metricRow}>
        <Text style={styles.metricLabel}>Focus time</Text>
        <Text style={styles.metricValue}>
          {formatGoalMins(progress.mins)} / {formatGoalMins(minsGoal)}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.focusFill, { width: `${minsPct}%` }]} />
      </View>

      <View style={styles.metricRow}>
        <Text style={styles.metricLabel}>Active days</Text>
        <Text style={styles.metricValue}>
          {progress.days} / {daysGoal}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.daysFill, { width: `${daysPct}%` }]} />
      </View>
    </View>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 18,
      padding: 18,
      marginBottom: 18,
    },
    cardComplete: { borderColor: t.success },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 15,
    },
    eyebrow: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 10,
      letterSpacing: 1.2,
    },
    title: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 20,
      marginTop: 3,
    },
    badge: {
      color: t.accent,
      backgroundColor: t.surfaceActive,
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      overflow: "hidden",
    },
    badgeComplete: { color: t.success },
    metricRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    metricLabel: {
      color: t.textSecondary,
      fontFamily: FONTS.bodyMedium,
      fontSize: 12,
    },
    metricValue: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 12,
    },
    track: {
      height: 7,
      backgroundColor: t.progressTrack,
      borderRadius: 4,
      overflow: "hidden",
      marginBottom: 13,
    },
    focusFill: {
      height: 7,
      borderRadius: 4,
      backgroundColor: t.accent,
    },
    daysFill: {
      height: 7,
      borderRadius: 4,
      backgroundColor: t.success,
    },
  });
