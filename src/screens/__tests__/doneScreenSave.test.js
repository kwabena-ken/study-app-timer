import React from "react";
import { act, create } from "react-test-renderer";
import { TouchableOpacity, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DoneScreen from "../DoneScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as storage from "../../utils/storage";

jest.mock("../../utils/storage", () => {
  const actual = jest.requireActual("../../utils/storage");
  return {
    ...actual,
    saveSession: jest.fn(),
    loadSessions: jest.fn(),
  };
});
jest.mock("../../components/Icon", () => () => null);

describe("DoneScreen save and recovery", () => {
  const baseSession = {
    label: "25m Deep Work",
    phases: [
      { name: "Deep Work", duration: 25, isBreak: false },
      { name: "Short Break", duration: 5, isBreak: true },
    ],
  };

  const baseSessionMeta = {
    sessionKey: "pomodoro",
    subject: "Mathematics",
    startedAt: "2026-11-05T10:00:00.000Z",
    actualStudyMins: 25,
  };

  let renderer;

  beforeEach(() => {
    jest.clearAllMocks();
    storage.loadSessions.mockResolvedValue([]);
    storage.saveSession.mockResolvedValue({ id: "s1" });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
      renderer = null;
    }
  });

  it("migrates to SafeAreaView with 4-edge insets", async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={baseSession}
            sessionMeta={baseSessionMeta}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    const safeAreas = renderer.root.findAllByType(SafeAreaView);
    expect(safeAreas.length).toBeGreaterThanOrEqual(1);
    expect(safeAreas[0].props.edges).toEqual(["top", "bottom", "left", "right"]);
  });

  it("automatically saves session and displays confirmation on successful mount", async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={baseSession}
            sessionMeta={baseSessionMeta}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    expect(storage.saveSession).toHaveBeenCalledTimes(1);
    expect(storage.saveSession).toHaveBeenCalledWith({
      sessionType: "pomodoro",
      label: "25m Deep Work",
      subject: "Mathematics",
      startedAt: "2026-11-05T10:00:00.000Z",
      phasesCompleted: 1,
      totalStudyMins: 25,
      actualStudyMins: 25,
      completed: true,
    });
    expect(storage.loadSessions).toHaveBeenCalled();

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((txt) => typeof txt === "string" && txt.includes("Saved to history"))).toBe(true);

    const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
      (btn) => btn.props.accessibilityLabel === "Retry Save"
    );
    expect(retryBtn).toBeUndefined();
  });

  it("shows explicit warning banner and Retry Save button when saveSession fails", async () => {
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    storage.saveSession.mockRejectedValueOnce(new Error("AsyncStorage quota exceeded"));

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={baseSession}
            sessionMeta={baseSessionMeta}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    expect(storage.saveSession).toHaveBeenCalledTimes(1);

    const texts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((txt) => typeof txt === "string" && txt.includes("Failed to save session to history."))).toBe(true);
    expect(texts.some((txt) => typeof txt === "string" && txt.includes("Saved to history"))).toBe(false);

    const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
      (btn) => btn.props.accessibilityLabel === "Retry Save"
    );
    expect(retryBtn).toBeDefined();

    consoleWarnSpy.mockRestore();
  });

  it("retrying save re-calls saveSession, clears warning banner, and displays saved confirmation", async () => {
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    // Fail first attempt
    storage.saveSession.mockRejectedValueOnce(new Error("Network / disk glitch"));

    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <DoneScreen
            session={baseSession}
            sessionMeta={baseSessionMeta}
            onGoHome={jest.fn()}
          />
        </ThemeProvider>
      );
    });

    expect(storage.saveSession).toHaveBeenCalledTimes(1);

    const retryBtn = renderer.root.findAllByType(TouchableOpacity).find(
      (btn) => btn.props.accessibilityLabel === "Retry Save"
    );
    expect(retryBtn).toBeDefined();

    // Now allow second attempt to succeed
    storage.saveSession.mockResolvedValueOnce({ id: "s-retry-success" });

    await act(async () => {
      retryBtn.props.onPress();
    });

    expect(storage.saveSession).toHaveBeenCalledTimes(2);

    const textsAfterRetry = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(textsAfterRetry.some((txt) => typeof txt === "string" && txt.includes("Saved to history"))).toBe(true);
    expect(textsAfterRetry.some((txt) => typeof txt === "string" && txt.includes("Failed to save session to history."))).toBe(false);

    const retryBtnAfter = renderer.root.findAllByType(TouchableOpacity).find(
      (btn) => btn.props.accessibilityLabel === "Retry Save"
    );
    expect(retryBtnAfter).toBeUndefined();

    consoleWarnSpy.mockRestore();
  });
});
