import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
} from "react-native";
import Slider from "@react-native-community/slider";
import { saveTemplate } from "../utils/storage";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

const PRESET_TAGS = [
  { name: "Deep Study", emoji: "📖", isBreak: false, tip: "Focused, deep work session." },
  { name: "Past Questions", emoji: "✏️", isBreak: false, tip: "Attempt practice questions." },
  { name: "Flashcards", emoji: "🃏", isBreak: false, tip: "Active recall review." },
  { name: "Card Making", emoji: "✍️", isBreak: false, tip: "Create new review cards." },
  { name: "Short Break", emoji: "☕", isBreak: true, tip: "Rest, stretch, grab water." },
  { name: "Long Break", emoji: "🛌", isBreak: true, tip: "Extended rest period." },
];

const TIME_PILLS = [15, 30, 45, 60, 90, 120];

/**
 * Custom Session Configurator Screen
 *
 * Allows user to:
 * 1. Choose overall session duration (in minutes).
 * 2. Add preset or custom tags (study tasks or breaks).
 * 3. Use sliders/+/- buttons to assign time per tag without exceeding total session duration.
 * 4. Save the built session as a reusable template.
 */
export default function CustomSessionScreen({
  subject,
  subjectColor,
  onStartCustomSession,
  onGoBack,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [totalMins, setTotalMins] = useState(30);
  const [customTotalInput, setCustomTotalInput] = useState("30");
  const [templateName, setTemplateName] = useState("");
  const [tasks, setTasks] = useState([
    {
      id: "1",
      name: "Deep Study",
      emoji: "📖",
      isBreak: false,
      duration: 30,
      tip: "Focused, deep work session.",
    },
  ]);

  const [customTagName, setCustomTagName] = useState("");
  const [isCustomBreak, setIsCustomBreak] = useState(false);

  // Total allocated duration across all tasks
  const allocatedMins = useMemo(() => {
    return tasks.reduce((sum, t) => sum + (t.duration || 0), 0);
  }, [tasks]);

  const remainingMins = useMemo(() => {
    return Math.max(0, totalMins - allocatedMins);
  }, [totalMins, allocatedMins]);

  // Handle changing total session duration
  const handleSetTotalMins = useCallback(
    (mins) => {
      const validMins = Math.max(1, Math.min(480, mins || 1));
      setTotalMins(validMins);
      setCustomTotalInput(String(validMins));

      // Scale or cap task durations if new total is smaller than current allocated
      setTasks((prevTasks) => {
        if (prevTasks.length === 0) return prevTasks;
        const currentTotal = prevTasks.reduce((s, t) => s + t.duration, 0);
        if (currentTotal <= validMins) return prevTasks;

        // Proportional scale down
        let leftover = validMins;
        return prevTasks.map((t, idx) => {
          if (idx === prevTasks.length - 1) {
            return { ...t, duration: Math.max(1, leftover) };
          }
          const scaled = Math.max(1, Math.floor((t.duration / currentTotal) * validMins));
          leftover -= scaled;
          return { ...t, duration: scaled };
        });
      });
    },
    []
  );

  // Add a task (preset or custom)
  const handleAddTask = useCallback(
    (preset) => {
      const taskName = preset ? preset.name : customTagName.trim();
      if (!taskName) return;

      const isBreak = preset ? preset.isBreak : isCustomBreak;
      const emoji = preset ? preset.emoji : isBreak ? "☕" : "🎯";
      const tip = preset ? preset.tip : isBreak ? "Take a rest." : "Focused work.";

      setTasks((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: String(Date.now()),
              name: taskName,
              emoji,
              isBreak,
              duration: totalMins,
              tip,
            },
          ];
        }

        // Available space or default 5 mins
        const available = Math.max(0, totalMins - prev.reduce((s, t) => s + t.duration, 0));
        const newDuration = available > 0 ? available : 5;

        // If no available space, reduce the last task's time to make room for new task
        let updatedPrev = [...prev];
        if (available <= 0 && updatedPrev.length > 0) {
          const lastIndex = updatedPrev.length - 1;
          const lastTask = updatedPrev[lastIndex];
          if (lastTask.duration > newDuration) {
            updatedPrev[lastIndex] = {
              ...lastTask,
              duration: lastTask.duration - newDuration,
            };
          }
        }

        return [
          ...updatedPrev,
          {
            id: String(Date.now()),
            name: taskName,
            emoji,
            isBreak,
            duration: newDuration,
            tip,
          },
        ];
      });

      if (!preset) {
        setCustomTagName("");
      }
    },
    [customTagName, isCustomBreak, totalMins]
  );

  // Remove a task
  const handleRemoveTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Update a single task's duration from slider or button
  const handleTaskDurationChange = useCallback(
    (id, newDuration) => {
      setTasks((prev) => {
        const target = prev.find((t) => t.id === id);
        if (!target) return prev;

        const otherTotal = prev
          .filter((t) => t.id !== id)
          .reduce((sum, t) => sum + t.duration, 0);

        // Cap at totalMins - otherTotal
        const maxAllowed = Math.max(1, totalMins - otherTotal);
        const clamped = Math.max(1, Math.min(maxAllowed, Math.round(newDuration)));

        return prev.map((t) => (t.id === id ? { ...t, duration: clamped } : t));
      });
    },
    [totalMins]
  );

  // Build the phase list from the current tasks (shared by Start and Save).
  const buildPhases = useCallback(
    () =>
      tasks.map((t) => ({
        name: t.name,
        duration: t.duration,
        emoji: t.emoji,
        isBreak: t.isBreak,
        tip: t.tip,
      })),
    [tasks]
  );

  // Start the custom session
  const handleStart = useCallback(() => {
    if (tasks.length === 0) {
      Alert.alert("No Tasks", "Please add at least one study task or break to your session.");
      return;
    }

    onStartCustomSession({
      label: `Custom Session (${totalMins}m)`,
      phases: buildPhases(),
    });
  }, [tasks, totalMins, buildPhases, onStartCustomSession]);

  // Save the built session as a reusable template
  const handleSaveTemplate = useCallback(async () => {
    if (tasks.length === 0) {
      Alert.alert("Nothing to Save", "Add at least one study task or break before saving a template.");
      return;
    }

    const label = templateName.trim() || `Custom Session (${totalMins}m)`;
    try {
      await saveTemplate({ label, phases: buildPhases() });
      Alert.alert(
        "Template Saved",
        `"${label}" is now under Your Templates on the session picker.`
      );
    } catch (e) {
      Alert.alert("Save Failed", "Could not save the template. Please try again.");
    }
  }, [tasks, templateName, totalMins, buildPhases]);

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onGoBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="chevron-left" size={22} color={theme.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build Custom Session</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Subject Indicator ── */}
        <View style={styles.subjectBadge}>
          <View
            style={[
              styles.colorDot,
              { backgroundColor: subjectColor || theme.accent },
            ]}
          />
          <Text style={styles.subjectText}>{subject}</Text>
        </View>

        {/* ── Section 1: Total Duration ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>1. Set Total Time</Text>
          <View style={styles.pillRow}>
            {TIME_PILLS.map((mins) => (
              <TouchableOpacity
                key={mins}
                style={[
                  styles.timePill,
                  totalMins === mins && styles.timePillActive,
                ]}
                onPress={() => handleSetTotalMins(mins)}
                accessibilityRole="button"
                accessibilityLabel={`Set total time to ${mins} minutes`}
                accessibilityState={{ selected: totalMins === mins }}
              >
                <Text
                  style={[
                    styles.timePillText,
                    totalMins === mins && styles.timePillTextActive,
                  ]}
                >
                  {mins}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.customInputRow}>
            <Text style={styles.inputLabel}>Or type minutes:</Text>
            <TextInput
              style={styles.textInput}
              keyboardType="number-pad"
              value={customTotalInput}
              onChangeText={(val) => {
                setCustomTotalInput(val);
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed) && parsed > 0) {
                  handleSetTotalMins(parsed);
                }
              }}
            />
            <Text style={styles.unitText}>mins</Text>
          </View>
        </View>

        {/* ── Section 2: Add Tasks / Tags ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>2. Add Tasks & Breaks</Text>

          <Text style={styles.subLabel}>Quick Presets:</Text>
          <View style={styles.tagGrid}>
            {PRESET_TAGS.map((tag) => (
              <TouchableOpacity
                key={tag.name}
                style={[
                  styles.presetTag,
                  tag.isBreak && styles.presetTagBreak,
                ]}
                onPress={() => handleAddTask(tag)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${tag.name}`}
              >
                <Text style={styles.presetTagEmoji}>{tag.emoji}</Text>
                <Text style={styles.presetTagText}>{tag.name}</Text>
                <Icon name="plus" size={14} color={theme.accent} />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.subLabel, { marginTop: 14 }]}>Or Create Custom Tag:</Text>
          <View style={styles.customTagRow}>
            <TextInput
              style={[styles.textInput, { flex: 1, marginRight: 8 }]}
              placeholder="e.g. Solve 5 problems"
              placeholderTextColor={theme.textMuted}
              value={customTagName}
              onChangeText={setCustomTagName}
            />
            <TouchableOpacity
              style={[
                styles.typeToggle,
                isCustomBreak && styles.typeToggleBreak,
              ]}
              onPress={() => setIsCustomBreak((b) => !b)}
              accessibilityRole="button"
              accessibilityLabel={
                isCustomBreak ? "Tag type: break, tap for study" : "Tag type: study, tap for break"
              }
            >
              <Text style={styles.typeToggleText}>
                {isCustomBreak ? "☕ Break" : "📖 Study"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addCustomBtn}
              onPress={() => handleAddTask(null)}
              accessibilityRole="button"
              accessibilityLabel="Add custom tag"
            >
              <Text style={styles.addCustomBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Section 3: Time Allocation (Sliders) ── */}
        <View style={styles.card}>
          <View style={styles.allocationHeader}>
            <Text style={styles.cardHeader}>3. Adjust Task Durations</Text>
            <Text
              style={[
                styles.allocationSummary,
                allocatedMins === totalMins ? styles.allocPerfect : styles.allocWarn,
              ]}
            >
              {allocatedMins}m / {totalMins}m
            </Text>
          </View>

          {remainingMins > 0 && (
            <Text style={styles.remainingHint}>
              💡 You have {remainingMins}m remaining to assign.
            </Text>
          )}

          {tasks.length === 0 ? (
            <Text style={styles.emptyTasksText}>No tasks added yet. Tap a tag above to add one!</Text>
          ) : (
            tasks.map((t) => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskTopRow}>
                  <Text style={styles.taskEmoji}>{t.emoji}</Text>
                  <Text style={styles.taskName}>{t.name}</Text>
                  <Text style={[styles.taskDurationText, t.isBreak && styles.breakText]}>
                    {t.duration}m
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveTask(t.id)}
                    style={styles.deleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${t.name}`}
                  >
                    <Icon name="trash" size={18} color={theme.danger} />
                  </TouchableOpacity>
                </View>

                {/* Slider + Stepper Controls */}
                <View style={styles.sliderRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleTaskDurationChange(t.id, t.duration - 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${t.name} minutes`}
                  >
                    <Icon name="minus" size={18} color={theme.textPrimary} />
                  </TouchableOpacity>

                  <Slider
                    style={styles.slider}
                    minimumValue={1}
                    maximumValue={totalMins}
                    step={1}
                    value={t.duration}
                    minimumTrackTintColor={t.isBreak ? theme.neutral : theme.accent}
                    maximumTrackTintColor={theme.border}
                    thumbTintColor={t.isBreak ? theme.textSecondary : theme.accent}
                    onValueChange={(val) => handleTaskDurationChange(t.id, val)}
                  />

                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleTaskDurationChange(t.id, t.duration + 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${t.name} minutes`}
                  >
                    <Icon name="plus" size={18} color={theme.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        {/* ── Save as Template ── */}
        <View style={styles.saveTemplateRow}>
          <TextInput
            style={styles.templateNameInput}
            placeholder={`Custom Session (${totalMins}m)`}
            placeholderTextColor={theme.textMuted}
            value={templateName}
            onChangeText={setTemplateName}
          />
          <TouchableOpacity
            style={[styles.saveTemplateBtn, tasks.length === 0 && styles.saveTemplateBtnDisabled]}
            onPress={handleSaveTemplate}
            disabled={tasks.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Save as template"
          >
            <Icon name="check" size={18} color={theme.accent} />
            <Text style={styles.saveTemplateBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* ── Start Button ── */}
        <TouchableOpacity
          style={[styles.startBtn, tasks.length === 0 && styles.startBtnDisabled]}
          onPress={handleStart}
          disabled={tasks.length === 0}
        >
          <Icon name="play" size={20} color={theme.onAccent} />
          <Text style={styles.startBtnText}>Start Custom Session ({totalMins}m)</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 8,
    },
    backBtn: {
      backgroundColor: t.hairline,
      borderRadius: 10,
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { color: t.textPrimary, fontSize: 16, fontFamily: FONTS.displayBold },
    spacer: { width: 40 },
    scroll: { padding: 20, paddingTop: 10 },
    subjectBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 16,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginBottom: 16,
    },
    colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    subjectText: { color: t.textPrimary, fontSize: 12, fontFamily: FONTS.bodySemibold },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    cardHeader: {
      color: t.textPrimary,
      fontSize: 15,
      fontFamily: FONTS.displayBold,
      marginBottom: 12,
    },
    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    timePill: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    timePillActive: {
      backgroundColor: t.accent,
      borderColor: t.accent,
    },
    timePillText: { color: t.textTertiary, fontSize: 13, fontFamily: FONTS.bodySemibold },
    timePillTextActive: { color: t.onAccent },
    customInputRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 4,
    },
    inputLabel: { color: t.textMuted, fontSize: 13, marginRight: 10 },
    textInput: {
      color: t.textPrimary,
      fontSize: 14,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    unitText: { color: t.textMuted, fontSize: 13, marginLeft: 8 },
    subLabel: { color: t.textTertiary, fontSize: 12, fontFamily: FONTS.bodySemibold, marginBottom: 8 },
    tagGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    presetTag: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    presetTagBreak: {
      borderColor: t.neutral,
    },
    presetTagEmoji: { fontSize: 13, marginRight: 6 },
    presetTagText: { color: t.textPrimary, fontSize: 12, fontFamily: FONTS.bodyMedium, marginRight: 6 },
    customTagRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    typeToggle: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      marginRight: 8,
    },
    typeToggleBreak: {
      borderColor: t.neutral,
    },
    typeToggleText: { color: t.textTertiary, fontSize: 12 },
    addCustomBtn: {
      backgroundColor: t.accent,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    addCustomBtnText: { color: t.onAccent, fontSize: 13, fontFamily: FONTS.bodyBold },
    allocationHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    allocationSummary: { fontSize: 13, fontFamily: FONTS.displayBold },
    allocPerfect: { color: t.success },
    allocWarn: { color: t.warning },
    remainingHint: { color: t.accent, fontSize: 12, marginBottom: 10 },
    emptyTasksText: { color: t.textMuted, fontSize: 13, fontStyle: "italic", textAlign: "center", marginVertical: 12 },
    taskItem: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    taskTopRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    taskEmoji: { fontSize: 15, marginRight: 8 },
    taskName: { color: t.textPrimary, fontSize: 14, fontFamily: FONTS.bodySemibold, flex: 1 },
    taskDurationText: { color: t.accent, fontSize: 14, fontFamily: FONTS.displayBold, marginRight: 10 },
    breakText: { color: t.neutral },
    deleteBtn: { padding: 4 },
    sliderRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    stepBtn: {
      backgroundColor: t.border,
      borderRadius: 8,
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    slider: {
      flex: 1,
      height: 40,
      marginHorizontal: 8,
    },
    saveTemplateRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    templateNameInput: {
      flex: 1,
      color: t.textPrimary,
      fontSize: 14,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginRight: 8,
    },
    saveTemplateBtn: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.accent,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    saveTemplateBtnDisabled: {
      opacity: 0.4,
    },
    saveTemplateBtnText: { color: t.accent, fontSize: 14, fontFamily: FONTS.bodyBold },
    startBtn: {
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginBottom: 40,
    },
    startBtnDisabled: {
      backgroundColor: t.border,
      opacity: 0.5,
    },
    startBtnText: {
      color: t.onAccent,
      fontSize: 16,
      fontFamily: FONTS.bodyBold,
    },
  });
