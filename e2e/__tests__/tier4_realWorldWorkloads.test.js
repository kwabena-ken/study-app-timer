/**
 * Tier 4: Real-World Workloads & End-to-End Application Scenarios
 *
 * Exercises realistic multi-step user workflows across end-to-end sessions,
 * background sleep recovery, manual phase pacing, partial hardware interruptions,
 * save failure retries, custom template authoring, navigation churn, and corrupted
 * storage defense-in-depth.
 *
 * Feature Inventory Coverage:
 *   RW-1: Full Pomodoro cycle with background intervals [F1, F2, F8, F11]
 *   RW-2: Multi-phase study session completing while asleep in background [F1, F2, F3, F6, F8]
 *   RW-3: Manual mode session halting at phase boundary [F1, F10]
 *   RW-4: Interrupted session recovery and partial quit via hardware back button [F2, F4, F5, F11]
 *   RW-5: Session save error and successful retry in DoneScreen [F7, F8, F10]
 *   RW-6: Custom session template creation, duplication with 64-char cap, subject assignment [F9, F11, F12]
 *   RW-7: Rapid app navigation churn and startup notification cleanup [F5, F6, F7]
 *   RW-8: Storage corruption recovery and defense-in-depth sanitization [F8, F9, F10, F11, F12]
 */

import React from "react";
import { AppState, BackHandler, Alert, Vibration, Text, TouchableOpacity } from "react-native";
import { create, act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";

import App from "../../App";
import HomeScreen from "../../src/screens/HomeScreen";
import SessionScreen from "../../src/screens/SessionScreen";
import DoneScreen from "../../src/screens/DoneScreen";
import HistoryScreen from "../../src/screens/HistoryScreen";
import StatsScreen from "../../src/screens/StatsScreen";
import SettingsScreen from "../../src/screens/SettingsScreen";
import { ThemeProvider } from "../../src/theme/ThemeContext";

import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  loadSessions,
  saveSession,
  updateSession,
  loadSubjects,
  saveSubject,
  loadTemplates,
  saveTemplate,
  duplicateTemplate,
  MAX_NAME_LENGTH,
} from "../../src/utils/storage";
import { computeStreak } from "../../src/utils/streak";
import { minsFromSecs } from "../../src/utils/studyTime";

const SESSIONS_KEY = "@study_timer/sessions";
const SUBJECTS_KEY = "@study_timer/subjects";
const TEMPLATES_KEY = "@study_timer/templates";
const SETTINGS_KEY = "@study_timer/settings";

// Mocks
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/components/SessionDial", () => () => null);
jest.mock("../../src/components/Icon", () => () => null);

const mockPlayAlarm = jest.fn();
const mockStopAlarm = jest.fn();
jest.mock("../../src/hooks/useAlarmSound", () => ({
  useAlarmSound: () => ({ playAlarm: mockPlayAlarm, stopAlarm: mockStopAlarm }),
}));

const mockScheduleChain = jest.fn();
const mockCancelAll = jest.fn();
const mockCancelSessionNotifications = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/hooks/useNotifications", () => ({
  useNotifications: () => ({
    scheduleChain: mockScheduleChain,
    cancelAll: mockCancelAll,
    error: null,
  }),
  cancelSessionNotifications: () => mockCancelSessionNotifications(),
}));

let mockTimerState;
jest.mock("../../src/hooks/useTimer", () => ({
  useTimer: (opts) => {
    mockTimerState._onComplete = opts?.onComplete;
    return mockTimerState;
  },
}));

describe("Tier 4: Real-World Workloads & Application Scenarios", () => {
  let appStateListener = null;
  let backHandlerStack = [];
  let originalDateNow;
  let currentTime = 1700000000000;
  let renderer = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();

    currentTime = 1700000000000;
    originalDateNow = Date.now;
    Date.now = jest.fn(() => currentTime);

    mockTimerState = {
      secondsLeft: 1500,
      running: false,
      setRunning: jest.fn((fn) => {
        if (typeof fn === "function") {
          mockTimerState.running = fn(mockTimerState.running);
        } else {
          mockTimerState.running = fn;
        }
      }),
      loadDuration: jest.fn((secs) => {
        mockTimerState.secondsLeft = secs;
        mockTimerState.running = false;
      }),
      stop: jest.fn(() => {
        mockTimerState.running = false;
      }),
      restart: jest.fn((secs) => {
        mockTimerState.secondsLeft = secs;
        mockTimerState.running = true;
      }),
      _onComplete: null,
    };

    appStateListener = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((type, cb) => {
      if (type === "change") appStateListener = cb;
      return {
        remove: jest.fn(() => {
          if (appStateListener === cb) appStateListener = null;
        }),
      };
    });

    backHandlerStack = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") backHandlerStack.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = backHandlerStack.indexOf(cb);
          if (idx !== -1) backHandlerStack.splice(idx, 1);
        }),
      };
    });

    jest.spyOn(Alert, "alert");
    jest.spyOn(Vibration, "vibrate");
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
      renderer = null;
    }
    Date.now = originalDateNow;
  });

  const triggerBackPress = async () => {
    if (backHandlerStack.length === 0) return false;
    let result;
    await act(async () => {
      result = backHandlerStack[backHandlerStack.length - 1]();
    });
    return result;
  };

  // =========================================================================
  // RW-1: Full Pomodoro cycle with background intervals (25m study -> 5m break)
  // =========================================================================
  it("RW-1: executes full Pomodoro cycle with background study and break intervals", async () => {
    const POMODORO_25_5 = {
      label: "Pomodoro 25/5",
      phases: [
        { name: "Deep Focus", duration: 25, isBreak: false, emoji: "📖" },
        { name: "Short Break", duration: 5, isBreak: true, emoji: "☕" },
      ],
    };

    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={POMODORO_25_5}
            subject="Algorithms"
            subjectColor="#3b82f6"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // 1. User starts session
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 25 * 60;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={POMODORO_25_5}
            subject="Algorithms"
            subjectColor="#3b82f6"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // 2. User backgrounds device during study phase
    await act(async () => {
      appStateListener("background");
    });

    // 25 minutes pass in background: Phase 0 finishes, auto-advances to Phase 1 (break)
    currentTime += 25 * 60 * 1000;

    // 3. User checks app: app re-enters active state
    await act(async () => {
      appStateListener("active");
    });

    // Timer restarts for break phase (5 mins remaining)
    expect(mockTimerState.restart).toHaveBeenCalledWith(5 * 60);

    // 4. User backgrounds app again for 5-minute break
    await act(async () => {
      appStateListener("background");
    });

    currentTime += 5 * 60 * 1000;

    // 5. Break finishes in background and user opens app
    await act(async () => {
      appStateListener("active");
    });

    // Session finished cleanly
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStudyMins: 25, // 25m study credited, break not credited
      })
    );

    // 6. Record session in history
    const saved = await saveSession({
      label: POMODORO_25_5.label,
      subject: "Algorithms",
      totalStudyMins: 25,
      actualStudyMins: 25,
      startedAt: new Date(currentTime - 30 * 60 * 1000).toISOString(),
      completed: true,
    });
    expect(saved.id).toBeDefined();

    const history = await loadSessions();
    expect(history.length).toBe(1);
    expect(history[0].actualStudyMins).toBe(25);
  });

  // =========================================================================
  // RW-2: Multi-phase study session completing while asleep in background
  // =========================================================================
  it("RW-2: multi-phase study session completes while asleep in background without late alarms", async () => {
    const THREE_PHASE_SESSION = {
      label: "Evening Block",
      phases: [
        { name: "Study 1", duration: 20, isBreak: false, emoji: "📖" },
        { name: "Rest", duration: 5, isBreak: true, emoji: "☕" },
        { name: "Study 2", duration: 15, isBreak: false, emoji: "📝" },
      ],
    };

    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={THREE_PHASE_SESSION}
            subject="Computer Architecture"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // Start timer
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 20 * 60;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={THREE_PHASE_SESSION}
            subject="Computer Architecture"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // User locks screen and falls asleep
    await act(async () => {
      appStateListener("background");
    });

    // 8 hours (480 minutes) elapse overnight
    currentTime += 480 * 60 * 1000;

    // User wakes up and unlocks device
    await act(async () => {
      appStateListener("active");
    });

    // Both study phases credited (20 + 15 = 35 mins), break ignored
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStudyMins: 35,
      })
    );

    // Suppress late alarms and vibration
    expect(mockPlayAlarm).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  // =========================================================================
  // RW-3: Manual mode session halting at phase boundary
  // =========================================================================
  it("RW-3: manual mode session halts cleanly at phase boundary when autoAdvance is false", async () => {
    await saveSettings({ autoAdvance: false });

    const TWO_PHASE = {
      label: "Manual Paced",
      phases: [
        { name: "Focus 1", duration: 20, isBreak: false, emoji: "📖" },
        { name: "Rest", duration: 5, isBreak: true, emoji: "☕" },
      ],
    };

    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={TWO_PHASE}
            subject="Linear Algebra"
            subjectColor="#6366f1"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // Wait for settings to load
    await act(async () => {
      await Promise.resolve();
    });

    // Start timer
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 20 * 60;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={TWO_PHASE}
            subject="Linear Algebra"
            subjectColor="#6366f1"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // App goes to background for 30 minutes
    await act(async () => {
      appStateListener("background");
    });

    currentTime += 30 * 60 * 1000;

    // User re-opens app
    await act(async () => {
      appStateListener("active");
    });

    // In manual mode, it must halt at phase boundary (awaiting user to manually start break)
    expect(onComplete).not.toHaveBeenCalled();
    // Phase 1 (break) loaded with full duration
    expect(mockTimerState.loadDuration).toHaveBeenCalledWith(5 * 60);
  });

  // =========================================================================
  // RW-4: Interrupted session recovery and partial quit via hardware back button
  // =========================================================================
  it("RW-4: handles interrupted session with partial quit and accurate time crediting via hardware back", async () => {
    const DEEP_STUDY = {
      label: "Extended Deep Work",
      phases: [
        { name: "Intensive 45", duration: 45, isBreak: false, emoji: "🧠" },
      ],
    };

    const onPartialQuit = jest.fn();
    const onGoHome = jest.fn();

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={DEEP_STUDY}
            subject="Distributed Systems"
            subjectColor="#ec4899"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // Start timer
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 45 * 60;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={DEEP_STUDY}
            subject="Distributed Systems"
            subjectColor="#ec4899"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // 18.5 minutes elapse
    currentTime += 18.5 * 60 * 1000;
    await act(async () => {
      mockTimerState.secondsLeft = Math.round((45 - 18.5) * 60);
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={DEEP_STUDY}
            subject="Distributed Systems"
            subjectColor="#ec4899"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // User taps Android hardware back button
    await triggerBackPress();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Leave Session?",
      expect.any(String),
      expect.any(Array)
    );

    // User confirms "Leave"
    const leaveBtn = Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave");
    await act(async () => {
      leaveBtn.onPress();
    });

    // Partial quit credited accurately (18.5 mins)
    expect(onPartialQuit).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStudyMins: 18.5,
      })
    );

    // Save partial session and verify history calculation
    await saveSession({
      label: DEEP_STUDY.label,
      subject: "Distributed Systems",
      totalStudyMins: 45,
      actualStudyMins: 18.5,
      startedAt: new Date(currentTime - 18.5 * 60000).toISOString(),
      completed: false,
    });

    const sessions = await loadSessions();
    expect(sessions[0].actualStudyMins).toBe(18.5);
  });

  // =========================================================================
  // RW-5: Session save error and successful retry in DoneScreen
  // =========================================================================
  it("RW-5: recovers gracefully from DoneScreen save failure and persists on user retry", async () => {
    // 1. Initial attempt fails due to storage fault
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("Disk IO Error"));

    const onGoHome = jest.fn();
    const session = {
      label: "Sprint 30",
      phases: [{ name: "Study", duration: 30, isBreak: false, emoji: "🚀" }],
    };
    const sessionMeta = {
      sessionKey: "sprint_30",
      subject: "Quantum Computing",
      actualStudyMins: 30,
    };

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={session}
            sessionMeta={sessionMeta}
            onGoHome={onGoHome}
          />
        </ThemeProvider>
      );
    });

    // Let the initial save rejection settle
    await act(async () => {
      await Promise.resolve();
    });

    // Warning banner rendered with retry button
    const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
    expect(retryBtn).toBeDefined();

    // 2. User presses Retry — mock succeeds
    await act(async () => {
      await retryBtn.props.onPress();
    });

    // Verify session was persisted
    const sessions = await loadSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].subject).toBe("Quantum Computing");
    expect(sessions[0].actualStudyMins).toBe(30);

    // User taps "Back to Home"
    const homeBtn = renderer.root
      .findAllByType(TouchableOpacity)
      .find((node) => node.props.onPress === onGoHome);
    expect(homeBtn).toBeDefined();
    await act(async () => {
      homeBtn.props.onPress();
    });
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // RW-6: Custom session template creation, duplication with 64-char cap, subject assignment
  // =========================================================================
  it("RW-6: creates custom template, duplicates with 64-char cap, assigns subject, and inspects history", async () => {
    // 1. Create custom template with realistic name
    const templateName = "Neuroscience Deep Work";
    const savedTemplate = await saveTemplate({
      label: templateName,
      phases: [
        { name: "Focus 1", duration: 40, isBreak: false, emoji: "🧠" },
        { name: "Coffee", duration: 10, isBreak: true, emoji: "☕" },
      ],
    });
    expect(savedTemplate.label).toBe("Neuroscience Deep Work");

    // 2. Duplicate template: appends " Copy" and respects 64-char limit
    const duplicated = await duplicateTemplate(savedTemplate.id);
    expect(duplicated).not.toBeNull();
    expect(duplicated.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(duplicated.label).toBe("Neuroscience Deep Work Copy");

    // Also verify 64-char capping on ultra-long template duplication
    const longTemplate = await saveTemplate({
      label: "A".repeat(80),
      phases: [{ name: "Study", duration: 25, isBreak: false }],
    });
    expect(longTemplate.label.length).toBe(MAX_NAME_LENGTH);
    const duplicatedLong = await duplicateTemplate(longTemplate.id);
    expect(duplicatedLong.label.length).toBe(MAX_NAME_LENGTH);

    // 3. Register custom subject
    await saveSubject("Neurobiology");
    const subjects = await loadSubjects();
    expect(subjects.some((s) => s.name === "Neurobiology")).toBe(true);

    // 4. Save session using this template
    await saveSession({
      label: duplicated.label,
      subject: "Neurobiology",
      totalStudyMins: 40,
      actualStudyMins: 40,
    });

    const history = await loadSessions();
    expect(history.length).toBe(1);
    expect(history[0].label).toBe(duplicated.label);
    expect(history[0].subject).toBe("Neurobiology");
  });

  // =========================================================================
  // RW-7: Rapid app navigation churn and startup notification cleanup
  // =========================================================================
  it("RW-7: performs startup notification cleanup and survives rapid navigation tab churn", async () => {
    // 1. Launch App.js
    await act(async () => {
      renderer = create(<App />);
    });

    // Startup notification cleanup called
    expect(mockCancelSessionNotifications).toHaveBeenCalled();

    // 2. Rapid tab switching
    const tabs = ["Stats", "History", "Settings", "Home"];
    for (const tabLabel of tabs) {
      await act(async () => {
        const tabBtn = renderer.root.findAll(
          (node) => node.props.accessibilityLabel === tabLabel
        );
        if (tabBtn.length > 0) {
          tabBtn[0].props.onPress();
        }
      });
    }

    // 3. Hardware back press at root Home tab checks exit logic
    const handled = await triggerBackPress();
    expect(typeof handled).toBe("boolean");
  });

  // =========================================================================
  // RW-8: Storage corruption recovery and defense-in-depth sanitization
  // =========================================================================
  it("RW-8: gracefully sanitizes corrupted storage and handles invalid boundary schemas", async () => {
    // Inject corrupt JSON into storage keys
    await AsyncStorage.setItem(SETTINGS_KEY, "{ invalid json corrupt !! ");
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify("not-an-array"));
    await AsyncStorage.setItem(SUBJECTS_KEY, "null");
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify([null, { id: 123 }]));

    // 1. loadSettings returns defaults
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);

    // 2. loadSessions recovers empty array
    const sessions = await loadSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(0);

    // 3. loadSubjects recovers empty array or defaults
    const subjects = await loadSubjects();
    expect(Array.isArray(subjects)).toBe(true);

    // 4. loadTemplates recovers empty array
    const templates = await loadTemplates();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBe(0);

    // 5. App components render without throwing when storage is corrupted
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <HomeScreen
            onStartSession={jest.fn()}
            onSelectCustomTemplate={jest.fn()}
            onOpenTemplateManager={jest.fn()}
            onOpenStats={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.length).toBeGreaterThan(0);
  });
});
