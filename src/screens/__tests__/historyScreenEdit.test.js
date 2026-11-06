import React from "react";
import { act, create } from "react-test-renderer";
import { TouchableOpacity, TextInput, Text, View } from "react-native";
import HistoryScreen from "../HistoryScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as storage from "../../utils/storage";

jest.mock("../../utils/storage", () => {
  const actual = jest.requireActual("../../utils/storage");
  return {
    ...actual,
    loadSessions: jest.fn(),
    loadSubjects: jest.fn(),
    saveSubject: jest.fn(),
    updateSession: jest.fn(),
    deleteSession: jest.fn(),
    clearSessions: jest.fn(),
  };
});
jest.mock("../../components/Icon", () => () => null);

describe("HistoryScreen inline edit and subject persistence", () => {
  let mockSessions;
  let mockSubjects;
  let renderer;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSessions = [
      {
        id: "session-1",
        label: "25m Study",
        subject: "Math",
        startedAt: "2026-11-05T10:00:00.000Z",
        completedAt: new Date().toISOString(),
        completed: true,
        totalStudyMins: 25,
        actualStudyMins: 25,
        phasesCompleted: 1,
      },
    ];

    mockSubjects = [{ name: "Math", color: "#4f8ef7" }];

    storage.loadSessions.mockImplementation(async () => [...mockSessions]);
    storage.loadSubjects.mockImplementation(async () => [...mockSubjects]);
    storage.saveSubject.mockImplementation(async (name) => {
      const trimmed = name.trim();
      const existing = mockSubjects.find(
        (s) => s.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;
      const newSubj = { name: trimmed, color: "#22c55e" };
      mockSubjects.push(newSubj);
      return newSubj;
    });
    storage.updateSession.mockImplementation(async (id, updates) => {
      mockSessions = mockSessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      );
      return mockSessions.find((s) => s.id === id);
    });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
      renderer = null;
    }
  });

  it("persists new subject with saveSubject and refreshes filter chips and color", async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <HistoryScreen onGoHome={jest.fn()} />
        </ThemeProvider>
      );
    });

    // Verify initial subjects & filter chips
    const initialTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(initialTexts).toContain("Math");
    expect(initialTexts).not.toContain("Neuroscience");

    // Click "Edit subject"
    const editBtn = renderer.root
      .findAllByType(TouchableOpacity)
      .find((btn) => btn.props.accessibilityLabel === "Edit subject");
    expect(editBtn).toBeDefined();

    await act(async () => {
      editBtn.props.onPress();
    });

    // Find the inline edit TextInput (autoFocus is true on the inline edit input)
    const textInput = renderer.root
      .findAllByType(TextInput)
      .find((input) => input.props.autoFocus === true);
    expect(textInput).toBeDefined();

    await act(async () => {
      textInput.props.onChangeText("   Neuroscience   ");
    });

    // Click "Save name"
    const saveBtn = renderer.root
      .findAllByType(TouchableOpacity)
      .find((btn) => btn.props.accessibilityLabel === "Save name");
    expect(saveBtn).toBeDefined();

    await act(async () => {
      await saveBtn.props.onPress();
    });

    // Verify saveSubject was called with trimmed name
    expect(storage.saveSubject).toHaveBeenCalledWith("Neuroscience");

    // Verify updateSession was called with new canonical subject name
    expect(storage.updateSession).toHaveBeenCalledWith("session-1", {
      subject: "Neuroscience",
    });

    // Verify loadSubjects was called to refresh the subject list
    expect(storage.loadSubjects).toHaveBeenCalled();

    // Verify UI updated: subject changed to Neuroscience and filter chips include Neuroscience
    const updatedTexts = renderer.root.findAllByType(Text).map((t) => t.props.children);
    expect(updatedTexts).toContain("Neuroscience");

    // Verify color dot has the assigned color for Neuroscience (#22c55e)
    const colorDots = renderer.root
      .findAllByType(View)
      .filter((v) => {
        const flatStyle = Array.isArray(v.props.style)
          ? Object.assign({}, ...v.props.style.filter(Boolean))
          : v.props.style;
        return flatStyle && flatStyle.backgroundColor === "#22c55e";
      });
    expect(colorDots.length).toBeGreaterThanOrEqual(1);
  });

  it("reuses existing canonical subject casing and does not duplicate subject", async () => {
    await act(async () => {
      renderer = create(
        <ThemeProvider>
          <HistoryScreen onGoHome={jest.fn()} />
        </ThemeProvider>
      );
    });

    const editBtn = renderer.root
      .findAllByType(TouchableOpacity)
      .find((btn) => btn.props.accessibilityLabel === "Edit subject");

    await act(async () => {
      editBtn.props.onPress();
    });

    const textInput = renderer.root
      .findAllByType(TextInput)
      .find((input) => input.props.autoFocus === true);
    await act(async () => {
      textInput.props.onChangeText("math"); // lowercase
    });

    const saveBtn = renderer.root
      .findAllByType(TouchableOpacity)
      .find((btn) => btn.props.accessibilityLabel === "Save name");

    await act(async () => {
      await saveBtn.props.onPress();
    });

    expect(storage.saveSubject).toHaveBeenCalledWith("math");
    // updateSession receives canonical "Math" returned by saveSubject
    expect(storage.updateSession).toHaveBeenCalledWith("session-1", {
      subject: "Math",
    });
  });
});
