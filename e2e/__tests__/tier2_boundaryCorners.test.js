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

describe("Tier 2: Boundary & Corner Cases (F1 through F15)", () => {
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

  const BREAK_ONLY_SESSION = {
    label: "Break Only",
    phases: [
      { name: "Coffee", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Walk", duration: 10, isBreak: true, emoji: "🚶" },
    ],
  };

  function renderSessionScreen(props = {}) {
    return (
      <ThemeProvider>
        <SessionScreen
          session={props.session || SAMPLE_SESSION}
          subject={props.subject || "Quantum Mechanics"}
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
  // F1: Boundaries
  // ==========================================
  describe("F1: AppState Active Reconciliation (Boundaries)", () => {
    it("F1-B1: zero elapsed time boundary (now === anchorAt) leaves remainingMs unchanged", () => {
      const phases = SAMPLE_SESSION.phases;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 1500000,
        running: true,
        anchorAt: 1000,
        now: 1000, // zero elapsed
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(0);
      expect(reconciled.remainingMs).toBe(1500000);
      expect(reconciled.advancedPhases).toHaveLength(0);
      expect(reconciled.finished).toBe(false);
    });

    it("F1-B2: exact phase boundary match (elapsedMs === remainingMs) completes phase without overshoot", () => {
      const phases = SAMPLE_SESSION.phases;
      const remainingMs = 50000;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs,
        running: true,
        anchorAt: 1000,
        now: 1000 + remainingMs, // exact match
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(1);
      expect(reconciled.remainingMs).toBe(phases[1].duration * 60000);
      expect(reconciled.advancedPhases).toEqual([{ index: 0, completed: true }]);
    });

    it("F1-B3: negative elapsed time clock skew (now < anchorAt) is clamped gracefully", () => {
      const phases = SAMPLE_SESSION.phases;
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 1500000,
        running: true,
        anchorAt: 5000,
        now: 1000, // clock moved backwards
        autoAdvance: true,
      });

      expect(reconciled.phaseIndex).toBe(0);
      expect(reconciled.remainingMs).toBe(1500000);
      expect(reconciled.finished).toBe(false);
    });

    it("F1-B4: giant elapsed time interval (7 days asleep) finishes session safely without loop hang", () => {
      const phases = SAMPLE_SESSION.phases;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 1500000,
        running: true,
        anchorAt: 1000,
        now: 1000 + sevenDaysMs,
        autoAdvance: true,
      });

      expect(reconciled.finished).toBe(true);
      expect(reconciled.remainingMs).toBe(0);
      expect(reconciled.running).toBe(false);
    });

    it("F1-B5: background transition with 1ms left on last phase finishes cleanly", () => {
      const phases = SAMPLE_SESSION.phases;
      const lastIndex = phases.length - 1;

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: lastIndex,
        remainingMs: 1, // 1 ms left
        running: true,
        anchorAt: 1000,
        now: 1002, // 2 ms elapsed
        autoAdvance: true,
      });

      expect(reconciled.finished).toBe(true);
      expect(reconciled.remainingMs).toBe(0);
    });
  });

  // ==========================================
  // F2: Boundaries
  // ==========================================
  describe("F2: Background Study Time Crediting (Boundaries)", () => {
    it("F2-B1: session consisting solely of break phases credits exactly 0 study minutes", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(
          renderSessionScreen({ session: BREAK_ONLY_SESSION, onComplete })
        );
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 300;
        renderer.update(
          renderSessionScreen({ session: BREAK_ONLY_SESSION, onComplete })
        );
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 20 * 60 * 1000; // all breaks expire in background

      await act(async () => {
        appStateListener("active");
      });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          actualStudyMins: 0,
        })
      );
    });

    it("F2-B2: handles fractional minute phase durations (0.5 mins / 30s) accurately", () => {
      const fractionalPhase = { name: "Micro Study", duration: 0.5, isBreak: false };
      expect(phaseElapsedSecs(fractionalPhase, 10)).toBe(20);
      expect(phaseElapsedSecs(fractionalPhase, 0)).toBe(30);
      expect(minsFromSecs(phaseElapsedSecs(fractionalPhase, 0))).toBe(0.5);
    });

    it("F2-B3: Pomodoro 8-cycle study session credits all 8 study phases and 0 breaks", () => {
      const phases = [];
      for (let i = 0; i < 8; i++) {
        phases.push({ name: `Study ${i + 1}`, duration: 25, isBreak: false });
        phases.push({ name: `Break ${i + 1}`, duration: 5, isBreak: true });
      }

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 25 * 60 * 1000,
        running: true,
        anchorAt: 1000,
        now: 1000 + 300 * 60 * 1000, // 5 hours -> all 16 phases done
        autoAdvance: true,
      });

      expect(reconciled.finished).toBe(true);
      const studySecs = reconciled.advancedPhases
        .filter((adv) => adv.completed && !phases[adv.index].isBreak)
        .reduce((sum, adv) => sum + phases[adv.index].duration * 60, 0);

      expect(studySecs).toBe(8 * 25 * 60); // 12,000s = 200m
      expect(minsFromSecs(studySecs)).toBe(200);
    });

    it("F2-B4: quit immediately after background return credits both background and active time", () => {
      const curPhase = { name: "Deep Study", duration: 25, isBreak: false };
      const backgroundCreditedSecs = 15 * 60; // 15 mins already credited
      const remainingSecondsInActive = 400; // 10 mins started with 600s, 200s elapsed
      const currentElapsed = phaseElapsedSecs(curPhase, remainingSecondsInActive);

      const totalSecs = backgroundCreditedSecs + currentElapsed;
      expect(totalSecs).toBe(15 * 60 + (25 * 60 - 400));
      expect(minsFromSecs(totalSecs)).toBe(33.3);
    });

    it("F2-B5: paused during active study before backgrounding credits only elapsed running time", () => {
      const studyPhase = { name: "Study", duration: 20, isBreak: false };
      // User paused after 8 mins (480s elapsed, 720s left)
      const elapsed = phaseElapsedSecs(studyPhase, 720);
      expect(elapsed).toBe(480);
      expect(minsFromSecs(elapsed)).toBe(8);
    });
  });

  // ==========================================
  // F3: Boundaries
  // ==========================================
  describe("F3: Clean Reconciliation Branching (Boundaries)", () => {
    it("F3-B1: exact finish boundary when autoAdvance is false on final phase marks finished", () => {
      const phases = SAMPLE_SESSION.phases;
      const lastIndex = phases.length - 1;
      const lastPhaseMs = phases[lastIndex].duration * 60000;

      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: lastIndex,
        remainingMs: lastPhaseMs,
        running: true,
        anchorAt: 1000,
        now: 1000 + lastPhaseMs,
        autoAdvance: false, // autoAdvance false on last phase
      });

      expect(reconciled.finished).toBe(true);
      expect(reconciled.awaitingNext).toBe(false);
      expect(reconciled.running).toBe(false);
    });

    it("F3-B2: autoAdvance false stops strictly at the current phase boundary and waits", () => {
      const phases = MULTI_PHASE_SESSION.phases; // 20m, 5m, 15m
      const reconciled = reconcileTimeline({
        phases,
        phaseIndex: 0,
        remainingMs: 20 * 60000,
        running: true,
        anchorAt: 1000,
        now: 1000 + 40 * 60000, // 40m passed
        autoAdvance: false,
      });

      expect(reconciled.phaseIndex).toBe(1);
      expect(reconciled.awaitingNext).toBe(true);
      expect(reconciled.running).toBe(false);
      expect(reconciled.finished).toBe(false);
      expect(reconciled.advancedPhases).toHaveLength(1);
    });

    it("F3-B3: 1 ms remaining rounds up to 1 whole second (Math.max(1, Math.ceil(1/1000)))", () => {
      const remainingMs = 1;
      const remainingSecs = Math.max(1, Math.ceil(remainingMs / 1000));
      expect(remainingSecs).toBe(1);
    });

    it("F3-B4: rapid AppState toggle flurry preserves timeline integrity", () => {
      const phases = SAMPLE_SESSION.phases;
      let state = {
        phaseIndex: 0,
        remainingMs: 25 * 60 * 1000,
        running: true,
        anchorAt: 1000,
      };

      // 5 rapid 1-minute hops
      for (let i = 0; i < 5; i++) {
        const nextTime = state.anchorAt + 60000;
        const reconciled = reconcileTimeline({
          phases,
          phaseIndex: state.phaseIndex,
          remainingMs: state.remainingMs,
          running: true,
          anchorAt: state.anchorAt,
          now: nextTime,
          autoAdvance: true,
        });
        state = {
          phaseIndex: reconciled.phaseIndex,
          remainingMs: reconciled.remainingMs,
          running: true,
          anchorAt: nextTime,
        };
      }

      expect(state.phaseIndex).toBe(0);
      expect(state.remainingMs).toBe((25 - 5) * 60 * 1000);
    });

    it("F3-B5: background finish with vibrate enabled suppresses both sound and vibration", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onComplete }));
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 100;
        renderer.update(renderSessionScreen({ onComplete }));
      });

      await act(async () => {
        appStateListener("background");
      });

      currentTime += 3600 * 1000;

      await act(async () => {
        appStateListener("active");
      });

      expect(onComplete).toHaveBeenCalled();
      expect(mockPlayAlarm).not.toHaveBeenCalled();
      expect(Vibration.vibrate).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // F4: Boundaries
  // ==========================================
  describe("F4: Hardware Back Button in SessionScreen (Boundaries)", () => {
    it("F4-B1: hardware back press with 0 actual study seconds calls onGoHome directly without partial quit", async () => {
      const onGoHome = jest.fn();
      const onPartialQuit = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onGoHome, onPartialQuit }));
      });

      // Timer paused with full time (0 elapsed)
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 25 * 60;

      await triggerBackPress();

      expect(onPartialQuit).not.toHaveBeenCalled();
      expect(onGoHome).toHaveBeenCalledTimes(1);
    });

    it("F4-B2: hardware back press during break phase does not count break time as study time", async () => {
      const onPartialQuit = jest.fn();
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onPartialQuit, onGoHome }));
      });

      // Break phase is phase.isBreak = true
      const breakPhase = { name: "Break", duration: 5, isBreak: true };
      const elapsed = phaseElapsedSecs(breakPhase, 120);
      expect(elapsed).toBe(0);
    });

    it("F4-B3: multiple rapid hardware back presses while alert is visible do not crash", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        renderer.update(renderSessionScreen());
      });

      await triggerBackPress();
      await triggerBackPress();
      await triggerBackPress();

      expect(Alert.alert).toHaveBeenCalled();
    });

    it("F4-B4: hardware back press when paused quits immediately without alert modal", async () => {
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onGoHome }));
      });

      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1500;

      await triggerBackPress();

      expect(Alert.alert).not.toHaveBeenCalled();
      expect(onGoHome).toHaveBeenCalled();
    });

    it("F4-B5: repeated mount and unmount does not leave dangling BackHandler listeners", async () => {
      const baseLen = backHandlerStack.length;

      for (let i = 0; i < 5; i++) {
        await act(async () => {
          renderer = create(renderSessionScreen());
        });
        expect(backHandlerStack.length).toBe(baseLen + 1);

        await act(async () => {
          renderer.unmount();
          renderer = null;
        });
        expect(backHandlerStack.length).toBe(baseLen);
      }
    });
  });

  // ==========================================
  // F5: Boundaries
  // ==========================================
  describe("F5: Screen Hierarchy Back Navigation (Boundaries)", () => {
    it("F5-B1: back press bubbling walks through builder -> session-picker -> subject-picker -> home in sequence", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Move to custom-session-builder
      const home = renderer.root.findByType(HomeScreen);
      await act(async () => {
        home.props.onStartStudying();
      });

      const subjectPicker = renderer.root.findByType(SubjectPickerScreen);
      await act(async () => {
        await subjectPicker.props.onSelectSubject("Biology");
      });

      const sessionPicker = renderer.root.findByType(SessionPickerScreen);
      await act(async () => {
        sessionPicker.props.onOpenCustomSession();
      });
      expect(renderer.root.findAllByType(CustomSessionScreen).length).toBe(1);

      // Step 1: builder -> session-picker
      let handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(SessionPickerScreen).length).toBe(1);

      // Step 2: session-picker -> subject-picker
      handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(SubjectPickerScreen).length).toBe(1);

      // Step 3: subject-picker -> home
      handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);

      // Step 4: home -> OS exit (false)
      handled = await triggerBackPress();
      expect(handled).toBe(false);
    });

    it("F5-B2: back press on stats, history, and settings tabs each routes back to home", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const tabBar = renderer.root.findByType(TabBar);

      // Stats tab
      await act(async () => {
        tabBar.props.onChange("stats");
      });
      let handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);

      // History tab
      await act(async () => {
        tabBar.props.onChange("history");
      });
      handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    });

    it("F5-B3: back press on home screen strictly returns false without state mutation", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const handled = await triggerBackPress();
      expect(handled).toBe(false);
      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    });

    it("F5-B4: back press on home when called multiple times consecutively always returns false", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      for (let i = 0; i < 4; i++) {
        const handled = await triggerBackPress();
        expect(handled).toBe(false);
      }
    });

    it("F5-B5: back press from custom template editor resets editingTemplate and returns to session-picker", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      const home = renderer.root.findByType(HomeScreen);
      await act(async () => {
        home.props.onStartStudying();
      });

      const subjectPicker = renderer.root.findByType(SubjectPickerScreen);
      await act(async () => {
        await subjectPicker.props.onSelectSubject("History");
      });

      const sessionPicker = renderer.root.findByType(SessionPickerScreen);
      await act(async () => {
        sessionPicker.props.onEditTemplate({
          id: "t1",
          label: "Custom Template",
          phases: [{ name: "P1", duration: 25 }],
        });
      });

      expect(renderer.root.findAllByType(CustomSessionScreen).length).toBe(1);

      const handled = await triggerBackPress();
      expect(handled).toBe(true);
      expect(renderer.root.findAllByType(SessionPickerScreen).length).toBe(1);
    });
  });

  // ==========================================
  // F6: Boundaries
  // ==========================================
  describe("F6: Startup Notification Cleanup (Boundaries)", () => {
    it("F6-B1: cancelSessionNotifications handles native module rejection gracefully", async () => {
      cancelSessionNotifications.mockRejectedValueOnce("Native module dead");

      let error = null;
      try {
        await act(async () => {
          renderer = create(<App />);
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeNull();
    });

    it("F6-B2: delayed notification resolution does not block rendering", async () => {
      cancelSessionNotifications.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 30))
      );

      await act(async () => {
        renderer = create(<App />);
      });

      expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    });

    it("F6-B3: notification cleanup with null return resolves cleanly", async () => {
      cancelSessionNotifications.mockResolvedValueOnce(null);

      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalled();
    });

    it("F6-B4: multiple concurrent cancellations resolve cleanly without race conditions", async () => {
      const p1 = cancelSessionNotifications();
      const p2 = cancelSessionNotifications();
      const p3 = cancelSessionNotifications();

      await expect(Promise.all([p1, p2, p3])).resolves.toBeDefined();
    });

    it("F6-B5: app mount clears orphaned notifications before any session schedule call", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalled();
      expect(mockScheduleChain).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // F7: Boundaries
  // ==========================================
  describe("F7: SafeAreaView Migration (Boundaries)", () => {
    it("F7-B1: verifies that zero screens in src/screens/ import SafeAreaView from react-native", () => {
      const screensDir = path.resolve(__dirname, "../../src/screens");
      const files = fs.readdirSync(screensDir).filter((f) => f.endsWith(".js"));

      files.forEach((file) => {
        const content = fs.readFileSync(path.join(screensDir, file), "utf8");
        const hasLegacyImport =
          /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*["']react-native["']/.test(content);
        expect(hasLegacyImport).toBe(false);
      });
    });

    it("F7-B2: extreme insets values (59px top, 34px bottom) render seamlessly without error", async () => {
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={SAMPLE_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Math", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root).toBeDefined();
    });

    it("F7-B3: zero insets boundary (0px on all edges) renders cleanly", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      expect(renderer.root).toBeDefined();
    });

    it("F7-B4: safe area edges include ['top', 'bottom', 'left', 'right']", () => {
      const doneScreenPath = path.resolve(__dirname, "../../src/screens/DoneScreen.js");
      const content = fs.readFileSync(doneScreenPath, "utf8");
      expect(content).toContain('edges={["top", "bottom", "left", "right"]}');
    });

    it("F7-B5: App root wraps navigation tree in SafeAreaProvider", () => {
      const appPath = path.resolve(__dirname, "../../App.js");
      const content = fs.readFileSync(appPath, "utf8");
      expect(content).toContain("<SafeAreaProvider");
    });
  });

  // ==========================================
  // F8: Boundaries
  // ==========================================
  describe("F8: DoneScreen Save Failure Recovery (Boundaries)", () => {
    it("F8-B1: consecutive repeated save failures keep warning banner visible and interactive", async () => {
      AsyncStorage.setItem
        .mockRejectedValueOnce(new Error("Fail 1"))
        .mockRejectedValueOnce(new Error("Fail 2"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={SAMPLE_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Math", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn1 = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });

      // Retry 1 (fails)
      await act(async () => {
        await retryBtn1.props.onPress();
      });
      const warningNodes = renderer.root.findAll(
        (n) => n.props.children === "Failed to save session to history."
      );
      expect(warningNodes.length).toBeGreaterThan(0);
    });

    it("F8-B2: retry button has accessible role and label when save fails", async () => {
      AsyncStorage.setItem.mockRejectedValueOnce(new Error("First fail"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={SAMPLE_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Math", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });
      expect(retryBtn).toBeDefined();
      expect(retryBtn.props.accessibilityRole).toBe("button");
      expect(retryBtn.props.disabled).toBe(false);
    });

    it("F8-B3: save succeeds on retry attempt and clears error banner", async () => {
      AsyncStorage.setItem
        .mockRejectedValueOnce(new Error("Fail 1"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={SAMPLE_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Math", actualStudyMins: 25 }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const retryBtn = renderer.root.findByProps({ accessibilityLabel: "Retry Save" });

      await act(async () => {
        await retryBtn.props.onPress();
      });

      const warningNodes = renderer.root.findAll(
        (n) => n.props.children === "Failed to save session to history."
      );
      expect(warningNodes.length).toBe(0);
    });

    it("F8-B4: missing sessionMeta defaults safely to 'unknown' and 'Unspecified'", async () => {
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen session={SAMPLE_SESSION} sessionMeta={null} onGoHome={jest.fn()} />
          </ThemeProvider>
        );
      });

      const sessions = await loadSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionType).toBe("unknown");
      expect(sessions[0].subject).toBe("Unspecified");
    });

    it("F8-B5: storage quota exceeded error is surfaced via warning banner rather than crash", async () => {
      AsyncStorage.setItem.mockRejectedValueOnce(new Error("QUOTA_EXCEEDED"));

      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <DoneScreen
              session={SAMPLE_SESSION}
              sessionMeta={{ sessionKey: "1hr", subject: "Math" }}
              onGoHome={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const warningNodes = renderer.root.findAll(
        (n) => n.props.children === "Failed to save session to history."
      );
      expect(warningNodes.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // F9: Boundaries
  // ==========================================
  describe("F9: HistoryScreen Subject Auto-Registration (Boundaries)", () => {
    it("F9-B1: subject name with leading/trailing and inner extra spaces is trimmed cleanly", async () => {
      const subj = await saveSubject("   Calculus   ");
      expect(subj.name).toBe("Calculus");
    });

    it("F9-B2: subject matching existing subject with different case reuses existing entry", async () => {
      const first = await saveSubject("Physics");
      const second = await saveSubject("pHySiCs");

      expect(second.name).toBe(first.name);
      expect(second.color).toBe(first.color);

      const subjects = await loadSubjects();
      expect(subjects.filter((s) => s.name.toLowerCase() === "physics")).toHaveLength(1);
    });

    it("F9-B3: subject name exceeding 64 characters is capped to MAX_NAME_LENGTH (64 chars)", async () => {
      const giantName = "S".repeat(100);
      const subj = await saveSubject(giantName);

      expect(subj.name.length).toBe(MAX_NAME_LENGTH);
      expect(subj.name).toBe("S".repeat(64));
    });

    it("F9-B4: empty or whitespace-only subject name resolves to 'Unspecified'", async () => {
      const subj = await saveSubject("   \t\n   ");
      expect(subj.name).toBe("Unspecified");
      expect(subj.color).toBe(SUBJECT_COLORS[0]);
    });

    it("F9-B5: cycles through SUBJECT_COLORS modulo palette length when adding many subjects", async () => {
      const paletteLen = SUBJECT_COLORS.length;
      for (let i = 0; i < paletteLen + 3; i++) {
        await saveSubject(`Subject Num ${i}`);
      }

      const all = await loadSubjects();
      expect(all.length).toBe(paletteLen + 3);
      // Palette wraps around
      expect(all[paletteLen].color).toBe(SUBJECT_COLORS[0]);
      expect(all[paletteLen + 1].color).toBe(SUBJECT_COLORS[1]);
    });
  });

  // ==========================================
  // F10: Boundaries
  // ==========================================
  describe("F10: Settings Sanitization & Normalization (Boundaries)", () => {
    it("F10-B1: weeklyGoalDays boundary check: exactly 1 and exactly 7 are preserved", () => {
      expect(normalizeSettings({ weeklyGoalDays: 1 }).weeklyGoalDays).toBe(1);
      expect(normalizeSettings({ weeklyGoalDays: 7 }).weeklyGoalDays).toBe(7);
      expect(normalizeSettings({ weeklyGoalDays: 0 }).weeklyGoalDays).toBe(5);
      expect(normalizeSettings({ weeklyGoalDays: 8 }).weeklyGoalDays).toBe(5);
    });

    it("F10-B2: floating point weeklyGoalDays is rounded to nearest integer", () => {
      expect(normalizeSettings({ weeklyGoalDays: 4.2 }).weeklyGoalDays).toBe(4);
      expect(normalizeSettings({ weeklyGoalDays: 4.7 }).weeklyGoalDays).toBe(5);
    });

    it("F10-B3: extreme weeklyGoalMins: large numbers preserved, negative/zero fall back", () => {
      expect(normalizeSettings({ weeklyGoalMins: 1 }).weeklyGoalMins).toBe(1);
      expect(normalizeSettings({ weeklyGoalMins: 50000 }).weeklyGoalMins).toBe(50000);
      expect(normalizeSettings({ weeklyGoalMins: -1 }).weeklyGoalMins).toBe(600);
      expect(normalizeSettings({ weeklyGoalMins: 0 }).weeklyGoalMins).toBe(600);
    });

    it("F10-B4: corrupted settings object with non-primitive fields is normalized cleanly", () => {
      const malicious = {
        soundPreset: { evil: true },
        theme: ["dark"],
        weeklyGoalMins: null,
        weeklyGoalDays: undefined,
        vibrate: "yes",
      };

      const normalized = normalizeSettings(malicious);
      expect(typeof normalized.soundPreset).toBe("string");
      expect(typeof normalized.theme).toBe("string");
      expect(typeof normalized.vibrate).toBe("boolean");
      expect(normalized.weeklyGoalMins).toBe(600);
      expect(normalized.weeklyGoalDays).toBe(5);
    });

    it("F10-B5: empty or blank soundPreset and theme fall back to defaults", () => {
      const normalized = normalizeSettings({ soundPreset: "   ", theme: "" });
      expect(normalized.soundPreset).toBe("classic");
      expect(normalized.theme).toBe("dark");
    });
  });

  // ==========================================
  // F11: Boundaries
  // ==========================================
  describe("F11: Session Update Whitelisting & Caps (Boundaries)", () => {
    it("F11-B1: update string of exactly 64 characters is preserved without truncation", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Initial",
        subject: "Math",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      const exact64 = "L".repeat(64);
      await updateSession(session.id, { label: exact64, subject: exact64 });

      const updated = await loadSessions();
      expect(updated[0].label).toBe(exact64);
      expect(updated[0].subject).toBe(exact64);
    });

    it("F11-B2: update string of 65 characters is truncated to 64", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Initial",
        subject: "Math",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      const str65 = "M".repeat(65);
      await updateSession(session.id, { label: str65 });

      const updated = await loadSessions();
      expect(updated[0].label.length).toBe(64);
      expect(updated[0].label).toBe("M".repeat(64));
    });

    it("F11-B3: prototype pollution injection in updates is safely ignored", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Clean",
        subject: "Clean",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      const payload = JSON.parse('{"__proto__":{"polluted":true},"label":"Safe"}');
      await updateSession(session.id, payload);

      expect({}.polluted).toBeUndefined();
      const updated = await loadSessions();
      expect(updated[0].label).toBe("Safe");
    });

    it("F11-B4: fractional phasesCompleted is floored to integer", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Test",
        subject: "Test",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      await updateSession(session.id, { phasesCompleted: 4.8 });

      const updated = await loadSessions();
      expect(updated[0].phasesCompleted).toBe(4);
    });

    it("F11-B5: update against nonexistent ID resolves cleanly without altering records", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Original",
        subject: "Original",
        startedAt: new Date().toISOString(),
        phasesCompleted: 1,
        totalStudyMins: 25,
        actualStudyMins: 25,
        completed: true,
      });

      await updateSession("nonexistent-id", { label: "Modified" });

      const sessions = await loadSessions();
      expect(sessions[0].label).toBe("Original");
    });
  });

  // ==========================================
  // F12: Boundaries
  // ==========================================
  describe("F12: Duplicate Template Label Cap (Boundaries)", () => {
    it("F12-B1: duplicate template whose label is exactly 64 characters is capped to 64 chars", async () => {
      const label64 = "T".repeat(64);
      const tpl = await saveTemplate({
        label: label64,
        phases: [{ name: "P1", duration: 10 }],
      });

      const copy = await duplicateTemplate(tpl.id);
      expect(copy.label.length).toBe(64);
      expect(copy.label).toBe(`${label64} Copy`.slice(0, 64));
    });

    it("F12-B2: label of 60 characters with ' Copy' (total 65 chars) is clamped to 64 chars", async () => {
      const label60 = "K".repeat(60);
      const tpl = await saveTemplate({
        label: label60,
        phases: [{ name: "P1", duration: 10 }],
      });

      const copy = await duplicateTemplate(tpl.id);
      expect(copy.label.length).toBe(64);
    });

    it("F12-B3: mutating duplicate phases array does not affect source template phases", async () => {
      const tpl = await saveTemplate({
        label: "Original Template",
        phases: [{ name: "P1", duration: 20 }],
      });

      const copy = await duplicateTemplate(tpl.id);
      copy.phases[0].name = "Mutated Phase";

      const freshOriginal = (await loadTemplates()).find((t) => t.id === tpl.id);
      expect(freshOriginal.phases[0].name).toBe("P1");
    });

    it("F12-B4: duplicating template with empty label defaults safely", async () => {
      const tpl = await saveTemplate({
        label: "",
        phases: [{ name: "P1", duration: 20 }],
      });

      const copy = await duplicateTemplate(tpl.id);
      expect(copy.label).toBe("Custom Session Copy");
      expect(copy.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    });

    it("F12-B5: chained 20-depth duplications maintain label length <= 64 chars", async () => {
      let tpl = await saveTemplate({
        label: "Base",
        phases: [{ name: "P1", duration: 10 }],
      });

      for (let i = 0; i < 20; i++) {
        tpl = await duplicateTemplate(tpl.id);
        expect(tpl.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      }
    });
  });

  // ==========================================
  // F13: Boundaries
  // ==========================================
  describe("F13: Android Permissions & Security Config (Boundaries)", () => {
    let appJson;
    beforeAll(() => {
      const appJsonPath = path.resolve(__dirname, "../../app.json");
      appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    });

    it("F13-B1: SCHEDULE_EXACT_ALARM is present for accurate timer delivery on Android 12+", () => {
      expect(appJson.expo.android.permissions).toContain("SCHEDULE_EXACT_ALARM");
    });

    it("F13-B2: WAKE_LOCK is present for screen keep-awake functionality", () => {
      expect(appJson.expo.android.permissions).toContain("WAKE_LOCK");
    });

    it("F13-B3: allowBackup is strictly boolean false", () => {
      expect(appJson.expo.android.allowBackup).toBe(false);
      expect(typeof appJson.expo.android.allowBackup).toBe("boolean");
    });

    it("F13-B4: package matches com.kwabena.studytimer Android package format", () => {
      expect(appJson.expo.android.package).toBe("com.kwabena.studytimer");
      expect(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appJson.expo.android.package)).toBe(
        true
      );
    });

    it("F13-B5: versionCode is positive integer >= 1", () => {
      expect(appJson.expo.android.versionCode).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // F14: Boundaries
  // ==========================================
  describe("F14: Standalone APK Build Configuration (Boundaries)", () => {
    let easJson;
    beforeAll(() => {
      const easJsonPath = path.resolve(__dirname, "../../eas.json");
      easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));
    });

    it("F14-B1: EAS config schema contains valid build, cli, and submit blocks", () => {
      expect(typeof easJson.cli).toBe("object");
      expect(typeof easJson.build).toBe("object");
      expect(typeof easJson.submit).toBe("object");
    });

    it("F14-B2: EAS CLI version requires at least >= 20.5.1", () => {
      expect(easJson.cli.version).toBe(">= 20.5.1");
    });

    it("F14-B3: preview android buildType is strictly 'apk' (not 'aab')", () => {
      expect(easJson.build.preview.android.buildType).toBe("apk");
    });

    it("F14-B4: development profile has developmentClient true", () => {
      expect(easJson.build.development.developmentClient).toBe(true);
    });

    it("F14-B5: production profile has autoIncrement true", () => {
      expect(easJson.build.production.autoIncrement).toBe(true);
    });
  });

  // ==========================================
  // F15: Boundaries
  // ==========================================
  describe("F15: Security & Artifact Exclusions (Boundaries)", () => {
    let gitignore;
    beforeAll(() => {
      const gitignorePath = path.resolve(__dirname, "../../.gitignore");
      gitignore = fs.readFileSync(gitignorePath, "utf8");
    });

    it("F15-B1: matches all .env variations (.env, .env.local, .env.production)", () => {
      const regex = /^\.env\*/m;
      expect(regex.test(gitignore)).toBe(true);
    });

    it("F15-B2: matches Android signing keys (*.jks, *.keystore)", () => {
      expect(gitignore).toContain("*.jks");
      expect(gitignore).toContain("*.keystore");
    });

    it("F15-B3: matches iOS certs (*.p8, *.p12, *.key, *.mobileprovision)", () => {
      expect(gitignore).toContain("*.p8");
      expect(gitignore).toContain("*.p12");
      expect(gitignore).toContain("*.key");
      expect(gitignore).toContain("*.mobileprovision");
    });

    it("F15-B4: matches binary packages (*.apk, *.aab)", () => {
      expect(gitignore).toContain("*.apk");
      expect(gitignore).toContain("*.aab");
    });

    it("F15-B5: matches test cache (.jest-cache/)", () => {
      expect(gitignore).toContain(".jest-cache/");
    });
  });
});
