import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { FONTS } from "../theme/typography";
import Icon from "./Icon";

const TABS = [
  { key: "home", label: "Home", icon: "home" },
  { key: "stats", label: "Stats", icon: "chart" },
  { key: "history", label: "History", icon: "clock" },
  { key: "settings", label: "Settings", icon: "gear" },
];

/**
 * Bottom tab bar for the app's top-level destinations. Rendered only on the
 * main tabs (not during the session flow).
 *
 * @param {{ active: string, onChange: (key: string) => void }} props
 */
export default function TabBar({ active, onChange }) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const on = active === t.key;
        const color = on ? theme.accent : theme.textMuted;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => onChange(t.key)}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
          >
            <Icon name={t.icon} size={22} color={color} strokeWidth={2} />
            <Text style={[styles.label, { color }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (t) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: t.surface,
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 8,
      paddingBottom: 22,
      paddingHorizontal: 8,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    label: {
      fontFamily: FONTS.bodyMedium,
      fontSize: 10.5,
    },
  });
