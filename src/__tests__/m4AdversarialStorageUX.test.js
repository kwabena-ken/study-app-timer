import fs from "fs";
import path from "path";
import React from "react";
import { act, create } from "react-test-renderer";
import { TouchableOpacity, TextInput, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_SETTINGS,
  MAX_NAME_LENGTH,
  SUBJECT_COLORS,
  normalizeSettings,
  loadSettings,
  saveSettings,
  loadSubjects,
  saveSubject,
  updateSubjectColor,
  renameSubject,
  deleteSubject,
  moveSubject,
  loadSessions,
  saveSession,
  deleteSession,
  updateSession,
  clearSessions,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  updateTemplate,
  duplicateTemplate,
  toggleTemplateFavorite,
  moveTemplate,
} from "../utils/storage";
import DoneScreen from "../screens/DoneScreen";
import HistoryScreen from "../screens/HistoryScreen";
import { ThemeProvider } from "../theme/ThemeContext";

// Stub native Icon component to avoid native SVG dependencies in Jest
jest.mock("../components/Icon", () => () => null);

const defaultSetItem = AsyncStorage.setItem;

describe("Milestone 4 Tier 5 Adversarial Coverage Hardening: Storage, UX, & Configurations", () => {
  beforeEach(async () => {
    AsyncStorage.setItem = defaultSetItem;
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    AsyncStorage.setItem = defaultSetItem;
    delete Object.prototype.polluted;
    delete Object.prototype.admin;
    delete Object.prototype.injected;
  });

  // =========================================================================
  // SECTION 1: Storage Mutex Locks (withKeyLock) & Concurrency Resilience
  // =========================================================================
  describe("1. Storage Mutex Locks (withKeyLock) & Concurrency Resilience", () => {
    it("serializes 30 rapid concurrent saveSettings calls without lost updates", async () => {
      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(
          saveSettings({
            weeklyGoalMins: 100 + i * 10,
            vibrate: i % 2 === 0,
            keepAwake: i % 3 === 0,
          })
        );
      }
      const results = await Promise.all(promises);
      expect(results).toHaveLength(30);

      const finalSettings = await loadSettings();
      expect(Number.isFinite(finalSettings.weeklyGoalMins)).toBe(true);
      expect(finalSettings.weeklyGoalMins).toBeGreaterThanOrEqual(100);
      expect(typeof finalSettings.vibrate).toBe("boolean");
      expect(typeof finalSettings.keepAwake).toBe("boolean");
    });

    it("recovers mutex chain when an intermediate write rejects", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      // Step 1: Normal save
      await saveSettings({ theme: "dark" });

      // Step 2: Inject single AsyncStorage failure on next setItem
      let callCount = 0;
      AsyncStorage.setItem = jest.fn(async (key, val) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Simulated storage write error");
        }
        return defaultSetItem.call(AsyncStorage, key, val);
      });

      // Dispatch failed write
      const failedResult = await saveSettings({ theme: "light" });
      // saveSettings catches and returns DEFAULT_SETTINGS on error
      expect(failedResult).toEqual(DEFAULT_SETTINGS);

      // Restore setItem
      AsyncStorage.setItem = defaultSetItem;

      // Step 3: Mutex lock MUST NOT be stuck; next write must succeed
      const recoveredResult = await saveSettings({ theme: "solarized" });
      expect(recoveredResult.theme).toBe("solarized");

      const finalSettings = await loadSettings();
      expect(finalSettings.theme).toBe("solarized");

      warnSpy.mockRestore();
    });

    it("executes operations on independent storage keys in parallel", async () => {
      let subjectsResolved = false;
      let settingsResolved = false;

      // Delay subjects operation artificially
      const p1 = (async () => {
        await new Promise((r) => setTimeout(r, 50));
        await saveSubject("Slow Subject");
        subjectsResolved = true;
      })();

      const p2 = (async () => {
        await saveSettings({ autoAdvance: false });
        settingsResolved = true;
      })();

      await Promise.all([p1, p2]);
      expect(subjectsResolved).toBe(true);
      expect(settingsResolved).toBe(true);
    });

    it("handles concurrent saveSession calls without duplicate subjects", async () => {
      // 10 concurrent saves with the same subject name in different cases
      const names = ["Algebra", "algebra", "ALGEBRA", " Algebra ", "algebra"];
      const saves = names.map((name, i) =>
        saveSession({
          sessionType: "pomodoro",
          label: `Session ${i}`,
          subject: name,
          startedAt: new Date().toISOString(),
          phasesCompleted: 1,
          totalStudyMins: 25,
          completed: true,
        })
      );

      await Promise.all(saves);

      const subjects = await loadSubjects();
      const algebraSubjects = subjects.filter(
        (s) => s.name.toLowerCase() === "algebra"
      );
      expect(algebraSubjects).toHaveLength(1);

      const sessions = await loadSessions();
      expect(sessions).toHaveLength(5);
    });

    it("safely executes renameSubject and saveSession concurrently without deadlock", async () => {
      await saveSubject("Chemistry");
      await saveSession({
        sessionType: "pomodoro",
        label: "Chem Study",
        subject: "Chemistry",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });

      // Concurrently rename subject and save another session
      await Promise.all([
        renameSubject("Chemistry", "Organic Chemistry"),
        saveSession({
          sessionType: "pomodoro",
          label: "Chem 2",
          subject: "Chemistry",
          startedAt: new Date().toISOString(),
          phasesCompleted: 1,
          totalStudyMins: 25,
          completed: true,
        }),
      ]);

      const subjects = await loadSubjects();
      expect(subjects.some((s) => s.name === "Organic Chemistry")).toBe(true);
      const sessions = await loadSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  // =========================================================================
  // SECTION 2: Settings Sanitization, Boundary Clamping & Whitelisting
  // =========================================================================
  describe("2. Settings Sanitization, Boundary Clamping & Whitelisting", () => {
    it("handles hostile primitive and non-object inputs to normalizeSettings", () => {
      const hostileInputs = [
        null,
        undefined,
        "string",
        12345,
        true,
        false,
        [1, 2, 3],
        () => {},
        Symbol("evil"),
        NaN,
        Infinity,
        -Infinity,
      ];

      for (const input of hostileInputs) {
        expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
      }
    });

    it("prevents prototype pollution in normalizeSettings", () => {
      const malicious = JSON.parse(
        '{"__proto__":{"polluted":true},"theme":"dark","weeklyGoalMins":500}'
      );
      const normalized = normalizeSettings(malicious);
      expect(normalized.theme).toBe("dark");
      expect(normalized.weeklyGoalMins).toBe(500);
      expect(Object.prototype.polluted).toBeUndefined();
      expect({}.polluted).toBeUndefined();
    });

    it("strictly bounds weeklyGoalMins (positive finite numbers only)", () => {
      const invalidMins = [0, -1, -500, NaN, Infinity, -Infinity, "600", null, undefined];
      for (const val of invalidMins) {
        const res = normalizeSettings({ weeklyGoalMins: val });
        expect(res.weeklyGoalMins).toBe(DEFAULT_SETTINGS.weeklyGoalMins);
      }

      const validMins = [1, 30, 600, 10000];
      for (const val of validMins) {
        const res = normalizeSettings({ weeklyGoalMins: val });
        expect(res.weeklyGoalMins).toBe(val);
      }
    });

    it("strictly bounds and rounds weeklyGoalDays (1 to 7 integer)", () => {
      const outOfBounds = [0, -5, 8, 100, NaN, Infinity, -Infinity, "5", null, undefined];
      for (const val of outOfBounds) {
        const res = normalizeSettings({ weeklyGoalDays: val });
        expect(res.weeklyGoalDays).toBe(DEFAULT_SETTINGS.weeklyGoalDays);
      }

      // Fractional rounding within 1..7
      expect(normalizeSettings({ weeklyGoalDays: 1.2 }).weeklyGoalDays).toBe(1);
      expect(normalizeSettings({ weeklyGoalDays: 1.8 }).weeklyGoalDays).toBe(2);
      expect(normalizeSettings({ weeklyGoalDays: 6.7 }).weeklyGoalDays).toBe(7);
      expect(normalizeSettings({ weeklyGoalDays: 7 }).weeklyGoalDays).toBe(7);
      expect(normalizeSettings({ weeklyGoalDays: 1 }).weeklyGoalDays).toBe(1);
    });

    it("sanitizes soundPreset and theme strings and ignores empty whitespace", () => {
      const invalidStrings = ["", "   ", "\t\n  \r", null, undefined, 123, true, {}];
      for (const val of invalidStrings) {
        const res = normalizeSettings({ soundPreset: val, theme: val });
        expect(res.soundPreset).toBe(DEFAULT_SETTINGS.soundPreset);
        expect(res.theme).toBe(DEFAULT_SETTINGS.theme);
      }

      const trimmed = normalizeSettings({ soundPreset: "  marimba  ", theme: "  nord  " });
      expect(trimmed.soundPreset).toBe("marimba");
      expect(trimmed.theme).toBe("nord");
    });

    it("whitelists output fields, stripping unknown or injected properties", () => {
      const dirty = {
        theme: "dark",
        admin: true,
        extraConfig: "injected",
        token: "secret",
        debugMode: 1,
      };
      const normalized = normalizeSettings(dirty);
      expect(Object.keys(normalized).sort()).toEqual([
        "autoAdvance",
        "keepAwake",
        "soundPreset",
        "theme",
        "vibrate",
        "weeklyGoalDays",
        "weeklyGoalEnabled",
        "weeklyGoalMins",
      ]);
      expect(normalized.admin).toBeUndefined();
      expect(normalized.extraConfig).toBeUndefined();
    });

    it("falls back to DEFAULT_SETTINGS when fallback argument itself is invalid", () => {
      expect(normalizeSettings({ weeklyGoalMins: -10 }, null).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ theme: "" }, "bad_fallback").theme).toBe(
        DEFAULT_SETTINGS.theme
      );
    });
  });

  // =========================================================================
  // SECTION 3: updateSession Whitelisting & 64-char Clamping
  // =========================================================================
  describe("3. updateSession Whitelisting & 64-char Clamping", () => {
    let sessionRecord;

    beforeEach(async () => {
      sessionRecord = await saveSession({
        sessionType: "pomodoro",
        label: "Initial Session",
        subject: "History",
        startedAt: "2026-11-05T12:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        actualStudyMins: 50,
        completed: true,
      });
    });

    it("strictly discards non-whitelisted keys during updateSession", async () => {
      await updateSession(sessionRecord.id, {
        id: "hacked-id",
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: "1970-01-01T00:00:00.000Z",
        totalStudyMins: 9999,
        hackedField: "injected",
      });

      const sessions = await loadSessions();
      const updated = sessions.find((s) => s.id === sessionRecord.id);
      expect(updated.id).toBe(sessionRecord.id);
      expect(updated.startedAt).toBe("2026-11-05T12:00:00.000Z");
      expect(updated.totalStudyMins).toBe(50);
      expect(updated.hackedField).toBeUndefined();
    });

    it("clamps oversized subject strings to MAX_NAME_LENGTH (64 chars)", async () => {
      const oversized = "A".repeat(5000);
      await updateSession(sessionRecord.id, { subject: oversized });

      const sessions = await loadSessions();
      const updated = sessions.find((s) => s.id === sessionRecord.id);
      expect(updated.subject).toHaveLength(MAX_NAME_LENGTH);
      expect(updated.subject).toBe("A".repeat(MAX_NAME_LENGTH));
    });

    it("falls back to 'Unspecified' when subject update is whitespace-only", async () => {
      await updateSession(sessionRecord.id, { subject: "   \t\n  " });

      const sessions = await loadSessions();
      const updated = sessions.find((s) => s.id === sessionRecord.id);
      expect(updated.subject).toBe("Unspecified");
    });

    it("clamps oversized label strings to MAX_NAME_LENGTH (64 chars)", async () => {
      const oversizedLabel = "Custom Label ".repeat(500);
      await updateSession(sessionRecord.id, { label: oversizedLabel });

      const sessions = await loadSessions();
      const updated = sessions.find((s) => s.id === sessionRecord.id);
      expect(updated.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    });

    it("validates actualStudyMins and phasesCompleted type and boundaries", async () => {
      // Negative / NaN / string actualStudyMins must be ignored
      await updateSession(sessionRecord.id, { actualStudyMins: -30 });
      let session = (await loadSessions())[0];
      expect(session.actualStudyMins).toBe(50);

      await updateSession(sessionRecord.id, { actualStudyMins: NaN });
      session = (await loadSessions())[0];
      expect(session.actualStudyMins).toBe(50);

      // Valid actualStudyMins (including 0)
      await updateSession(sessionRecord.id, { actualStudyMins: 0 });
      session = (await loadSessions())[0];
      expect(session.actualStudyMins).toBe(0);

      await updateSession(sessionRecord.id, { actualStudyMins: 42.5 });
      session = (await loadSessions())[0];
      expect(session.actualStudyMins).toBe(42.5);

      // phasesCompleted: floats floored, negatives ignored
      await updateSession(sessionRecord.id, { phasesCompleted: -5 });
      session = (await loadSessions())[0];
      expect(session.phasesCompleted).toBe(2);

      await updateSession(sessionRecord.id, { phasesCompleted: 3.8 });
      session = (await loadSessions())[0];
      expect(session.phasesCompleted).toBe(3);
    });

    it("ignores non-plain object or invalid update arguments", async () => {
      await updateSession(sessionRecord.id, null);
      await updateSession(sessionRecord.id, "string");
      await updateSession(sessionRecord.id, [1, 2]);
      await updateSession("non-existent-id", { subject: "Bio" });

      const sessions = await loadSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].subject).toBe("History");
    });
  });

  // =========================================================================
  // SECTION 4: Template Duplication 64-char Clamping & Phase Isolation
  // =========================================================================
  describe("4. Template Duplication 64-char Clamping & Phase Isolation", () => {
    it("slices duplicated template labels to MAX_NAME_LENGTH (64 chars)", async () => {
      // 60-char label: "${label} Copy" is 65 chars
      const longLabel = "B".repeat(60);
      const original = await saveTemplate({
        label: longLabel,
        phases: [{ name: "Study", duration: 25, isBreak: false }],
      });

      const duplicate = await duplicateTemplate(original.id);
      expect(duplicate.label).toHaveLength(MAX_NAME_LENGTH);
      expect(duplicate.label).toBe(`${longLabel} Copy`.slice(0, MAX_NAME_LENGTH));
    });

    it("handles cascading 10-depth template duplication without exceeding 64 chars", async () => {
      let current = await saveTemplate({
        label: "X".repeat(MAX_NAME_LENGTH),
        phases: [{ name: "Focus", duration: 20, isBreak: false }],
      });

      for (let i = 0; i < 10; i++) {
        current = await duplicateTemplate(current.id);
        expect(current.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      }

      const templates = await loadTemplates();
      expect(templates).toHaveLength(11);
    });

    it("ensures deep copy of phases during template duplication", async () => {
      const original = await saveTemplate({
        label: "Mastery Session",
        phases: [
          { name: "Phase 1", duration: 25, emoji: "🎯", isBreak: false },
          { name: "Break", duration: 5, emoji: "☕", isBreak: true },
        ],
      });

      const copy = await duplicateTemplate(original.id);
      // Mutate copy's phase array in-place
      copy.phases[0].duration = 999;
      copy.phases[0].name = "Mutated Phase";

      const templates = await loadTemplates();
      const storedOriginal = templates.find((t) => t.id === original.id);
      expect(storedOriginal.phases[0].duration).toBe(25);
      expect(storedOriginal.phases[0].name).toBe("Phase 1");
    });

    it("recovers gracefully from corrupt JSON in template storage", async () => {
      await AsyncStorage.setItem(
        "@study_timer/templates",
        JSON.stringify([
          { id: "corrupt-1", label: 12345 }, // invalid label
          { id: "corrupt-2", label: "Valid", phases: [] }, // no usable phases
          {
            id: "corrupt-3",
            label: "Bad Phase",
            phases: [{ name: "Zero", duration: 0 }],
          },
          {
            id: "valid-1",
            label: "Good Template",
            phases: [{ name: "Study", duration: 25, isBreak: false }],
          },
        ])
      );

      const templates = await loadTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe("valid-1");
    });
  });

  // =========================================================================
  // SECTION 5: DoneScreen Save Failure Recovery & Retry UX State Machine
  // =========================================================================
  describe("5. DoneScreen Save Failure Recovery & Retry UX State Machine", () => {
    const baseSession = {
      label: "25m Deep Focus",
      phases: [
        { name: "Deep Focus", duration: 25, isBreak: false },
        { name: "Break", duration: 5, isBreak: true },
      ],
    };

    const baseSessionMeta = {
      sessionKey: "pomodoro",
      subject: "Astrophysics",
      startedAt: "2026-11-05T14:00:00.000Z",
      actualStudyMins: 25,
    };

    let renderer;

    afterEach(async () => {
      AsyncStorage.setItem = defaultSetItem;
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
        renderer = null;
      }
    });

    it("displays explicit warning banner and Retry Save button upon storage failure", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      // Simulate disk write failure on mount
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error("Disk Full / I/O Error"));

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

      const root = renderer.root;
      const banner = root.findAll(
        (node) => node.props.accessibilityRole === "alert"
      );
      expect(banner.length).toBeGreaterThanOrEqual(1);

      // Verify error text
      const texts = root.findAllByType(Text).map((t) => t.props.children);
      expect(
        texts.some((txt) => typeof txt === "string" && txt.includes("Failed to save session to history."))
      ).toBe(true);

      // Verify Retry Save button is present
      const retryButtons = root
        .findAllByType(TouchableOpacity)
        .filter((node) => node.props.accessibilityLabel === "Retry Save");
      expect(retryButtons).toHaveLength(1);

      // Confirmation text must NOT be visible
      expect(texts).not.toContain("✅ Saved to history");

      AsyncStorage.setItem = defaultSetItem;
      warnSpy.mockRestore();
    });

    it("re-calls saveSession on Retry Save press, removes banner, and displays saved confirmation", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      let shouldFail = true;
      AsyncStorage.setItem = jest.fn(async (key, val) => {
        if (shouldFail) {
          throw new Error("Temporary DB Lock");
        }
        return defaultSetItem.call(AsyncStorage, key, val);
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

      const root = renderer.root;
      expect(
        root.findAll((node) => node.props.accessibilityRole === "alert").length
      ).toBeGreaterThanOrEqual(1);

      // Resolve storage failure condition and click retry
      shouldFail = false;
      const retryBtn = root
        .findAllByType(TouchableOpacity)
        .find((node) => node.props.accessibilityLabel === "Retry Save");

      await act(async () => {
        retryBtn.props.onPress();
      });

      // Warning banner must now be removed
      expect(
        root.findAll((node) => node.props.accessibilityRole === "alert")
      ).toHaveLength(0);

      // Confirmation and streak text must now appear
      const texts = root.findAllByType(Text).map((t) => t.props.children);
      expect(texts).toContain("✅ Saved to history");
      expect(texts).toContain("Streak started");

      AsyncStorage.setItem = defaultSetItem;
      warnSpy.mockRestore();
    });

    it("handles multiple consecutive retry failures cleanly without crashing", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error("Persistent Storage Failure"));

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

      const root = renderer.root;

      // Attempt 3 retries, all failing
      for (let attempt = 0; attempt < 3; attempt++) {
        const retryBtn = root
          .findAllByType(TouchableOpacity)
          .find((node) => node.props.accessibilityLabel === "Retry Save");
        expect(retryBtn).toBeDefined();

        await act(async () => {
          retryBtn.props.onPress();
        });
        expect(
          root.findAll((node) => node.props.accessibilityRole === "alert").length
        ).toBeGreaterThanOrEqual(1);
      }

      AsyncStorage.setItem = defaultSetItem;
      warnSpy.mockRestore();
    });

    it("handles session without study phases (all breaks) gracefully", async () => {
      const breakOnlySession = {
        label: "Coffee Break",
        phases: [{ name: "Rest", duration: 15, isBreak: true }],
      };

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={breakOnlySession}
              sessionMeta={baseSessionMeta}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const sessions = await loadSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].totalStudyMins).toBe(0);
      expect(sessions[0].phasesCompleted).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 6: HistoryScreen Inline Subject Edit & Dynamic Filter Matrix
  // =========================================================================
  describe("6. HistoryScreen Inline Subject Edit & Dynamic Filter Matrix", () => {
    let renderer;

    afterEach(async () => {
      AsyncStorage.setItem = defaultSetItem;
      if (renderer) {
        await act(async () => {
          renderer.unmount();
        });
        renderer = null;
      }
    });

    it("auto-registers newly edited subject name, updates color dot, and refreshes filters", async () => {
      // Seed 1 session with existing subject
      await saveSubject("InitialMath");
      const session = await saveSession({
        sessionType: "pomodoro",
        label: "Study Block",
        subject: "InitialMath",
        startedAt: new Date().toISOString(),
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

      const root = renderer.root;

      // Start edit
      const editBtn = root.find(
        (node) => node.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      // Type brand new subject name
      const input = root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);
      expect(input).toBeDefined();
      await act(async () => {
        input.props.onChangeText("Quantum Computing");
      });

      // Save edit
      const saveBtn = root.find(
        (node) => node.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Verify storage was updated
      const subjects = await loadSubjects();
      const newSubj = subjects.find((s) => s.name === "Quantum Computing");
      expect(newSubj).toBeDefined();
      expect(newSubj.color).toBeDefined();

      const sessions = await loadSessions();
      expect(sessions[0].subject).toBe("Quantum Computing");

      // Verify dynamic subject filter chip includes the new subject
      const filterChips = root
        .findAll((n) => n.props.accessibilityLabel?.startsWith("Filter by "))
        .map((n) => n.props.accessibilityLabel);
      expect(filterChips).toContain("Filter by Quantum Computing");
    });

    it("cancels edit cleanly when user enters whitespace-only", async () => {
      await saveSubject("Literature");
      await saveSession({
        sessionType: "pomodoro",
        label: "Reading",
        subject: "Literature",
        startedAt: new Date().toISOString(),
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

      const root = renderer.root;
      const editBtn = root.find(
        (node) => node.props.accessibilityLabel === "Edit subject"
      );
      await act(async () => {
        editBtn.props.onPress();
      });

      const input = root
        .findAllByType(TextInput)
        .find((i) => i.props.autoFocus === true);
      expect(input).toBeDefined();
      await act(async () => {
        input.props.onChangeText("   \t  ");
      });

      const saveBtn = root.find(
        (node) => node.props.accessibilityLabel === "Save name"
      );
      await act(async () => {
        await saveBtn.props.onPress();
      });

      // Session subject must remain unchanged
      const sessions = await loadSessions();
      expect(sessions[0].subject).toBe("Literature");
    });

    it("cycles subject colors round-robin through SUBJECT_COLORS without error", async () => {
      for (let i = 0; i < 25; i++) {
        const subj = await saveSubject(`Course_${i}`);
        expect(subj.color).toBe(SUBJECT_COLORS[i % SUBJECT_COLORS.length]);
      }

      const all = await loadSubjects();
      expect(all).toHaveLength(25);
    });

    it("supports search, subject, status, and range filtering with clear filters", async () => {
      await saveSession({
        sessionType: "pomodoro",
        label: "Chemistry Lab",
        subject: "Chemistry",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: true,
      });
      await saveSession({
        sessionType: "pomodoro",
        label: "Math Homework",
        subject: "Math",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        completed: false, // left early
      });

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <HistoryScreen onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const root = renderer.root;

      const hasMatchingText = (expected) =>
        root.findAllByType(Text).some((t) => {
          const content = Array.isArray(t.props.children)
            ? t.props.children.join("")
            : t.props.children;
          return typeof content === "string" && content.includes(expected);
        });

      // Filter by "Left early" status
      const leftEarlyChip = root.find(
        (n) => n.props.accessibilityLabel === "Show Left early sessions"
      );
      await act(async () => {
        leftEarlyChip.props.onPress();
      });

      expect(hasMatchingText("1 session")).toBe(true);

      // Clear filters
      const clearBtn = root.find(
        (n) => n.props.accessibilityLabel === "Clear history filters"
      );
      await act(async () => {
        clearBtn.props.onPress();
      });

      // Both sessions back in view
      expect(hasMatchingText("2 sessions")).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 7: Screen Safe Area Wrapping & Security/Build Hardening
  // =========================================================================
  describe("7. Screen Safe Area Wrapping & Security/Build Hardening", () => {
    const projectRoot = path.resolve(__dirname, "../..");
    const screensDir = path.resolve(__dirname, "../screens");

    it("verifies all 9 screen files import SafeAreaView exclusively from react-native-safe-area-context", () => {
      const screenFiles = fs
        .readdirSync(screensDir)
        .filter((f) => f.endsWith(".js") && !f.includes(".test."));

      expect(screenFiles).toHaveLength(9);

      for (const file of screenFiles) {
        const content = fs.readFileSync(path.join(screensDir, file), "utf8");

        // Must NOT import SafeAreaView from "react-native"
        const rnMatch = content.match(
          /import\s*\{([^}]*)\}\s*from\s*["']react-native["'];/s
        );
        if (rnMatch) {
          const imports = rnMatch[1].split(",").map((s) => s.trim());
          expect(imports).not.toContain("SafeAreaView");
        }

        // MUST import SafeAreaView from "react-native-safe-area-context"
        const safeAreaMatch = content.match(
          /import\s*\{([^}]*)\}\s*from\s*["']react-native-safe-area-context["'];/s
        );
        expect(safeAreaMatch).not.toBeNull();
        const safeImports = safeAreaMatch[1].split(",").map((s) => s.trim());
        expect(safeImports).toContain("SafeAreaView");

        // Must use <SafeAreaView> in JSX
        expect(content).toMatch(/<SafeAreaView\b/);
      }
    });

    it("verifies 5 modal/fullscreen screens protect all 4 edges (top, bottom, left, right)", () => {
      const fullBleedScreens = [
        "SubjectPickerScreen.js",
        "SessionPickerScreen.js",
        "CustomSessionScreen.js",
        "DoneScreen.js",
        "SessionScreen.js",
      ];

      for (const file of fullBleedScreens) {
        const content = fs.readFileSync(path.join(screensDir, file), "utf8");
        expect(content).toMatch(
          /<SafeAreaView[^>]*edges=\{\["top",\s*"bottom",\s*"left",\s*"right"\]\}/
        );
      }
    });

    it("verifies 4 tab screens protect 3 edges (top, left, right) allowing bottom tab bar inset", () => {
      const tabScreens = [
        "HomeScreen.js",
        "StatsScreen.js",
        "SettingsScreen.js",
        "HistoryScreen.js",
      ];

      for (const file of tabScreens) {
        const content = fs.readFileSync(path.join(screensDir, file), "utf8");
        expect(content).toMatch(
          /<SafeAreaView[^>]*edges=\{\["top",\s*"left",\s*"right"\]\}/
        );
      }
    });

    it("validates app.json Android permissions, backup restrictions, and versioning", () => {
      const appJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "app.json"), "utf8")
      );
      const android = appJson.expo.android;

      expect(android.permissions).toContain("android.permission.POST_NOTIFICATIONS");
      expect(android.permissions).not.toContain("NOTIFICATIONS");
      expect(android.allowBackup).toBe(false);
      expect(android.versionCode).toBe(1);
      expect(android.package).toBe("com.kwabena.studytimer");
    });

    it("validates eas.json preview profile targets standalone APK buildType", () => {
      const easJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "eas.json"), "utf8")
      );
      expect(easJson.build.preview.android.buildType).toBe("apk");
      expect(easJson.build.preview.distribution).toBe("internal");
    });

    it("validates .gitignore excludes certificates, keys, build artifacts, and test caches", () => {
      const gitignore = fs.readFileSync(
        path.join(projectRoot, ".gitignore"),
        "utf8"
      );
      const rules = gitignore.split("\n").map((l) => l.trim());

      const requiredPatterns = [
        ".env*",
        "*.jks",
        "*.keystore",
        "*.p8",
        "*.p12",
        "*.key",
        "*.mobileprovision",
        "*.apk",
        "*.aab",
        "android/",
        "ios/",
        ".jest-cache/",
      ];

      for (const pattern of requiredPatterns) {
        expect(rules).toContain(pattern);
      }
    });
  });
});
