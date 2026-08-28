import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";
import WeeklyGoalCard from "../components/WeeklyGoalCard";
import { loadSessions, loadSettings } from "../utils/storage";
import { computeStreak, recentStudyDays } from "../utils/streak";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Darken a #rrggbb color by a factor (0–1). Used for gradient stops. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * factor)
    .toString(16)
    .padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

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

/** "Monday, 24 August" style date line for the home header. */
function longDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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
  const [settings, setSettings] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const refreshSessions = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [savedSessions, savedSettings] = await Promise.all([
        loadSessions(),
        loadSettings(),
      ]);
      setSessions(savedSessions);
      setSettings(savedSettings);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshSessions(true)}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not load your study data.</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => refreshSessions()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading study data"
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Greeting ── */}
        <Text style={styles.greeting}>{greeting(now.getHours())} 👋</Text>
        <Text style={styles.dateLine}>{longDate(now)}</Text>

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
          {/* Diagonal sheen (dark themes only) + warm glow bleeding from the corner */}
          {theme.isDark && (
            <LinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              colors={["rgba(255,255,255,0.05)", "rgba(255,255,255,0)"]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
          <View style={styles.streakGlow} pointerEvents="none" />
          <View>
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
                <Text style={styles.streakBest}>Best streak · {streak.best} days</Text>
              </View>
            </View>

            {/* 7-day marker row */}
            <View style={styles.week}>
              {week.map((on, i) => (
                <View key={i} style={styles.weekCol}>
                  {on ? (
                    <LinearGradient
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      colors={[theme.warning, shade(theme.warning, 0.72)]}
                      style={[
                        styles.dayMarker,
                        styles.dayMarkerOn,
                        i === week.length - 1 && styles.dayMarkerToday,
                      ]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.dayMarker,
                        styles.dayMarkerOff,
                        i === week.length - 1 && styles.dayMarkerToday,
                      ]}
                    />
                  )}
                  <Text style={styles.weekLetter}>{dayLabels[i]}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <WeeklyGoalCard sessions={list} settings={settings} now={now} />

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
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    scroll: { padding: 20, paddingTop: 16, paddingBottom: 28 },

    greeting: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 28,
      marginBottom: 2,
    },
    dateLine: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 13,
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
      overflow: "hidden",
    },
    // Fake radial warm glow bleeding from the top-right corner.
    streakGlow: {
      position: "absolute",
      right: -50,
      top: -50,
      width: 150,
      height: 150,
      borderRadius: 75,
      backgroundColor: t.warning,
      opacity: t.isDark ? 0.16 : 0.08,
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
      shadowColor: t.warning,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: t.isDark ? 0.5 : 0.25,
      shadowRadius: 10,
      elevation: 4,
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
    // 20px rounded-square day markers (redesign spec)
    dayMarker: {
      width: 20,
      height: 20,
      borderRadius: 7,
      marginBottom: 6,
    },
    dayMarkerOn: {
      shadowColor: t.warning,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: t.isDark ? 0.45 : 0.25,
      shadowRadius: 8,
      elevation: 3,
    },
    dayMarkerOff: {
      backgroundColor: t.isDark ? "rgba(255,255,255,0.06)" : t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
    },
    dayMarkerToday: {
      borderWidth: 2,
      borderColor: t.accent,
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
      marginBottom: 18,
      shadowColor: t.accent,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: t.isDark ? 0.38 : 0.22,
      shadowRadius: 20,
      elevation: 8,
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
      marginBottom: 22,
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
    errorBox: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.danger,
      borderRadius: 14,
      padding: 14,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    errorText: {
      color: t.textSecondary,
      fontFamily: FONTS.body,
      fontSize: 12,
      flex: 1,
    },
    retryBtn: {
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 999,
      paddingVertical: 7,
      paddingHorizontal: 12,
    },
    retryText: {
      color: t.accent,
      fontFamily: FONTS.bodySemibold,
      fontSize: 12,
    },
  });
