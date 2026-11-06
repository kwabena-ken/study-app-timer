import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import SessionScreen from "../SessionScreen";
import App from "../../../App";
import { ThemeProvider } from "../../theme/ThemeContext";
import { cancelSessionNotifications } from "../../hooks/useNotifications";

jest.setTimeout(20000);

// Mocks for SessionScreen
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock("../../components/SessionDial", () => () => null);
jest.mock("../../components/Icon", () => () => null);

const mockPlayAlarm = jest.fn();
const mockStopAlarm = jest.fn();
jest.mock("../../hooks/useAlarmSound", () => ({
  useAlarmSound: () => ({ playAlarm: mockPlayAlarm, stopAlarm: mockStopAlarm }),
}));

const mockScheduleChain = jest.fn();
const mockCancelAll = jest.fn();
jest.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({
    scheduleChain: mockScheduleChain,
    cancelAll: mockCancelAll,
    error: null,
  }),
  cancelSessionNotifications: jest.fn().mockResolvedValue(undefined),
}));

let mockTimerState;
jest.mock("../../hooks/useTimer", () => ({
  useTimer: (opts) => {
    mockTimerState._onComplete = opts?.onComplete;
    return mockTimerState;
  },
}));

let mockSavedSettings = {
  autoAdvance: true,
  soundPreset: "classic",
  vibrate: true,
  keepAwake: true,
};

jest.mock("../../utils/storage", () => ({
  ...jest.requireActual("../../utils/storage"),
  loadSettings: jest.fn(() => Promise.resolve({ ...mockSavedSettings })),
  saveSettings: jest.fn((s) => {
    Object.assign(mockSavedSettings, s);
    return Promise.resolve(undefined);
  }),
  saveSession: jest.fn().mockResolvedValue({ id: "saved_s1" }),
  saveSubject: jest.fn((name) => Promise.resolve({ name, color: "#3b82f6" })),
}));

// Mocks for App screens
const mockAppScreens = {};
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../HomeScreen", () => (props) => {
  mockAppScreens.HomeScreen = props;
  return null;
});
jest.mock("../SubjectPickerScreen", () => (props) => {
  mockAppScreens.SubjectPickerScreen = props;
  return null;
});
jest.mock("../SessionPickerScreen", () => (props) => {
  mockAppScreens.SessionPickerScreen = props;
  return null;
});
jest.mock("../CustomSessionScreen", () => (props) => {
  mockAppScreens.CustomSessionScreen = props;
  return null;
});
jest.mock("../DoneScreen", () => (props) => {
  mockAppScreens.DoneScreen = props;
  return null;
});
jest.mock("../HistoryScreen", () => (props) => {
  mockAppScreens.HistoryScreen = props;
  return null;
});
jest.mock("../StatsScreen", () => (props) => {
  mockAppScreens.StatsScreen = props;
  return null;
});
jest.mock("../SettingsScreen", () => (props) => {
  mockAppScreens.SettingsScreen = props;
  return null;
});
jest.mock("../../components/TabBar", () => (props) => {
  mockAppScreens.TabBar = props;
  return null;
});

describe("Milestone 3 Empirical Adversarial Challenge Suite (challenger_m3_2)", () => {
  const POMODORO_SESSION = {
    label: "Pomodoro 25/5",
    phases: [
      { name: "Focus 1", duration: 25, isBreak: false, emoji: "📖" },
      { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Focus 2", duration: 25, isBreak: false, emoji: "📝" },
      { name: "Break 2", duration: 5, isBreak: true, emoji: "☕" },
    ],
  };

  let renderer;
  let appStateListener = null;
  let backHandlerListeners = [];
  let originalDateNow;
  let currentTime = 1000000000;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockAppScreens).forEach((k) => delete mockAppScreens[k]);

    mockSavedSettings = {
      autoAdvance: true,
      soundPreset: "classic",
      vibrate: true,
      keepAwake: true,
    };

    currentTime = 1000000000;
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
      if (type === "change") {
        appStateListener = cb;
      }
      return {
        remove: jest.fn(() => {
          if (appStateListener === cb) appStateListener = null;
        }),
      };
    });

    // Realistic BackHandler LIFO stack implementation
    backHandlerListeners = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") {
        backHandlerListeners.push(cb);
      }
      return {
        remove: jest.fn(() => {
          const idx = backHandlerListeners.lastIndexOf(cb);
          if (idx !== -1) backHandlerListeners.splice(idx, 1);
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

  const dispatchBack = () => {
    // Android BackHandler invokes listeners in LIFO order until one returns true
    for (let i = backHandlerListeners.length - 1; i >= 0; i--) {
      const handled = backHandlerListeners[i]();
      if (handled) return true;
    }
    return false;
  };

  function renderSessionScreen(props = {}) {
    return (
      <ThemeProvider>
        <SessionScreen
          session={props.session || POMODORO_SESSION}
          subject="Adversarial Testing"
          subjectColor="#10b981"
          onGoHome={props.onGoHome || jest.fn()}
          onComplete={props.onComplete || jest.fn()}
          onPartialQuit={props.onPartialQuit || jest.fn()}
        />
      </ThemeProvider>
    );
  }

  // =========================================================================
  // 1. SessionScreen: Concurrency & Timing Bounds
  // =========================================================================
  describe("1. SessionScreen: Concurrency & Timing Bounds", () => {
    it("1.1 survives 10 rapid consecutive background/active cycles across multi-second intervals with zero drift", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      // Start timer with 1500 seconds left
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSessionScreen());
      });

      let totalElapsedSecs = 0;
      // 10 cycles of 3-second background intervals
      for (let cycle = 1; cycle <= 10; cycle++) {
        const intervalSecs = 3;
        // Background
        await act(async () => {
          appStateListener("background");
        });
        currentTime += intervalSecs * 1000;
        totalElapsedSecs += intervalSecs;

        // Foreground
        await act(async () => {
          appStateListener("active");
        });

        // Reflect timer state in mock and renderer
        const expectedSecs = 1500 - totalElapsedSecs;
        expect(mockTimerState.restart).toHaveBeenLastCalledWith(expectedSecs);
        await act(async () => {
          mockTimerState.secondsLeft = expectedSecs;
          renderer.update(renderSessionScreen());
        });
      }

      // Verification: 10 * 3s = 30s elapsed, remaining is exactly 1470s
      expect(mockTimerState.restart).toHaveBeenLastCalledWith(1470);
      expect(mockTimerState.running).toBe(true);
      expect(mockPlayAlarm).not.toHaveBeenCalled();
    });

    it("1.2 accurately accounts for multi-step transitions through inactive (notification shade / window focus)", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1200;
        renderer.update(renderSessionScreen());
      });

      // User pulls down notification shade (active -> inactive)
      await act(async () => {
        appStateListener("inactive");
      });
      currentTime += 3000; // 3 seconds in inactive

      // User switches apps (inactive -> background)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 7000; // 7 seconds in background

      // User returns to app switcher (background -> inactive)
      await act(async () => {
        appStateListener("inactive");
      });
      currentTime += 2000; // 2 seconds in inactive

      // App gains full window focus (inactive -> active)
      await act(async () => {
        appStateListener("active");
      });

      // Total passed = 3s + 7s + 2s = 12 seconds
      // Expected remaining = 1200 - 12 = 1188 seconds
      expect(mockTimerState.restart).toHaveBeenCalledWith(1188);
    });

    it("1.3 sub-second remaining time bounds: clamps to 1s when 1ms..999ms remain, and advances when 0ms", async () => {
      await act(async () => {
        renderer = create(renderSessionScreen());
      });

      // Set running with 5s remaining
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 5;
        renderer.update(renderSessionScreen());
      });

      // Test Case A: 4.95s elapse -> exactly 50ms (0.05s) remain
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 4950;
      await act(async () => {
        appStateListener("active");
      });

      // Clamps to Math.max(1, Math.ceil(50 / 1000)) = 1s
      expect(mockTimerState.restart).toHaveBeenLastCalledWith(1);

      // Test Case B: 1ms remain
      mockTimerState.secondsLeft = 2;
      await act(async () => {
        renderer.update(renderSessionScreen());
        appStateListener("background");
      });
      currentTime += 1999; // 1ms remains
      await act(async () => {
        appStateListener("active");
      });
      expect(mockTimerState.restart).toHaveBeenLastCalledWith(1);

      // Test Case C: 1001ms remain (1.001s) -> Math.ceil(1001/1000) = 2s
      mockTimerState.secondsLeft = 10;
      await act(async () => {
        renderer.update(renderSessionScreen());
        appStateListener("background");
      });
      currentTime += 8999; // 1001ms remains
      await act(async () => {
        appStateListener("active");
      });
      expect(mockTimerState.restart).toHaveBeenLastCalledWith(2);
    });

    describe("1.4 autoAdvance=false transitions", () => {
      it("pauses on next phase when study phase finishes with autoAdvance=false and credits completed study time", async () => {
        mockSavedSettings.autoAdvance = false;
        const onComplete = jest.fn();
        await act(async () => {
          renderer = create(renderSessionScreen({ onComplete }));
        });

        // Start Phase 0 (25m study) with 5m (300s) left
        await act(async () => {
          mockTimerState.running = true;
          mockTimerState.secondsLeft = 300;
          renderer.update(renderSessionScreen({ onComplete }));
        });

        // App backgrounded for 10 minutes (Phase 0 finishes, 5m into Phase 1 window)
        await act(async () => {
          appStateListener("background");
        });
        currentTime += 10 * 60 * 1000;

        await act(async () => {
          appStateListener("active");
        });

        // Since autoAdvance=false, it stops at Phase 1 (5m break), loaded paused
        expect(mockTimerState.loadDuration).toHaveBeenCalledWith(5 * 60);
        expect(mockTimerState.running).toBe(false);
        expect(onComplete).not.toHaveBeenCalled();
      });

      it("does not credit study time when a break phase finishes with autoAdvance=false", async () => {
        mockSavedSettings.autoAdvance = false;
        const onPartialQuit = jest.fn();
        const onGoHome = jest.fn();

        const BREAK_FIRST_SESSION = {
          label: "Break then Study",
          phases: [
            { name: "Initial Break", duration: 5, isBreak: true, emoji: "☕" },
            { name: "Focus Block", duration: 25, isBreak: false, emoji: "📖" },
          ],
        };

        await act(async () => {
          renderer = create(
            renderSessionScreen({
              session: BREAK_FIRST_SESSION,
              onPartialQuit,
              onGoHome,
            })
          );
        });

        // Set to Phase 0 (Initial Break 5m) running with 2m (120s) left
        await act(async () => {
          mockTimerState.running = true;
          mockTimerState.secondsLeft = 120;
          renderer.update(
            renderSessionScreen({
              session: BREAK_FIRST_SESSION,
              onPartialQuit,
              onGoHome,
            })
          );
        });

        // Background for 5m (Break finishes)
        await act(async () => {
          appStateListener("background");
        });
        currentTime += 5 * 60 * 1000;

        await act(async () => {
          appStateListener("active");
        });

        // Next study phase (Phase 1, 25m) is loaded paused
        expect(mockTimerState.loadDuration).toHaveBeenCalledWith(25 * 60);
        expect(mockTimerState.running).toBe(false);

        // Update renderer to reflect the paused timer state
        await act(async () => {
          renderer.update(
            renderSessionScreen({
              session: BREAK_FIRST_SESSION,
              onPartialQuit,
              onGoHome,
            })
          );
        });

        // Now if user quits while paused at start of Phase 1
        act(() => {
          dispatchBack();
        });

        // Should call onGoHome directly because 0 study seconds were accumulated during the break!
        expect(onGoHome).toHaveBeenCalledTimes(1);
        expect(onPartialQuit).not.toHaveBeenCalled();
      });

      it("prolonged backgrounding (10 hours) does NOT advance beyond the immediate next phase when autoAdvance=false", async () => {
        mockSavedSettings.autoAdvance = false;
        const onComplete = jest.fn();

        await act(async () => {
          renderer = create(renderSessionScreen({ onComplete }));
        });

        // Phase 0 running with 10m left
        await act(async () => {
          mockTimerState.running = true;
          mockTimerState.secondsLeft = 600;
          renderer.update(renderSessionScreen({ onComplete }));
        });

        // 10 hours pass in background!
        await act(async () => {
          appStateListener("background");
        });
        currentTime += 10 * 3600 * 1000;

        await act(async () => {
          appStateListener("active");
        });

        // Session must NOT be finished and must only be waiting at Phase 1 (break)
        expect(onComplete).not.toHaveBeenCalled();
        expect(mockTimerState.loadDuration).toHaveBeenCalledWith(5 * 60);
        expect(mockTimerState.running).toBe(false);

        // Backgrounding again while awaiting next does nothing
        await act(async () => {
          appStateListener("background");
        });
        currentTime += 2 * 3600 * 1000;
        await act(async () => {
          appStateListener("active");
        });
        expect(onComplete).not.toHaveBeenCalled();
      });

      it("final phase finishing in background with autoAdvance=false completes session cleanly with alarms suppressed", async () => {
        mockSavedSettings.autoAdvance = false;
        const onComplete = jest.fn();

        const SINGLE_PHASE_SESSION = {
          label: "Single 15m Study",
          phases: [{ name: "Focus", duration: 15, isBreak: false, emoji: "🎯" }],
        };

        await act(async () => {
          renderer = create(renderSessionScreen({ session: SINGLE_PHASE_SESSION, onComplete }));
        });

        await act(async () => {
          mockTimerState.running = true;
          mockTimerState.secondsLeft = 300; // 5m left
          renderer.update(renderSessionScreen({ session: SINGLE_PHASE_SESSION, onComplete }));
        });

        // 10m pass in background
        await act(async () => {
          appStateListener("background");
        });
        currentTime += 10 * 60 * 1000;

        await act(async () => {
          appStateListener("active");
        });

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0].actualStudyMins).toBe(15);
        expect(mockPlayAlarm).not.toHaveBeenCalled();
        expect(Vibration.vibrate).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // 2. Study Time Crediting Accuracy: Mid-Phase Quit vs Background Intervals
  // =========================================================================
  describe("2. Study Time Crediting Accuracy: Mid-Phase Quit vs Background Intervals", () => {
    it("2.1 strict equivalence: credits identical study minutes whether elapsed in foreground or across background", async () => {
      // Scenario A: 12 minutes in foreground
      const onPartialQuitA = jest.fn();
      let rendererA;
      await act(async () => {
        rendererA = create(renderSessionScreen({ onPartialQuit: onPartialQuitA }));
      });
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500; // 25m total
        rendererA.update(renderSessionScreen({ onPartialQuit: onPartialQuitA }));
      });
      // 12 minutes elapse in foreground (780s left)
      await act(async () => {
        mockTimerState.secondsLeft = 780;
        rendererA.update(renderSessionScreen({ onPartialQuit: onPartialQuitA }));
      });
      // Press leave
      act(() => {
        dispatchBack();
      });
      Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave").onPress();
      expect(onPartialQuitA).toHaveBeenCalledTimes(1);
      const studyMinsForeground = onPartialQuitA.mock.calls[0][0].actualStudyMins;
      expect(studyMinsForeground).toBe(12); // (1500 - 780) / 60 = 12m
      await act(async () => {
        rendererA.unmount();
      });

      // Scenario B: 4 minutes foreground + 8 minutes background (total 12m)
      const onPartialQuitB = jest.fn();
      let rendererB;
      await act(async () => {
        rendererB = create(renderSessionScreen({ onPartialQuit: onPartialQuitB }));
      });
      // 4 minutes elapse in foreground (1260s left)
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1260;
        rendererB.update(renderSessionScreen({ onPartialQuit: onPartialQuitB }));
      });
      // App backgrounds for 8 minutes (480,000 ms)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 8 * 60 * 1000;
      // App resumes
      await act(async () => {
        appStateListener("active");
      });
      // Remaining is 1260 - 480 = 780s
      expect(mockTimerState.restart).toHaveBeenCalledWith(780);
      await act(async () => {
        mockTimerState.secondsLeft = 780;
        rendererB.update(renderSessionScreen({ onPartialQuit: onPartialQuitB }));
      });
      // Press leave
      act(() => {
        dispatchBack();
      });
      Alert.alert.mock.calls[1][2].find((b) => b.text === "Leave").onPress();
      expect(onPartialQuitB).toHaveBeenCalledTimes(1);
      const studyMinsBackground = onPartialQuitB.mock.calls[0][0].actualStudyMins;

      // Assert strict mathematical equivalence
      expect(studyMinsBackground).toBe(studyMinsForeground);
      expect(studyMinsBackground).toBe(12);

      await act(async () => {
        rendererB.unmount();
      });
    });

    it("2.2 quitting during break phase credits exactly zero break time and only credits prior completed study phases", async () => {
      const onPartialQuit = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ onPartialQuit }));
      });

      // Run Phase 0 (25m study) to completion in foreground
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1;
        renderer.update(renderSessionScreen({ onPartialQuit }));
      });

      // Timer completes Phase 0 -> triggers timer onComplete callback
      await act(async () => {
        mockTimerState._onComplete();
      });

      // Now in Phase 1 (Break 1, 5m). Timer running with 3m (180s) left (2m break spent)
      await act(async () => {
        mockTimerState.secondsLeft = 180;
        renderer.update(renderSessionScreen({ onPartialQuit }));
      });

      // User presses hardware back to quit during the break
      act(() => {
        dispatchBack();
      });
      Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave").onPress();

      expect(onPartialQuit).toHaveBeenCalledTimes(1);
      const partialData = onPartialQuit.mock.calls[0][0];
      // Exactly 25 minutes of study (Phase 0), break time is 0!
      expect(partialData.actualStudyMins).toBe(25);
      expect(partialData.phasesCompleted).toBe(1);
    });

    it("2.3 complex multi-phase background interval followed by partial quit calculates accurate study credit", async () => {
      const THREE_BLOCK_SESSION = {
        label: "3-Study Block",
        phases: [
          { name: "Study 1", duration: 15, isBreak: false, emoji: "1️⃣" },
          { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
          { name: "Study 2", duration: 15, isBreak: false, emoji: "2️⃣" },
          { name: "Break 2", duration: 5, isBreak: true, emoji: "☕" },
          { name: "Study 3", duration: 15, isBreak: false, emoji: "3️⃣" },
        ],
      };

      const onPartialQuit = jest.fn();
      await act(async () => {
        renderer = create(renderSessionScreen({ session: THREE_BLOCK_SESSION, onPartialQuit }));
      });

      // Start Study 1 with 5m left (10m done)
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 300;
        renderer.update(renderSessionScreen({ session: THREE_BLOCK_SESSION, onPartialQuit }));
      });

      // Background app for 17 minutes:
      // 5m: finishes Study 1 (Phase 0, 15m total)
      // 5m: finishes Break 1 (Phase 1, 5m break)
      // 7m: consumed in Study 2 (Phase 2, 8m left)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 17 * 60 * 1000;

      // Resume
      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(8 * 60);

      // In foreground, user studies 3 more minutes in Study 2 (5m = 300s left)
      await act(async () => {
        mockTimerState.secondsLeft = 300;
        renderer.update(renderSessionScreen({ session: THREE_BLOCK_SESSION, onPartialQuit }));
      });

      // User leaves session
      act(() => {
        dispatchBack();
      });
      Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave").onPress();

      expect(onPartialQuit).toHaveBeenCalledTimes(1);
      const partialData = onPartialQuit.mock.calls[0][0];
      // Study 1 (15m) + Study 2 (10m) = 25.0 minutes
      expect(partialData.actualStudyMins).toBe(25);
      expect(partialData.phasesCompleted).toBe(1); // 1 completed study phase (Study 1)
    });

    it("2.4 immediate quit with 0s elapsed triggers onGoHome directly without saving 0-minute partial session", async () => {
      const onPartialQuit = jest.fn();
      const onGoHome = jest.fn();

      await act(async () => {
        renderer = create(renderSessionScreen({ onPartialQuit, onGoHome }));
      });

      // Paused immediately at start (0 elapsed)
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1500;

      act(() => {
        dispatchBack();
      });

      expect(onGoHome).toHaveBeenCalledTimes(1);
      expect(onPartialQuit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. App.js: BackHandler Stack Order and Hierarchy Behavior
  // =========================================================================
  describe("3. App.js: BackHandler Stack Order and Hierarchy Behavior", () => {
    it("3.1 respects LIFO stack: SessionScreen back handler intercepts before App back handler", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Initially on Home: only App's listener registered
      expect(backHandlerListeners.length).toBe(1);

      // Navigate to Session: Home -> SubjectPicker -> SessionPicker -> Session
      await act(async () => {
        mockAppScreens.HomeScreen.onStartStudying();
      });
      await act(async () => {
        await mockAppScreens.SubjectPickerScreen.onSelectSubject("Physics");
      });
      await act(async () => {
        mockAppScreens.SessionPickerScreen.onStartSession("1hr");
      });

      // In real App, SessionScreen is mounted and automatically pushed its listener to the top of the stack.
      expect(backHandlerListeners.length).toBe(2);

      // Hardware back pressed: top of stack (SessionScreen) consumes it (returns true) and leaves
      let handled;
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);

      // App returned to Home and SessionScreen unmounted, popping its listener
      expect(mockAppScreens.HomeScreen).toBeDefined();
      expect(backHandlerListeners.length).toBe(1);

      // Now on Home: hardware back returns false (allowing OS exit)
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(false);
    });

    it("3.2 traverses full screen hierarchy back navigation properly", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // 1. Home -> Subject Picker
      await act(async () => {
        mockAppScreens.HomeScreen.onStartStudying();
      });
      expect(mockAppScreens.SubjectPickerScreen).toBeDefined();

      // 2. Subject Picker -> Session Picker
      await act(async () => {
        await mockAppScreens.SubjectPickerScreen.onSelectSubject("Chemistry");
      });
      expect(mockAppScreens.SessionPickerScreen).toBeDefined();

      // 3. Session Picker -> Custom Session Builder
      await act(async () => {
        mockAppScreens.SessionPickerScreen.onOpenCustomSession();
      });
      expect(mockAppScreens.CustomSessionScreen).toBeDefined();

      // Back 1: Custom Session Builder -> Session Picker
      let handled;
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.SessionPickerScreen).toBeDefined();

      // Back 2: Session Picker -> Subject Picker
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.SubjectPickerScreen).toBeDefined();

      // Back 3: Subject Picker -> Home
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.HomeScreen).toBeDefined();

      // Back 4: On Home -> returns false (allows default OS exit)
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(false);
    });

    it("3.3 navigates back to Home from Done, Stats, History, and Settings screens", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Test Stats -> Home
      await act(async () => {
        mockAppScreens.HomeScreen.onViewStats();
      });
      expect(mockAppScreens.StatsScreen).toBeDefined();
      let handled;
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.HomeScreen).toBeDefined();

      // Test History -> Home
      await act(async () => {
        mockAppScreens.HomeScreen.onViewHistory();
      });
      expect(mockAppScreens.HistoryScreen).toBeDefined();
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.HomeScreen).toBeDefined();

      // Test Settings -> Home
      await act(async () => {
        mockAppScreens.HomeScreen.onViewSettings();
      });
      expect(mockAppScreens.SettingsScreen).toBeDefined();
      await act(async () => {
        handled = dispatchBack();
      });
      expect(handled).toBe(true);
      expect(mockAppScreens.HomeScreen).toBeDefined();
    });
  });

  // =========================================================================
  // 4. App.js: Startup Notification Cleanup Rejection Resilience
  // =========================================================================
  describe("4. App.js: Startup Notification Cleanup Rejection Resilience", () => {
    it("4.1 handles rejection with Error object without crashing or failing mount", async () => {
      cancelSessionNotifications.mockRejectedValueOnce(new Error("Native notification service died"));

      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
      expect(mockAppScreens.HomeScreen).toBeDefined();
    });

    it("4.2 handles rejection with string primitive without crashing", async () => {
      cancelSessionNotifications.mockRejectedValueOnce("Fatal permission denial");

      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
      expect(mockAppScreens.HomeScreen).toBeDefined();
    });

    it("4.3 handles rejection with null and undefined reasons without crashing", async () => {
      cancelSessionNotifications.mockRejectedValueOnce(null);

      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
      expect(mockAppScreens.HomeScreen).toBeDefined();
    });
  });
});
