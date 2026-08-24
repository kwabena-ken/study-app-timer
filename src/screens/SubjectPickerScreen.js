import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { loadSubjects } from "../utils/storage";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "../components/Icon";

/**
 * Subject picker screen — type a new subject or tap a recent one.
 *
 * @param {{ onSelectSubject: (name: string) => void, onGoHome: () => void }} props
 */
export default function SubjectPickerScreen({ onSelectSubject, onGoHome }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [text, setText] = useState("");
  const [subjects, setSubjects] = useState([]);

  useEffect(() => {
    loadSubjects().then(setSubjects);
  }, []);

  const trimmed = text.trim();

  const filteredSubjects = trimmed
    ? subjects.filter((s) =>
        s.name.toLowerCase().includes(trimmed.toLowerCase())
      )
    : subjects;

  const handleSubmit = () => {
    if (!trimmed) return;
    onSelectSubject(trimmed);
  };

  const handlePickExisting = (subject) => {
    onSelectSubject(subject.name);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onGoHome}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go home"
          >
            <Icon name="chevron-left" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>What are you studying?</Text>
          <View style={styles.spacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Text input ── */}
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="e.g. Biology, Mathematics..."
              placeholderTextColor={theme.textDisabled}
              value={text}
              onChangeText={setText}
              onSubmitEditing={handleSubmit}
              returnKeyType="next"
              autoFocus
            />
          </View>

          {/* ── Next button ── */}
          <TouchableOpacity
            style={[styles.nextBtn, !trimmed && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={!trimmed}
          >
            <Text
              style={[
                styles.nextBtnText,
                !trimmed && styles.nextBtnTextDisabled,
              ]}
            >
              Next →
            </Text>
          </TouchableOpacity>

          {/* ── Previously used subjects ── */}
          {subjects.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>
                {trimmed ? "Matching subjects" : "Recent subjects"}
              </Text>

              {filteredSubjects.map((s) => (
                <TouchableOpacity
                  key={s.name}
                  style={styles.subjectCard}
                  onPress={() => handlePickExisting(s)}
                >
                  <View
                    style={[styles.colorDot, { backgroundColor: s.color }]}
                  />
                  <Text style={styles.subjectName}>{s.name}</Text>
                  <Text style={styles.arrowText}>→</Text>
                </TouchableOpacity>
              ))}

              {filteredSubjects.length === 0 && trimmed !== "" && (
                <Text style={styles.noMatch}>
                  No matching subjects — press Next to create &quot;{trimmed}
                  &quot;
                </Text>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
    headerTitle: {
      color: t.textPrimary,
      fontFamily: FONTS.displayMedium,
      fontSize: 16,
    },
    spacer: { width: 40 },
    scroll: { padding: 20, paddingTop: 20 },
    inputWrap: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 4,
      marginBottom: 16,
    },
    input: {
      color: t.textPrimary,
      fontFamily: FONTS.body,
      fontSize: 16,
      paddingVertical: 14,
    },
    nextBtn: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      marginBottom: 28,
    },
    nextBtnDisabled: {
      backgroundColor: t.border,
    },
    nextBtnText: {
      color: t.onAccent,
      fontFamily: FONTS.bodyBold,
      fontSize: 15,
    },
    nextBtnTextDisabled: {
      color: t.textDisabled,
    },
    sectionLabel: {
      color: t.textMuted,
      fontFamily: FONTS.bodySemibold,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 10,
    },
    subjectCard: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.border,
      borderRadius: 14,
      padding: 16,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
    },
    colorDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 12,
    },
    subjectName: {
      color: t.textPrimary,
      fontFamily: FONTS.bodySemibold,
      fontSize: 15,
      flex: 1,
    },
    arrowText: {
      color: t.textMuted,
      fontSize: 16,
    },
    noMatch: {
      color: t.textMuted,
      fontFamily: FONTS.body,
      fontSize: 13,
      textAlign: "center",
      marginTop: 12,
    },
  });
