import React from "react";
import { act, create } from "react-test-renderer";
import { BackHandler } from "react-native";
import App from "../../App";
import { cancelSessionNotifications } from "../hooks/useNotifications";

jest.setTimeout(15000);

jest.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../hooks/useNotifications", () => ({
  cancelSessionNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/storage", () => ({
  ...jest.requireActual("../utils/storage"),
  saveSession: jest.fn().mockResolvedValue({ id: "s1" }),
  saveSubject: jest.fn((name) =>
    Promise.resolve({ name, color: "#3b82f6" })
  ),
  loadSettings: jest.fn().mockResolvedValue({}),
}));

const mockScreenProps = {};

jest.mock("../screens/HomeScreen", () => (props) => {
  mockScreenProps.HomeScreen = props;
  return null;
});
jest.mock("../screens/SubjectPickerScreen", () => (props) => {
  mockScreenProps.SubjectPickerScreen = props;
  return null;
});
jest.mock("../screens/SessionPickerScreen", () => (props) => {
  mockScreenProps.SessionPickerScreen = props;
  return null;
});
jest.mock("../screens/CustomSessionScreen", () => (props) => {
  mockScreenProps.CustomSessionScreen = props;
  return null;
});
jest.mock("../screens/SessionScreen", () => (props) => {
  mockScreenProps.SessionScreen = props;
  return null;
});
jest.mock("../screens/DoneScreen", () => (props) => {
  mockScreenProps.DoneScreen = props;
  return null;
});
jest.mock("../screens/HistoryScreen", () => (props) => {
  mockScreenProps.HistoryScreen = props;
  return null;
});
jest.mock("../screens/StatsScreen", () => (props) => {
  mockScreenProps.StatsScreen = props;
  return null;
});
jest.mock("../screens/SettingsScreen", () => (props) => {
  mockScreenProps.SettingsScreen = props;
  return null;
});
jest.mock("../components/TabBar", () => (props) => {
  mockScreenProps.TabBar = props;
  return null;
});

describe("App Startup Notification Cleanup & BackHandler Navigation Hierarchy", () => {
  let renderer;
  let backHandlerListener = null;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockScreenProps).forEach((k) => delete mockScreenProps[k]);

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

  describe("Startup Notification Cleanup", () => {
    it("calls cancelSessionNotifications on app startup", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
    });

    it("catches and ignores notification cleanup rejection without crashing", async () => {
      cancelSessionNotifications.mockRejectedValueOnce(new Error("Notification cleanup failed"));

      await act(async () => {
        renderer = create(<App />);
      });

      expect(cancelSessionNotifications).toHaveBeenCalledTimes(1);
      // App still mounts successfully on home screen
      expect(mockScreenProps.HomeScreen).toBeDefined();
    });
  });

  describe("BackHandler Navigation Hierarchy", () => {
    it("registers hardwareBackPress listener on mount and unregisters on unmount", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(backHandlerListener).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
      renderer = null;

      expect(backHandlerListener).toBeNull();
    });

    it("returns false on 'home' screen allowing default OS back behavior", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      expect(mockScreenProps.HomeScreen).toBeDefined();

      let handled;
      act(() => {
        handled = backHandlerListener();
      });

      expect(handled).toBe(false);
    });

    it("navigates back from 'subject-picker' to 'home' and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Go from home to subject-picker
      await act(async () => {
        mockScreenProps.HomeScreen.onStartStudying();
      });

      expect(mockScreenProps.SubjectPickerScreen).toBeDefined();

      // Press hardware back
      let handled;
      act(() => {
        handled = backHandlerListener();
      });

      expect(handled).toBe(true);
      // Now on home screen
      expect(mockScreenProps.HomeScreen).toBeDefined();
    });

    it("navigates back from 'session-picker' to 'subject-picker' and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Navigate home -> subject-picker -> session-picker
      await act(async () => {
        mockScreenProps.HomeScreen.onStartStudying();
      });
      await act(async () => {
        await mockScreenProps.SubjectPickerScreen.onSelectSubject("Biology");
      });

      expect(mockScreenProps.SessionPickerScreen).toBeDefined();

      // Press hardware back
      let handled;
      act(() => {
        handled = backHandlerListener();
      });

      expect(handled).toBe(true);
      // Returned to subject-picker
      expect(mockScreenProps.SubjectPickerScreen).toBeDefined();
    });

    it("navigates back from 'custom-session-builder' to 'session-picker' and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Navigate home -> subject-picker -> session-picker -> custom-session-builder
      await act(async () => {
        mockScreenProps.HomeScreen.onStartStudying();
      });
      await act(async () => {
        await mockScreenProps.SubjectPickerScreen.onSelectSubject("Physics");
      });
      await act(async () => {
        mockScreenProps.SessionPickerScreen.onOpenCustomSession();
      });

      expect(mockScreenProps.CustomSessionScreen).toBeDefined();

      // Press hardware back
      let handled;
      act(() => {
        handled = backHandlerListener();
      });

      expect(handled).toBe(true);
      // Returned to session-picker
      expect(mockScreenProps.SessionPickerScreen).toBeDefined();
    });

    it("navigates back from tab screens ('stats', 'history', 'settings') to 'home' and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Test stats -> home
      await act(async () => {
        mockScreenProps.HomeScreen.onViewStats();
      });
      expect(mockScreenProps.StatsScreen).toBeDefined();

      let handledStats;
      act(() => {
        handledStats = backHandlerListener();
      });
      expect(handledStats).toBe(true);
      expect(mockScreenProps.HomeScreen).toBeDefined();

      // Test history -> home
      await act(async () => {
        mockScreenProps.HomeScreen.onViewHistory();
      });
      expect(mockScreenProps.HistoryScreen).toBeDefined();

      let handledHistory;
      act(() => {
        handledHistory = backHandlerListener();
      });
      expect(handledHistory).toBe(true);
      expect(mockScreenProps.HomeScreen).toBeDefined();

      // Test settings -> home
      await act(async () => {
        mockScreenProps.HomeScreen.onViewSettings();
      });
      expect(mockScreenProps.SettingsScreen).toBeDefined();

      let handledSettings;
      act(() => {
        handledSettings = backHandlerListener();
      });
      expect(handledSettings).toBe(true);
      expect(mockScreenProps.HomeScreen).toBeDefined();
    });

    it("navigates back from 'done' screen to 'home' and returns true", async () => {
      await act(async () => {
        renderer = create(<App />);
      });

      // Navigate home -> subject-picker -> session-picker -> session -> done
      await act(async () => {
        mockScreenProps.HomeScreen.onStartStudying();
      });
      await act(async () => {
        await mockScreenProps.SubjectPickerScreen.onSelectSubject("Math");
      });
      await act(async () => {
        mockScreenProps.SessionPickerScreen.onStartSession("1hr");
      });

      expect(mockScreenProps.SessionScreen).toBeDefined();

      // Complete the session to reach DoneScreen
      await act(async () => {
        mockScreenProps.SessionScreen.onComplete({
          startedAt: "2026-11-05T10:00:00.000Z",
          actualStudyMins: 50,
        });
      });

      expect(mockScreenProps.DoneScreen).toBeDefined();

      // Press hardware back on Done screen
      let handled;
      act(() => {
        handled = backHandlerListener();
      });

      expect(handled).toBe(true);
      // Navigates back to home
      expect(mockScreenProps.HomeScreen).toBeDefined();
    });
  });
});
