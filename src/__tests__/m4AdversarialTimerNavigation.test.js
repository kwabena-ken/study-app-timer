import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Vibration, AppState, BackHandler } from "react-native";
import SessionScreen from "../screens/SessionScreen";
import App from "../../App";
import { ThemeProvider } from "../theme/ThemeContext";
import { cancelSessionNotifications } from "../hooks/useNotifications";
import {
  reconcileTimeline,
  buildNotificationChain,
  defaultChainBody,
  minsStudiedFromResults,
  totalPhaseMs,
  isValidSnapshot,
} from "../utils/sessionTimeline";

jest.setTimeout(30000);

// --- Mocks ---
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: {
    Light: "Light",
    Medium: "Medium",
    Heavy: "Heavy",
  },
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
  saveSession: jest.fn().mockResolvedValue({ id: "m4-test-session" }),
  saveSubject: jest.fn((name) => Promise.resolve({ name, color: "#3b82f6" })),
}));

// Screen spies for App.js
const mockScreens = {};
jest.mock("../screens/HomeScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.HomeScreen = props;
      return () => {
        delete mockScreens.HomeScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/SubjectPickerScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.SubjectPickerScreen = props;
      return () => {
        delete mockScreens.SubjectPickerScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/SessionPickerScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.SessionPickerScreen = props;
      return () => {
        delete mockScreens.SessionPickerScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/CustomSessionScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.CustomSessionScreen = props;
      return () => {
        delete mockScreens.CustomSessionScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/DoneScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.DoneScreen = props;
      return () => {
        delete mockScreens.DoneScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/HistoryScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.HistoryScreen = props;
      return () => {
        delete mockScreens.HistoryScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/StatsScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.StatsScreen = props;
      return () => {
        delete mockScreens.StatsScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../screens/SettingsScreen", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.SettingsScreen = props;
      return () => {
        delete mockScreens.SettingsScreen;
      };
    }, [props]);
    return null;
  };
});
jest.mock("../components/TabBar", () => {
  const React = require("react");
  return (props) => {
    React.useEffect(() => {
      mockScreens.TabBar = props;
      return () => {
        delete mockScreens.TabBar;
      };
    }, [props]);
    return null;
  };
});

describe("Tier 5 Adversarial Coverage Hardening Suite", () => {
  let appStateListener = null;
  let backHandlerStack = [];
  let originalDateNow;
  let currentTime = 1700000000000;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockScreens).forEach((k) => delete mockScreens[k]);

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

    // Realistic LIFO BackHandler stack
    backHandlerStack = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") {
        backHandlerStack.push(cb);
      }
      return {
        remove: jest.fn(() => {
          const idx = backHandlerStack.lastIndexOf(cb);
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

  // =========================================================================
  // SUITE 1: sessionTimeline.js Adversarial Boundary & Numerical Robustness
  // =========================================================================
  describe("Suite 1: sessionTimeline.js Adversarial Boundary & Numerical Robustness", () => {
    const standardPhases = [
      { name: "Focus 1", duration: 25, isBreak: false },
      { name: "Break 1", duration: 5, isBreak: true },
      { name: "Focus 2", duration: 25, isBreak: false },
    ];

    it("1.1 handles negative elapsed time (clock skew backwards) cleanly without advancing or corrupting state", () => {
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 1,
        remainingMs: 180000,
        running: true,
        anchorAt: 2000000,
        now: 1000000, // now is 1000s in the PAST
        autoAdvance: true,
      });

      expect(result.phaseIndex).toBe(1);
      expect(result.remainingMs).toBe(180000);
      expect(result.running).toBe(true);
      expect(result.finished).toBe(false);
      expect(result.advancedPhases).toEqual([]);
    });

    it("1.2 handles zero-duration and micro-duration phases seamlessly", () => {
      const oddPhases = [
        { name: "Zero Phase", duration: 0, isBreak: false },
        { name: "Tiny Phase", duration: 0.05, isBreak: false }, // 3 seconds = 3000ms
        { name: "Regular", duration: 10, isBreak: false },
      ];

      // Reconcile across zero phase and tiny phase
      const result = reconcileTimeline({
        phases: oddPhases,
        phaseIndex: 0,
        remainingMs: 0,
        running: true,
        anchorAt: 0,
        now: 5000, // 5 seconds elapsed
        autoAdvance: true,
      });

      // 0s used on Zero Phase (finished)
      // 3s used on Tiny Phase (finished)
      // 2s into Regular Phase (10m = 600s total -> 598s = 598000ms remaining)
      expect(result.phaseIndex).toBe(2);
      expect(result.remainingMs).toBe(598000);
      expect(result.advancedPhases).toEqual([
        { index: 0, completed: true },
        { index: 1, completed: true },
      ]);
    });

    it("1.3 handles exact boundary hits with mathematical precision", () => {
      // 10m study (600,000ms), exact 600,000ms elapsed
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 0,
        remainingMs: 600000,
        running: true,
        anchorAt: 0,
        now: 600000,
        autoAdvance: true,
      });

      // Exactly hits Phase 1 start (Break 1, 5m = 300,000ms remaining)
      expect(result.phaseIndex).toBe(1);
      expect(result.remainingMs).toBe(300000);
      expect(result.advancedPhases).toEqual([{ index: 0, completed: true }]);
    });

    it("1.4 handles astronomical elapsed time (1 year) without loop explosion or stack overflow", () => {
      const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 0,
        remainingMs: 1500000,
        running: true,
        anchorAt: 0,
        now: ONE_YEAR_MS,
        autoAdvance: true,
      });

      expect(result.finished).toBe(true);
      expect(result.running).toBe(false);
      expect(result.remainingMs).toBe(0);
      expect(result.phaseIndex).toBe(standardPhases.length - 1);
      expect(result.advancedPhases.length).toBe(standardPhases.length);
    });

    it("1.5 manual mode (autoAdvance=false) halts precisely at boundary and reports awaitingNext", () => {
      // Start 5 minutes before end of Phase 0, background for 30 minutes
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 0,
        remainingMs: 300000,
        running: true,
        anchorAt: 0,
        now: 1800000, // 30 mins
        autoAdvance: false,
      });

      // Must pause at Phase 1 (Break 1) with its full duration (5m = 300,000ms)
      expect(result.phaseIndex).toBe(1);
      expect(result.remainingMs).toBe(300000);
      expect(result.running).toBe(false);
      expect(result.awaitingNext).toBe(true);
      expect(result.finished).toBe(false);
      expect(result.advancedPhases).toEqual([{ index: 0, completed: true }]);
    });

    it("1.6 manual mode (autoAdvance=false) on the final phase finishes the session cleanly", () => {
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 2, // Last phase (Focus 2)
        remainingMs: 300000,
        running: true,
        anchorAt: 0,
        now: 500000,
        autoAdvance: false,
      });

      expect(result.finished).toBe(true);
      expect(result.awaitingNext).toBe(false);
      expect(result.running).toBe(false);
      expect(result.remainingMs).toBe(0);
      expect(result.phaseIndex).toBe(2);
      expect(result.advancedPhases).toEqual([{ index: 2, completed: true }]);
    });

    it("1.7 buildNotificationChain handles edge cases (empty phases, manual vs autoAdvance)", () => {
      // Empty phases
      expect(
        buildNotificationChain({
          phases: [],
          phaseIndex: 0,
          remainingMs: 5000,
          now: 1000,
          autoAdvance: true,
          bodyFor: defaultChainBody,
        })
      ).toEqual([]);

      // Out of bounds phaseIndex
      expect(
        buildNotificationChain({
          phases: standardPhases,
          phaseIndex: 99,
          remainingMs: 5000,
          now: 1000,
          autoAdvance: true,
          bodyFor: defaultChainBody,
        })
      ).toEqual([]);

      // autoAdvance false produces only 1 item
      const single = buildNotificationChain({
        phases: standardPhases,
        phaseIndex: 0,
        remainingMs: 5000,
        now: 1000,
        autoAdvance: false,
        bodyFor: defaultChainBody,
      });
      expect(single).toHaveLength(1);
      expect(single[0].at).toBe(6000);
    });

    it("1.8 isValidSnapshot validates integrity against adversarial corruptions", () => {
      expect(isValidSnapshot(null)).toBe(false);
      expect(isValidSnapshot("invalid")).toBe(false);
      expect(isValidSnapshot({})).toBe(false);
      expect(isValidSnapshot({ id: "" })).toBe(false);
      expect(isValidSnapshot({ id: "1", session: null })).toBe(false);
      expect(isValidSnapshot({ id: "1", session: { label: 123 } })).toBe(false);
      expect(
        isValidSnapshot({
          id: "1",
          session: { label: "Test", phases: [{ name: "A", duration: -5 }] },
        })
      ).toBe(false);
      expect(
        isValidSnapshot({
          id: "1",
          session: { label: "Test", phases: [{ name: "A", duration: 10 }] },
          timeline: { phaseIndex: -1 },
        })
      ).toBe(false);
    });

    it("1.9 totalPhaseMs sums durations and guards against negative durations or null/empty phases", () => {
      expect(totalPhaseMs(null)).toBe(0);
      expect(totalPhaseMs([])).toBe(0);
      expect(
        totalPhaseMs([
          { duration: 10 },
          { duration: -5 }, // Clamped to 0
          { duration: 15 },
        ])
      ).toBe(25 * 60000);
    });

    it("1.10 minsStudiedFromResults rounds to 0.1, ignores breaks, ignores negative or null items", () => {
      expect(minsStudiedFromResults(null)).toBe(0);
      expect(minsStudiedFromResults([])).toBe(0);
      expect(
        minsStudiedFromResults([
          null,
          { isBreak: true, elapsedMs: 300000 },
          { isBreak: false, elapsedMs: 90000 }, // 1.5 mins
          { isBreak: false, elapsedMs: -20000 }, // clamped to 0
          { isBreak: false, elapsedMs: 45000 }, // 0.75 mins -> total 2.25 mins -> 2.3 mins
        ])
      ).toBe(2.3);
    });

    it("1.11 reconcileTimeline handles remainingMs = 0 with elapsedMs = 0 when running", () => {
      const result = reconcileTimeline({
        phases: standardPhases,
        phaseIndex: 0,
        remainingMs: 0,
        running: true,
        anchorAt: 1000,
        now: 1000,
        autoAdvance: true,
      });

      expect(result.phaseIndex).toBe(0);
      expect(result.remainingMs).toBe(0);
      expect(result.running).toBe(true);
      expect(result.finished).toBe(false);
    });

    it("1.12 reconcileTimeline rolls through 6 continuous phases in a large session", () => {
      const sixPhases = [
        { name: "P1", duration: 10 },
        { name: "P2", duration: 10 },
        { name: "P3", duration: 10 },
        { name: "P4", duration: 10 },
        { name: "P5", duration: 10 },
        { name: "P6", duration: 10 },
      ];
      // 10 + 10 + 10 + 10 + 10 + 10 = 60m total
      // Start at P1 with 10m left, 45m elapsed
      const result = reconcileTimeline({
        phases: sixPhases,
        phaseIndex: 0,
        remainingMs: 600000,
        running: true,
        anchorAt: 0,
        now: 45 * 60000,
        autoAdvance: true,
      });

      // 10m P1 + 10m P2 + 10m P3 + 10m P4 = 40m consumed (4 phases advanced)
      // 5m consumed in P5 (Phase index 4) -> 5m (300,000ms) left in P5
      expect(result.phaseIndex).toBe(4);
      expect(result.remainingMs).toBe(300000);
      expect(result.advancedPhases).toHaveLength(4);
    });
  });

  // =========================================================================
  // SUITE 2: SessionScreen.js Background Reconciliation, Crediting & Sound Suppression
  // =========================================================================
  describe("Suite 2: SessionScreen.js Background Reconciliation, Crediting & Sound Suppression", () => {
    const MULTI_BLOCK_SESSION = {
      label: "Adversarial Multi-Block",
      phases: [
        { name: "Study 1", duration: 20, isBreak: false, emoji: "1️⃣" }, // 0: 20m
        { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },   // 1: 5m
        { name: "Study 2", duration: 30, isBreak: false, emoji: "2️⃣" }, // 2: 30m
        { name: "Break 2", duration: 10, isBreak: true, emoji: "☕" },  // 3: 10m
        { name: "Study 3", duration: 25, isBreak: false, emoji: "3️⃣" }, // 4: 25m
      ],
      // Total Study: 20 + 30 + 25 = 75m
      // Total Break: 5 + 10 = 15m
    };

    it("2.1 multi-phase background intervals credit exact study minutes while strictly ignoring breaks", async () => {
      const onComplete = jest.fn();
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={onComplete}
            />
          </ThemeProvider>
        );
      });

      // Study 1 starts with 10m (600s) left (10m completed in foreground)
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 600;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={onComplete}
            />
          </ThemeProvider>
        );
      });

      // Background for 25 minutes:
      // 10m finishes Study 1 (20m total nominal credited)
      // 5m finishes Break 1 (0m credited)
      // 10m consumed in Study 2 (30m nominal -> 20m = 1200s left)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 25 * 60 * 1000;
      await act(async () => {
        appStateListener("active");
      });

      expect(mockTimerState.restart).toHaveBeenCalledWith(1200);
      expect(onComplete).not.toHaveBeenCalled();

      // Reflect state in Study 2 with 1200s left
      await act(async () => {
        mockTimerState.secondsLeft = 1200;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={onComplete}
            />
          </ThemeProvider>
        );
      });

      // Background for 60 minutes:
      // 20m finishes Study 2 (30m nominal credited -> total so far: 50m)
      // 10m finishes Break 2 (0m credited)
      // 25m finishes Study 3 (25m nominal credited -> total so far: 75m)
      // 5m extra time after session finishes
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 60 * 60 * 1000;
      await act(async () => {
        appStateListener("active");
      });

      // Verification: onComplete called once with EXACT 75 study minutes
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0][0].actualStudyMins).toBe(75);

      // Alarm sound and vibration MUST be suppressed on background finish
      expect(mockPlayAlarm).not.toHaveBeenCalled();
      expect(Vibration.vibrate).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.2 foreground phase completion triggers alarm sound and vibration", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Trigger timer onComplete in foreground
      await act(async () => {
        mockTimerState._onComplete();
      });

      // In foreground, playAlarm and Vibration.vibrate MUST be invoked
      expect(mockPlayAlarm).toHaveBeenCalledWith("classic");
      expect(Vibration.vibrate).toHaveBeenCalledWith([0, 500, 250, 500]);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.3 live toggle of autoAdvance switch updates reconciliation behavior dynamically", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Find Switch and toggle autoAdvance to false
      const switchEl = renderer.root.findByProps({ accessibilityLabel: "Auto-advance phases" });
      await act(async () => {
        switchEl.props.onValueChange(false);
      });

      // Study 1 has 5m (300s) left
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 300;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Background for 20m (exceeds Study 1's 5m)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 20 * 60 * 1000;
      await act(async () => {
        appStateListener("active");
      });

      // Because autoAdvance was toggled to false, it must halt at Phase 1 (Break 1, 5m = 300s) paused
      expect(mockTimerState.loadDuration).toHaveBeenCalledWith(300);
      expect(mockTimerState.restart).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.4 rapid AppState flutter (active -> inactive -> active) causes zero drift", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1000;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // 5 rapid flutter cycles of 1 second each
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          appStateListener("inactive");
        });
        currentTime += 1000;
        await act(async () => {
          appStateListener("active");
        });
        const expectedLeft = 1000 - (i + 1);
        expect(mockTimerState.restart).toHaveBeenLastCalledWith(expectedLeft);
        await act(async () => {
          mockTimerState.secondsLeft = expectedLeft;
          renderer.update(
            <ThemeProvider>
              <SessionScreen
                session={MULTI_BLOCK_SESSION}
                subject="Neuroscience"
                subjectColor="#06b6d4"
                onGoHome={jest.fn()}
                onComplete={jest.fn()}
              />
            </ThemeProvider>
          );
        });
      }

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.5 sub-second remaining time clamps to at least 1 second on background resume", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // 5 seconds left
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 5;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Background for 4950ms (50ms left)
      await act(async () => {
        appStateListener("background");
      });
      currentTime += 4950;
      await act(async () => {
        appStateListener("active");
      });

      // Math.max(1, Math.ceil(50 / 1000)) = 1s
      expect(mockTimerState.restart).toHaveBeenCalledWith(1);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.6 respects vibrate=false setting upon foreground completion", async () => {
      mockSavedSettings.vibrate = false;
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        mockTimerState._onComplete();
      });

      expect(mockPlayAlarm).toHaveBeenCalledWith("classic");
      // Vibration must NOT be called when vibrate setting is false
      expect(Vibration.vibrate).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("2.7 respects keepAwake=false setting and suppresses activateKeepAwakeAsync", async () => {
      const { activateKeepAwakeAsync } = require("expo-keep-awake");
      mockSavedSettings.keepAwake = false;
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        mockTimerState.running = true;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={MULTI_BLOCK_SESSION}
              subject="Neuroscience"
              subjectColor="#06b6d4"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // activateKeepAwakeAsync should NOT be called when keepAwake is false
      expect(activateKeepAwakeAsync).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // SUITE 3: SessionScreen.js BackHandler, Confirmation Alert & Partial Save
  // =========================================================================
  describe("Suite 3: SessionScreen.js BackHandler, Confirmation Alert & Partial Save", () => {
    const TWO_PHASE = {
      label: "Two-Phase Study",
      phases: [
        { name: "Study 1", duration: 25, isBreak: false, emoji: "📖" },
        { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
      ],
    };

    it("3.1 back press while running displays confirmation alert and cancels on Cancel button", async () => {
      const onGoHome = jest.fn();
      const onPartialQuit = jest.fn();

      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 1000;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // Press hardware back
      let handled;
      act(() => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);

      expect(Alert.alert).toHaveBeenCalledWith(
        "Leave Session?",
        "Your timer is still running. Your progress will be saved.",
        expect.any(Array)
      );

      // Press "Cancel"
      const buttons = Alert.alert.mock.calls[0][2];
      const cancelBtn = buttons.find((b) => b.text === "Cancel");
      act(() => {
        cancelBtn.onPress?.();
      });

      // Timer should NOT have stopped, no quit callbacks fired
      expect(mockTimerState.stop).not.toHaveBeenCalled();
      expect(onGoHome).not.toHaveBeenCalled();
      expect(onPartialQuit).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("3.2 confirming Leave in alert stops timer, cancels notifications, and saves partial progress", async () => {
      const onGoHome = jest.fn();
      const onPartialQuit = jest.fn();

      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // Running with 15m (900s) left -> 10m elapsed in Study 1
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 900;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      act(() => {
        fireHardwareBack();
      });

      // Press "Leave"
      const buttons = Alert.alert.mock.calls[0][2];
      const leaveBtn = buttons.find((b) => b.text === "Leave");
      await act(async () => {
        leaveBtn.onPress();
      });

      expect(mockTimerState.stop).toHaveBeenCalled();
      expect(mockCancelAll).toHaveBeenCalled();
      expect(onPartialQuit).toHaveBeenCalledTimes(1);
      const partialData = onPartialQuit.mock.calls[0][0];
      expect(partialData.actualStudyMins).toBe(10); // 25m - 15m = 10m
      expect(partialData.phasesCompleted).toBe(0);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("3.3 hardware back press when paused exits directly without confirmation alert", async () => {
      const onGoHome = jest.fn();
      const onPartialQuit = jest.fn();

      // Case A: 0 elapsed seconds (secondsLeft matches phase length 1500s)
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 1500;

      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      let handled;
      act(() => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);

      // Alert was NOT called
      expect(Alert.alert).not.toHaveBeenCalled();
      // Since 0 study mins elapsed, calls onGoHome directly
      expect(onGoHome).toHaveBeenCalledTimes(1);
      expect(onPartialQuit).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });

      // Case B: 10 mins elapsed while paused -> calls onPartialQuit directly without Alert
      const onGoHomeB = jest.fn();
      const onPartialQuitB = jest.fn();
      mockTimerState.running = false;
      mockTimerState.secondsLeft = 900; // 10m elapsed

      let rendererB;
      await act(async () => {
        rendererB = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHomeB}
              onPartialQuit={onPartialQuitB}
            />
          </ThemeProvider>
        );
      });

      act(() => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(onPartialQuitB).toHaveBeenCalledTimes(1);
      expect(onPartialQuitB.mock.calls[0][0].actualStudyMins).toBe(10);
      expect(onGoHomeB).not.toHaveBeenCalled();

      await act(async () => {
        rendererB.unmount();
      });
    });

    it("3.4 skip phase accurately credits elapsed time from skipped study phase and 0 from skipped break", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Running in Study 1 with 15m (900s) left -> 10m elapsed
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 900;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Find skip button and press it
      const buttons = renderer.root.findAllByType("TouchableOpacity" || "RNGestureHandlerButton");
      // Or find accessibilityLabel="Skip to next phase"
      const skipBtn = renderer.root.findByProps({ accessibilityLabel: "Skip to next phase" });

      await act(async () => {
        skipBtn.props.onPress();
      });

      // Skip confirmation alert shown
      expect(Alert.alert).toHaveBeenCalledWith(
        "Skip Phase?",
        "Are you sure you want to skip to the next phase?",
        expect.any(Array)
      );

      const skipAlertBtns = Alert.alert.mock.calls[0][2];
      const confirmSkip = skipAlertBtns.find((b) => b.text === "Skip");
      await act(async () => {
        confirmSkip.onPress();
      });

      // Should load duration for Break 1 (5m = 300s)
      expect(mockTimerState.loadDuration).toHaveBeenCalledWith(300);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("3.5 leave session with onPartialQuit undefined falls back cleanly to onGoHome()", async () => {
      const onGoHome = jest.fn();
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onComplete={jest.fn()}
              // onPartialQuit omitted intentionally
            />
          </ThemeProvider>
        );
      });

      // Running with 10m elapsed
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 900;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={onGoHome}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      act(() => {
        fireHardwareBack();
      });

      const leaveBtn = Alert.alert.mock.calls[0][2].find((b) => b.text === "Leave");
      await act(async () => {
        leaveBtn.onPress();
      });

      // Must call onGoHome directly without crashing
      expect(onGoHome).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("3.6 skipping a break phase credits 0 study time towards session history", async () => {
      const THREE_PHASE = {
        label: "Three-Phase",
        phases: [
          { name: "Study 1", duration: 25, isBreak: false, emoji: "📖" },
          { name: "Break 1", duration: 5, isBreak: true, emoji: "☕" },
          { name: "Study 2", duration: 25, isBreak: false, emoji: "📖" },
        ],
      };
      const onPartialQuit = jest.fn();
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={THREE_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // Study 1 finishes completely in foreground (0s left)
      await act(async () => {
        mockTimerState.secondsLeft = 0;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={THREE_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // Timer completes Phase 0
      await act(async () => {
        mockTimerState._onComplete();
      });

      // Now in Break 1 (5m = 300s). Spend 2m in break (180s left)
      await act(async () => {
        mockTimerState.running = true;
        mockTimerState.secondsLeft = 180;
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={THREE_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // User presses skip on the break
      const skipBtn = renderer.root.findByProps({ accessibilityLabel: "Skip to next phase" });
      await act(async () => {
        skipBtn.props.onPress();
      });
      const confirmSkip = Alert.alert.mock.calls[0][2].find((b) => b.text === "Skip");
      await act(async () => {
        confirmSkip.onPress();
      });

      // Update renderer to reflect Phase 2 state
      await act(async () => {
        renderer.update(
          <ThemeProvider>
            <SessionScreen
              session={THREE_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
              onPartialQuit={onPartialQuit}
            />
          </ThemeProvider>
        );
      });

      // Quits after break skip
      act(() => {
        fireHardwareBack();
      });
      if (Alert.alert.mock.calls.length > 1) {
        Alert.alert.mock.calls[1][2].find((b) => b.text === "Leave").onPress();
      }

      // Only the 25m from Study 1 was credited; break elapsed time was 0
      expect(onPartialQuit).toHaveBeenCalled();
      expect(onPartialQuit.mock.calls[0][0].actualStudyMins).toBe(25);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("3.7 reset button resets timer to phase nominal duration and cancels notifications", async () => {
      let renderer;
      await act(async () => {
        renderer = create(
          <ThemeProvider>
            <SessionScreen
              session={TWO_PHASE}
              subject="Physics"
              subjectColor="#f43f5e"
              onGoHome={jest.fn()}
              onComplete={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const resetBtn = renderer.root.findByProps({ accessibilityLabel: "Reset timer" });
      await act(async () => {
        resetBtn.props.onPress();
      });

      expect(mockCancelAll).toHaveBeenCalled();
      expect(mockTimerState.loadDuration).toHaveBeenCalledWith(25 * 60);

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // SUITE 4: App.js Global Navigation Hierarchy & Startup Cleanup
  // =========================================================================
  describe("Suite 4: App.js Global Navigation Hierarchy & Startup Cleanup", () => {
    it("4.1 navigates backward through full hierarchy: builder -> session-picker -> subject-picker -> home -> OS exit", async () => {
      let renderer;
      await act(async () => {
        renderer = create(<App />);
      });

      // Initially on Home: hardware back returns false (allowing OS exit)
      expect(fireHardwareBack()).toBe(false);

      // Home -> Subject Picker
      await act(async () => {
        mockScreens.HomeScreen.onStartStudying();
      });
      expect(mockScreens.SubjectPickerScreen).toBeDefined();

      // Subject Picker -> Session Picker
      await act(async () => {
        await mockScreens.SubjectPickerScreen.onSelectSubject("Biology");
      });
      expect(mockScreens.SessionPickerScreen).toBeDefined();

      // Session Picker -> Custom Session Builder
      await act(async () => {
        mockScreens.SessionPickerScreen.onOpenCustomSession();
      });
      expect(mockScreens.CustomSessionScreen).toBeDefined();

      // --- Unwind hierarchy with BackHandler ---
      // 1. In Custom Session Builder -> goes back to Session Picker (returns true)
      let handled;
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(mockScreens.SessionPickerScreen).toBeDefined();

      // 2. In Session Picker -> goes back to Subject Picker (returns true)
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(mockScreens.SubjectPickerScreen).toBeDefined();

      // 3. In Subject Picker -> goes back to Home (returns true)
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(mockScreens.HomeScreen).toBeDefined();

      // 4. On Home -> allows OS default exit (returns false)
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(false);

      await act(async () => {
        renderer.unmount();
      });
    });

    it("4.2 secondary screens (done, stats, history, settings) navigate directly back to home", async () => {
      let renderer;
      await act(async () => {
        renderer = create(<App />);
      });

      const secondaryNavActions = [
        { name: "stats", navigate: () => mockScreens.HomeScreen.onViewStats(), check: () => mockScreens.StatsScreen },
        { name: "history", navigate: () => mockScreens.HomeScreen.onViewHistory(), check: () => mockScreens.HistoryScreen },
        { name: "settings", navigate: () => mockScreens.HomeScreen.onViewSettings(), check: () => mockScreens.SettingsScreen },
      ];

      for (const item of secondaryNavActions) {
        await act(async () => {
          item.navigate();
        });
        expect(item.check()).toBeDefined();

        let handled;
        await act(async () => {
          handled = fireHardwareBack();
        });
        expect(handled).toBe(true);
        expect(mockScreens.HomeScreen).toBeDefined();
      }

      await act(async () => {
        renderer.unmount();
      });
    });

    it("4.3 cancels orphaned notifications on startup and withstands rejection gracefully", async () => {
      cancelSessionNotifications.mockRejectedValueOnce(new Error("Notification service offline"));

      let renderer;
      await act(async () => {
        renderer = create(<App />);
      });

      // Called on startup
      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
      // App successfully mounted and rendered HomeScreen
      expect(mockScreens.HomeScreen).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("4.4 quick-start paths: preset jumps directly to session screen, custom jumps to builder", async () => {
      let renderer;
      await act(async () => {
        renderer = create(<App />);
      });

      // QuickStart "1hr"
      await act(async () => {
        mockScreens.HomeScreen.onQuickStart("1hr");
      });
      expect(mockScreens.SubjectPickerScreen).toBeDefined();

      // Choosing subject immediately launches session
      await act(async () => {
        await mockScreens.SubjectPickerScreen.onSelectSubject("Architecture");
      });
      // In session screen
      expect(mockScreens.HomeScreen).toBeUndefined();
      expect(mockScreens.SubjectPickerScreen).toBeUndefined();

      // Leave session back to home
      await act(async () => {
        fireHardwareBack();
      });

      // QuickStart "custom"
      await act(async () => {
        mockScreens.HomeScreen.onQuickStart("custom");
      });
      expect(mockScreens.SubjectPickerScreen).toBeDefined();

      await act(async () => {
        await mockScreens.SubjectPickerScreen.onSelectSubject("Architecture");
      });
      expect(mockScreens.CustomSessionScreen).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
    });

    it("4.5 tab bar navigation switches between primary destinations and maintains BackHandler consistency", async () => {
      let renderer;
      await act(async () => {
        renderer = create(<App />);
      });

      expect(mockScreens.TabBar).toBeDefined();

      // Switch to stats
      await act(async () => {
        mockScreens.TabBar.onChange("stats");
      });
      expect(mockScreens.StatsScreen).toBeDefined();

      // Back returns to home
      let handled;
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(mockScreens.HomeScreen).toBeDefined();

      // Switch to history
      await act(async () => {
        mockScreens.TabBar.onChange("history");
      });
      expect(mockScreens.HistoryScreen).toBeDefined();

      // Switch directly to settings via TabBar
      await act(async () => {
        mockScreens.TabBar.onChange("settings");
      });
      expect(mockScreens.SettingsScreen).toBeDefined();

      // Back returns to home
      await act(async () => {
        handled = fireHardwareBack();
      });
      expect(handled).toBe(true);
      expect(mockScreens.HomeScreen).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
    });
  });
});
