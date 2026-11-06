import React from "react";
import { act, create } from "react-test-renderer";
import { StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import Slider from "@react-native-community/slider";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import CustomSessionScreen from "../CustomSessionScreen";
import SettingsScreen from "../SettingsScreen";
import HomeScreen from "../HomeScreen";
import SessionPickerScreen from "../SessionPickerScreen";
import TabBar from "../../components/TabBar";
import { ThemeProvider } from "../../theme/ThemeContext";
import { THEME_OPTIONS } from "../../theme/themes";

// Cold transforms of native screen dependencies can exceed Jest's five-second default.
jest.setTimeout(15000);

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: require("react-native").View,
  useSafeAreaInsets: jest.fn(),
}));
jest.mock("@react-native-community/slider", () => "Slider");
jest.mock("../../components/Icon", () => () => null);
jest.mock("../../hooks/useAlarmSound", () => ({
  useAlarmSound: () => ({ playAlarm: jest.fn(), stopAlarm: jest.fn() }),
}));

let renderer;
let originalActEnvironment;

async function mount(element) {
  await act(async () => { renderer = create(element); });
  return renderer.root;
}

function button(label) {
  return renderer.root.findAllByType(TouchableOpacity)
    .find((node) => node.props.accessibilityLabel === label);
}

beforeEach(() => {
  originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  useSafeAreaInsets.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
  const consoleError = console.error;
  jest.spyOn(console, "error").mockImplementation((message, ...args) => {
    if (typeof message === "string" && message.startsWith("react-test-renderer is deprecated")) return;
    consoleError(message, ...args);
  });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  jest.restoreAllMocks();
});

it("keeps every theme selectable in wrapping, touch-sized pills", async () => {
  await mount(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  for (const option of THEME_OPTIONS) {
    const pill = button(`${option.name} theme`);
    expect(pill).toBeDefined();
    expect(StyleSheet.flatten(pill.props.style)).toMatchObject({ minHeight: 48, maxWidth: "100%" });
    expect(StyleSheet.flatten(pill.props.style).flex).toBeUndefined();
    expect(StyleSheet.flatten(pill.parent.props.style)).toMatchObject({ flexWrap: "wrap" });
    await act(async () => pill.props.onPress());
    expect(button(`${option.name} theme`).props.accessibilityState.selected).toBe(true);
  }
});

it("labels builder inputs and keeps slider values and button limits in sync", async () => {
  const onStart = jest.fn();
  const root = await mount(<CustomSessionScreen subject="Math" onStartCustomSession={onStart} />);
  expect(root.findAllByType(TextInput).map((node) => node.props.accessibilityLabel)).toEqual([
    "Total session time in minutes", "Custom task name", "Template name",
  ]);
  let slider = root.findByType(Slider);
  expect(slider.props.accessibilityLabel).toBe("Deep Study duration");
  expect(slider.props.accessibilityValue).toEqual({ min: 1, max: 30, now: 30, text: "30 minutes" });
  expect(button("Increase Deep Study minutes").props.accessibilityState.disabled).toBe(true);

  await act(async () => slider.props.onValueChange(1));
  expect(button("Decrease Deep Study minutes").props.accessibilityState.disabled).toBe(true);
  expect(button("Save as template").props.accessibilityState.disabled).toBe(true);
  expect(button("Assign all session minutes before starting").props.accessibilityState.disabled).toBe(true);
  expect(root.findByType(Slider).props.accessibilityValue.text).toBe("1 minute");

  await act(async () => button("Increase Deep Study minutes").props.onPress());
  expect(root.findByType(Slider).props.accessibilityValue.now).toBe(2);
  await act(async () => button("Assign remaining 28 minutes").props.onPress());
  expect(button("Save as template").props.accessibilityState.disabled).toBe(false);
  await act(async () => button("Start custom session for 30 minutes").props.onPress());
  expect(onStart.mock.calls[0][0].phases[0].duration).toBe(30);

  for (const label of ["Go back", "Remove Deep Study", "Decrease Deep Study minutes", "Increase Deep Study minutes"]) {
    expect(StyleSheet.flatten(button(label).props.style)).toMatchObject({ width: 48, height: 48 });
  }
});

it("announces template updates and distinguishes multiple task sliders", async () => {
  const root = await mount(<CustomSessionScreen initialTemplate={{
    id: "template", label: "Review", phases: [
      { name: "Study", duration: 10 }, { name: "Break", duration: 5, isBreak: true },
    ],
  }} />);
  expect(button("Update template").props.accessibilityState.disabled).toBe(false);
  expect(root.findAllByType(Slider).map((node) => node.props.accessibilityLabel))
    .toEqual(["Study duration", "Break duration"]);
});

it("keeps slider bounds valid while reducing an overallocated multi-task plan", async () => {
  const root = await mount(<CustomSessionScreen initialTemplate={{
    id: "template", label: "Review", phases: [27, 1, 1, 1].map((duration, index) => ({
      name: `Task ${index + 1}`, duration,
    })),
  }} />);
  const totalInput = root.findAllByType(TextInput)
    .find((node) => node.props.accessibilityLabel === "Total session time in minutes");
  await act(async () => totalInput.props.onChangeText("4"));
  for (const slider of root.findAllByType(Slider)) {
    expect(slider.props.maximumValue).toBeGreaterThanOrEqual(slider.props.value);
    expect(slider.props.accessibilityValue.max).toBeGreaterThanOrEqual(slider.props.accessibilityValue.now);
  }
  expect(button("Update template").props.accessibilityState.disabled).toBe(true);
  await act(async () => button("Decrease Task 1 minutes").props.onPress());
  expect(button("Update template").props.accessibilityState.disabled).toBe(false);
});

it.each([
  [{ top: 0, bottom: 0, left: 0, right: 0 }, 8, 8, 8],
  [{ top: 44, bottom: 34, left: 0, right: 0 }, 42, 8, 8],
  [{ top: 0, bottom: 21, left: 44, right: 44 }, 29, 52, 52],
])("positions tabs using device insets %j", async (insets, bottom, left, right) => {
  useSafeAreaInsets.mockReturnValue(insets);
  const onChange = jest.fn();
  const root = await mount(<TabBar active="home" onChange={onChange} />);
  expect(StyleSheet.flatten(root.findAllByType(View)[0].props.style)).toMatchObject({
    paddingBottom: bottom, paddingLeft: left, paddingRight: right,
  });
  await act(async () => button("Settings").props.onPress());
  expect(onChange).toHaveBeenCalledWith("settings");
});

it("shows break-inclusive quick starts without a second bottom safe area", async () => {
  const onQuickStart = jest.fn();
  const root = await mount(<HomeScreen onQuickStart={onQuickStart} />);
  expect(root.findAllByType(SafeAreaView)[0].props.edges).toEqual(["top", "left", "right"]);
  await act(async () => button("Start 1-Hour Session, including breaks").props.onPress());
  expect(onQuickStart).toHaveBeenCalledWith("1hr");
  expect(button("Start 2-Hour Session, including breaks")).toBeDefined();
});

it("announces the actual total and study/break breakdown for each preset", async () => {
  const onStartSession = jest.fn();
  await mount(<SessionPickerScreen subject="Math" onStartSession={onStartSession} />);
  await act(async () => button("Start 1-Hour Session, 60 minutes total, 51 minutes study and 9 minutes breaks").props.onPress());
  expect(onStartSession).toHaveBeenCalledWith("1hr");
  expect(button("Start 2-Hour Session, 120 minutes total, 110 minutes study and 10 minutes breaks")).toBeDefined();
});
