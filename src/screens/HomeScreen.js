import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";
import { loadSessions } from "../utils/storage";
import { computeStreak, recentStudyDays } from "../utils/streak";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Round a minute count to "Xm" / "Xh" / "Xh Ym". */
function formatMins(mins) {
  const m = Math.round(mins || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function greeting(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const QUICK_STARTS = [
  { key: "1hr", label: "1 Hour", sub: "4 blocks" },
  { key: "2hr", label: "2 Hours", sub: "5 blocks" },
  { key: "custom", label: "Custom", sub: "Build it" },
];

/**
 * Home dashboard — the app's landing page.
 *
 * Fronted by the streak card (the signature element), then a primary
 * "Start a session" call to action, quick-start chips that preselect a length,
 * and a compact focus-time recap. Top-level navigation lives in the tab bar.
 *
 * @param {{
 *   onStartStudying: () => void,
 *   onQuickStart: (key: string) => void,
 * }} props
 */
export default function HomeScreen({ onStartStudying, onQuickStart }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    loadSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const now = useMemo(() => new Date(), []);
  const list = sessions || [];

  const streak = useMemo(() => computeStreak(list, now), [sessions]);
  const week = useMemo(() => recentStudyDays(list, 7, now), [sessions]);

  // Focus-minute recap (matches Stats: actual studied minutes, partials count).
  const recap = useMemo(() => {
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const startWeek = startToday - 6 * 24 * 60 * 60 * 1000;
    let todayMins = 0;
    let weekMins = 0;
    let weekSessions = 0;
    for (const s of list) {
      const when = new Date(s.completedAt || s.startedAt).getTime();
      if (Number.isNaN(when)) continue;
      const mins = s.actualStudyMins != null ? s.actualStudyMins : s.totalStudyMins || 0;
      if (when >= startToday) todayMins += mins;
      if (when >= startWeek) {
        weekMins += mins;
        weekSessions += 1;
      }
    }
    return { todayMins, weekMins, weekSessions };
  }, [sessions]);

  // Weekday initials for the last 7 days, oldest → today.
  const dayLabels = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(DAY_LETTERS[d.getDay()]);
    }
    return out;
  }, [now]);

  const hasStreak = streak.current > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ── */}
        <Text style={styles.eyebrow}>STUDY TIMER</Text>
        <Text style={styles.greeting}>{greeting(now.getHours())}</Text>

        {/* ── Streak card (signature) ── */}
        <View
          style={styles.streakCard}
          accessibilityRole="text"
          accessibilityLabel={
            hasStreak
              ? `Current streak ${streak.current} day${streak.current === 1 ? "" : "s"}. Best ${streak.best}.`
              : "No active streak. Study today to start one."
          }
        >
          <View style={styles.streakTop}>
            <View style={styles.flameWrap}>
              <Icon name="flame" size={26} color={theme.warning} />
            </View>
            <View style={styles.streakNums}>
              <View style={styles.streakValueRow}>
                <Text style={styles.streakValue}>{streak.current}</Text>
                <Text style={styles.streakUnit}>
                  {hasStreak ? "day streak" : "days — start today"}
                </Text>
              </View>
              <Text style={styles.streakBest}>Best {streak.best}</Text>
            </View>
          </View>

          {/* 7-day dot row */}
          <View style={styles.week}>
            {week.map((on, i) => (
              <View key={i} style={styles.weekCol}>
                <View
                  style={[
                    styles.dot,
                    on ? styles.dotOn : styles.dotOff,
                    i === week.length - 1 && styles.dotToday,
                  ]}
                />
                <Text style={styles.weekLetter}>{dayLabels[i]}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Primary CTA ── */}
        <TouchableOpacity
          style={styles.cta}
          onPress={onStartStudying}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Start a session"
        >
          <Icon name="play" size={20} color={theme.onAccent} />
          <Text style={styles.ctaText}>Start a session</Text>
        </TouchableOpacity>

        {/* ── Quick start ── */}
        <Text style={styles.sectionLabel}>Quick start</Text>
        <View style={styles.chipRow}>
          {QUICK_STARTS.map((q) => (
            <TouchableOpacity
              key={q.key}
              style={styles.chip}
              onPress={() => onQuickStart(q.key)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Start ${q.label} session`}
            >
              <Text style={styles.chipLabel}>{q.label}</Text>
              <Text style={styles.chipSub}>{q.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Focus recap ── */}
        <View style={styles.statRow}>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{formatMins(recap.todayMins)}</Text>
            <Text style={styles.statLabel}>Today</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{formatMins(recap.weekMins)}</Text>
            <Text style={styles.statLabel}>This week</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{recap.weekSessions}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    scroll: { padding: 20, paddingTop: 16, paddingBottom: 28 },

    eyebrow: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      letterSpacing: 2,
    },
    greeting: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 28,
      marginTop: 4,
      marginBottom: 20,
    },

    // Streak card
    streakCard: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      padding: 20,
      marginBottom: 18,
    },
    streakTop: {
      flexDirection: "row",
      alignItems: "center",
    },
    flameWrap: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: t.surfaceActive,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 14,
    },
    streakNums: { flex: 1 },
    streakValueRow: {
      flexDirection: "row",
      alignItems: "baseline",
    },
    streakValue: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 40,
      lineHeight: 44,
    },
    streakUnit: {
      color: t.textSecondary,
      fontFamily: FONTS.bodyMedium,
      fontSize: 14,
      marginLeft: 8,
    },
    streakBest: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 12,
      marginTop: 2,
    },
    week: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 20,
    },
    weekCol: { alignItems: "center", flex: 1 },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginBottom: 6,
    },
    dotOn: { backgroundColor: t.warning },
    dotOff: { backgroundColor: t.dotIdle },
    dotToday: {
      borderWidth: 2,
      borderColor: t.accent,
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    weekLetter: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
    },

    // CTA
    cta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: t.accent,
      borderRadius: 16,
      paddingVertical: 17,
      marginBottom: 22,
    },
    ctaText: {
      color: t.onAccent,
      fontFamily: FONTS.bodyBold,
      fontSize: 16,
    },

    // Quick start
    sectionLabel: {
      color: t.textSecondary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 13,
      marginBottom: 10,
    },
    chipRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 22,
    },
    chip: {
      flex: 1,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 10,
      alignItems: "center",
    },
    chipLabel: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 15,
    },
    chipSub: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 11,
      marginTop: 3,
    },

    // Recap
    statRow: {
      flexDirection: "row",
      gap: 10,
    },
    statTile: {
      flex: 1,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: "center",
    },
    statValue: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 20,
    },
    statLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
      marginTop: 4,
    },
  });
