import React, { useState, useEffect, useMemo } from "react";
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
import { loadSessions, loadSubjects, loadSettings } from "../utils/storage";
import { computeStreak } from "../utils/streak";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";
import WeeklyGoalCard from "../components/WeeklyGoalCard";

const TABS = ["Day", "Week", "Month", "All"];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_HEIGHT = 116;

/** Midnight of the given date, in local time. */
function getStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The cutoff date for a range tab. */
function getFilterDate(tab, now) {
  switch (tab) {
    case "Day":
      return getStartOfDay(now);
    case "Week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "Month": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d;
    }
    default:
      return new Date(0); // All time
  }
}

/** Minutes studied in a session (partials count their actual time). */
function sessionMins(s) {
  return s.actualStudyMins != null ? s.actualStudyMins : s.totalStudyMins || 0;
}

/** Format minutes as "Xh Ym" / "Xh" / "Xm". */
function formatDuration(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Darken a #rrggbb color by a factor (0–1). Used for gradient stops. */
function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * factor)
    .toString(16)
    .padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/**
 * Focus minutes for each of the last 7 local days, oldest → today.
 * Each entry: { mins, label (weekday initial), isToday }.
 */
function buildLast7(sessions, now) {
  const startToday = getStartOfDay(now).getTime();
  const buckets = new Array(7).fill(0);
  for (const s of sessions) {
    const when = new Date(s.completedAt || s.startedAt).getTime();
    if (Number.isNaN(when)) continue;
    const d = new Date(when);
    const dayStart = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate()
    ).getTime();
    const diff = Math.round((startToday - dayStart) / DAY_MS);
    if (diff >= 0 && diff < 7) buckets[6 - diff] += sessionMins(s);
  }
  return buckets.map((mins, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return { mins, label: DAY_LETTERS[d.getDay()], isToday: i === 6 };
  });
}

/**
 * Insights — the app's focus dashboard.
 *
 * Fronted by a seven-day focus bar chart (the signature), then current/best
 * streak, a range switch, and a per-subject breakdown scoped to that range.
 * Reached from the tab bar, so it needs no back control.
 */
export default function StatsScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [activeTab, setActiveTab] = useState("Week");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const refreshStats = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [sessData, subData, savedSettings] = await Promise.all([
        loadSessions(),
        loadSubjects(),
        loadSettings(),
      ]);
      setSessions(sessData);
      setSubjects(subData);
      setSettings(savedSettings);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const now = useMemo(() => new Date(), []);

  // Subject name (lowercased) → identity color.
  const subjectColorMap = useMemo(() => {
    const map = {};
    subjects.forEach((s) => {
      map[s.name.toLowerCase()] = s.color;
    });
    return map;
  }, [subjects]);

  const week = useMemo(() => buildLast7(sessions, now), [sessions, now]);
  const weekTotal = useMemo(
    () => week.reduce((a, d) => a + d.mins, 0),
    [week]
  );
  const maxDayMins = useMemo(
    () => Math.max(1, ...week.map((d) => d.mins)),
    [week]
  );

  const streak = useMemo(() => computeStreak(sessions, now), [sessions, now]);

  // Lifetime figures for the totals trio.
  const lifetime = useMemo(() => {
    let mins = 0;
    for (const s of sessions) mins += sessionMins(s);
    return {
      totalMins: mins,
      count: sessions.length,
      avgMins: sessions.length ? mins / sessions.length : 0,
    };
  }, [sessions]);

  // Per-subject breakdown + totals for the active range.
  const stats = useMemo(() => {
    const cutoff = getFilterDate(activeTab, now);
    const filtered = sessions.filter(
      (s) => new Date(s.completedAt || s.startedAt) >= cutoff
    );

    const bySubject = {};
    let totalMins = 0;
    filtered.forEach((s) => {
      const subject = s.subject || "Unspecified";
      const mins = sessionMins(s);
      if (!bySubject[subject]) {
        bySubject[subject] = { name: subject, mins: 0, sessions: 0 };
      }
      bySubject[subject].mins += mins;
      bySubject[subject].sessions += 1;
      totalMins += mins;
    });

    const sorted = Object.values(bySubject).sort((a, b) => b.mins - a.mins);
    return { subjects: sorted, totalMins, totalSessions: filtered.length };
  }, [sessions, activeTab, now]);

  const hasAny = sessions.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>STATS</Text>
        <Text style={styles.title}>Insights</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshStats(true)}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {loading && <Text style={styles.muted}>Loading…</Text>}

        {!loading && loadError && (
          <View style={styles.errorCard}>
            <Icon name="close" size={24} color={theme.danger} />
            <Text style={styles.errorTitle}>Could not load insights</Text>
            <Text style={styles.muted}>
              Check your device storage and try again.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => refreshStats()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading insights"
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !loadError && !hasAny && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Icon name="chart" size={26} color={theme.accent} />
            </View>
            <Text style={styles.emptyTitle}>No focus logged yet</Text>
            <Text style={styles.muted}>
              Finish a study session and your focus time will chart here.
            </Text>
          </View>
        )}

        {!loading && hasAny && (
          <>
            {/* ── Signature: seven-day focus chart ── */}
            <View
              style={styles.chartCard}
              accessibilityRole="text"
              accessibilityLabel={`${formatDuration(
                weekTotal
              )} focused in the last seven days.`}
            >
              <View style={styles.chartHead}>
                <View>
                  <Text style={styles.cardLabel}>LAST 7 DAYS</Text>
                  <Text style={styles.chartTotal}>
                    {formatDuration(weekTotal)}
                  </Text>
                </View>
                <Text style={styles.chartCaption}>focused</Text>
              </View>

              <View style={styles.chart}>
                {week.map((d, i) => {
                  const h =
                    d.mins <= 0
                      ? 3
                      : Math.max(
                          8,
                          Math.round((d.mins / maxDayMins) * CHART_HEIGHT)
                        );
                  return (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        {d.mins <= 0 ? (
                          <View style={[styles.bar, { height: h }, styles.barEmpty]} />
                        ) : (
                          <LinearGradient
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            colors={[theme.accent, shade(theme.accent, 0.62)]}
                            style={[
                              styles.bar,
                              { height: h },
                              !d.isToday && styles.barPast,
                            ]}
                          />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.barLabel,
                          d.isToday && styles.barLabelToday,
                        ]}
                      >
                        {d.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <WeeklyGoalCard sessions={sessions} settings={settings} now={now} />

            {/* ── Streak tiles ── */}
            <View style={styles.tileRow}>
              <View style={styles.tile}>
                <View style={styles.tileTop}>
                  <Icon name="flame" size={18} color={theme.warning} />
                  <Text style={styles.tileValue}>{streak.current}</Text>
                </View>
                <Text style={styles.tileLabel}>
                  Day{streak.current === 1 ? "" : "s"} streak
                </Text>
              </View>
              <View style={styles.tile}>
                <View style={styles.tileTop}>
                  <Text style={styles.tileValue}>{streak.best}</Text>
                </View>
                <Text style={styles.tileLabel}>Best streak</Text>
              </View>
            </View>

            {/* ── Range switch ── */}
            <Text style={styles.sectionLabel}>Breakdown</Text>
            <View style={styles.tabRow}>
              {TABS.map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === tab && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${tab} breakdown`}
                  accessibilityState={{ selected: activeTab === tab }}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTab === tab && styles.tabTextActive,
                    ]}
                  >
                    {tab}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Range total ── */}
            <View style={styles.totalRow}>
              <Text style={styles.totalValue}>
                {formatDuration(stats.totalMins)}
              </Text>
              <Text style={styles.totalSub}>
                {stats.totalSessions} session
                {stats.totalSessions !== 1 ? "s" : ""}
              </Text>
            </View>

            {/* ── Per-subject breakdown ── */}
            {stats.subjects.length === 0 ? (
              <Text style={styles.rangeEmpty}>
                No focus in this range yet.
              </Text>
            ) : (
              stats.subjects.map((s) => {
                const color =
                  subjectColorMap[s.name.toLowerCase()] || theme.neutral;
                const pct =
                  stats.totalMins > 0 ? (s.mins / stats.totalMins) * 100 : 0;
                return (
                  <View key={s.name} style={styles.subjectRow}>
                    <View style={styles.subjectTop}>
                      <View
                        style={[styles.colorDot, { backgroundColor: color }]}
                      />
                      <Text style={styles.subjectName} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={styles.subjectTime}>
                        {formatDuration(s.mins)}
                      </Text>
                    </View>
                    <View style={styles.barBg}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.max(pct, 2)}%`, backgroundColor: color },
                        ]}
                      />
                    </View>
                    <Text style={styles.subjectMeta}>
                      {s.sessions} session{s.sessions !== 1 ? "s" : ""} ·{" "}
                      {Math.round(pct)}%
                    </Text>
                  </View>
                );
              })
            )}

            {/* ── Lifetime totals ── */}
            <View style={styles.totRow}>
              <View style={styles.tot}>
                <Text style={styles.totN}>{formatDuration(lifetime.totalMins)}</Text>
                <Text style={styles.totL}>All time</Text>
              </View>
              <View style={styles.tot}>
                <Text style={styles.totN}>{lifetime.count}</Text>
                <Text style={styles.totL}>Sessions</Text>
              </View>
              <View style={styles.tot}>
                <Text style={styles.totN}>{formatDuration(lifetime.avgMins)}</Text>
                <Text style={styles.totL}>Avg</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 4,
    },
    eyebrow: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      letterSpacing: 2,
    },
    title: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 28,
      marginTop: 4,
    },
    scroll: { padding: 20, paddingTop: 16, paddingBottom: 28 },
    muted: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 13,
      textAlign: "center",
      maxWidth: 240,
    },

    // Empty (no data at all)
    emptyCard: {
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      paddingVertical: 36,
      paddingHorizontal: 24,
      marginTop: 24,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: t.surfaceActive,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    emptyTitle: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 17,
      marginBottom: 6,
    },
    errorCard: {
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      paddingVertical: 28,
      paddingHorizontal: 24,
      marginTop: 24,
    },
    errorTitle: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 17,
      marginTop: 10,
      marginBottom: 6,
    },
    retryBtn: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 18,
      marginTop: 16,
    },
    retryText: {
      color: t.onAccent,
      fontFamily: FONTS.bodySemibold,
      fontSize: 13,
    },

    // Chart card (signature)
    chartCard: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
    },
    chartHead: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    cardLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      letterSpacing: 1,
    },
    chartTotal: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 30,
      marginTop: 4,
    },
    chartCaption: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 12,
      marginBottom: 4,
    },
    chart: {
      flexDirection: "row",
      alignItems: "flex-end",
      height: CHART_HEIGHT + 24,
    },
    barCol: {
      flex: 1,
      alignItems: "center",
      justifyContent: "flex-end",
    },
    barTrack: {
      height: CHART_HEIGHT,
      justifyContent: "flex-end",
    },
    bar: {
      width: 22,
      borderRadius: 7,
    },
    barPast: { opacity: 0.38 },
    barEmpty: { backgroundColor: t.dotIdle },
    barLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
      marginTop: 8,
    },
    barLabelToday: { color: t.textSecondary },

    // Streak tiles
    tileRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 22,
    },
    tile: {
      flex: 1,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 16,
    },
    tileTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    tileValue: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 26,
    },
    tileLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 12,
      marginTop: 4,
    },

    // Range switch
    sectionLabel: {
      color: t.textSecondary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 13,
      marginBottom: 10,
    },
    tabRow: {
      flexDirection: "row",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 4,
      marginBottom: 16,
    },
    tab: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 9,
      alignItems: "center",
    },
    tabActive: { backgroundColor: t.surfaceActive },
    tabText: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 13,
    },
    tabTextActive: { color: t.textPrimary },

    // Range total
    totalRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 10,
      marginBottom: 16,
    },
    totalValue: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 24,
    },
    totalSub: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 13,
    },
    rangeEmpty: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 13,
      paddingVertical: 8,
    },

    // Per-subject rows
    subjectRow: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
    },
    subjectTop: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    colorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: 10,
    },
    subjectName: {
      color: t.textPrimary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 15,
      flex: 1,
    },
    subjectTime: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 15,
    },
    barBg: {
      backgroundColor: t.progressTrack,
      height: 6,
      borderRadius: 3,
      marginBottom: 8,
      overflow: "hidden",
    },
    barFill: {
      height: 6,
      borderRadius: 3,
    },
    subjectMeta: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 11,
    },

    // Lifetime totals trio
    totRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 12,
    },
    tot: {
      flex: 1,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: "center",
    },
    totN: {
      color: t.textPrimary,
      fontFamily: FONTS.displayBold,
      fontSize: 20,
      fontVariant: ["tabular-nums"],
    },
    totL: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
      marginTop: 4,
    },
  });
