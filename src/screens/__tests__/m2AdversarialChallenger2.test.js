import fs from "fs";
import path from "path";
import React from "react";
import { act, create } from "react-test-renderer";
import { TouchableOpacity, TextInput, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import HistoryScreen from "../HistoryScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as storage from "../../utils/storage";

// Lightweight stub for Svg Icon component to avoid native SVG dependencies in test runner
jest.mock("../../components/Icon", () => () => null);

describe("Milestone 2 Challenger 2 Empirical Adversarial Suite", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. SafeAreaView Exhaustive Audit
  // =========================================================================
  describe("SafeAreaView Migration Verification", () => {
    const screensDir = path.resolve(__dirname, "..");
    const screenFiles = fs
      .readdirSync(screensDir)
      .filter((file) => file.endsWith(".js") && !file.includes(".test."));

    it("confirms all 9 screen files exist", () => {
      expect(screenFiles.sort()).toEqual([
        "CustomSessionScreen.js",
        "DoneScreen.js",
        "HistoryScreen.js",
        "HomeScreen.js",
        "SessionPickerScreen.js",
        "SessionScreen.js",
        "SettingsScreen.js",
        "StatsScreen.js",
        "SubjectPickerScreen.js",
      ]);
    });

    it.each(screenFiles)(
      "%s: guarantees 0 imports of SafeAreaView from 'react-native' and valid import from 'react-native-safe-area-context'",
      (screenName) => {
        const filePath = path.join(screensDir, screenName);
        const code = fs.readFileSync(filePath, "utf8");

        // Verify react-native import clause does not contain SafeAreaView
        const rnImportMatch = code.match(
          /import\s*\{([^}]*)\}\s*from\s*["']react-native["'];/s
        );
        if (rnImportMatch) {
          const rnImports = rnImportMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          expect(rnImports).not.toContain("SafeAreaView");
        }

        // Verify react-native-safe-area-context imports SafeAreaView
        const safeAreaImportMatch = code.match(
          /import\s*\{([^}]*)\}\s*from\s*["']react-native-safe-area-context["'];/s
        );
        expect(safeAreaImportMatch).not.toBeNull();
        const safeAreaImports = safeAreaImportMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        expect(safeAreaImports).toContain("SafeAreaView");

        // Verify SafeAreaView component is used in JSX
        expect(code).toMatch(/<SafeAreaView\b/);
      }
    );

    it("verifies 5 target full-bleed screens configure 4-edge insets", () => {
      const fullBleedScreens = [
        "SubjectPickerScreen.js",
        "SessionPickerScreen.js",
        "CustomSessionScreen.js",
        "DoneScreen.js",
        "SessionScreen.js",
      ];
      fullBleedScreens.forEach((screenName) => {
        const code = fs.readFileSync(path.join(screensDir, screenName), "utf8");
        expect(code).toMatch(
          /<SafeAreaView[^>]*edges=\{\["top",\s*"bottom",\s*"left",\s*"right"\]\}/
        );
      });
    });

    it("verifies 4 dashboard/tab screens configure top/left/right insets", () => {
      const tabScreens = [
        "HomeScreen.js",
        "HistoryScreen.js",
        "StatsScreen.js",
        "SettingsScreen.js",
      ];
      tabScreens.forEach((screenName) => {
        const code = fs.readFileSync(path.join(screensDir, screenName), "utf8");
        expect(code).toMatch(
          /<SafeAreaView[^>]*edges=\{\["top",\s*"left",\s*"right"\]\}/
        );
      });
    });
  });

  // =========================================================================
  // 2. HistoryScreen: AsyncStorage Subject Persistence
  // =========================================================================
  describe("HistoryScreen: AsyncStorage Subject Persistence", () => {
    let renderer;

    afterEach(async () => {
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
        renderer = null;
      }
    });

    it("persists newly registered subject directly to AsyncStorage @study_timer/subjects with color and canonical name", async () => {
      // Seed real storage using actual storage functions
      await storage.saveSubject("Mathematics");
      await storage.saveSubject("World History");

      await storage.saveSession({
        sessionType: "1hr",
        label: "Calculus Review",
        subject: "Mathematics",
        startedAt: "2026-11-05T09:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        completed: true,
      });

      // Verify initial storage
      const initialRaw = await AsyncStorage.getItem("@study_timer/subjects");
      const initialParsed = JSON.parse(initialRaw);
      expect(initialParsed.map((s) => s.name)).toEqual(["Mathematics", "World History"]);

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Tap "Edit subject"
      const editBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Edit subject");
      expect(editBtn).toBeDefined();

      await act(async () => {
        editBtn.props.onPress();
      });

      // Enter a new subject name
      const input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);
      expect(input).toBeDefined();

      await act(async () => {
        input.props.onChangeText("   Quantum Computing   ");
      });

      // Save
      const saveBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Save name");
      expect(saveBtn).toBeDefined();

      await act(async () => {
        await saveBtn.props.onPress();
      });

      // 1. Verify AsyncStorage @study_timer/subjects contains "Quantum Computing"
      const rawStoredSubjects = await AsyncStorage.getItem("@study_timer/subjects");
      expect(rawStoredSubjects).not.toBeNull();
      const storedSubjects = JSON.parse(rawStoredSubjects);
      expect(storedSubjects.length).toBe(3);
      const qcEntry = storedSubjects.find((s) => s.name === "Quantum Computing");
      expect(qcEntry).toBeDefined();
      expect(qcEntry.name).toBe("Quantum Computing");
      expect(qcEntry.color).toMatch(/^#[0-9a-fA-F]{6}$/);

      // 2. Verify AsyncStorage @study_timer/sessions has updated subject
      const rawStoredSessions = await AsyncStorage.getItem("@study_timer/sessions");
      const storedSessions = JSON.parse(rawStoredSessions);
      expect(storedSessions[0].subject).toBe("Quantum Computing");

      // 3. Verify HistoryScreen UI has updated subject text and filter chip
      const renderedTexts = renderer.root
        .findAllByType(Text)
        .map((t) => t.props.children);
      expect(renderedTexts).toContain("Quantum Computing");

      // 4. Verify color dot has assigned color
      const colorDots = renderer.root.findAllByType(View).filter((v) => {
        const flat = Array.isArray(v.props.style)
          ? Object.assign({}, ...v.props.style.filter(Boolean))
          : v.props.style;
        return flat && flat.backgroundColor === qcEntry.color;
      });
      expect(colorDots.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 3. HistoryScreen: Filter Chips Behavior with Newly Registered Subject
  // =========================================================================
  describe("HistoryScreen: Filter Chips Behavior with Newly Registered Subject", () => {
    let renderer;

    afterEach(async () => {
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
        renderer = null;
      }
    });

    it("updates filter chips and filters session list when selecting newly created subject", async () => {
      await storage.saveSubject("Literature");
      await storage.saveSubject("Physics");

      // Session 1 (newer)
      await storage.saveSession({
        sessionType: "1hr",
        label: "Modern Literature",
        subject: "Literature",
        startedAt: "2026-11-05T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      // Session 2 (older)
      await storage.saveSession({
        sessionType: "2hr",
        label: "Classical Mechanics",
        subject: "Physics",
        startedAt: "2026-11-05T08:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        completed: true,
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Inline edit Session 1 to "Cognitive Neuroscience"
      const editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");
      expect(editButtons.length).toBe(2);

      await act(async () => {
        editButtons[0].props.onPress();
      });

      const input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);

      await act(async () => {
        input.props.onChangeText("Cognitive Neuroscience");
      });

      const saveBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Save name");

      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify the new filter chip is present
      const cnChip = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Filter by Cognitive Neuroscience");
      expect(cnChip).toBeDefined();
      expect(cnChip.props.accessibilityState.selected).toBe(false);

      // Select the new filter chip
      await act(async () => {
        cnChip.props.onPress();
      });

      // Verify chip is now selected
      const selectedCnChip = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Filter by Cognitive Neuroscience");
      expect(selectedCnChip.props.accessibilityState.selected).toBe(true);

      // Verify filtered view: only the edited session (Classical Mechanics) is rendered
      const displayedLabels = renderer.root
        .findAllByType(Text)
        .map((t) => t.props.children);
      expect(displayedLabels).toContain("Cognitive Neuroscience");
      expect(displayedLabels).toContain("Classical Mechanics");
      expect(displayedLabels).not.toContain("Modern Literature"); // Filtered out!

      // Result count displays "1 session"
      const resultCountText = renderer.root
        .findAllByType(Text)
        .find((t) => {
          const content = Array.isArray(t.props.children)
            ? t.props.children.join("")
            : t.props.children;
          return typeof content === "string" && content.includes("1 session");
        });
      expect(resultCountText).toBeDefined();

      // Clear filter by tapping "Clear filters"
      const clearBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Clear history filters");
      expect(clearBtn).toBeDefined();

      await act(async () => {
        clearBtn.props.onPress();
      });

      // All sessions are displayed again
      const restoredLabels = renderer.root
        .findAllByType(Text)
        .map((t) => t.props.children);
      expect(restoredLabels).toContain("Cognitive Neuroscience");
      expect(restoredLabels).toContain("Classical Mechanics");
      expect(restoredLabels).toContain("Modern Literature");
    });
  });

  // =========================================================================
  // 4. HistoryScreen: Concurrent & Interrupted Inline Edits Stress Test
  // =========================================================================
  describe("HistoryScreen: Concurrent & Interrupted Inline Edits", () => {
    let renderer;

    afterEach(async () => {
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
        renderer = null;
      }
    });

    it("cancels uncommitted edit when user switches edit target to another session", async () => {
      await storage.saveSubject("Math");
      await storage.saveSubject("Art");

      await storage.saveSession({
        sessionType: "1hr",
        label: "Art Session",
        subject: "Art",
        startedAt: "2026-11-05T09:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await storage.saveSession({
        sessionType: "1hr",
        label: "Math Session",
        subject: "Math",
        startedAt: "2026-11-05T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      let editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");
      expect(editButtons.length).toBe(2);

      // Start editing Session 1 (Math Session)
      await act(async () => {
        editButtons[0].props.onPress();
      });

      let activeInput = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);
      expect(activeInput.props.value).toBe("Math");

      // Type partial changes
      await act(async () => {
        activeInput.props.onChangeText("Discarded Math Draft");
      });

      // Without saving, tap edit on Session 2 (Art Session)
      editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");
      expect(editButtons.length).toBe(1); // Session 1 is in edit mode, so only Session 2 has edit button

      await act(async () => {
        editButtons[0].props.onPress();
      });

      // Now exactly one input exists and it belongs to Session 2 ("Art")
      const inputs = renderer.root
        .findAllByType(TextInput)
        .filter((i) => i.props.autoFocus === true);
      expect(inputs.length).toBe(1);
      expect(inputs[0].props.value).toBe("Art");

      // Verify Session 1 reverted back to "Math" and did not save the draft
      const storedSessions = await storage.loadSessions();
      expect(storedSessions.find((s) => s.label === "Math Session").subject).toBe("Math");
    });

    it("supports sequential edits across multiple sessions creating distinct subjects without race conditions", async () => {
      await storage.saveSubject("Subject A");
      await storage.saveSubject("Subject B");

      await storage.saveSession({
        sessionType: "1hr",
        label: "Session 1",
        subject: "Subject A",
        startedAt: "2026-11-05T08:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await storage.saveSession({
        sessionType: "1hr",
        label: "Session 2",
        subject: "Subject B",
        startedAt: "2026-11-05T09:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Edit Session 2 -> "Biophysics"
      let editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");

      await act(async () => {
        editButtons[0].props.onPress();
      });

      let input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);

      await act(async () => {
        input.props.onChangeText("Biophysics");
      });

      let saveBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Save name");

      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Edit Session 1 -> "Geophysics"
      editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");

      await act(async () => {
        editButtons[1].props.onPress();
      });

      input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);

      await act(async () => {
        input.props.onChangeText("Geophysics");
      });

      saveBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Save name");

      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify both subjects in AsyncStorage @study_timer/subjects
      const rawStoredSubjects = await AsyncStorage.getItem("@study_timer/subjects");
      const storedSubjects = JSON.parse(rawStoredSubjects);
      const subjectNames = storedSubjects.map((s) => s.name);
      expect(subjectNames).toContain("Biophysics");
      expect(subjectNames).toContain("Geophysics");

      // Verify both sessions in AsyncStorage @study_timer/sessions
      const rawStoredSessions = await AsyncStorage.getItem("@study_timer/sessions");
      const storedSessions = JSON.parse(rawStoredSessions);
      expect(storedSessions.find((s) => s.label === "Session 2").subject).toBe("Biophysics");
      expect(storedSessions.find((s) => s.label === "Session 1").subject).toBe("Geophysics");
    });

    it("guards against empty / whitespace subject edits", async () => {
      await storage.saveSubject("Ecology");
      await storage.saveSession({
        sessionType: "1hr",
        label: "Ecology Lab",
        subject: "Ecology",
        startedAt: "2026-11-05T09:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Edit subject");

      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);

      await act(async () => {
        input.props.onChangeText("     ");
      });

      const saveBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Save name");

      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify edit closed and subject retained
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe("Ecology");

      const storedSubjects = await storage.loadSubjects();
      expect(storedSubjects.map((s) => s.name)).toEqual(["Ecology"]);
    });

    it("cancels edit mode without changes when cancel icon is tapped", async () => {
      await storage.saveSubject("Botany");
      await storage.saveSession({
        sessionType: "1hr",
        label: "Plant Taxonomy",
        subject: "Botany",
        startedAt: "2026-11-05T09:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Edit subject");

      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);

      await act(async () => {
        input.props.onChangeText("Cancelled Text");
      });

      const cancelBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Cancel editing");
      expect(cancelBtn).toBeDefined();

      await act(async () => {
        cancelBtn.props.onPress();
      });

      // Verify input is gone
      const activeInputs = renderer.root
        .findAllByType(TextInput)
        .filter((i) => i.props.autoFocus === true);
      expect(activeInputs.length).toBe(0);

      // Verify subject remained Botany
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe("Botany");
    });
  });
});
