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
import TabBar from "../../src/components/TabBar";
import App from "../../App";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { reconcileTimeline } from "../../src/utils/sessionTimeline";
import { minsFromSecs } from "../../src/utils/studyTime";
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

describe("Tier 1: Feature Coverage (F1 through F15)", () => {
  let appStateListener = null;
  let backHandlerStack = [];
  let originalDateNow;
  let currentTime = 1700000000000;
  let renderer = null;

  const SAMPLE_SESSION = {
    label: "Pomodoro 25/5",
    phases: [
      { name: "Deep Study", duration: 25, isBreak: false, emoji: "📖" },
      { name: "Short Break", duration: 5, isBreak: true, emoji: "☕" },
    ],
  };

  const MULTI_PHASE_SESSION = {
    label: "3-Phase Intensive",
    phases: [
      { name: "Study 1", duration: 20, isBreak: false, emoji: "📖" },
      { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Study 2", duration: 15, isBreak: false, emoji: "📝" },
    ],
  };

  function renderSessionScreen(props = {}) {
    return (
      <ThemeProvider>
        <SessionScreen
          session={props.session || SAMPLE_SESSION}
          subject={props.subject || "Computer Science"}
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

  // ==========================================
  // F1: AppState Active Reconciliation
  // ==========================================
  describe("F1: AppState Active Reconciliation", () => {
    it("F1-1: reconciles active session timing when AppState transitions background -> active while running", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen());
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 300 * 1000; // 5 minutes

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(1200);
      expect(mockTimerState.running).toBe(true);
    });

    it("F1-2: reconciles active session timing when AppState transitions inactive -> active", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen());
      });

      await act(async () => {
        appStateListener("inactive");
      });

      currentTime += 120 * 1000; // 2 minutes

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(1380);
    });

    it("F1-3: ignores AppState transition to active if timer was paused (running === false)", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1500;

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 600 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).not.toHaveBeenCalled();
      expect(mockTimerState.loadDuration).toHaveBeenCalledTimes(1);
    });

    it("F1-4: updates timeline anchor when entering background to accurately anchor elapsed time", () => {
      const phases = SAMPLE_SESSION.phases;
      const anchorAt = 1000;
      const remainingMs = 1500 * 1000;

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs,
        running: true,
        anchorAt,
        now: anchorAt + 500000,
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(0);
      expect(reconciled.remainingMs).toBe(remainingMs - 500000);
      expect(reconciled.finished).toBe(false);
    });

    it("F1-5: reconciles multi-phase timeline progression across background duration with autoAdvance", () => {
      const phases = MULTI_PHASE_SESSION.phases;
      const anchorAt = 1000;
      const remainingMs = 120 * 1000;
      const elapsedMs = 10 * 60 * 1000;

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs,
        running: true,
        anchorAt,
        now: anchorAt + elapsedMs,
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(2);
      expect(reconciled.remainingMs).toBe((15 - 3) * 60 * 1000);
      expect(reconciled.advancedPhases).toEqual([
        { index: 0, completed: true },
        { index: 1, completed: true },
      ]);
      expect(reconciled.finished).toBe(false);
    });
  });

  // ==========================================
  // F2: Background Study Time Crediting
  // ==========================================
  describe("F2: Background Study Time Crediting", () => {
    it("F2-1: credits full study phase duration when study phase completes in background", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ session: SAMPLE_SESSION, onComplete }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen({ session: SAMPLE_SESSION, onComplete }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 26 * 60 * 1000; // 26 minutes

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(4 * 60);

      await act(async () => {
        currentTime += 4 * 60 * 1000;
        mockTimerState._onComplete();
      });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          actualStudyMins: 25,
        })
      );
    });

    it("F2-2: does NOT credit study time for completed break phases during background duration", () => {
      const phases = MULTI_PHASE_SESSION.phases;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 1,
        remainingMs: 5 * 60 * 1000,
        running: true,
        anchorAt: 1000,
        now: 1000 + 6 * 60 * 1000,
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(2);
      expect(reconciled.advancedPhases).toEqual([{ index: 1, completed: true }]);
      const creditedStudySecs = reconciled.advancedPhases
        .filter((adv) => adv.completed && !phases[adv.index].isBreak)
        .reduce((sum, adv) => sum + phases[adv.index].duration * 60, 0);

      expect(creditedStudySecs).toBe(0);
    });

    it("F2-3: credits multiple study phases completed during a prolonged background duration", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ session: MULTI_PHASE_SESSION, onComplete }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 20 * 60;
        renderer.update(renderSessionScreen({ session: MULTI_PHASE_SESSION, onComplete }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 45 * 60 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          actualStudyMins: 35,
        })
      );
    });

    it("F2-4: credits study time accurately when user quits after partial background progression", async () => {
      const onPartialQuit = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ session: SAMPLE_SESSION, onPartialQuit }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 25 * 60;
        renderer.update(renderSessionScreen({ session: SAMPLE_SESSION, onPartialQuit }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 10 * 60 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      await act(async () => {
        mockTimerState.secondsLeft = 15 * 60;
        mockTimerState.running = true;
        renderer.update(renderSessionScreen({ session: SAMPLE_SESSION, onPartialQuit }));
      });

      await triggerBackPress();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Leave Session?",
        expect.any(String),
        expect.any(Array)
      );

      const alertButtons = Alert.alert.mock.calls[0][2];
      const leaveBtn = alertButtons.find((b) => b.text === "Leave");
      await act(async () => {
        leaveBtn.onPress();
      });

      expect(onPartialQuit).toHaveBeenCalledWith(
        expect.objectContaining({
          actualStudyMins: 10,
        })
      );
    });

    it("F2-5: converts study seconds to study minutes accurately via minsFromSecs", () => {
      expect(minsFromSecs(0)).toBe(0);
      expect(minsFromSecs(6)).toBe(0.1);
      expect(minsFromSecs(30)).toBe(0.5);
      expect(minsFromSecs(60)).toBe(1);
      expect(minsFromSecs(90)).toBe(1.5);
      expect(minsFromSecs(1500)).toBe(25);
      expect(minsFromSecs(3600)).toBe(60);
    });
  });

  // ==========================================
  // F3: Clean Reconciliation Branching
  // ==========================================
  describe("F3: Clean Reconciliation Branching", () => {
    it("F3-1: finishes session cleanly without late alarms or vibration when completed in background", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ session: SAMPLE_SESSION, onComplete }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 25 * 60;
        renderer.update(renderSessionScreen({ session: SAMPLE_SESSION, onComplete }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 35 * 60 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(mockPlayAlarm).not.toHaveBeenCalled();
      expect(Vibration.vibrate).not.toHaveBeenCalled();
    });

    it("F3-2: pauses at phase boundary and enters awaitingNext state when autoAdvance is false", () => {
      const phases = SAMPLE_SESSION.phases;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 25 * 60 * 1000,
        running: true,
        anchorAt: 1000,
        now: 1000 + 26 * 60 * 1000,
        autoAdvance: false,
      });

      expect(reconciled.phaseIndex).toBe(1);
      expect(reconciled.awaitingNext).toBe(true);
      expect(reconciled.running).toBe(false);
      expect(reconciled.remainingMs).toBe(5 * 60 * 1000);
      expect(reconciled.finished).toBe(false);
    });

    it("F3-3: restarts timer with exact remaining seconds when still in current phase upon resume", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen());
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 45500;

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(1455);
      expect(mockPlayAlarm).not.toHaveBeenCalled();
    });

    it("F3-4: advances phaseIndex and restarts timer with remaining seconds of new phase", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen({ session: SAMPLE_SESSION }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen({ session: SAMPLE_SESSION }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 26 * 60 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(240);
    });

    it("F3-5: resets timeline anchor to 0 remaining ms when session finishes in background", () => {
      const phases = SAMPLE_SESSION.phases;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 1500 * 1000,
        running: true,
        anchorAt: 1000,
        now: 1000 + 40 * 60 * 1000,
        autoAdvance: true,
      });

      expect(reconciled.finished).toBe(true);
      expect(reconciled.remainingMs).toBe(0);
      expect(reconciled.running).toBe(false);
    });
  });

  // ==========================================
  // F4: Hardware Back Button in SessionScreen
  // ==========================================
  describe("F4: Hardware Back Button in SessionScreen", () => {
    it("F4-1: subscribes to hardwareBackPress on mount and unregisters on unmount", async () => {
      const initialStackLen = backHandlerStack.length;

      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      expect(backHandlerStack.length).toBe(initialStackLen + 1);

      await act(async () => {
        renderer.unmount();
        renderer = null;
      });

      expect(backHandlerStack.length).toBe(initialStackLen);
    });

    it("F4-2: hardware back press callback returns true to consume the event", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      const handled = await triggerBackPress();
      expect(handled).toBe(true);
    });

    it("F4-3: prompts confirmation Alert ('Leave Session?') when timer is running", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        renderer.update(renderSessionScreen());
      });

      await triggerBackPress();

      expect(Alert.alert).toHaveBeenCalledWith(
        "Leave Session?",
        "Your timer is still running. Your progress will be saved.",
        expect.arrayContaining([
          expect.objectContaining({ text: "Cancel", style: "cancel" }),
          expect.objectContaining({ text: "Leave", style: "destructive" }),
        ])
      );
    });

    it("F4-4: confirming 'Leave' in alert halts timer, cancels notifications, and quits", async () => {
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onGoHome }));
      });

      await act(async () => {
        mockTimerState.running = true;
        renderer.update(renderSessionScreen({ onGoHome }));
      });

      await triggerBackPress();

      const buttons = Alert.alert.mock.calls[0][2];
      const leaveBtn = buttons.find((b) => b.text === "Leave");

      await act(async () => {
        leaveBtn.onPress();
      });

      expect(mockTimerState.stop).toHaveBeenCalled();
      expect(mockCancelAll).toHaveBeenCalled();
      expect(onGoHome).toHaveBeenCalled();
    });

    it("F4-5: canceling the alert keeps the timer running and does not exit", async () => {
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onGoHome }));
      });

      await act(async () => {
        mockTimerState.running = true;
        renderer.update(renderSessionScreen({ onGoHome }));
      });

      await triggerBackPress();

      const buttons = Alert.alert.mock.calls[0][2];
      const cancelBtn = buttons.find((b) => b.text === "Cancel");
      if (cancelBtn.onPress) {
        await act(async () => {
          cancelBtn.onPress();
        });
      }

      expect(mockTimerState.stop).not.toHaveBeenCalled();
      expect(onGoHome).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // F5: Screen Hierarchy Back Navigation
  // ==========================================
  describe("F5: Screen Hierarchy Back Navigation", () => {
    it("F5-1: on custom-session-builder screen, back navigates to session-picker and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

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
        sessionPicker.props.onOpenCustomSession();
      });

      expect(renderer.root.findAllByType(CustomSessionScreen).length).toBe(1);

      const handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(SessionPickerScreen).length).toBe(1);
    });

    it("F5-2: on session-picker screen, back navigates to subject-picker and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const home = renderer.root.findByType(HomeScreen);
      await act(async () => {
        home.props.onStartStudying();
      });

      const subjectPicker = renderer.root.findByType(SubjectPickerScreen);
      await act(async () => {
        await subjectPicker.props.onSelectSubject("Math");
      });

      expect(renderer.root.findAllByType(SessionPickerScreen).length).toBe(1);

      const handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(SubjectPickerScreen).length).toBe(1);
    });

    it("F5-3: on subject-picker, stats, history, settings, back navigates to home and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const home = renderer.root.findByType(HomeScreen);
      await act(async () => {
        home.props.onStartStudying();
      });
      expect(renderer.root.findAllByType(SubjectPickerScreen).length).toBe(1);

      let handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);

      const tabBar = renderer.root.findByType(TabBar);
      await act(async () => {
        tabBar.props.onChange("settings");
      });

      handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    });

    it("F5-4: on home screen, back press returns false (allowing OS default back behavior)", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const handled = await triggerBackPress();
      expect(handled).toBe(false);
    });

    it("F5-5: App unmount unregisters the hardwareBackPress listener cleanly", async () => {
      const initialLen = backHandlerStack.length;
      await act(async () => {
        renderer = create(<App />);
      });
      expect(backHandlerStack.length).toBe(initialLen + 1);

      await act(async () => {
        renderer.unmount();
        renderer = null;
      });
      expect(backHandlerStack.length).toBe(initialLen);
    });
  });

  // ==========================================
  // F6: Startup Notification Cleanup
  // ==========================================
  describe("F6: Startup Notification Cleanup", () => {
    it("F6-1: invokes cancelSessionNotifications on root App component mount", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
    });

    it("F6-2: completes cleanly when notification cancellation resolves", async () => {
      cancelSessionNotifications.mockResolvedValueOnce(undefined);
      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalled();
    });

    it("F6-3: silently catches rejection when cancelSessionNotifications rejects without crashing", async () => {
      cancelSessionNotifications.mockRejectedValueOnce(new Error("Native permissions denied"));

      let appError = null;
      try {
        await act(async () => {
          renderer = create(<App />);
        });
      } catch (e) {
        appError = e;
      }

      expect(appError).toBeNull();
      expect(cancelSessionNotifications).toHaveBeenCalled();
    });

    it("F6-4: does not re-invoke cancelSessionNotifications upon internal screen transitions", async () => {
      await act(async () => {
        renderer = create(<App />);
      });
      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);

      const tabBar = renderer.root.findByType(TabBar);
      await act(async () => {
        tabBar.props.onChange("history");
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
    });

    it("F6-5: ensures clean initial state with zero pending notifications for subsequent timers", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(mockScheduleChain).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // F7: SafeAreaView Migration
  // ==========================================
  describe("F7: SafeAreaView Migration", () => {
    const screensToCheck = [
      "SubjectPickerScreen.js",
      "SessionPickerScreen.js",
      "CustomSessionScreen.js",
      "DoneScreen.js",
      "SessionScreen.js",
    ];

    screensToCheck.forEach((screenFileName, idx) => {
      it(`F7-${idx + 1}: ${screenFileName} imports SafeAreaView from react-native-safe-area-context and not react-native`, () => {
        const filePath = path.resolve(__dirname, "../../src/screens", screenFileName);
        const content = fs.readFileSync(filePath, "utf8");

        const hasSafeAreaContextImport =
          /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*["']react-native-safe-area-context["']/.test(
            content
          );
        const hasLegacyReactNativeImport =
          /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*["']react-native["']/.test(content);

        expect(hasSafeAreaContextImport).toBe(true);
        expect(hasLegacyReactNativeImport).toBe(false);
      });
    });
  });

  // ==========================================
  // F8: DoneScreen Save Failure Recovery
  // ==========================================
  describe("F8: DoneScreen Save Failure Recovery", () => {
    const DUMMY_SESSION = {
      label: "Focus 25",
      phases: [{ name: "Focus", duration: 25, isBreak: false, emoji: "🎯" }],
    };

    it("F8-1: automatically attempts saveSession upon mounting DoneScreen", async () => {
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={DUMMY_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Literature", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const sessions = await loadSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].subject).toBe("Literature");
    });

    it("F8-2: displays warning banner when saveSession fails", async () => {
      jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("Storage disk full"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={DUMMY_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "History", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const warningTextNodes = renderer.root.findAll(
        (node) => node.props.children === "Failed to save session to history."
      );
      expect(warningTextNodes.length).toBeGreaterThan(0);
    });

    it("F8-3: displays 'Retry Save' interactive button and hides streak on save failure", async () => {
      jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("Network glitch"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={DUMMY_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "History", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
      expect(retryBtn).toBeDefined();

      const streakNodes = renderer.root.findAll(
        (node) => typeof node.props.children === "string" && node.props.children.includes("Streak")
      );
      expect(streakNodes.length).toBe(0);
    });

    it("F8-4: pressing 'Retry Save' attempts performSave again and clears warning", async () => {
      jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("Temporary error"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={DUMMY_SESSION}
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

      const warningTextNodes = renderer.root.findAll(
        (node) => node.props.children === "Failed to save session to history."
      );
      expect(warningTextNodes.length).toBe(0);

      const sessions = await loadSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].subject).toBe("History");
    });

    it("F8-5: clears error banner and renders streak upon successful retry", async () => {
      jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("First attempt fail"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={DUMMY_SESSION}
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

      const streakNodes = renderer.root.findAll(
        (node) =>
          typeof node.props.children === "string" && node.props.children.includes("Streak started")
      );
      expect(streakNodes.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // F9: HistoryScreen Subject Auto-Registration
  // ==========================================
  describe("F9: HistoryScreen Subject Auto-Registration", () => {
    it("F9-1: registers new subjects via saveSubject before updating session record", async () => {
      const savedSession = await saveSession({
        sessionType: "1hr",
        label: "Study Block",
        subject: "General",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      const newSubjectName = "Astrophysics";
      const savedSubj = await saveSubject(newSubjectName);
      expect(savedSubj.name).toBe("Astrophysics");
      expect(savedSubj.color).toBeDefined();

      await updateSession(savedSession.id, { subject: savedSubj.name });

      const sessions = await loadSessions();
      expect(sessions[0].subject).toBe("Astrophysics");
    });

    it("F9-2: updateSession only accepts canonical registered subject string", async () => {
      const session = await saveSession({
        sessionType: "custom",
        label: "Test Session",
        subject: "Math",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 30,
        actualStudyMins: 30,
        completed: true,
      });

      await updateSession(session.id, { subject: "   Philosophy   " });
      const updated = await loadSessions();
      expect(updated[0].subject).toBe("Philosophy");
    });

    it("F9-3: refreshes subjects list so new subjects appear in subject list", async () => {
      const beforeSubjects = await loadSubjects();
      expect(beforeSubjects.find((s) => s.name === "Economics")).toBeUndefined();

      await saveSubject("Economics");
      const afterSubjects = await loadSubjects();
      expect(afterSubjects.find((s) => s.name === "Economics")).toBeDefined();
    });

    it("F9-4: assigns distinct palette color from SUBJECT_COLORS to newly auto-registered subjects", async () => {
      const subj1 = await saveSubject("Subj 1");
      const subj2 = await saveSubject("Subj 2");

      expect(SUBJECT_COLORS).toContain(subj1.color);
      expect(SUBJECT_COLORS).toContain(subj2.color);
      expect(subj1.color).not.toBe(subj2.color);
    });

    it("F9-5: trims extra whitespace and falls back to Unspecified if name is blank", async () => {
      const subj = await saveSubject("   ");
      expect(subj.name).toBe("Unspecified");
      expect(subj.color).toBe(SUBJECT_COLORS[0]);
    });
  });

  // ==========================================
  // F10: Settings Sanitization & Normalization
  // ==========================================
  describe("F10: Settings Sanitization & Normalization", () => {
    it("F10-1: loadSettings returns full default settings when storage is empty", async () => {
      const settings = await loadSettings();
      expect(settings).toEqual({
        soundPreset: "classic",
        vibrate: true,
        keepAwake: true,
        autoAdvance: true,
        theme: "dark",
        weeklyGoalEnabled: true,
        weeklyGoalMins: 600,
        weeklyGoalDays: 5,
      });
    });

    it("F10-2: normalizeSettings validates and normalizes all 8 settings properties", () => {
      const normalized = normalizeSettings({
        soundPreset: "  bell  ",
        vibrate: false,
        keepAwake: false,
        autoAdvance: false,
        theme: "light",
        weeklyGoalEnabled: true,
        weeklyGoalMins: 1200,
        weeklyGoalDays: 4,
      });

      expect(normalized).toEqual({
        soundPreset: "bell",
        vibrate: false,
        keepAwake: false,
        autoAdvance: false,
        theme: "light",
        weeklyGoalEnabled: true,
        weeklyGoalMins: 1200,
        weeklyGoalDays: 4,
      });
    });

    it("F10-3: rejects non-positive or non-finite weeklyGoalMins and falls back to default", () => {
      expect(normalizeSettings({ weeklyGoalMins: -100 }).weeklyGoalMins).toBe(600);
      expect(normalizeSettings({ weeklyGoalMins: 0 }).weeklyGoalMins).toBe(600);
      expect(normalizeSettings({ weeklyGoalMins: NaN }).weeklyGoalMins).toBe(600);
      expect(normalizeSettings({ weeklyGoalMins: Infinity }).weeklyGoalMins).toBe(600);
      expect(normalizeSettings({ weeklyGoalMins: "500" }).weeklyGoalMins).toBe(600);
    });

    it("F10-4: rejects out-of-range weeklyGoalDays (<1 or >7) and rounds decimals", () => {
      expect(normalizeSettings({ weeklyGoalDays: 0 }).weeklyGoalDays).toBe(5);
      expect(normalizeSettings({ weeklyGoalDays: 8 }).weeklyGoalDays).toBe(5);
      expect(normalizeSettings({ weeklyGoalDays: -2 }).weeklyGoalDays).toBe(5);
      expect(normalizeSettings({ weeklyGoalDays: 3.4 }).weeklyGoalDays).toBe(3);
      expect(normalizeSettings({ weeklyGoalDays: 5.8 }).weeklyGoalDays).toBe(6);
    });

    it("F10-5: saveSettings safely normalizes and merges partial updates", async () => {
      await saveSettings({ theme: "dracula", weeklyGoalMins: 900 });
      let loaded = await loadSettings();
      expect(loaded.theme).toBe("dracula");
      expect(loaded.weeklyGoalMins).toBe(900);
      expect(loaded.soundPreset).toBe("classic");

      await saveSettings({ soundPreset: "marimba" });
      loaded = await loadSettings();
      expect(loaded.soundPreset).toBe("marimba");
      expect(loaded.theme).toBe("dracula");
    });
  });

  // ==========================================
  // F11: Session Update Whitelisting & Caps
  // ==========================================
  describe("F11: Session Update Whitelisting & Caps", () => {
    it("F11-1: whitelists allowed update fields on session records", async () => {
      const created = await saveSession({
        sessionType: "custom",
        label: "Initial Label",
        subject: "Biology",
        startedAt: "2026-01-01T00:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 20,
        actualStudyMins: 20,
        completed: false,
      });

      await updateSession(created.id, {
        label: "Updated Label",
        subject: "Advanced Biology",
        completed: true,
        actualStudyMins: 25,
        phasesCompleted: 2,
      });

      const sessions = await loadSessions();
      expect(sessions[0].label).toBe("Updated Label");
      expect(sessions[0].subject).toBe("Advanced Biology");
      expect(sessions[0].completed).toBe(true);
      expect(sessions[0].actualStudyMins).toBe(25);
      expect(sessions[0].phasesCompleted).toBe(2);
    });

    it("F11-2: discards non-whitelisted update fields", async () => {
      const created = await saveSession({
        sessionType: "1hr",
        label: "Normal",
        subject: "Bio",
        startedAt: "2026-01-01T00:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 20,
        actualStudyMins: 20,
        completed: false,
      });

      await updateSession(created.id, {
        id: "hacked-id",
        startedAt: "1999-01-01T00:00:00.000Z",
        totalStudyMins: 9999,
        injectedField: "malicious",
      });

      const sessions = await loadSessions();
      expect(sessions[0].id).toBe(created.id);
      expect(sessions[0].startedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(sessions[0].totalStudyMins).toBe(20);
      expect(sessions[0].injectedField).toBeUndefined();
    });

    it("F11-3: clamps string fields to MAX_NAME_LENGTH (64 characters)", async () => {
      const created = await saveSession({
        sessionType: "custom",
        label: "A",
        subject: "B",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 10,
        actualStudyMins: 10,
        completed: true,
      });

      const giantString = "X".repeat(120);
      await updateSession(created.id, {
        label: giantString,
        subject: giantString,
      });

      const sessions = await loadSessions();
      expect(sessions[0].label.length).toBe(MAX_NAME_LENGTH);
      expect(sessions[0].subject.length).toBe(MAX_NAME_LENGTH);
    });

    it("F11-4: validates numerical bounds for actualStudyMins and phasesCompleted", async () => {
      const created = await saveSession({
        sessionType: "custom",
        label: "A",
        subject: "B",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 10,
        actualStudyMins: 10,
        completed: true,
      });

      await updateSession(created.id, {
        actualStudyMins: -15,
        phasesCompleted: -3,
      });

      const sessions = await loadSessions();
      expect(sessions[0].actualStudyMins).toBe(10);
      expect(sessions[0].phasesCompleted).toBe(1);
    });

    it("F11-5: ignores non-object updates safely without error", async () => {
      const created = await saveSession({
        sessionType: "custom",
        label: "A",
        subject: "B",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 10,
        actualStudyMins: 10,
        completed: true,
      });

      await updateSession(created.id, null);
      await updateSession(created.id, "string-not-object");
      await updateSession(created.id, 12345);

      const sessions = await loadSessions();
      expect(sessions[0].label).toBe("A");
    });
  });

  // ==========================================
  // F12: Duplicate Template Label Cap
  // ==========================================
  describe("F12: Duplicate Template Label Cap", () => {
    it("F12-1: appends ' Copy' when source label is comfortably under 64 characters", async () => {
      const template = await saveTemplate({
        label: "Short Study",
        phases: [{ name: "P1", duration: 15, isBreak: false, emoji: "📖" }],
      });

      const duplicate = await duplicateTemplate(template.id);
      expect(duplicate.label).toBe("Short Study Copy");
      expect(duplicate.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    });

    it("F12-2: slices label to MAX_NAME_LENGTH (64 characters) when label + ' Copy' exceeds 64", async () => {
      const longLabel = "A".repeat(62);
      const template = await saveTemplate({
        label: longLabel,
        phases: [{ name: "P1", duration: 15, isBreak: false, emoji: "📖" }],
      });

      const duplicate = await duplicateTemplate(template.id);
      expect(duplicate.label.length).toBe(MAX_NAME_LENGTH);
      expect(duplicate.label).toBe(`${longLabel} Copy`.slice(0, MAX_NAME_LENGTH));
    });

    it("F12-3: duplicated template receives new ID and deep copies phases array", async () => {
      const template = await saveTemplate({
        label: "Modular Deep Work",
        phases: [
          { name: "P1", duration: 25, isBreak: false, emoji: "📖" },
          { name: "Break", duration: 5, isBreak: true, emoji: "☕" },
        ],
      });

      const duplicate = await duplicateTemplate(template.id);
      expect(duplicate.id).not.toBe(template.id);
      expect(duplicate.phases).toHaveLength(2);
      expect(duplicate.phases[0]).not.toBe(template.phases[0]);
      expect(duplicate.phases[0].name).toBe("P1");
    });

    it("F12-4: inserts duplicate immediately after source template in template list", async () => {
      const t1 = await saveTemplate({ label: "T1", phases: [{ name: "p", duration: 5 }] });
      const t2 = await saveTemplate({ label: "T2", phases: [{ name: "p", duration: 5 }] });
      const t3 = await saveTemplate({ label: "T3", phases: [{ name: "p", duration: 5 }] });

      const copy = await duplicateTemplate(t2.id);
      const all = await loadTemplates();

      const t2Index = all.findIndex((t) => t.id === t2.id);
      const copyIndex = all.findIndex((t) => t.id === copy.id);
      expect(copyIndex).toBe(t2Index + 1);
    });

    it("F12-5: chained duplicate operations never exceed 64 characters", async () => {
      let current = await saveTemplate({
        label: "Repeated Chain",
        phases: [{ name: "p", duration: 5 }],
      });

      for (let i = 0; i < 15; i++) {
        current = await duplicateTemplate(current.id);
        expect(current.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      }
    });
  });

  // ==========================================
  // F13: Android Permissions & Security Config
  // ==========================================
  describe("F13: Android Permissions & Security Config", () => {
    let appJson;
    beforeAll(() => {
      const appJsonPath = path.resolve(__dirname, "../../app.json");
      appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    });

    it("F13-1: specifies 'android.permission.POST_NOTIFICATIONS' in expo.android.permissions", () => {
      const permissions = appJson.expo.android.permissions;
      expect(permissions).toContain("android.permission.POST_NOTIFICATIONS");
    });

    it("F13-2: does NOT contain bare or deprecated 'NOTIFICATIONS' in permissions", () => {
      const permissions = appJson.expo.android.permissions;
      expect(permissions).not.toContain("NOTIFICATIONS");
    });

    it("F13-3: specifies 'allowBackup': false under expo.android to avoid data leakage", () => {
      expect(appJson.expo.android.allowBackup).toBe(false);
    });

    it("F13-4: configures versionCode as 1 (positive integer)", () => {
      expect(appJson.expo.android.versionCode).toBe(1);
      expect(Number.isInteger(appJson.expo.android.versionCode)).toBe(true);
    });

    it("F13-5: includes required native plugins in app.json", () => {
      const plugins = appJson.expo.plugins;
      expect(plugins.some((p) => (Array.isArray(p) ? p[0] : p) === "expo-notifications")).toBe(
        true
      );
      expect(plugins.some((p) => (Array.isArray(p) ? p[0] : p) === "expo-audio")).toBe(true);
      expect(plugins.some((p) => (Array.isArray(p) ? p[0] : p) === "expo-splash-screen")).toBe(
        true
      );
    });
  });

  // ==========================================
  // F14: Standalone APK Build Configuration
  // ==========================================
  describe("F14: Standalone APK Build Configuration", () => {
    let easJson;
    beforeAll(() => {
      const easJsonPath = path.resolve(__dirname, "../../eas.json");
      easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));
    });

    it("F14-1: defines a preview build profile in eas.json", () => {
      expect(easJson.build).toBeDefined();
      expect(easJson.build.preview).toBeDefined();
    });

    it("F14-2: specifies buildType 'apk' for android under preview profile", () => {
      expect(easJson.build.preview.android).toBeDefined();
      expect(easJson.build.preview.android.buildType).toBe("apk");
    });

    it("F14-3: specifies distribution 'internal' under preview profile", () => {
      expect(easJson.build.preview.distribution).toBe("internal");
    });

    it("F14-4: configures development profile with developmentClient true", () => {
      expect(easJson.build.development).toBeDefined();
      expect(easJson.build.development.developmentClient).toBe(true);
    });

    it("F14-5: configures production profile with autoIncrement true", () => {
      expect(easJson.build.production).toBeDefined();
      expect(easJson.build.production.autoIncrement).toBe(true);
    });
  });

  // ==========================================
  // F15: Security & Artifact Exclusions
  // ==========================================
  describe("F15: Security & Artifact Exclusions", () => {
    let gitignoreContent;
    beforeAll(() => {
      const gitignorePath = path.resolve(__dirname, "../../.gitignore");
      gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    });

    it("F15-1: excludes environment files (.env*)", () => {
      expect(gitignoreContent).toMatch(/^\.env\*/m);
    });

    it("F15-2: excludes Android keystores (*.jks, *.keystore)", () => {
      expect(gitignoreContent).toMatch(/^\*\.jks/m);
      expect(gitignoreContent).toMatch(/^\*\.keystore/m);
    });

    it("F15-3: excludes iOS security keys and profiles (*.p8, *.p12, *.key, *.mobileprovision)", () => {
      expect(gitignoreContent).toMatch(/^\*\.p8/m);
      expect(gitignoreContent).toMatch(/^\*\.p12/m);
      expect(gitignoreContent).toMatch(/^\*\.key/m);
      expect(gitignoreContent).toMatch(/^\*\.mobileprovision/m);
    });

    it("F15-4: excludes compiled app binaries (*.apk, *.aab)", () => {
      expect(gitignoreContent).toMatch(/^\*\.apk/m);
      expect(gitignoreContent).toMatch(/^\*\.aab/m);
    });

    it("F15-5: excludes native directories (android/, ios/) and test cache (.jest-cache/)", () => {
      expect(gitignoreContent).toMatch(/^android\//m);
      expect(gitignoreContent).toMatch(/^ios\//m);
      expect(gitignoreContent).toMatch(/^\.jest-cache\//m);
    });
  });
});
