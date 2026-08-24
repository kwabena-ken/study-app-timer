import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
} from "react-native";
import { SESSIONS } from "../constants/sessions";
import { loadTemplates, deleteTemplate } from "../utils/storage";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

/**
 * Runs a callback once, when the component mounts. Screens remount on each
 * visit (the App-level `useState` screen switch unmounts the previous screen),
 * so this refreshes the template list every time the picker is shown — no
 * navigation-focus event needed.
 */
function useOnMount(callback) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(callback, []);
}

/**
 * Sum the study (or break) minutes of a phase list.
 */
function sumMins(phases, isBreak) {
  return phases
    .filter((p) => (isBreak ? p.isBreak : !p.isBreak))
    .reduce((a, p) => a + (p.duration || 0), 0);
}

/**
 * Session picker screen — shows subject badge, saved templates, and session
 * type cards.
 *
 * @param {{ subject: string, subjectColor: string, onStartSession: (key: string) => void, onOpenCustomSession: () => void, onStartTemplate: (template: Object) => void, onGoBack: () => void }} props
 */
export default function SessionPickerScreen({
  subject,
  subjectColor,
  onStartSession,
  onOpenCustomSession,
  onStartTemplate,
  onGoBack,
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [templates, setTemplates] = useState([]);

  // Refresh saved templates each time the picker is shown.
  useOnMount(() => {
    loadTemplates().then(setTemplates);
  });

  // ── Delete a saved template (with confirmation) ──
  const handleDeleteTemplate = useCallback((tpl) => {
    Alert.alert(
      "Delete Template?",
      `Remove "${tpl.label}" from your saved templates?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteTemplate(tpl.id);
            setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
          },
        },
      ]
    );
  }, []);

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
        <Text style={styles.headerTitle}>Pick a session</Text>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Subject indicator ── */}
        <View style={styles.subjectBadge}>
          <View
            style={[
              styles.colorDot,
              { backgroundColor: subjectColor || theme.accent },
            ]}
          />
          <Text style={styles.subjectText}>{subject}</Text>
        </View>

        {/* ── Saved templates ── */}
        {templates.length > 0 && (
          <View style={styles.templatesSection}>
            <Text style={styles.sectionLabel}>Your Templates</Text>
            {templates.map((tpl) => {
              const studyMins = sumMins(tpl.phases, false);
              const breakMins = sumMins(tpl.phases, true);
              return (
                <View key={tpl.id} style={styles.templateCard}>
                  <TouchableOpacity
                    style={styles.templateLaunch}
                    onPress={() => onStartTemplate(tpl)}
                    accessibilityRole="button"
                    accessibilityLabel={`Start template ${tpl.label}`}
                  >
                    <View style={styles.templateEmoji}>
                      <Icon name="edit" size={20} color={theme.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {tpl.label}
                      </Text>
                      <Text style={styles.cardMetaTight}>
                        {tpl.phases.length} phase
                        {tpl.phases.length !== 1 ? "s" : ""} · {studyMins}m study
                        {breakMins > 0 ? ` · ${breakMins}m breaks` : ""}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.templateDelete}
                    onPress={() => handleDeleteTemplate(tpl)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete template ${tpl.label}`}
                  >
                    <Icon name="trash" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Session cards ── */}
        {Object.entries(SESSIONS).map(([key, s]) => {
          const studyMins = sumMins(s.phases, false);
          const breakMins = sumMins(s.phases, true);

          return (
            <TouchableOpacity
              key={key}
              style={styles.card}
              onPress={() => onStartSession(key)}
            >
              <Text style={styles.cardTitle}>{s.label}</Text>
              <Text style={styles.cardMeta}>
                {studyMins}m study · {breakMins}m breaks
              </Text>
              {s.phases.map((p, i) => (
                <View key={i} style={styles.phaseRow}>
                  <Text style={styles.phaseEmoji}>{p.emoji}</Text>
                  <Text
                    style={[
                      styles.phaseRowName,
                      p.isBreak && styles.phaseRowNameBreak,
                    ]}
                  >
                    {p.name}
                  </Text>
                  <Text
                    style={[
                      styles.phaseRowDuration,
                      p.isBreak && styles.phaseRowDurationBreak,
                    ]}
                  >
                    {p.duration}m
                  </Text>
                </View>
              ))}
            </TouchableOpacity>
          );
        })}

        {/* ── Custom Session Card ── */}
        <TouchableOpacity
          style={[styles.card, styles.customCard]}
          onPress={onOpenCustomSession}
        >
          <View style={styles.customCardHeader}>
            <View style={styles.customCardEmoji}><Icon name="plus" size={22} color={theme.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Custom Session</Text>
              <Text style={styles.cardMeta}>
                Choose your own time, tasks & breaks
              </Text>
            </View>
            <Text style={styles.customArrow}>→</Text>
          </View>
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
    headerTitle: { color: t.textPrimary, fontSize: 16, fontFamily: FONTS.displayMedium },
    spacer: { width: 40 },
    scroll: { alignItems: "center", padding: 24, paddingTop: 12 },
    subjectBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 20,
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginBottom: 20,
    },
    colorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: 8,
    },
    subjectText: {
      color: t.textPrimary,
      fontSize: 13,
      fontFamily: FONTS.bodySemibold,
    },
    templatesSection: { width: "100%", marginBottom: 6 },
    sectionLabel: {
      color: t.textMuted,
      fontSize: 11,
      fontFamily: FONTS.bodySemibold,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 10,
    },
    templateCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 16,
      marginBottom: 10,
    },
    templateLaunch: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 16,
      paddingLeft: 16,
      paddingRight: 8,
    },
    templateEmoji: { marginRight: 12 },
    templateDelete: {
      paddingHorizontal: 16,
      paddingVertical: 18,
    },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 18,
      padding: 20,
      width: "100%",
      marginBottom: 14,
    },
    cardTitle: {
      color: t.textPrimary,
      fontSize: 17,
      fontFamily: FONTS.displayMedium,
      marginBottom: 4,
    },
    cardMeta: { color: t.textMuted, fontSize: 12, marginBottom: 12, fontFamily: FONTS.body },
    cardMetaTight: { color: t.textMuted, fontSize: 12, fontFamily: FONTS.body },
    phaseRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
    phaseEmoji: { fontSize: 13, marginRight: 8 },
    phaseRowName: { color: t.textTertiary, fontSize: 12, flex: 1, fontFamily: FONTS.body },
    phaseRowNameBreak: { color: t.textDisabled, fontStyle: "italic" },
    phaseRowDuration: { color: t.accent, fontSize: 12, fontFamily: FONTS.bodySemibold },
    phaseRowDurationBreak: { color: t.textDisabled },
    customCard: {
      borderColor: t.accent,
      backgroundColor: t.surfaceActive,
    },
    customCardHeader: {
      flexDirection: "row",
      alignItems: "center",
    },
    customCardEmoji: {
      marginRight: 12,
    },
    customArrow: {
      color: t.accent,
      fontSize: 20,
      fontFamily: FONTS.displayMedium,
      marginLeft: 8,
    },
  });
