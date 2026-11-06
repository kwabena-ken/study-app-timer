import React from "react";
import { act, create } from "react-test-renderer";

import SessionScreen from "../SessionScreen";

jest.setTimeout(15000);

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock("../../hooks/useAlarmSound", () => ({
  useAlarmSound: () => ({ playAlarm: jest.fn(), stopAlarm: jest.fn() }),
}));
jest.mock("../../components/SessionDial", () => () => null);
jest.mock("../../components/Icon", () => () => null);
jest.mock("../../utils/storage", () => ({
  ...jest.requireActual("../../utils/storage"),
  loadSettings: jest.fn().mockResolvedValue({}),
  saveSettings: jest.fn().mockResolvedValue(undefined),
}));

// `mock`-prefixed so Jest's hoisted factories may close over them.
let mockTimerState;
const mockScheduleChain = jest.fn();
const mockCancelAll = jest.fn();
let mockNotificationError = null;

jest.mock("../../hooks/useTimer", () => ({
  useTimer: () => mockTimerState,
}));

jest.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({
    scheduleChain: mockScheduleChain,
    cancelAll: mockCancelAll,
    error: mockNotificationError,
  }),
}));

const NOW = 1000000;

const SESSION = {
  label: "Test Session",
  phases: [
    { name: "Deep Study", duration: 20, emoji: "📖", tip: "Read." },
    { name: "Break", duration: 5, emoji: "☕", isBreak: true, tip: "Rest." },
    { name: "Recall", duration: 15, emoji: "🃏", tip: "Recall." },
  ],
};

let renderer;
let originalActEnvironment;

function element(session = SESSION) {
  return (
    <SessionScreen
      session={session}
      subject="Math"
      subjectColor="#4f8ef7"
      onGoHome={() => {}}
      onComplete={() => {}}
      onPartialQuit={() => {}}
    />
  );
}

async function mount(session = SESSION) {
  await act(async () => {
    renderer = create(element(session));
  });
  return renderer.root;
}

/** Re-render with the current mock timer state. */
async function refresh(session = SESSION) {
  await act(async () => {
    renderer.update(element(session));
  });
  return renderer.root;
}

/** Flip the timer's running flag and let the screen react. */
async function setRunning(next, session = SESSION) {
  mockTimerState = { ...mockTimerState, running: next };
  return refresh(session);
}

beforeEach(() => {
  jest.clearAllMocks();
  originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockNotificationError = null;
  mockTimerState = {
    secondsLeft: 1200,
    running: false,
    setRunning: jest.fn(),
    loadDuration: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
  };
  jest.spyOn(Date, "now").mockReturnValue(NOW);
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

// Regression: the screen used to emit `{ seconds }` (a relative countdown) while
// useNotifications requires `{ at }` (absolute epoch ms). Number.isFinite(undefined)
// failed the hook's guard, so it threw before scheduling anything and the screen
// ignored the error — background alarms silently never fired.
it("schedules phase alarms with absolute deadlines the native hook accepts", async () => {
  await mount();
  await setRunning(true);

  expect(mockScheduleChain).toHaveBeenCalled();
  const [items] = mockScheduleChain.mock.calls.at(-1);

  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    // Exactly the guard in useNotifications.scheduleChain.
    expect(Number.isFinite(item.at) && Number.isFinite(new Date(item.at).getTime())).toBe(true);
    expect(item.at).toBeGreaterThan(Date.now());
    expect(item.seconds).toBeUndefined();
    expect(typeof item.title).toBe("string");
    expect(typeof item.body).toBe("string");
  }
});

it("anchors the first deadline to the timer's remaining time", async () => {
  await mount();
  await setRunning(true);

  const [items] = mockScheduleChain.mock.calls.at(-1);
  expect(items[0].at).toBe(NOW + 1200 * 1000);
});

it("stacks later phase deadlines cumulatively with auto-advance", async () => {
  await mount();
  await setRunning(true);

  const [items] = mockScheduleChain.mock.calls.at(-1);
  expect(items).toHaveLength(3);
  expect(items[1].at - items[0].at).toBe(5 * 60 * 1000);
  expect(items[2].at - items[1].at).toBe(15 * 60 * 1000);
});

it("cancels the chain while the timer is paused and reschedules on resume", async () => {
  await mount();
  mockScheduleChain.mockClear();
  mockCancelAll.mockClear();

  await setRunning(true);
  expect(mockScheduleChain).toHaveBeenCalledTimes(1);

  await setRunning(false);
  expect(mockCancelAll).toHaveBeenCalled();
  expect(mockScheduleChain).toHaveBeenCalledTimes(1);

  await setRunning(true);
  expect(mockScheduleChain).toHaveBeenCalledTimes(2);
});

it("forwards the sound preset and vibration preference to the channel", async () => {
  await mount();
  await setRunning(true);

  const [, soundPreset, vibrate] = mockScheduleChain.mock.calls.at(-1);
  expect(soundPreset).toBe("classic");
  // loadSettings resolves {} → vibrate defaults to true.
  expect(vibrate).toBe(true);
});

it("reschedules when the vibration preference changes", async () => {
  const { loadSettings } = require("../../utils/storage");
  loadSettings.mockResolvedValue({ vibrate: false, soundPreset: "chime" });

  await mount();
  await setRunning(true);

  const [, soundPreset, vibrate] = mockScheduleChain.mock.calls.at(-1);
  expect(soundPreset).toBe("chime");
  expect(vibrate).toBe(false);
});

/** Flatten a rendered Text node's children into one searchable string. */
function textOf(node) {
  const children = node.props?.children;
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map((child) => (typeof child === "string" ? child : "")).join(" ");
  }
  return "";
}

it("surfaces a scheduling failure to the user instead of failing silently", async () => {
  await mount();
  mockNotificationError = "Notification scheduling failed";
  const root = await refresh();

  const warnings = root.findAll(
    (node) => typeof node.type === "string" && textOf(node).includes("Background alarms unavailable")
  );
  expect(warnings.length).toBeGreaterThan(0);
  expect(textOf(warnings[0])).toContain("in-app alarm still work");
});

it("shows no warning while scheduling is healthy", async () => {
  const root = await mount();
  await setRunning(true);

  const warnings = root.findAll(
    (node) => typeof node.type === "string" && textOf(node).includes("Background alarms unavailable")
  );
  expect(warnings).toHaveLength(0);
});
