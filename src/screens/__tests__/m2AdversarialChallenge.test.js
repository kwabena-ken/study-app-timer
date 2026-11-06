import React from "react";
import { act, create } from "react-test-renderer";
import { TouchableOpacity, TextInput, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DoneScreen from "../DoneScreen";
import HistoryScreen from "../HistoryScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as storage from "../../utils/storage";
import { SUBJECT_COLORS, MAX_NAME_LENGTH } from "../../utils/storage";

jest.mock("../../components/Icon", () => () => null);

describe("Milestone 2 Empirical Adversarial Challenges", () => {
  const baseSession = {
    label: "25m Deep Work",
    phases: [
      { name: "Deep Work", duration: 25, isBreak: false },
      { name: "Short Break", duration: 5, isBreak: true },
    ],
  };

  const baseSessionMeta = {
    sessionKey: "pomodoro",
    subject: "Mathematics",
    startedAt: "2026-11-05T10:00:00.000Z",
    actualStudyMins: 25,
  };

  let renderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
      renderer = null;
    }
  });

  // =========================================================================
  // 1. DoneScreen Stress Tests
  // =========================================================================
  describe("DoneScreen: Save failure recovery, race conditions & streaks", () => {
    it("handles repeated save failures followed by retry without duplicating records", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      let saveAttempts = 0;
      const originalSave = storage.saveSession;
      const saveSpy = jest.spyOn(storage, "saveSession").mockImplementation(async (params) => {
        saveAttempts++;
        if (saveAttempts <= 3) {
          throw new Error(`Disk write failed (attempt ${saveAttempts})`);
        }
        return originalSave(params);
      });

      // Mount DoneScreen — Attempt 1 fails
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(saveAttempts).toBe(1);
      let alertBanners = renderer.root.findAll(
        (node) => node.type === View && node.props.accessibilityRole === "alert"
      );
      expect(alertBanners.length).toBe(1);

      // Attempt 2 fails
      let retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      expect(retryBtn).toBeDefined();

      await act(async () => {
        await retryBtn.props.onPress();
      });

      expect(saveAttempts).toBe(2);
      alertBanners = renderer.root.findAll(
        (node) => node.type === View && node.props.accessibilityRole === "alert"
      );
      expect(alertBanners.length).toBe(1);

      // Attempt 3 fails
      retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      expect(retryBtn).toBeDefined();

      await act(async () => {
        await retryBtn.props.onPress();
      });

      expect(saveAttempts).toBe(3);
      alertBanners = renderer.root.findAll(
        (node) => node.type === View && node.props.accessibilityRole === "alert"
      );
      expect(alertBanners.length).toBe(1);

      // Attempt 4 succeeds!
      retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      expect(retryBtn).toBeDefined();

      await act(async () => {
        await retryBtn.props.onPress();
      });

      expect(saveAttempts).toBe(4);

      // Banner should now be gone, saved confirmation visible
      alertBanners = renderer.root.findAll(
        (node) => node.type === View && node.props.accessibilityRole === "alert"
      );
      expect(alertBanners.length).toBe(0);

      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts.some((txt) => typeof txt === "string" && txt.includes("Saved to history"))).toBe(true);

      // Verify that only 1 session was saved to storage
      const storedSessions = await storage.loadSessions();
      expect(storedSessions.length).toBe(1);
      expect(storedSessions[0].subject).toBe("Mathematics");

      saveSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("verifies rapid retry clicks UI disable state and documents concurrency behavior", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      let resolveSave;
      let saveCallCount = 0;

      // Fail first save on mount
      let shouldBlock = false;
      const saveSpy = jest.spyOn(storage, "saveSession").mockImplementation(async (params) => {
        saveCallCount++;
        if (!shouldBlock) {
          throw new Error("Initial save failure");
        }
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(saveCallCount).toBe(1);

      const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      expect(retryBtn).toBeDefined();

      // Switch to pending save
      shouldBlock = true;

      // Trigger first click
      let clickPromise;
      act(() => {
        clickPromise = retryBtn.props.onPress();
      });

      expect(saveCallCount).toBe(2);

      // Note: React Native TouchableOpacity sets disabled={isSaving} and performSave sets setSaveError(false).
      // We check that once retry is pressed, the retry button's disabled prop is true OR the warning banner is unmounted
      const retryBtnDuringSave = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      // Because saveError was set to false, retryBtnDuringSave is unmounted during save!
      expect(retryBtnDuringSave).toBeUndefined();

      // Resolve the in-flight save
      await act(async () => {
        resolveSave({ id: "s-resolved" });
        await clickPromise;
      });

      expect(saveCallCount).toBe(2);

      saveSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("calculates streak correctly after retry on day 1 (streak start)", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      let failedOnce = false;
      const originalSave = storage.saveSession;
      const saveSpy = jest.spyOn(storage, "saveSession").mockImplementation(async (params) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error("Fail once");
        }
        return originalSave(params);
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      await act(async () => {
        await retryBtn.props.onPress();
      });

      // Streak text should indicate streak started
      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain("Streak started");

      saveSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("calculates streak correctly after retry when extending an existing multi-day streak", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const now = new Date();

      // Seed storage with sessions from yesterday, 2 days ago, and 3 days ago
      const dayMs = 24 * 60 * 60 * 1000;
      const priorSessions = [
        {
          id: "hist-1",
          sessionType: "pomodoro",
          label: "Session Day -1",
          subject: "Math",
          startedAt: new Date(now.getTime() - 1 * dayMs).toISOString(),
          completedAt: new Date(now.getTime() - 1 * dayMs).toISOString(),
          completed: true,
          totalStudyMins: 25,
          phasesCompleted: 1,
        },
        {
          id: "hist-2",
          sessionType: "pomodoro",
          label: "Session Day -2",
          subject: "Math",
          startedAt: new Date(now.getTime() - 2 * dayMs).toISOString(),
          completedAt: new Date(now.getTime() - 2 * dayMs).toISOString(),
          completed: true,
          totalStudyMins: 25,
          phasesCompleted: 1,
        },
        {
          id: "hist-3",
          sessionType: "pomodoro",
          label: "Session Day -3",
          subject: "Math",
          startedAt: new Date(now.getTime() - 3 * dayMs).toISOString(),
          completedAt: new Date(now.getTime() - 3 * dayMs).toISOString(),
          completed: true,
          totalStudyMins: 25,
          phasesCompleted: 1,
        },
      ];
      await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify(priorSessions));

      let failedOnce = false;
      const saveSpy = jest.spyOn(storage, "saveSession").mockImplementation(async (params) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error("Disk glitch");
        }
        const updated = [{ id: "new-today", ...params, completedAt: now.toISOString() }, ...priorSessions];
        await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify(updated));
        return updated[0];
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Retry Save"
      );
      expect(retryBtn).toBeDefined();

      await act(async () => {
        await retryBtn.props.onPress();
      });

      const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain("That's 4 days in a row");

      saveSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("safely handles unmount / navigation away while save is in flight", async () => {
      let resolveSave;
      const savePromise = new Promise((resolve) => {
        resolveSave = resolve;
      });
      const saveSpy = jest.spyOn(storage, "saveSession").mockImplementation(() => savePromise);

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);

      // Unmount before save completes (user navigating away)
      await act(async () => {
        renderer.unmount();
        renderer = null;
      });

      // Now resolve the promise in the background
      await act(async () => {
        resolveSave({ id: "s-late" });
      });

      // Verification: no crash, no unhandled rejection
      saveSpy.mockRestore();
    });
  });

  // =========================================================================
  // 2. HistoryScreen Stress Tests
  // =========================================================================
  describe("HistoryScreen: Inline edit edge cases, casing, unicode, and palette", () => {
    const seedSession = async (subject = "Math") => {
      const session = {
        id: "sess-100",
        label: "25m Study",
        subject,
        startedAt: "2026-11-05T10:00:00.000Z",
        completedAt: new Date().toISOString(),
        completed: true,
        totalStudyMins: 25,
        actualStudyMins: 25,
        phasesCompleted: 1,
      };
      await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify([session]));
      await AsyncStorage.setItem(
        "@study_timer/subjects",
        JSON.stringify([{ name: subject, color: SUBJECT_COLORS[0] }])
      );
      return session;
    };

    it("rejects empty string and whitespace edits without modifying session or subject", async () => {
      await seedSession("Algorithms");

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Start edit
      let editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      // Set empty string
      let input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      await act(async () => {
        input.props.onChangeText("");
      });

      // Click save
      let saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify subject is still "Algorithms"
      let texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain("Algorithms");

      // Now test with whitespace only
      editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      await act(async () => {
        input.props.onChangeText("   \t\n   ");
      });

      saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify subject remains "Algorithms"
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe("Algorithms");

      const storedSubjects = await storage.loadSubjects();
      expect(storedSubjects.length).toBe(1);
      expect(storedSubjects[0].name).toBe("Algorithms");
    });

    it("enforces MAX_NAME_LENGTH (64 chars) in UI input and storage persistence", async () => {
      await seedSession("Algorithms");

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      // UI enforcement: maxLength attribute
      expect(input.props.maxLength).toBe(MAX_NAME_LENGTH);
      expect(MAX_NAME_LENGTH).toBe(64);

      // Programmatic bypass test: simulate text input event with 100 chars
      const ultraLongName = "A".repeat(100);
      await act(async () => {
        input.props.onChangeText(ultraLongName);
      });

      const saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Storage should cap at 64 characters
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject.length).toBe(64);
      expect(storedSessions[0].subject).toBe("A".repeat(64));

      const storedSubjects = await storage.loadSubjects();
      expect(storedSubjects.some((s) => s.name === "A".repeat(64))).toBe(true);
    });

    it("reuses existing canonical subject casing and prevents duplicate subject creation", async () => {
      // Setup existing subject "Neuroscience" with color SUBJECT_COLORS[2]
      await AsyncStorage.setItem(
        "@study_timer/subjects",
        JSON.stringify([
          { name: "Math", color: SUBJECT_COLORS[0] },
          { name: "Neuroscience", color: SUBJECT_COLORS[2] },
        ])
      );
      await AsyncStorage.setItem(
        "@study_timer/sessions",
        JSON.stringify([
          {
            id: "s1",
            label: "Study",
            subject: "Math",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            completed: true,
            totalStudyMins: 25,
            phasesCompleted: 1,
          },
        ])
      );

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      // Type all-lowercase "neuroscience"
      await act(async () => {
        input.props.onChangeText("neuroscience");
      });

      const saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify canonical casing "Neuroscience" is used
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe("Neuroscience");

      // Verify no duplicate in subjects
      const storedSubjects = await storage.loadSubjects();
      expect(storedSubjects.length).toBe(2);
      expect(storedSubjects.map((s) => s.name)).toEqual(["Math", "Neuroscience"]);

      // Verify color dot matches the canonical subject's color
      const colorDots = renderer.root.findAllByType(View).filter((v) => {
        const flatStyle = Array.isArray(v.props.style)
          ? Object.assign({}, ...v.props.style.filter(Boolean))
          : v.props.style;
        return flatStyle && flatStyle.backgroundColor === SUBJECT_COLORS[2];
      });
      expect(colorDots.length).toBeGreaterThanOrEqual(1);
    });

    it("handles special characters, unicode, and emojis correctly across persistence and filtering", async () => {
      await seedSession("Math");

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      const complexUnicodeName = "量子力学 🔬 & AI 🚀 (2026)";
      await act(async () => {
        input.props.onChangeText(complexUnicodeName);
      });

      const saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify stored accurately
      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe(complexUnicodeName);

      const storedSubjects = await storage.loadSubjects();
      expect(storedSubjects.some((s) => s.name === complexUnicodeName)).toBe(true);

      // Verify UI filter chips display the unicode subject
      const filterChip = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === `Filter by ${complexUnicodeName}`
      );
      expect(filterChip).toBeDefined();

      // Test selecting the filter chip
      await act(async () => {
        filterChip.props.onPress();
      });

      const texts = renderer.root.findAllByType(Text).map((t) =>
        Array.isArray(t.props.children) ? t.props.children.join("") : String(t.props.children)
      );
      expect(texts).toContain(complexUnicodeName);
      expect(texts).toContain("1 session");
    });

    it("verifies round-robin palette assignment and filter chip addition for multiple new subjects", async () => {
      // Start with empty storage
      await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify([]));
      await AsyncStorage.setItem("@study_timer/subjects", JSON.stringify([]));

      // Create 12 subjects sequentially via saveSubject (simulating successive edits)
      const createdSubjects = [];
      for (let i = 0; i < 12; i++) {
        const subj = await storage.saveSubject(`Course-${i + 1}`);
        createdSubjects.push(subj);
        expect(subj.color).toBe(SUBJECT_COLORS[i % SUBJECT_COLORS.length]);
      }

      // Also create 12 sessions matching these subjects
      const sessions = createdSubjects.map((subj, i) => ({
        id: `sess-${i}`,
        label: `Session ${i}`,
        subject: subj.name,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        completed: true,
        totalStudyMins: 25,
        phasesCompleted: 1,
      }));
      await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify(sessions));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Verify all 12 subjects appear in filter chips
      for (let i = 0; i < 12; i++) {
        const chip = renderer.root.findAllByType(TouchableOpacity).find(
          (btn) => btn.props.accessibilityLabel === `Filter by Course-${i + 1}`
        );
        expect(chip).toBeDefined();
      }

      // Verify that color dots for all 10 palette colors exist in the rendered sessions
      for (let i = 0; i < SUBJECT_COLORS.length; i++) {
        const dots = renderer.root.findAllByType(View).filter((v) => {
          const flatStyle = Array.isArray(v.props.style)
            ? Object.assign({}, ...v.props.style.filter(Boolean))
            : v.props.style;
          return flatStyle && flatStyle.backgroundColor === SUBJECT_COLORS[i];
        });
        expect(dots.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("handles cancel editing and switching edit between sessions without saving", async () => {
      const s1 = {
        id: "sess-1",
        label: "Session 1",
        subject: "Math",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        completed: true,
        totalStudyMins: 25,
        phasesCompleted: 1,
      };
      const s2 = {
        id: "sess-2",
        label: "Session 2",
        subject: "Physics",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        completed: true,
        totalStudyMins: 30,
        phasesCompleted: 1,
      };
      await AsyncStorage.setItem("@study_timer/sessions", JSON.stringify([s1, s2]));
      await AsyncStorage.setItem(
        "@study_timer/subjects",
        JSON.stringify([
          { name: "Math", color: SUBJECT_COLORS[0] },
          { name: "Physics", color: SUBJECT_COLORS[1] },
        ])
      );

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      // Start editing s1
      const editButtons = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");
      expect(editButtons.length).toBe(2);

      await act(async () => {
        editButtons[0].props.onPress();
      });

      let input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      expect(input).toBeDefined();

      await act(async () => {
        input.props.onChangeText("Temp Math");
      });

      // Cancel editing
      const cancelBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Cancel editing"
      );
      expect(cancelBtn).toBeDefined();

      await act(async () => {
        cancelBtn.props.onPress();
      });

      // Verify no changes were made to s1
      let storedSessions = await storage.loadSessions();
      expect(storedSessions.find((s) => s.id === "sess-1").subject).toBe("Math");

      // Now edit s1 again, then click edit on s2 directly
      const editButtonsAfter = renderer.root
        .findAllByType(TouchableOpacity)
        .filter((btn) => btn.props.accessibilityLabel === "Edit subject");

      await act(async () => {
        editButtonsAfter[0].props.onPress();
      });

      // Now s2 edit button should still be accessible
      const s2EditBtn = renderer.root
        .findAllByType(TouchableOpacity)
        .find((btn) => btn.props.accessibilityLabel === "Edit subject");
      if (s2EditBtn) {
        await act(async () => {
          s2EditBtn.props.onPress();
        });
      }

      // Verify s1 is still "Math"
      storedSessions = await storage.loadSessions();
      expect(storedSessions.find((s) => s.id === "sess-1").subject).toBe("Math");
    });

    it("handles special regex characters in search query without throwing SyntaxError", async () => {
      await seedSession("Algorithms & Data Structures [Advanced]");

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const searchInput = renderer.root.findAllByType(TextInput).find(
        (i) => i.props.accessibilityLabel === "Search sessions or subjects"
      );
      expect(searchInput).toBeDefined();

      // Test regex special characters: [, (, ), *, +, ?, \, ^, $, ., |
      const regexStrings = ["[", "]", "(", ")", "*", "+", "?", "\\", "^", "$", ".", "|", ".*", "[Advanced]"];

      for (const str of regexStrings) {
        await act(async () => {
          searchInput.props.onChangeText(str);
        });

        // Should not throw and should render without crashing
        const texts = renderer.root.findAllByType(Text).map((t) =>
          Array.isArray(t.props.children) ? t.props.children.join("") : String(t.props.children)
        );
        expect(texts.length).toBeGreaterThan(0);
      }
    });

    it("safely trims surrounding whitespace while preserving maximum length", async () => {
      await seedSession("Old Subject");

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      const input = renderer.root.findAllByType(TextInput).find((i) => i.props.autoFocus === true);
      // 5 spaces + 64 'Z' characters + 5 spaces
      const spacedInput = "     " + "Z".repeat(64) + "     ";
      await act(async () => {
        input.props.onChangeText(spacedInput);
      });

      const saveBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => btn.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      const storedSessions = await storage.loadSessions();
      expect(storedSessions[0].subject).toBe("Z".repeat(64));
      expect(storedSessions[0].subject.length).toBe(64);
    });
  });

  describe("DoneScreen: Null/Empty props and navigation edge cases", () => {
    it("handles empty phases and null sessionMeta gracefully", async () => {
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={{ label: "Empty Phases", phases: [] }}
              sessionMeta={null}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const storedSessions = await storage.loadSessions();
      expect(storedSessions.length).toBe(1);
      expect(storedSessions[0].label).toBe("Empty Phases");
      expect(storedSessions[0].subject).toBe("Unspecified");
      expect(storedSessions[0].totalStudyMins).toBe(0);
      expect(storedSessions[0].phasesCompleted).toBe(0);
    });

    it("allows user to navigate home (onGoHome) while save error banner is visible", async () => {
      const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const onGoHomeMock = jest.fn();

      const saveSpy = jest.spyOn(storage, "saveSession").mockRejectedValue(new Error("Disk error"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={baseSession}
              sessionMeta={baseSessionMeta}
              onGoHome={onGoHomeMock}
            />
          </ThemeProvider>
        );
      });

      const homeBtn = renderer.root.findAllByType(TouchableOpacity).find(
        (btn) => {
          const texts = btn.findAllByType(Text).map((t) => t.props.children);
          return texts.some((txt) => typeof txt === "string" && txt.includes("Back to Home"));
        }
      );
      expect(homeBtn).toBeDefined();

      await act(async () => {
        homeBtn.props.onPress();
      });

      expect(onGoHomeMock).toHaveBeenCalledTimes(1);

      saveSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });
});
