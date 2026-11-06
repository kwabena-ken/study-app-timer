import fs from "fs";
import path from "path";

describe("SafeAreaView migration across screens", () => {
  const screens = [
    "SubjectPickerScreen.js",
    "SessionPickerScreen.js",
    "CustomSessionScreen.js",
    "DoneScreen.js",
    "SessionScreen.js",
    "HomeScreen.js",
    "HistoryScreen.js",
    "StatsScreen.js",
    "SettingsScreen.js",
  ];

  it.each(screens)(
    "%s imports SafeAreaView from react-native-safe-area-context and not react-native",
    (screenFileName) => {
      const filePath = path.join(__dirname, "..", screenFileName);
      const content = fs.readFileSync(filePath, "utf8");

      // Verify react-native import does not include SafeAreaView
      const rnImportRegex = /import\s*\{[^}]*\}\s*from\s*["']react-native["'];/s;
      const rnMatch = content.match(rnImportRegex);
      if (rnMatch) {
        expect(rnMatch[0]).not.toMatch(/\bSafeAreaView\b/);
      }

      // Verify react-native-safe-area-context provides SafeAreaView
      const safeAreaImportRegex =
        /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*["']react-native-safe-area-context["'];/;
      expect(safeAreaImportRegex.test(content)).toBe(true);
    }
  );

  const fourEdgeScreens = [
    "SubjectPickerScreen.js",
    "SessionPickerScreen.js",
    "CustomSessionScreen.js",
    "DoneScreen.js",
    "SessionScreen.js",
  ];

  it.each(fourEdgeScreens)(
    "%s configures 4-edge safe area insets",
    (screenFileName) => {
      const filePath = path.join(__dirname, "..", screenFileName);
      const content = fs.readFileSync(filePath, "utf8");

      expect(content).toMatch(
        /<SafeAreaView[^>]*edges=\{\["top",\s*"bottom",\s*"left",\s*"right"\]\}/
      );
    }
  );
});
