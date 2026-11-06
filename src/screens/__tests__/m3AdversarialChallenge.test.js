import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import SessionScreen from "../SessionScreen";
import { ThemeProvider } from "../../theme/ThemeContext";

jest.setTimeout(15000);

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
}));

describe("M3 Adversarial & Edge Case Challenges", () => {
  const FIVE_PHASE_SESSION = {
    label: "3x Study + 2x Break",
    phases: [
      { name: "Study 1", duration: 25, isBreak: false, emoji: "1️⃣" },
      { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Study 2", duration: 25, isBreak: false, emoji: "2️⃣" },
      { name: "Break 2", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Study 3", duration: 25, isBreak: false, emoji: "3️⃣" },
    ],
  };

  let renderer;
  let appStateListener = null;
  let backHandlerListener = null;
  let originalDateNow;
  let currentTime = 1000000000;

  beforeEach(() => {
    jest.clearAllMocks();
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

    backHandlerListener = null;
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") {
        backHandlerListener = cb;
      }
      return {
        remove: jest.fn(() => {
          if (backHandlerListener === cb) backHandlerListener = null;
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

  function renderSession(props = {}) {
    return (
      <ThemeProvider>
        <SessionScreen
          session={props.session || FIVE_PHASE_SESSION}
          subject="Advanced Mathematics"
          subjectColor="#6366f1"
          onGoHome={props.onGoHome || jest.fn()}
          onComplete={props.onComplete || jest.fn()}
          onPartialQuit={props.onPartialQuit || jest.fn()}
        />
      </ThemeProvider>
    );
  }

  it("accurately accumulates study credit across multi-phase background intervals skipping breaks", async () => {
    const onComplete = jest.fn();
    await act(async () => {
      renderer = create(renderSession({ onComplete }));
    });

    // Start timer with 5m (300s) left in Study 1
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 300;
      renderer.update(renderSession({ onComplete }));
    });

    // Background app
    await act(async () => {
      appStateListener("background");
    });

    // Advance time by 32 minutes (1,920,000 ms):
    // 5m: finishes Study 1 (Phase 0, 25m total credited)
    // 5m: finishes Break 1 (Phase 1, 0m credited)
    // 20m: consumes 20m of Study 2 (Phase 2, 25m total)
    // Remaining in Study 2: 5m (300s)
    currentTime += 30 * 60 * 1000;

    // Resume
    await act(async () => {
      appStateListener("active");
    });

    // Verify Study 1 was credited and timer restarted at Phase 2 with 5m
    expect(mockTimerState.restart).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    // Now background again for 40 minutes:
    // 5m: finishes Study 2 (credited 25m)
    // 5m: finishes Break 2 (credited 0m)
    // 25m: finishes Study 3 (credited 25m)
    // 5m: excess time after whole session completes
    await act(async () => {
      appStateListener("background");
    });

    currentTime += 40 * 60 * 1000;

    await act(async () => {
      appStateListener("active");
    });

    // Now all 3 study blocks have completed: 25 + 25 + 25 = 75 minutes!
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0].actualStudyMins).toBe(75);
    expect(mockPlayAlarm).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it("correctly credits accumulated background study time on partial quit", async () => {
    const onPartialQuit = jest.fn();
    const onGoHome = jest.fn();

    await act(async () => {
      renderer = create(renderSession({ onPartialQuit, onGoHome }));
    });

    // Start timer with 5m (300s) remaining in Study 1
    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 300;
      renderer.update(renderSession({ onPartialQuit, onGoHome }));
    });

    // Background app
    await act(async () => {
      appStateListener("background");
    });

    // 12 minutes elapse:
    // 5m finishes Study 1 (25m study)
    // 5m finishes Break 1 (5m break)
    // 2m into Study 2 (23m = 1380s left)
    currentTime += 12 * 60 * 1000;

    // Resume to active
    await act(async () => {
      appStateListener("active");
    });

    expect(mockTimerState.restart).toHaveBeenCalledWith(1380);

    // Update mock state with 1380s left in Study 2
    await act(async () => {
      mockTimerState.secondsLeft = 1380;
      renderer.update(renderSession({ onPartialQuit, onGoHome }));
    });

    // User presses hardware back button to quit
    act(() => {
      const handled = backHandlerListener();
      expect(handled).toBe(true);
    });

    // Confirm "Leave" in alert
    const buttons = Alert.alert.mock.calls[0][2];
    const leaveBtn = buttons.find((b) => b.text === "Leave");

    await act(async () => {
      leaveBtn.onPress();
    });

    // Study 1 (25m) + 2m elapsed in Study 2 = 27m actualStudyMins!
    expect(onPartialQuit).toHaveBeenCalledTimes(1);
    const partialArg = onPartialQuit.mock.calls[0][0];
    expect(partialArg.actualStudyMins).toBe(27);
    expect(partialArg.phasesCompleted).toBe(1); // 1 completed study phase (Study 1)
  });

  it("clamps remaining seconds to at least 1 when remainingMs is less than a second", async () => {
    await act(async () => {
      renderer = create(renderSession());
    });

    await act(async () => {
      mockTimerState.running = true;
      mockTimerState.secondsLeft = 10;
      renderer.update(renderSession());
    });

    await act(async () => {
      appStateListener("background");
    });

    // 9.95 seconds pass (50ms left)
    currentTime += 9950;

    await act(async () => {
      appStateListener("active");
    });

    // Clamps to at least 1s
    expect(mockTimerState.restart).toHaveBeenCalledWith(1);
  });
});
