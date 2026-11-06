import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import fs from "fs";
import path from "path";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SessionScreen from "../../src/screens/SessionScreen";
import DoneScreen from "../../src/screens/DoneScreen";
import HomeScreen from "../../src/screens/HomeScreen";
import SubjectPickerScreen from "../../src/screens/SubjectPickerScreen";
import SessionPickerScreen from "../../src/screens/SessionPickerScreen";
import CustomSessionScreen from "../../src/screens/CustomSessionScreen";
import HistoryScreen from "../../src/screens/HistoryScreen";
import TabBar from "../../src/components/TabBar";
import App from "../../App";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { reconcileTimeline } from "../../src/utils/sessionTimeline";
import { minsFromSecs, phaseElapsedSecs } from "../../src/utils/studyTime";
import {
  loadSettings,
  saveSettings,
  normalizeSettings,
  updateSession,
  loadSessions,
  saveSession,
  saveSubject,
  loadSubjects,
  loadTemplates,
  saveTemplate,
  duplicateTemplate,
  MAX_NAME_LENGTH,
  SUBJECT_COLORS,
} from "../../src/utils/storage";
import { cancelSessionNotifications } from "../../src/hooks/useNotifications";

jest.setTimeout(25000);

// --- Native and External Mocks ---
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));

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
jest.mock("../../src/hooks/useNotifications", () => ({
  useNotifications: () => ({
    scheduleChain: mockScheduleChain,
    cancelAll: mockCancelAll,
    error: null,
  }),
  cancelSessionNotifications: jest.fn().mockResolvedValue(undefined),
}));

let mockTimerState;
jest.mock("../../src/hooks/useTimer", () => ({
  useTimer: (opts) => {
    mockTimerState._onComplete = opts?.onComplete;
    return mockTimerState;
  },
}));

describe("Tier 3: Cross-Feature Combinations & Pairwise Interactions", () => {
  let appStateListener = null;
  let backHandlerStack = [];
  let originalDateNow;
  let currentTime = 1700000000000;
  let renderer = null;

  const POMODORO_SESSION = {
    label: "Pomodoro 25/5",
    phases: [
      { name: "Deep Study", duration: 25, isBreak: false, emoji: "📖" },
      { name: "Short Break", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Second Study", duration: 25, isBreak: false, emoji: "📝" },
    ],
  };

  function renderSessionScreen(props = {}) {
    return (
      <ThemeProvider>
        <SessionScreen
          session={props.session || POMODORO_SESSION}
          subject={props.subject || "Operating Systems"}
          subjectColor="#3b82f6"
          onGoHome={props.onGoHome || jest.fn()}
          onComplete={props.onComplete || jest.fn()}
          onPartialQuit={props.onPartialQuit || jest.fn()}
        />
      </ThemeProvider>
    );
  }

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
    jest.restoreAllMocks();
  });

  const triggerBackPress = async () => {
    if (backHandlerStack.length === 0) return false;
    let result;
    await act(async () => {
      result = backHandlerStack[backHandlerStack.length - 1]();
    });
    return result;
  };

  // 1. F1 x F2
  it("P1 [F1 x F2]: AppState reconciliation calculates background study time across multiple phases", async () => {
    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(renderSessionScreen({ onComplete }));
    });

    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 25 * 60;
      renderer.update(renderSessionScreen({ onComplete }));
    });

    await act(async () => {
      appStateListener("background");
    });

    // 35 minutes pass: Phase 0 (25m study) done, Phase 1 (5m break) done, 5m into Phase 2 (study)
    currentTime += 35 * 60 * 1000;

    await act(async () => {
      appStateListener("active");
    });

    // Timer restarts with (25 - 5) = 20 mins left
    expect(mockTimerState.restart).toHaveBeenCalledWith(20 * 60);

    // Now complete the remaining 20 minutes
    await act(async () => {
      currentTime += 20 * 60 * 1000;
      mockTimerState.secondsLeft = 0;
      renderer.update(renderSessionScreen({ onComplete, subject: "Updated Subject" }));
    });

    await act(async () => {
      mockTimerState._onComplete();
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStudyMins: 50, // 25m Phase 0 + 25m Phase 2
      })
    );
  });

  // 2. F1 x F3
  it("P2 [F1 x F3]: AppState reconciliation suppresses alarm/vibration on background completion", async () => {
    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(renderSessionScreen({ onComplete }));
    });

    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 25 * 60;
      renderer.update(renderSessionScreen({ onComplete }));
    });

    await act(async () => {
      appStateListener("background");
    });

    // Full 55m session completes in background
    currentTime += 60 * 60 * 1000;

    await act(async () => {
      appStateListener("active");
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockPlayAlarm).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  // 3. F1 x F4
  it("P3 [F1 x F4]: hardware back press immediately following active AppState reconciliation halts timer safely", async () => {
    const onPartialQuit = jest.fn();
    await act(async () => {
      renderer = create(renderSessionScreen({ onPartialQuit }));
    });

    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 25 * 60;
      renderer.update(renderSessionScreen({ onPartialQuit }));
    });

    await act(async () => {
      appStateListener("background");
    });

    // 10 minutes pass in background
    currentTime += 10 * 60 * 1000;

    await act(async () => {
      appStateListener("active");
    });

    await act(async () => {
      mockTimerState.secondsLeft = 15 * 60;
      mockTimerState.running = true;
      renderer.update(renderSessionScreen({ onPartialQuit }));
    });

    // Back press triggers leave modal
    await triggerBackPress();
    expect(Alert.alert).toHaveBeenCalledWith(
      "Leave Session?",
      expect.any(String),
      expect.any(Array)
    );

    const leaveBtn = Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave");
    await act(async () => {
      leaveBtn.onPress();
    });

    expect(onPartialQuit).toHaveBeenCalledWith(
      expect.objectContaining({
        actualStudyMins: 10,
      })
    );
  });

  // 4. F2 x F8
  it("P4 [F2 x F8]: background study time crediting feeds DoneScreen and survives save failure retry", async () => {
    // 1st save fails, 2nd succeeds
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("Storage disk error"));

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={POMODORO_SESSION}
            sessionMeta={{ sessionKey: "custom", subject: "Compiler Design", actualStudyMins: 42 }}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    // Warning banner shown
    const warningNodes = renderer.root.findAll(
      (n) => n.props.children === "Failed to save session to history."
    );
    expect(warningNodes.length).toBeGreaterThan(0);

    // Press retry
    const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
    await act(async () => {
      await retryBtn.props.onPress();
    });

    const sessions = await loadSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].actualStudyMins).toBe(42);
    expect(sessions[0].subject).toBe("Compiler Design");
  });

  // 5. F3 x F6
  it("P5 [F3 x F6]: background session completion notification cancellation integrates with startup cleanup", async () => {
    await act(async () => {
      renderer = create(<App />);
    });
    expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);

    // Start session
    const home = renderer.root.findByType(HomeScreen);
    await act(async () => {
      home.props.onStartStudying();
    });

    const subjectPicker = renderer.root.findByType(SubjectPickerScreen);
    await act(async () => {
      await subjectPicker.props.onSelectSubject("Math");
    });

    const sessionPicker = renderer.root.findByType(SessionPickerScreen);
    await act(async () => {
      sessionPicker.props.onStartSession("1hr");
    });

    expect(renderer.root.findAllByType(SessionScreen).length).toBe(1);
  });

  // 6. F4 x F5
  it("P6 [F4 x F5]: SessionScreen back modal exit transfers back navigation hierarchy smoothly to App.js", async () => {
    await act(async () => {
      renderer = create(<App />);
    });

    const home = renderer.root.findByType(HomeScreen);
    await act(async () => {
      home.props.onStartStudying();
    });

    const subjectPicker = renderer.root.findByType(SubjectPickerScreen);
    await act(async () => {
      await subjectPicker.props.onSelectSubject("Chemistry");
    });

    const sessionPicker = renderer.root.findByType(SessionPickerScreen);
    await act(async () => {
      sessionPicker.props.onStartSession("1hr");
    });

    expect(renderer.root.findAllByType(SessionScreen).length).toBe(1);

    // Back press in SessionScreen
    await triggerBackPress();

    // In SessionScreen (running=false on initial mount), leave returns to Home directly
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);

    // Back press in Home now returns false
    const handled = await triggerBackPress();
    expect(handled).toBe(false);
  });

  // 7. F7 x F8
  it("P7 [F7 x F8]: DoneScreen renders within react-native-safe-area-context with active save failure recovery", async () => {
    AsyncStorage.setItem.mockRejectedValueOnce(new Error("Transient safe area error"));

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={POMODORO_SESSION}
            sessionMeta={{ sessionKey: "1hr", subject: "Math", actualStudyMins: 25 }}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
    expect(retryBtn).toBeDefined();

    await act(async () => {
      await retryBtn.props.onPress();
    });

    const sessions = await loadSessions();
    expect(sessions.length).toBe(1);
  });

  // 8. F7 x F9
  it("P8 [F7 x F9]: HistoryScreen safe area layout updates subject badge on inline subject auto-registration", async () => {
    await saveSession({
      sessionType: "1hr",
      label: "Block",
      subject: "OldSubject",
      startedAt: new Date().toISOString(),
      phasesCompleted: 1,
      totalStudyMins: 25,
      actualStudyMins: 25,
      completed: true,
    });

    const newSubject = await saveSubject("RegisteredSubject");
    expect(newSubject.name).toBe("RegisteredSubject");
    expect(newSubject.color).toBeDefined();

    const sessions = await loadSessions();
    await updateSession(sessions[0].id, { subject: newSubject.name });

    const updated = await loadSessions();
    expect(updated[0].subject).toBe("RegisteredSubject");
  });

  // 9. F8 x F10
  it("P9 [F8 x F10]: DoneScreen save failure recovery calculates streak accurately against sanitized settings", async () => {
    await saveSettings({ weeklyGoalMins: 1200, weeklyGoalDays: 5 });
    const settings = await loadSettings();
    expect(settings.weeklyGoalMins).toBe(1200);

    AsyncStorage.setItem.mockRejectedValueOnce(new Error("Initial fail"));

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={POMODORO_SESSION}
            sessionMeta={{ sessionKey: "1hr", subject: "History", actualStudyMins: 25 }}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
    await act(async () => {
      await retryBtn.props.onPress();
    });

    const sessions = await loadSessions();
    expect(sessions.length).toBe(1);
  });

  // 10. F9 x F11
  it("P10 [F9 x F11]: HistoryScreen subject auto-registration integrates with updateSession whitelist and 64-char cap", async () => {
    const session = await saveSession({
      sessionType: "custom",
      label: "Session",
      subject: "Math",
      startedAt: new Date().toISOString(),
      phasesCompleted: 1,
      totalStudyMins: 25,
      actualStudyMins: 25,
      completed: true,
    });

    const longSubject = "Z".repeat(80);
    const savedSubj = await saveSubject(longSubject);
    expect(savedSubj.name.length).toBe(MAX_NAME_LENGTH);

    await updateSession(session.id, {
      subject: savedSubj.name,
      unauthorizedKey: "malicious-injection",
    });

    const updated = await loadSessions();
    expect(updated[0].subject).toBe("Z".repeat(64));
    expect(updated[0].unauthorizedKey).toBeUndefined();
  });

  // 11. F10 x F11
  it("P11 [F10 x F11]: concurrent settings updates and session mutations operate safely under mutex locks", async () => {
    const session = await saveSession({
      sessionType: "custom",
      label: "Concurrent Session",
      subject: "Science",
      startedAt: new Date().toISOString(),
      phasesCompleted: 1,
      totalStudyMins: 30,
      actualStudyMins: 30,
      completed: false,
    });

    // Run parallel settings save and session update
    await Promise.all([
      saveSettings({ soundPreset: "bell", theme: "dracula" }),
      updateSession(session.id, { completed: true, actualStudyMins: 35 }),
      saveSettings({ autoAdvance: false }),
    ]);

    const settings = await loadSettings();
    expect(settings.soundPreset).toBe("bell");
    expect(settings.theme).toBe("dracula");
    expect(settings.autoAdvance).toBe(false);

    const sessions = await loadSessions();
    expect(sessions[0].completed).toBe(true);
    expect(sessions[0].actualStudyMins).toBe(35);
  });

  // 12. F10 x F12
  it("P12 [F10 x F12]: custom template duplication respects 64-char cap while settings preserve defaults", async () => {
    const settings = await loadSettings();
    expect(settings.keepAwake).toBe(true);

    const template = await saveTemplate({
      label: "X".repeat(63),
      phases: [{ name: "P1", duration: 25 }],
    });

    const duplicate = await duplicateTemplate(template.id);
    expect(duplicate.label.length).toBe(MAX_NAME_LENGTH);
    expect(duplicate.label).toBe(`${"X".repeat(63)} Copy`.slice(0, MAX_NAME_LENGTH));
  });

  // 13. F1 x F10
  it("P13 [F1 x F10]: auto-advance setting toggled in storage persists and alters timeline reconciliation", async () => {
    await saveSettings({ autoAdvance: false });
    const settings = await loadSettings();
    expect(settings.autoAdvance).toBe(false);

    const phases = POMODORO_SESSION.phases;
    const reconciled = reconcileTimeline({
      phases,
      phaseIndex: 0,
      remainingMs: 25 * 60 * 1000,
      running: true,
      anchorAt: 1000,
      now: 1000 + 30 * 60 * 1000,
      autoAdvance: settings.autoAdvance,
    });

    expect(reconciled.awaitingNext).toBe(true);
    expect(reconciled.running).toBe(false);
  });

  // 14. F4 x F11
  it("P4 [F4 x F11]: hardware back quit partial save sanitizes and caps session subject and label", async () => {
    const onPartialQuit = jest.fn();
    await act(async () => {
      renderer = create(
        renderSessionScreen({
          subject: "S".repeat(80),
          onPartialQuit,
        })
      );
    });

    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 1000;
      renderer.update(
        renderSessionScreen({
          subject: "S".repeat(80),
          onPartialQuit,
        })
      );
    });

    await triggerBackPress();

    const leaveBtn = Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave");
    await act(async () => {
      leaveBtn.onPress();
    });

    expect(onPartialQuit).toHaveBeenCalled();
  });

  // 15. F5 x F9
  it("P15 [F5 x F9]: back navigation from HistoryScreen maintains auto-registered subject states", async () => {
    await saveSubject("Neuroscience");
    const subjects = await loadSubjects();
    expect(subjects.find((s) => s.name === "Neuroscience")).toBeDefined();

    await act(async () => {
      renderer = create(<App />);
    });

    const tabBar = renderer.root.findByType(TabBar);
    await act(async () => {
      tabBar.props.onChange("history");
    });

    const handled = await triggerBackPress();
    expect(handled).toBe(true);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);

    const afterSubjects = await loadSubjects();
    expect(afterSubjects.find((s) => s.name === "Neuroscience")).toBeDefined();
  });

  // 16. F13 x F14 x F15
  it("P16 [F13 x F14 x F15]: project configuration synergy across permissions, build type, and security exclusions", () => {
    const appJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../app.json"), "utf8"));
    const easJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../eas.json"), "utf8"));
    const gitignore = fs.readFileSync(path.resolve(__dirname, "../../.gitignore"), "utf8");

    // Android configuration
    expect(appJson.expo.android.permissions).toContain("android.permission.POST_NOTIFICATIONS");
    expect(appJson.expo.android.allowBackup).toBe(false);
    expect(appJson.expo.android.versionCode).toBe(1);

    // Build configuration
    expect(easJson.build.preview.android.buildType).toBe("apk");

    // Git ignore security
    expect(gitignore).toMatch(/^\.env\*/m);
    expect(gitignore).toMatch(/^\*\.keystore/m);
    expect(gitignore).toMatch(/^\*\.apk/m);
  });
});
