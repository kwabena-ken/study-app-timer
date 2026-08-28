import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  TextInput,
  RefreshControl,
} from "react-native";
import {
  loadSessions,
  clearSessions,
  deleteSession,
  updateSession,
  loadSubjects,
} from "../utils/storage";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

/**
 * Groups an array of session records by day label.
 * Returns an array of { label: string, sessions: Array } objects.
 */
function groupByDay(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = [];
  const map = new Map();

  for (const s of sessions) {
    const d = new Date(s.completedAt);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label;

    if (dayStart.getTime() === today.getTime()) {
      label = "Today";
    } else if (dayStart.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else {
      label = dayStart.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year:
          dayStart.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
    }

    if (!map.has(label)) {
      const group = { label, sessions: [] };
      map.set(label, group);
      groups.push(group);
    }
    map.get(label).sessions.push(s);
  }

  return groups;
}

/**
 * Formats an ISO timestamp to a time string like "3:45 PM".
 */
function formatTimeOfDay(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * History screen — shows all completed sessions grouped by day.
 * Each session card shows its subject (with color dot) and
 * supports inline edit (subject) and delete.
 *
 * @param {{ onGoHome: () => void }} props
 */
export default function HistoryScreen({ onGoHome }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [rangeFilter, setRangeFilter] = useState("All time");

  const refreshHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [sessData, subData] = await Promise.all([
        loadSessions(),
        loadSubjects(),
      ]);
      setSessions(sessData);
      setSubjects(subData);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // Build a map of subject name (lowercase) → color
  const subjectColorMap = useMemo(() => {
    const map = {};
    subjects.forEach((s) => {
      map[s.name.toLowerCase()] = s.color;
    });
    return map;
  }, [subjects]);

  // ── Delete a single session ──
  const handleDelete = useCallback((id) => {
    Alert.alert(
      "Delete Session?",
      "This will permanently remove this session record.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteSession(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));
          },
        },
      ]
    );
  }, []);

  // ── Inline edit: start ──
  const handleStartEdit = useCallback((session) => {
    setEditingId(session.id);
    setEditText(session.subject || "");
  }, []);

  // ── Inline edit: save ──
  const handleSaveEdit = useCallback(async () => {
    if (editingId && editText.trim()) {
      await updateSession(editingId, { subject: editText.trim() });
      setSessions((prev) =>
        prev.map((s) =>
          s.id === editingId ? { ...s, subject: editText.trim() } : s
        )
      );
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText]);

  // ── Inline edit: cancel ──
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  // ── Clear all history ──
  const handleClear = useCallback(() => {
    Alert.alert(
      "Clear History?",
      "This will permanently delete all your session records.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearSessions();
            setSessions([]);
          },
        },
      ]
    );
  }, []);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const now = Date.now();
    const rangeMs =
      rangeFilter === "7 days"
        ? 7 * 24 * 60 * 60 * 1000
        : rangeFilter === "30 days"
        ? 30 * 24 * 60 * 60 * 1000
        : null;

    return sessions.filter((session) => {
      const subject = session.subject || "No subject";
      const searchable = `${subject} ${session.label || ""}`.toLowerCase();
      const date = new Date(session.completedAt || session.startedAt).getTime();

      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;
      if (subjectFilter !== "All" && subject !== subjectFilter) return false;
      if (statusFilter === "Completed" && session.completed === false) return false;
      if (statusFilter === "Left early" && session.completed !== false) return false;
      if (rangeMs != null && (Number.isNaN(date) || now - date > rangeMs)) return false;
      return true;
    });
  }, [sessions, query, subjectFilter, statusFilter, rangeFilter]);

  const groups = groupByDay(filteredSessions);
  const hasFilters =
    query.trim() || subjectFilter !== "All" || statusFilter !== "All" || rangeFilter !== "All time";
  const clearFilters = useCallback(() => {
    setQuery("");
    setSubjectFilter("All");
    setStatusFilter("All");
    setRangeFilter("All time");
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>HISTORY</Text>
        <Text style={styles.title}>Your sessions</Text>
      </View>

      <View style={styles.filterPanel}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions or subjects"
          placeholderTextColor={theme.textDisabled}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search sessions or subjects"
        />

        <Text style={styles.filterLabel}>Subject</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {["All", ...subjects.map((subject) => subject.name)].map((subject) => (
            <TouchableOpacity
              key={subject}
              style={[styles.filterChip, subjectFilter === subject && styles.filterChipActive]}
              onPress={() => setSubjectFilter(subject)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${subject}`}
              accessibilityState={{ selected: subjectFilter === subject }}
            >
              <Text style={[styles.filterChipText, subjectFilter === subject && styles.filterChipTextActive]}>
                {subject}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.filterLine}>
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Status</Text>
            <View style={styles.filterRow}>
              {["All", "Completed", "Left early"].map((status) => (
                <TouchableOpacity
                  key={status}
                  style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
                  onPress={() => setStatusFilter(status)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${status} sessions`}
                  accessibilityState={{ selected: statusFilter === status }}
                >
                  <Text style={[styles.filterChipText, statusFilter === status && styles.filterChipTextActive]}>
                    {status}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Date</Text>
            <View style={styles.filterRow}>
              {["All time", "7 days", "30 days"].map((range) => (
                <TouchableOpacity
                  key={range}
                  style={[styles.filterChip, rangeFilter === range && styles.filterChipActive]}
                  onPress={() => setRangeFilter(range)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show sessions from ${range}`}
                  accessibilityState={{ selected: rangeFilter === range }}
                >
                  <Text style={[styles.filterChipText, rangeFilter === range && styles.filterChipTextActive]}>
                    {range}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.filterSummary}>
          <Text style={styles.resultCount}>
            {filteredSessions.length} session{filteredSessions.length === 1 ? "" : "s"}
          </Text>
          {hasFilters ? (
            <TouchableOpacity onPress={clearFilters} accessibilityRole="button" accessibilityLabel="Clear history filters">
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refreshHistory(true)}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {loading && <Text style={styles.emptyText}>Loading...</Text>}

        {!loading && loadError && (
          <View style={styles.errorWrap}>
            <Icon name="close" size={24} color={theme.danger} />
            <Text style={styles.errorTitle}>Could not load history</Text>
            <Text style={styles.emptyText}>
              Check your device storage and try again.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => refreshHistory()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading history"
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !loadError && filteredSessions.length === 0 && !hasFilters && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptyText}>
              Complete a study session to see it here!
            </Text>
          </View>
        )}

        {!loading && !loadError && filteredSessions.length === 0 && hasFilters && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No matching sessions</Text>
            <Text style={styles.emptyText}>Try changing your search or filters.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={clearFilters} accessibilityRole="button" accessibilityLabel="Clear history filters">
              <Text style={styles.retryText}>Clear filters</Text>
            </TouchableOpacity>
          </View>
        )}

        {groups.map((group) => (
          <View key={group.label} style={styles.dayGroup}>
            <Text style={styles.dayLabel}>{group.label}</Text>

            {group.sessions.map((s) => {
              const color =
                subjectColorMap[(s.subject || "").toLowerCase()] || theme.textMuted;
              const isEditing = editingId === s.id;

              return (
                <View key={s.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View
                      style={[styles.colorDot, { backgroundColor: color }]}
                    />

                    {isEditing ? (
                      /* ── Edit mode ── */
                      <View style={styles.editRow}>
                        <TextInput
                          style={styles.editInput}
                          value={editText}
                          onChangeText={setEditText}
                          onSubmitEditing={handleSaveEdit}
                          autoFocus
                        />
                        <TouchableOpacity
                          onPress={handleSaveEdit}
                          style={styles.editAction}
                          accessibilityRole="button"
                          accessibilityLabel="Save name"
                        >
                          <Icon name="check" size={18} color={theme.success} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleCancelEdit}
                          style={styles.editAction}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel editing"
                        >
                          <Icon name="close" size={18} color={theme.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      /* ── Display mode ── */
                      <>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardSubject, { color }]}>
                            {s.subject || "No subject"}
                          </Text>
                          <Text style={styles.cardTitle}>{s.label}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleStartEdit(s)}
                          style={styles.iconBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Edit subject"
                        >
                          <Icon name="edit" size={18} color={theme.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(s.id)}
                          style={styles.iconBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Delete session"
                        >
                          <Icon name="trash" size={18} color={theme.danger} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>

                  {!isEditing && (
                    <>
                      <Text style={styles.cardMeta}>
                        {s.phasesCompleted} phase
                        {s.phasesCompleted !== 1 ? "s" : ""} ·{" "}
                        {s.actualStudyMins != null
                          ? `${Math.round(s.actualStudyMins)}m studied`
                          : `${s.totalStudyMins}m study`}
                        {s.completed === false && " · left early"}
                      </Text>
                      <Text style={styles.cardTime}>
                        {formatTimeOfDay(s.completedAt)}
                      </Text>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        {sessions.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Text style={styles.clearBtnText}>Clear History</Text>
          </TouchableOpacity>
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
    filterPanel: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 4,
    },
    searchInput: {
      color: t.textPrimary,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontFamily: FONTS.body,
      fontSize: 13,
    },
    filterLine: {
      flexDirection: "row",
      gap: 12,
    },
    filterGroup: { flex: 1 },
    filterLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: 12,
      marginBottom: 7,
    },
    filterRow: {
      flexDirection: "row",
      gap: 7,
      alignItems: "center",
    },
    filterChip: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    filterChipActive: {
      backgroundColor: t.surfaceActive,
      borderColor: t.accent,
    },
    filterChipText: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
    },
    filterChipTextActive: { color: t.accent },
    filterSummary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 12,
      marginBottom: 4,
    },
    resultCount: {
      color: t.textMuted,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
    },
    clearFiltersText: {
      color: t.accent,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
    },
    scroll: { padding: 20, paddingTop: 12 },
    emptyWrap: { alignItems: "center", marginTop: 80 },
    emptyEmoji: { fontSize: 48, marginBottom: 12 },
    emptyTitle: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 18,
      marginBottom: 6,
    },
    emptyText: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 13,
      textAlign: "center",
      maxWidth: 220,
    },
    errorWrap: {
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 18,
      paddingVertical: 28,
      paddingHorizontal: 22,
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
    dayGroup: { marginBottom: 20 },
    dayLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 8,
    },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
    },
    cardTop: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
    },
    colorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: 10,
    },
    cardSubject: {
      fontFamily: FONTS.bodyBold,
      fontSize: 13,
      marginBottom: 2,
    },
    cardTitle: { color: t.textPrimary, fontFamily: FONTS.bodyBold, fontSize: 15 },
    cardMeta: { color: t.textTertiary, fontFamily: FONTS.body, fontSize: 12, marginBottom: 2, marginLeft: 20 },
    cardTime: { color: t.textMuted, fontFamily: FONTS.body, fontSize: 11, marginLeft: 20 },
    iconBtn: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    editRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    editInput: {
      flex: 1,
      color: t.textPrimary,
      fontFamily: FONTS.body,
      fontSize: 14,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    editAction: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    clearBtn: {
      alignSelf: "center",
      borderWidth: 1,
      borderColor: t.danger,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 20,
      marginTop: 12,
      marginBottom: 32,
    },
    clearBtnText: {
      color: t.danger,
      fontFamily: FONTS.bodySemibold,
      fontSize: 12,
    },
  });
