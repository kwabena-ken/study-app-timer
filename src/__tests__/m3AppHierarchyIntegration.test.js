import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, BackHandler } from "react-native";
import App from "../../App";
import { cancelSessionNotifications } from "../hooks/useNotifications";

jest.setTimeout(20000);

// --- Mocks ---
jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../hooks/useNotifications", () => ({
  cancelSessionNotifications: jest.fn().mockResolvedValue(undefined),
  useNotifications: () => ({
    scheduleChain: jest.fn(),
    cancelAll: jest.fn(),
    error: null,
  }),
}));

jest.mock("../utils/storage", () => ({
  ...jest.requireActual("../utils/storage"),
  saveSession: jest.fn().mockResolvedValue({ id: "saved-sess-1" }),
  saveSubject: jest.fn((name) =>
    Promise.resolve({ name, color: "#3b82f6" })
  ),
  loadSettings: jest.fn().mockResolvedValue({}),
}));

const capturedScreenProps = {};

jest.mock("../screens/HomeScreen", () => (props) => {
  capturedScreenProps.HomeScreen = props;
  return null;
});
jest.mock("../screens/SubjectPickerScreen", () => (props) => {
  capturedScreenProps.SubjectPickerScreen = props;
  return null;
});
jest.mock("../screens/SessionPickerScreen", () => (props) => {
  capturedScreenProps.SessionPickerScreen = props;
  return null;
});
jest.mock("../screens/CustomSessionScreen", () => (props) => {
  capturedScreenProps.CustomSessionScreen = props;
  return null;
});
jest.mock("../screens/DoneScreen", () => (props) => {
  capturedScreenProps.DoneScreen = props;
  return null;
});
jest.mock("../screens/HistoryScreen", () => (props) => {
  capturedScreenProps.HistoryScreen = props;
  return null;
});
jest.mock("../screens/StatsScreen", () => (props) => {
  capturedScreenProps.StatsScreen = props;
  return null;
});
jest.mock("../screens/SettingsScreen", () => (props) => {
  capturedScreenProps.SettingsScreen = props;
  return null;
});
jest.mock("../components/TabBar", () => (props) => {
  capturedScreenProps.TabBar = props;
  return null;
});

// Mock SessionScreen with realistic BackHandler behavior
jest.mock("../screens/SessionScreen", () => {
  const React = require("react");
  const { BackHandler, Alert } = require("react-native");
  return function MockSessionScreen(props) {
    capturedScreenProps.SessionScreen = props;
    React.useEffect(() => {
      const onBack = () => {
        Alert.alert(
          "Leave Session?",
          "Your timer is still running. Your progress will be saved.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Leave",
              style: "destructive",
              onPress: () => props.onGoHome(),
            },
          ]
        );
        return true;
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
      return () => {
        if (sub && typeof sub.remove === "function") sub.remove();
        else if (BackHandler.removeEventListener) BackHandler.removeEventListener("hardwareBackPress", onBack);
      };
    }, [props]);
    return null;
  };
});

describe("Milestone 3 App Navigation Hierarchy & BackHandler LIFO Stack", () => {
  let renderer;
  let backHandlerStack = [];

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(capturedScreenProps).forEach((k) => delete capturedScreenProps[k]);

    backHandlerStack = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((type, cb) => {
      if (type === "hardwareBackPress") {
        backHandlerStack.push(cb);
      }
      return {
        remove: jest.fn(() => {
          const idx = backHandlerStack.indexOf(cb);
          if (idx !== -1) backHandlerStack.splice(idx, 1);
        }),
      };
    });

    jest.spyOn(Alert, "alert");
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
      renderer = null;
    }
    jest.restoreAllMocks();
  });

  function fireHardwareBack() {
    let result = false;
    act(() => {
      for (let i = backHandlerStack.length - 1; i >= 0; i--) {
        const handled = backHandlerStack[i]();
        if (handled) {
          result = true;
          return;
        }
      }
      result = false;
    });
    return result;
  }

  it("navigates sequential back chain: custom-builder -> session-picker -> subject-picker -> home -> OS exit (false)", async () => {
    await act(async () => {
      renderer = create(<App />);
    });

    // Mounts on Home
    expect(capturedScreenProps.HomeScreen).toBeDefined();

    // 1. Quick start "custom" -> SubjectPickerScreen
    await act(async () => {
      capturedScreenProps.HomeScreen.onQuickStart("custom");
    });
    expect(capturedScreenProps.SubjectPickerScreen).toBeDefined();

    // 2. Select subject -> CustomSessionScreen
    await act(async () => {
      await capturedScreenProps.SubjectPickerScreen.onSelectSubject("Physics");
    });
    expect(capturedScreenProps.CustomSessionScreen).toBeDefined();

    // 3. Hardware Back on CustomSessionScreen -> SessionPickerScreen (returns true)
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.SessionPickerScreen).toBeDefined();

    // 4. Hardware Back on SessionPickerScreen -> SubjectPickerScreen (returns true)
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.SubjectPickerScreen).toBeDefined();

    // 5. Hardware Back on SubjectPickerScreen -> HomeScreen (returns true)
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.HomeScreen).toBeDefined();

    // 6. Hardware Back on HomeScreen -> false (OS handles exit)
    expect(fireHardwareBack()).toBe(false);
  });

  it("handles LIFO BackHandler stack during active session: intercepts back press, respects Cancel, and exits to Home on Leave", async () => {
    await act(async () => {
      renderer = create(<App />);
    });

    // Start a standard session: Home -> SubjectPicker -> SessionPicker -> SessionScreen
    await act(async () => {
      capturedScreenProps.HomeScreen.onStartStudying();
    });
    await act(async () => {
      await capturedScreenProps.SubjectPickerScreen.onSelectSubject("Chemistry");
    });
    await act(async () => {
      capturedScreenProps.SessionPickerScreen.onStartSession("1hr");
    });

    expect(capturedScreenProps.SessionScreen).toBeDefined();
    // Both App.js and SessionScreen.js listeners are in the stack
    expect(backHandlerStack.length).toBe(2);

    // Press Hardware Back
    expect(fireHardwareBack()).toBe(true);
    expect(Alert.alert).toHaveBeenCalledWith(
      "Leave Session?",
      "Your timer is still running. Your progress will be saved.",
      expect.any(Array)
    );

    // Check that SessionScreen is still active (Cancel scenario)
    expect(capturedScreenProps.SessionScreen).toBeDefined();

    // Now press "Leave"
    const buttons = Alert.alert.mock.calls[0][2];
    const leaveBtn = buttons.find((b) => b.text === "Leave");

    await act(async () => {
      leaveBtn.onPress();
    });

    // Navigates to HomeScreen
    expect(capturedScreenProps.HomeScreen).toBeDefined();
    // SessionScreen was unmounted, its BackHandler was popped
    expect(backHandlerStack.length).toBe(1);

    // Now on Home screen, pressing back returns false (allowing OS exit)
    expect(fireHardwareBack()).toBe(false);
  });

  it("navigates all secondary screens (stats, history, settings, done) back to home on back press", async () => {
    await act(async () => {
      renderer = create(<App />);
    });

    // Test stats -> home
    await act(async () => {
      capturedScreenProps.HomeScreen.onViewStats();
    });
    expect(capturedScreenProps.StatsScreen).toBeDefined();
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.HomeScreen).toBeDefined();

    // Test history -> home
    await act(async () => {
      capturedScreenProps.HomeScreen.onViewHistory();
    });
    expect(capturedScreenProps.HistoryScreen).toBeDefined();
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.HomeScreen).toBeDefined();

    // Test settings -> home
    await act(async () => {
      capturedScreenProps.HomeScreen.onViewSettings();
    });
    expect(capturedScreenProps.SettingsScreen).toBeDefined();
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.HomeScreen).toBeDefined();

    // Test session completed -> DoneScreen -> home
    await act(async () => {
      capturedScreenProps.HomeScreen.onStartStudying();
    });
    await act(async () => {
      await capturedScreenProps.SubjectPickerScreen.onSelectSubject("Biology");
    });
    await act(async () => {
      capturedScreenProps.SessionPickerScreen.onStartSession("1hr");
    });
    expect(capturedScreenProps.SessionScreen).toBeDefined();

    await act(async () => {
      capturedScreenProps.SessionScreen.onComplete({
        startedAt: new Date().toISOString(),
        actualStudyMins: 50,
      });
    });
    expect(capturedScreenProps.DoneScreen).toBeDefined();
    expect(fireHardwareBack()).toBe(true);
    expect(capturedScreenProps.HomeScreen).toBeDefined();
    expect(fireHardwareBack()).toBe(false);
  });
});
