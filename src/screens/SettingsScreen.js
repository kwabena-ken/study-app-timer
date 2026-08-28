import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  Alert,
  TextInput,
} from "react-native";
import {
  SUBJECT_COLORS,
  loadSettings,
  saveSettings,
  loadSubjects,
  updateSubjectColor,
  renameSubject,
  deleteSubject,
  moveSubject,
} from "../utils/storage";
import { useAlarmSound } from "../hooks/useAlarmSound";
import { useTheme } from "../theme/ThemeContext";
import { THEME_OPTIONS } from "../theme/themes";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

const SOUND_OPTIONS = [
  {
    key: "classic",
    name: "Classic Beep",
    emoji: "⏰",
    desc: "Digital 880Hz alarm tone",
  },
  {
    key: "chime",
    name: "Pleasant Chime",
    emoji: "🔔",
    desc: "Soft 3-note rising chime",
  },
  {
    key: "bell",
    name: "Resonant Bell",
    emoji: "🎐",
    desc: "Deep bell tone with long decay",
  },
  {
    key: "marimba",
    name: "Marimba Melody",
    emoji: "🎵",
    desc: "Warm acoustic wooden notes",
  },
];

const WEEKLY_TIME_GOALS = [300, 600, 900, 1200];
const WEEKLY_DAY_GOALS = [3, 4, 5, 6, 7];

function formatGoalHours(mins) {
  const hours = mins / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/**
 * Settings Screen — sound selection with live audio previews, behavior toggles,
 * and live theme switching.
 */
export default function SettingsScreen({ onGoHome }) {
  const { theme, themeName, setThemeName } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [settings, setSettingsState] = useState({
    soundPreset: "classic",
    vibrate: true,
    keepAwake: true,
    theme: "dark",
    weeklyGoalEnabled: true,
    weeklyGoalMins: 600,
    weeklyGoalDays: 5,
  });
  const [loading, setLoading] = useState(true);
  const [playingPreset, setPlayingPreset] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [editingSubject, setEditingSubject] = useState(null);
  const [subjectName, setSubjectName] = useState("");

  const { playAlarm, stopAlarm } = useAlarmSound();

  // Load saved settings on mount
  useEffect(() => {
    Promise.all([loadSettings(), loadSubjects()]).then(([s, savedSubjects]) => {
      setSettingsState(s);
      setSubjects(savedSubjects);
      setLoading(false);
    });
  }, []);

  // Update a single setting field and persist
  const updateSetting = useCallback(async (key, value) => {
    setSettingsState((prev) => {
      const updated = { ...prev, [key]: value };
      saveSettings(updated);
      return updated;
    });
  }, []);

  // Test sound preview
  const handleTestSound = useCallback(
    async (presetKey) => {
      if (playingPreset === presetKey) {
        await stopAlarm();
        setPlayingPreset(null);
      } else {
        setPlayingPreset(presetKey);
        await playAlarm(presetKey);
      }
    },
    [playingPreset, playAlarm, stopAlarm]
  );

  const handleRenameSubject = useCallback(async () => {
    const nextName = subjectName.trim();
    if (!editingSubject || !nextName) return;
    try {
      const renamed = await renameSubject(editingSubject, nextName);
      setSubjects((prev) =>
        prev.map((s) =>
          s.name === editingSubject ? { ...s, name: renamed.name } : s
        )
      );
      setEditingSubject(null);
      setSubjectName("");
    } catch (error) {
      Alert.alert("Could Not Rename", error.message || "Please try another name.");
    }
  }, [editingSubject, subjectName]);

  const handleSubjectColor = useCallback(async (name, color) => {
    await updateSubjectColor(name, color);
    setSubjects((prev) =>
      prev.map((s) => (s.name === name ? { ...s, color } : s))
    );
  }, []);

  const handleMoveSubject = useCallback(async (name, direction) => {
    const updated = await moveSubject(name, direction);
    setSubjects(updated);
  }, []);

  const handleDeleteSubject = useCallback((name) => {
    Alert.alert(
      "Delete Subject?",
      `Remove “${name}” from your subject picker? Existing session history will be kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteSubject(name);
            setSubjects((prev) => prev.filter((s) => s.name !== name));
          },
        },
      ]
    );
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>Preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <Text style={styles.loadingText}>Loading settings...</Text>
        ) : (
          <>
            {/* ── Section 1: Notification Sound ── */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>🔔 Notification Alarm Sound</Text>
              <Text style={styles.sectionSubtitle}>
                Choose the sound that plays when your study phase or break finishes.
              </Text>

              {SOUND_OPTIONS.map((opt) => {
                const isSelected = settings.soundPreset === opt.key;
                const isPlaying = playingPreset === opt.key;

                return (
                  <View
                    key={opt.key}
                    style={[
                      styles.soundOptionRow,
                      isSelected && styles.soundOptionRowSelected,
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.soundSelectArea}
                      onPress={() => updateSetting("soundPreset", opt.key)}
                      accessibilityRole="radio"
                      accessibilityLabel={`${opt.name}. ${opt.desc}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={[
                          styles.radioCircle,
                          isSelected && styles.radioCircleSelected,
                        ]}
                      >
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                      <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionName,
                            isSelected && styles.optionNameSelected,
                          ]}
                        >
                          {opt.name}
                        </Text>
                        <Text style={styles.optionDesc}>{opt.desc}</Text>
                      </View>
                    </TouchableOpacity>

                    {/* Test Sound Preview Button */}
                    <TouchableOpacity
                      style={[
                        styles.testBtn,
                        isPlaying && styles.testBtnPlaying,
                      ]}
                      onPress={() => handleTestSound(opt.key)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isPlaying ? `Stop ${opt.name} preview` : `Preview ${opt.name}`
                      }
                    >
                      <Text style={styles.testBtnText}>
                        {isPlaying ? "⏹ Stop" : "🔊 Preview"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* ── Section 2: Vibrate & Keep Awake Toggles ── */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>⚡ Behavior & Controls</Text>

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Vibration & Haptics</Text>
                  <Text style={styles.toggleDesc}>
                    Vibrate phone when alarm sounds or buttons are pressed
                  </Text>
                </View>
                <Switch
                  value={settings.vibrate}
                  onValueChange={(val) => updateSetting("vibrate", val)}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.onAccent}
                  accessibilityLabel="Vibration and haptics"
                  accessibilityState={{ checked: settings.vibrate }}
                />
              </View>

              <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Keep Screen Awake</Text>
                  <Text style={styles.toggleDesc}>
                    Prevent screen from turning off automatically while timer runs
                  </Text>
                </View>
                <Switch
                  value={settings.keepAwake}
                  onValueChange={(val) => updateSetting("keepAwake", val)}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.onAccent}
                  accessibilityLabel="Keep screen awake"
                  accessibilityState={{ checked: settings.keepAwake }}
                />
              </View>
            </View>

            {/* ── Section 3: Weekly goals ── */}
            <View style={styles.sectionCard}>
              <View style={styles.goalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Weekly Study Goal</Text>
                  <Text style={styles.sectionSubtitleCompact}>
                    Track focused time and active study days from Monday to Sunday.
                  </Text>
                </View>
                <Switch
                  value={settings.weeklyGoalEnabled}
                  onValueChange={(value) =>
                    updateSetting("weeklyGoalEnabled", value)
                  }
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.onAccent}
                  accessibilityLabel="Weekly study goal"
                  accessibilityState={{ checked: settings.weeklyGoalEnabled }}
                />
              </View>

              {settings.weeklyGoalEnabled && (
                <>
                  <Text style={styles.goalLabel}>Focused time</Text>
                  <View style={styles.goalPillRow}>
                    {WEEKLY_TIME_GOALS.map((mins) => {
                      const active = settings.weeklyGoalMins === mins;
                      return (
                        <TouchableOpacity
                          key={mins}
                          style={[styles.goalPill, active && styles.goalPillActive]}
                          onPress={() => updateSetting("weeklyGoalMins", mins)}
                          accessibilityRole="button"
                          accessibilityLabel={`Set weekly focus goal to ${formatGoalHours(mins)}`}
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.goalPillText, active && styles.goalPillTextActive]}>
                            {formatGoalHours(mins)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.goalLabel}>Active study days</Text>
                  <View style={styles.goalPillRow}>
                    {WEEKLY_DAY_GOALS.map((days) => {
                      const active = settings.weeklyGoalDays === days;
                      return (
                        <TouchableOpacity
                          key={days}
                          style={[styles.goalPill, active && styles.goalPillActive]}
                          onPress={() => updateSetting("weeklyGoalDays", days)}
                          accessibilityRole="button"
                          accessibilityLabel={`Set weekly goal to ${days} active days`}
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.goalPillText, active && styles.goalPillTextActive]}>
                            {days}d
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* ── Section 4: App Theme ── */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>🎨 App Theme</Text>
              <Text style={styles.sectionSubtitle}>
                Select your visual color palette. Changes apply instantly.
              </Text>

              <View style={styles.themeRow}>
                {THEME_OPTIONS.map((opt) => {
                  const isActive = themeName === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.themePill, isActive && styles.themePillActive]}
                      onPress={() => setThemeName(opt.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`${opt.name} theme`}
                      accessibilityState={{ selected: isActive }}
                    >
                      <Text style={styles.themePillEmoji}>{opt.emoji}</Text>
                      <Text
                        style={isActive ? styles.themePillTextActive : styles.themePillText}
                      >
                        {opt.name}
                      </Text>
                      {isActive && (
                        <Icon name="check" size={16} color={theme.accent} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* ── Section 5: Subject management ── */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Subjects</Text>
              <Text style={styles.sectionSubtitle}>
                Rename, recolor, reorder, or remove saved subjects. Renaming also
                updates history; deleting does not remove past sessions.
              </Text>

              {subjects.length === 0 ? (
                <Text style={styles.subjectEmpty}>
                  Subjects you use in a session will appear here.
                </Text>
              ) : (
                subjects.map((subject, index) => {
                  const editing = editingSubject === subject.name;
                  return (
                    <View key={subject.name} style={styles.subjectRow}>
                      <View style={styles.subjectTopRow}>
                        <View
                          style={[
                            styles.subjectColorDot,
                            { backgroundColor: subject.color },
                          ]}
                        />
                        {editing ? (
                          <TextInput
                            style={styles.subjectInput}
                            value={subjectName}
                            onChangeText={setSubjectName}
                            onSubmitEditing={handleRenameSubject}
                            autoFocus
                            returnKeyType="done"
                            accessibilityLabel="New subject name"
                          />
                        ) : (
                          <Text style={styles.subjectName}>{subject.name}</Text>
                        )}

                        {editing ? (
                          <>
                            <TouchableOpacity
                              style={styles.subjectIconBtn}
                              onPress={handleRenameSubject}
                              accessibilityRole="button"
                              accessibilityLabel={`Save ${subject.name} name`}
                            >
                              <Icon name="check" size={18} color={theme.success} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.subjectIconBtn}
                              onPress={() => {
                                setEditingSubject(null);
                                setSubjectName("");
                              }}
                              accessibilityRole="button"
                              accessibilityLabel="Cancel renaming"
                            >
                              <Icon name="close" size={18} color={theme.textMuted} />
                            </TouchableOpacity>
                          </>
                        ) : (
                          <>
                            <TouchableOpacity
                              style={styles.subjectIconBtn}
                              onPress={() => {
                                setEditingSubject(subject.name);
                                setSubjectName(subject.name);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Rename ${subject.name}`}
                            >
                              <Icon name="edit" size={17} color={theme.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.subjectIconBtn}
                              onPress={() => handleDeleteSubject(subject.name)}
                              accessibilityRole="button"
                              accessibilityLabel={`Delete ${subject.name}`}
                            >
                              <Icon name="trash" size={17} color={theme.danger} />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>

                      {!editing && (
                        <>
                          <View style={styles.subjectControls}>
                            <TouchableOpacity
                              style={styles.orderBtn}
                              disabled={index === 0}
                              onPress={() => handleMoveSubject(subject.name, -1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${subject.name} up`}
                              accessibilityState={{ disabled: index === 0 }}
                            >
                              <Text
                                style={[
                                  styles.orderBtnText,
                                  index === 0 && styles.orderBtnTextDisabled,
                                ]}
                              >
                                ↑ Up
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.orderBtn}
                              disabled={index === subjects.length - 1}
                              onPress={() => handleMoveSubject(subject.name, 1)}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${subject.name} down`}
                              accessibilityState={{
                                disabled: index === subjects.length - 1,
                              }}
                            >
                              <Text
                                style={[
                                  styles.orderBtnText,
                                  index === subjects.length - 1 &&
                                    styles.orderBtnTextDisabled,
                                ]}
                              >
                                ↓ Down
                              </Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.colorRow}>
                            {SUBJECT_COLORS.map((color) => (
                              <TouchableOpacity
                                key={color}
                                style={[
                                  styles.colorChoice,
                                  { backgroundColor: color },
                                  subject.color === color && styles.colorChoiceActive,
                                ]}
                                onPress={() =>
                                  handleSubjectColor(subject.name, color)
                                }
                                accessibilityRole="radio"
                                accessibilityLabel={`Set ${subject.name} color to ${color}`}
                                accessibilityState={{
                                  selected: subject.color === color,
                                }}
                              />
                            ))}
                          </View>
                        </>
                      )}
                    </View>
                  );
                })
              )}
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
    spacer: { width: 40 },
    scroll: { padding: 20, paddingTop: 12 },
    loadingText: { color: t.textMuted, fontSize: 14, textAlign: "center", marginTop: 40, fontFamily: FONTS.body },
    sectionCard: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
    },
    sectionTitle: { color: t.textPrimary, fontSize: 15, fontFamily: FONTS.displayMedium },
    sectionSubtitle: { color: t.textMuted, fontSize: 12, marginTop: 4, marginBottom: 14, fontFamily: FONTS.body },
    sectionSubtitleCompact: {
      color: t.textMuted,
      fontSize: 12,
      marginTop: 4,
      paddingRight: 12,
      fontFamily: FONTS.body,
    },
    goalHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 16,
    },
    goalLabel: {
      color: t.textSecondary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 12,
      marginBottom: 8,
    },
    goalPillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16,
    },
    goalPill: {
      minWidth: 48,
      alignItems: "center",
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    goalPillActive: {
      backgroundColor: t.surfaceActive,
      borderColor: t.accent,
    },
    goalPillText: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 12,
    },
    goalPillTextActive: { color: t.accent },
    soundOptionRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    soundOptionRowSelected: {
      borderColor: t.accent,
      backgroundColor: t.surfaceActive,
    },
    soundSelectArea: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    radioCircle: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: t.textMuted,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    radioCircleSelected: { borderColor: t.accent },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent },
    optionEmoji: { fontSize: 18, marginRight: 10 },
    optionName: { color: t.textTertiary, fontSize: 14, fontFamily: FONTS.bodySemibold },
    optionNameSelected: { color: t.textPrimary },
    optionDesc: { color: t.textMuted, fontSize: 11, marginTop: 2, fontFamily: FONTS.body },
    testBtn: {
      backgroundColor: t.border,
      borderRadius: 10,
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginLeft: 8,
    },
    testBtnPlaying: {
      backgroundColor: t.danger,
    },
    testBtnText: { color: t.textPrimary, fontSize: 12, fontFamily: FONTS.bodySemibold },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    toggleTitle: { color: t.textPrimary, fontSize: 14, fontFamily: FONTS.bodySemibold },
    toggleDesc: { color: t.textMuted, fontSize: 11, marginTop: 2, paddingRight: 12, fontFamily: FONTS.body },
    themeRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    themePill: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.surfaceAlt,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
    },
    themePillActive: {
      backgroundColor: t.surfaceActive,
      borderColor: t.accent,
    },
    themePillEmoji: { fontSize: 14, marginRight: 6 },
    themePillText: { color: t.textMuted, fontSize: 12, fontFamily: FONTS.bodySemibold },
    themePillTextActive: { color: t.textPrimary, fontSize: 12, fontFamily: FONTS.bodyBold },
    subjectEmpty: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 12,
      paddingVertical: 8,
    },
    subjectRow: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    subjectTopRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    subjectColorDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 10,
    },
    subjectName: {
      color: t.textPrimary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 14,
      flex: 1,
    },
    subjectInput: {
      flex: 1,
      color: t.textPrimary,
      fontFamily: FONTS.body,
      fontSize: 14,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.accent,
      borderRadius: 8,
      paddingVertical: 7,
      paddingHorizontal: 10,
    },
    subjectIconBtn: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 4,
    },
    subjectControls: {
      flexDirection: "row",
      gap: 8,
      marginTop: 10,
    },
    orderBtn: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    orderBtnText: {
      color: t.textSecondary,
      fontFamily: FONTS.bodyMedium,
      fontSize: 11,
    },
    orderBtnTextDisabled: { color: t.textDisabled },
    colorRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 9,
      marginTop: 12,
    },
    colorChoice: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: "transparent",
    },
    colorChoiceActive: {
      borderColor: t.textPrimary,
      transform: [{ scale: 1.12 }],
    },
  });
