import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import SessionScreen from "../SessionScreen";
import { ThemeProvider } from "../../theme/ThemeContext";

jest.setTimeout(15000);

// Mocks
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

let mockTimerState = {
  secondsLeft: 1500,
  running: false,
  setRunning: jest.fn(),
  loadDuration: jest.fn(),
  stop: jest.fn(),
  restart: jest.fn(),
};

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

describe("SessionScreen Lifecycle, Reconciliation & BackHandler", () => {
  const SAMPLE_SESSION = {
    label: "Pomodoro 25/5",
    phases: [
      { name: "Deep Study", duration: 25, isBreak: false, emoji: "📖" },
      { name: "Short Break", duration: 5, isBreak: true, emoji: "☕" },
    ],
  };

  const MULTI_STUDY_SESSION = {
    label: "2-Block Study",
    phases: [
      { name: "Study 1", duration: 20, isBreak: false, emoji: "📖" },
      { name: "Break", duration: 5, isBreak: true, emoji: "☕" },
      { name: "Study 2", duration: 15, isBreak: false, emoji: "📝" },
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
          session={props.session || SAMPLE_SESSION}
          subject="Computer Science"
          subjectColor="#3b82f6"
          onGoHome={props.onGoHome || jest.fn()}
          onComplete={props.onComplete || jest.fn()}
          onPartialQuit={props.onPartialQuit || jest.fn()}
        />
      </ThemeProvider>
    );
  }

  describe("AppState active event reconciliation", () => {
    it("Branch 1: All phases finished in background triggers finishSession without late alarms or vibration", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSession({ session: SAMPLE_SESSION, onComplete }));
      });

      // Start the timer
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSession({ session: SAMPLE_SESSION, onComplete }));
      });

      // App transitions to background
      await act(async () => {
        appStateListener("background");
      });

      // Time advances 35 minutes (more than 25 + 5 mins = 30 mins)
      currentTime += 35 * 60 * 1000;

      // App transitions back to active
      await act(async () => {
        appStateListener("active");
      });

      // Verification:
      // 1. onComplete called with 25 study minutes (break phase duration is excluded)
      expect(onComplete).toHaveBeenCalledTimes(1);
      const callArg = onComplete.mock.calls[0][0];
      expect(callArg.actualStudyMins).toBe(25);

      // 2. Late in-app alarm and vibration are suppressed
      expect(mockPlayAlarm).not.toHaveBeenCalled();
      expect(Vibration.vibrate).not.toHaveBeenCalled();

      // 3. Timer stopped and notifications canceled
      expect(mockTimerState.stop).toHaveBeenCalled();
      expect(mockCancelAll).toHaveBeenCalled();
    });

    it("Branch 2: Phase finished when autoAdvance is disabled loads next phase in paused state", async () => {
      mockSavedSettings.autoAdvance = false;
      const onComplete = jest.fn();

      await act(async () => {
        renderer = create(renderSession({ session: SAMPLE_SESSION, onComplete }));
      });

      // Start timer with 10 mins remaining in 25 min study phase
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 600; // 10 minutes left
        renderer.update(renderSession({ session: SAMPLE_SESSION, onComplete }));
      });

      // Background app
      await act(async () => {
        appStateListener("background");
      });

      // 15 minutes pass in background (Phase 0 finishes, but autoAdvance is off)
      currentTime += 15 * 60 * 1000;

      // Resume to active
      await act(async () => {
        appStateListener("active");
      });

      // Verification:
      // Next phase (5-min break) duration is loaded in paused state
      expect(mockTimerState.loadDuration).toHaveBeenCalledWith(5 * 60);
      expect(mockTimerState.running).toBe(false);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("Branch 3: Still running in current phase calculates remaining seconds and restarts countdown", async () => {
      await act(async () => {
        renderer = create(renderSession({ session: SAMPLE_SESSION }));
      });

      // Start timer with 1500s remaining
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1500;
        renderer.update(renderSession({ session: SAMPLE_SESSION }));
      });

      // Background app
      await act(async () => {
        appStateListener("background");
      });

      // 5 minutes (300s = 300,000ms) pass
      currentTime += 300 * 1000;

      // Resume
      await act(async () => {
        appStateListener("active");
      });

      // Verification:
      // Restarted with remaining 1200 seconds (1500 - 300)
      expect(mockTimerState.restart).toHaveBeenCalledWith(1200);
      expect(mockPlayAlarm).not.toHaveBeenCalled();
    });

    it("Branch 3: Advanced to a later phase while running credits prior study phase and restarts with remaining time", async () => {
      const onComplete = jest.fn();
      await act(async () => {
        renderer = create(renderSession({ session: MULTI_STUDY_SESSION, onComplete }));
      });

      // Start in Phase 0 (20m study) with 5m (300s) left
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 300;
        renderer.update(renderSession({ session: MULTI_STUDY_SESSION, onComplete }));
      });

      // Background app
      await act(async () => {
        appStateListener("background");
      });

      // 8 minutes (480s) pass in background:
      // 5 minutes consume the rest of Phase 0 (study 20m completed)
      // 3 minutes consumed from Phase 1 (break 5m), so 2 minutes (120s) remain in Phase 1
      currentTime += 8 * 60 * 1000;

      // Resume
      await act(async () => {
        appStateListener("active");
      });

      // Restarted with remaining 120 seconds in Phase 1
      expect(mockTimerState.restart).toHaveBeenCalledWith(120);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("does not reconcile if the timer was paused by user before backgrounding", async () => {
      await act(async () => {
        renderer = create(renderSession({ session: SAMPLE_SESSION }));
      });

      // Timer paused with 1200s left
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1200;

      // Background app
      await act(async () => {
        appStateListener("background");
      });

      // 20 minutes pass
      currentTime += 20 * 60 * 1000;

      // Resume
      await act(async () => {
        appStateListener("active");
      });

      // Verification: timer remained paused, restart was not called
      expect(mockTimerState.restart).not.toHaveBeenCalled();
      expect(mockTimerState.loadDuration).toHaveBeenCalledTimes(1); // Only initial load on mount
    });

    it("handles inactive to active transition smoothly", async () => {
      await act(async () => {
        renderer = create(renderSession({ session: SAMPLE_SESSION }));
      });

      // Timer running
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1000;
        renderer.update(renderSession({ session: SAMPLE_SESSION }));
      });

      // Transition to inactive (e.g. notification shade or app switcher)
      await act(async () => {
        appStateListener("inactive");
      });

      // 100s pass
      currentTime += 100 * 1000;

      // Transition back to active
      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(900);
    });
  });

  describe("Hardware BackHandler Interception", () => {
    it("registers BackHandler on mount and cleans up on unmount", async () => {
      await act(async () => {
        renderer = create(renderSession());
      });

      expect(backHandlerListener).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
      renderer = null;

      expect(backHandlerListener).toBeNull();
    });

    it("shows leave confirmation alert and returns true when timer is running", async () => {
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSession({ onGoHome }));
      });

      // Set running to true
      await act(async () => {
        mockTimerState.running = true;
        renderer.update(renderSession({ onGoHome }));
      });

      // Press hardware back button
      let result;
      act(() => {
        result = backHandlerListener();
      });

      expect(result).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Leave Session?",
        expect.stringContaining("timer is still running"),
        expect.any(Array)
      );

      // Verify leave action from alert
      const buttons = Alert.alert.mock.calls[0][2];
      const leaveButton = buttons.find((b) => b.text === "Leave");
      expect(leaveButton).toBeDefined();

      act(() => {
        leaveButton.onPress();
      });

      expect(mockTimerState.stop).toHaveBeenCalled();
      expect(mockCancelAll).toHaveBeenCalled();
      expect(onGoHome).toHaveBeenCalled();
    });

    it("leaves immediately without confirmation alert and returns true when paused", async () => {
      const onGoHome = jest.fn();
      await act(async () => {
        renderer = create(renderSession({ onGoHome }));
      });

      mockTimerState.running = false;

      let result;
      act(() => {
        result = backHandlerListener();
      });

      expect(result).toBe(true);
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(mockTimerState.stop).toHaveBeenCalled();
      expect(onGoHome).toHaveBeenCalled();
    });
  });
});
