import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
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
      {/* Translucent blur underlay; tabs render above it */}
      <BlurView
        intensity={theme.isDark ? 45 : 60}
        tint={theme.isDark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {TABS.map((tab) => {
        const on = active === tab.key;
        const color = on ? theme.accent : theme.textMuted;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onChange(tab.key)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: on }}
          >
            <Icon name={tab.icon} size={22} color={color} strokeWidth={2} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
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
      backgroundColor: t.isDark
        ? "rgba(10,14,20,0.82)"
        : "rgba(244,246,251,0.85)",
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 8,
      paddingBottom: 22,
      paddingHorizontal: 8,
      overflow: "hidden",
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
