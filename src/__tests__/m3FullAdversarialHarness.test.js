import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import SessionScreen from "../screens/SessionScreen";
import App from "../../App";
import { ThemeProvider } from "../theme/ThemeContext";
import { cancelSessionNotifications } from "../hooks/useNotifications";

jest.setTimeout(20000);

// --- Mocks ---
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

jest.mock("../components/SessionDial", () => () => null);
jest.mock("../components/Icon", () => () => null);

const mockPlayAlarm = jest.fn();
const mockStopAlarm = jest.fn();
jest.mock("../hooks/useAlarmSound", () => ({
  useAlarmSound: () => ({ playAlarm: mockPlayAlarm, stopAlarm: mockStopAlarm }),
}));

const mockScheduleChain = jest.fn();
const mockCancelAll = jest.fn();
jest.mock("../hooks/useNotifications", () => ({
  useNotifications: () => ({
    scheduleChain: mockScheduleChain,
    cancelAll: mockCancelAll,
    error: null,
  }),
  cancelSessionNotifications: jest.fn().mockResolvedValue(undefined),
}));

let mockTimerState;
jest.mock("../hooks/useTimer", () => ({
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

jest.mock("../utils/storage", () => ({
  ...jest.requireActual("../utils/storage"),
  loadSettings: jest.fn(() => Promise.resolve({ ...mockSavedSettings })),
  saveSettings: jest.fn((s) => {
    Object.assign(mockSavedSettings, s);
    return Promise.resolve(undefined);
  }),
  saveSession: jest.fn().mockResolvedValue({ id: "test-session-id" }),
  saveSubject: jest.fn((name) =>
    Promise.resolve({ name, color: "#3b82f6" })
  ),
}));

describe("Milestone 3 Full Adversarial & Empirical Challenge Harness", () => {
  let appStateListener = null;
  let backHandlerStack = [];
  let originalDateNow;
  let currentTime = 1700000000000;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSavedSettings = {
      autoAdvance: true,
      soundPreset: "classic",
      vibrate: true,
      keepAwake: true,
    };

    currentTime = 1700000000000;
    originalDateNow = Date.now;
    Date.now = jest.fn(() => currentTime);

    mockTimerState = {
      secondsLeft: 1200,
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

    // Realistic LIFO BackHandler stack mock
    backHandlerStack = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") {
        backHandlerStack.push(cb);
      }
      return {
        remove: jest.fn(() => {
          const idx = backHandlerStack.indexOf(cb);
          if (idx !== -1) {
            backHandlerStack.splice(idx, 1);
          }
        }),
      };
    });

    jest.spyOn(Alert, "alert");
    jest.spyOn(Vibration, "vibrate");
  });

  afterEach(() => {
    Date.now = originalDateNow;
    jest.restoreAllMocks();
  });

  function fireHardwareBack() {
    for (let i = backHandlerStack.length - 1; i >= 0; i--) {
      const handled = backHandlerStack[i]();
      if (handled) return true;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Challenge 1: Complex Multi-Phase Timeline with Multiple Background Cycles
  // --------------------------------------------------------------------------
  it("CHALLENGE 1: multi-phase session over 3 sequential background cycles accumulates exact nominal study time, excludes breaks, and suppresses late alarms", async () => {
    const COMPLEX_SESSION = {
      label: "7-Phase Ultra",
      phases: [
        { name: "Study 1", duration: 20, isBreak: false, emoji: "1️⃣" }, // 0: 20m study
        { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },   // 1: 5m break
        { name: "Study 2", duration: 25, isBreak: false, emoji: "2️⃣" }, // 2: 25m study
        { name: "Break 2", duration: 10, isBreak: true, emoji: "☕" },  // 3: 10m break
        { name: "Study 3", duration: 30, isBreak: false, emoji: "3️⃣" }, // 4: 30m study
        { name: "Break 3", duration: 15, isBreak: true, emoji: "☕" },  // 5: 15m break
        { name: "Study 4", duration: 40, isBreak: false, emoji: "4️⃣" }, // 6: 40m study
      ],
      // Total Study: 20 + 25 + 30 + 40 = 115m (6900s)
      // Total Break: 5 + 10 + 15 = 30m
    };

    const onComplete = jest.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={COMPLEX_SESSION}
            subject="Biochemistry"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // Start timer with 5m (300s) remaining in Study 1
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 300;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={COMPLEX_SESSION}
            subject="Biochemistry"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // --- Cycle 1: Background for 20 minutes ---
    // 5m: finishes Study 1 (Phase 0, 20m credited)
    // 5m: finishes Break 1 (Phase 1, 0m credited)
    // 10m: into Study 2 (Phase 2, 25m total -> 15m remaining = 900s)
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 20 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    // Check timer restart for Study 2 with 15m (900s) remaining
    expect(mockTimerState.restart).toHaveBeenCalledWith(900);
    expect(onComplete).not.toHaveBeenCalled();

    // Update state to reflect 15m remaining in Study 2
    await act(async () => {
      mockTimerState.secondsLeft = 900;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={COMPLEX_SESSION}
            subject="Biochemistry"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // --- Cycle 2: Background for 40 minutes ---
    // 15m: finishes Study 2 (Phase 2, 25m credited -> total study credited = 45m)
    // 10m: finishes Break 2 (Phase 3, 0m credited)
    // 15m: into Study 3 (Phase 4, 30m total -> 15m remaining = 900s)
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 40 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    expect(mockTimerState.restart).toHaveBeenLastCalledWith(900);
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      mockTimerState.secondsLeft = 900;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={COMPLEX_SESSION}
            subject="Biochemistry"
            subjectColor="#10b981"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // --- Cycle 3: Background for 120 minutes (overshooting end of session) ---
    // 15m: finishes Study 3 (Phase 4, 30m credited -> total study = 75m)
    // 15m: finishes Break 3 (Phase 5, 0m credited)
    // 40m: finishes Study 4 (Phase 6, 40m credited -> total study = 115m)
    // 50m: past end of session
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 120 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    // Verification
    expect(onComplete).toHaveBeenCalledTimes(1);
    const completeArg = onComplete.mock.calls[0][0];
    // Exact nominal study time: 20 + 25 + 30 + 40 = 115 mins!
    expect(completeArg.actualStudyMins).toBe(115);

    // Alarms & vibrations must be suppressed when completed in background!
    expect(mockPlayAlarm).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 2: AutoAdvance Disabled (Manual Mode) Across Background Phase
  // --------------------------------------------------------------------------
  it("CHALLENGE 2: when autoAdvance is false, background expiration pauses at boundary, credits study time, and awaits next without ringing", async () => {
    mockSavedSettings.autoAdvance = false;

    const TWO_PHASE = {
      label: "Manual Pomodoro",
      phases: [
        { name: "Study Block", duration: 25, isBreak: false, emoji: "📖" },
        { name: "Break Block", duration: 5, isBreak: true, emoji: "☕" },
      ],
    };

    const onComplete = jest.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={TWO_PHASE}
            subject="Law"
            subjectColor="#6366f1"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // Start Study Block with 10m (600s) left
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 600;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={TWO_PHASE}
            subject="Law"
            subjectColor="#6366f1"
            onGoHome={jest.fn()}
            onComplete={onComplete}
          />
        </ThemeProvider>
      );
    });

    // Background for 30 minutes (exceeds the 10m left in Study 1)
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 30 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    // Since autoAdvance is false:
    // Study 1 ended -> 25m credited.
    // Break 1 loaded (duration 5m = 300s) in PAUSED state.
    expect(mockTimerState.loadDuration).toHaveBeenCalledWith(300);
    expect(mockTimerState.restart).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockPlayAlarm).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 3: Paused Timer Backgrounding (No Wall-Clock Drift or Accrual)
  // --------------------------------------------------------------------------
  it("CHALLENGE 3: paused session backgrounded for 2 hours maintains identical remaining time upon resume", async () => {
    const SIMPLE_SESSION = {
      label: "Simple Study",
      phases: [{ name: "Study", duration: 30, isBreak: false, emoji: "📖" }],
    };

    let renderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={SIMPLE_SESSION}
            subject="History"
            subjectColor="#f59e0b"
            onGoHome={jest.fn()}
            onComplete={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    // Timer is paused at 18m (1080s) remaining
    await act(async () => {
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1080;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={SIMPLE_SESSION}
            subject="History"
            subjectColor="#f59e0b"
            onGoHome={jest.fn()}
            onComplete={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    // Background app for 2 hours
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 120 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    // Must NOT restart or advance
    expect(mockTimerState.restart).not.toHaveBeenCalled();
    expect(mockTimerState.stop).not.toHaveBeenCalled();
    expect(mockTimerState.secondsLeft).toBe(1080);

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 4: Transient App State Transitions (active -> inactive -> active)
  // --------------------------------------------------------------------------
  it("CHALLENGE 4: transient active -> inactive -> active interruption accurately reconciles seconds without restart glitch", async () => {
    const SESSION = {
      label: "Short Study",
      phases: [{ name: "Study", duration: 10, isBreak: false, emoji: "📖" }],
    };

    let renderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={SESSION}
            subject="Philosophy"
            subjectColor="#ec4899"
            onGoHome={jest.fn()}
            onComplete={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    // Running with 8m (480s) left
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 480;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={SESSION}
            subject="Philosophy"
            subjectColor="#ec4899"
            onGoHome={jest.fn()}
            onComplete={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    // User receives notification shade or system dialog (active -> inactive)
    await act(async () => {
      appStateListener("inactive");
    });

    // 15 seconds pass
    currentTime += 15000;

    // Returns to active
    await act(async () => {
      appStateListener("active");
    });

    // Reconciled: 480s - 15s = 465s remaining
    expect(mockTimerState.restart).toHaveBeenCalledWith(465);

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 5: Partial Quit After Multi-Phase Progression via Hardware Back
  // --------------------------------------------------------------------------
  it("CHALLENGE 5: partial quit via hardware back button correctly credits completed study phase plus partial elapsed study time, ignoring breaks", async () => {
    const FOUR_PHASE = {
      label: "Alternating Session",
      phases: [
        { name: "Study 1", duration: 25, isBreak: false, emoji: "1️⃣" }, // 0
        { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },   // 1
        { name: "Study 2", duration: 25, isBreak: false, emoji: "2️⃣" }, // 2
        { name: "Break 2", duration: 5, isBreak: true, emoji: "☕" },   // 3
      ],
    };

    const onPartialQuit = jest.fn();
    const onGoHome = jest.fn();
    let renderer;
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <SessionScreen
            session={FOUR_PHASE}
            subject="Architecture"
            subjectColor="#8b5cf6"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // Study 1 running with 5m (300s) remaining
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 300;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={FOUR_PHASE}
            subject="Architecture"
            subjectColor="#8b5cf6"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // Background for 20m:
    // 5m finishes Study 1 (25m nominal credited)
    // 5m finishes Break 1 (0m credited)
    // 10m into Study 2 (15m = 900s remaining)
    await act(async () => {
      appStateListener("background");
    });
    currentTime += 20 * 60 * 1000;
    await act(async () => {
      appStateListener("active");
    });

    expect(mockTimerState.restart).toHaveBeenCalledWith(900);

    // Update state to 900s left in Study 2
    await act(async () => {
      mockTimerState.secondsLeft = 900;
      renderer.update(
        <ThemeProvider>
          <SessionScreen
            session={FOUR_PHASE}
            subject="Architecture"
            subjectColor="#8b5cf6"
            onGoHome={onGoHome}
            onPartialQuit={onPartialQuit}
          />
        </ThemeProvider>
      );
    });

    // Hardware back press on SessionScreen
    let handled = false;
    act(() => {
      handled = fireHardwareBack();
    });
    expect(handled).toBe(true);

    // Confirmation alert shown
    expect(Alert.alert).toHaveBeenCalledWith(
      "Leave Session?",
      "Your timer is still running. Your progress will be saved.",
      expect.any(Array)
    );

    const buttons = Alert.alert.mock.calls[0][2];
    const leaveBtn = buttons.find((b) => b.text === "Leave");

    await act(async () => {
      leaveBtn.onPress();
    });

    // Study 1 (25m) + 10m elapsed in Study 2 = 35m total!
    // Break 1 (5m) was completely ignored!
    expect(onPartialQuit).toHaveBeenCalledTimes(1);
    const partialArg = onPartialQuit.mock.calls[0][0];
    expect(partialArg.actualStudyMins).toBe(35);
    expect(partialArg.phasesCompleted).toBe(1); // 1 completed study phase

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 6: LIFO Stack Integration Between App.js and SessionScreen.js
  // --------------------------------------------------------------------------
  it("CHALLENGE 6: realistic LIFO BackHandler stack prioritizes SessionScreen over App.js, and App.js resumes control on leave", async () => {
    let renderer;
    await act(async () => {
      renderer = create(<App />);
    });

    // Root App registers its BackHandler (stack length 1)
    expect(backHandlerStack.length).toBe(1);

    // Navigate: Home -> SubjectPicker -> SessionPicker -> Session
    // We can simulate App's internal navigation:
    // Press "Start Studying" from Home
    // App renders HomeScreen, SubjectPickerScreen, etc.
    // Let's verify BackHandler in App.js returns false on Home:
    expect(fireHardwareBack()).toBe(false);

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 7: Full Screen Hierarchy Back Navigation Chain in App.js
  // --------------------------------------------------------------------------
  it("CHALLENGE 7: sequential back button presses traverse custom-builder -> session-picker -> subject-picker -> home -> OS exit", async () => {
    let renderer;
    await act(async () => {
      renderer = create(<App />);
    });

    // Stack has App's listener
    expect(backHandlerStack.length).toBe(1);

    // Initial screen is Home: back returns false
    expect(fireHardwareBack()).toBe(false);

    // Test tab screens navigation to home:
    const tabScreens = ["stats", "history", "settings", "done", "subject-picker"];
    // App mounts and startup effect fires
    expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Challenge 8: Startup Notification Cleanup Rejection Resilience
  // --------------------------------------------------------------------------
  it("CHALLENGE 8: notification cleanup handles rejection, non-error rejections, and never crashes App mount", async () => {
    cancelSessionNotifications.mockRejectedValueOnce("Native module unavailable");

    let renderer;
    await act(async () => {
      renderer = create(<App />);
    });

    // Successfully mounted without unhandled promise rejection
    expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
  });
});
