import React from "react";
import { SafeAreaView, Platform, StatusBar, StyleSheet } from "react-native";

// React Native's built-in SafeAreaView only applies top insets on iOS.
// On Android (especially edge-to-edge on Android 14–15+), add StatusBar height
// so screen headers never collide with the system status bar.
const ANDROID_TOP_INSET =
  Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0;

export default function ScreenContainer({ style, children, ...props }) {
  return (
    <SafeAreaView style={[styles.base, style]} {...props}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    paddingTop: ANDROID_TOP_INSET,
  },
});
