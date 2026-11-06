import React from "react";
import { act, create } from "react-test-renderer";
import { Alert, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { cancelSessionNotifications, useNotifications } from "../useNotifications";

jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  AndroidNotificationPriority: { HIGH: "high" },
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
}));

const NOW = 1800000000000;
const foregroundHandler = Notifications.setNotificationHandler.mock.calls[0][0];
const granted = { granted: true };
const denied = { granted: false, canAskAgain: false };
const item = (at = NOW + 60000) => ({ at, title: "Phase complete", body: "Take a break" });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let renderer;
let hook;
let nextId;
let originalOS;
let originalActEnvironment;

function Harness() {
  hook = useNotifications();
  return null;
}

async function mount() {
  await act(async () => {
    renderer = create(<Harness />);
  });
}

async function schedule(items = [item()], preset = "classic", vibrate) {
  await act(async () => {
    await hook.scheduleChain(items, preset, vibrate);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  originalOS = Platform.OS;
  Platform.OS = "android";
  originalActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  renderer = null;
  nextId = 0;
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  // React 19 deprecates this renderer, which is supplied by jest-expo.
  const consoleError = console.error;
  jest.spyOn(console, "error").mockImplementation((message, ...args) => {
    if (typeof message === "string" && message.startsWith("react-test-renderer is deprecated")) return;
    consoleError(message, ...args);
  });
  Notifications.setNotificationChannelAsync.mockReset().mockResolvedValue({ id: "channel" });
  Notifications.getPermissionsAsync.mockReset().mockResolvedValue(granted);
  Notifications.requestPermissionsAsync.mockReset().mockResolvedValue(granted);
  Notifications.scheduleNotificationAsync.mockReset().mockImplementation(async () => `id-${++nextId}`);
  Notifications.cancelScheduledNotificationAsync.mockReset().mockResolvedValue(undefined);
  Notifications.getAllScheduledNotificationsAsync.mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer.unmount());
  }
  Platform.OS = originalOS;
  global.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  jest.restoreAllMocks();
});

it("suppresses foreground notifications to avoid doubling the in-app alarm", async () => {
  expect(await foregroundHandler.handleNotification()).toEqual({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
});

it("creates all versioned sound/vibration channels before permission and shares an in-flight prompt", async () => {
  const channels = deferred();
  const permission = deferred();
  Notifications.setNotificationChannelAsync.mockReturnValue(channels.promise);
  Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  Notifications.requestPermissionsAsync.mockReturnValue(permission.promise);
  await mount();
  let pending;
  await act(async () => {
    pending = hook.scheduleChain([item()], "bell", false);
  });
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(8);
  for (const preset of ["classic", "chime", "bell", "marimba"]) {
    for (const vibrate of [true, false]) {
      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        `study-alarm-v2-${preset}-vibrate-${vibrate ? "on" : "off"}`,
        expect.objectContaining({ sound: `alarm_${preset}.wav`, enableVibrate: vibrate })
      );
    }
  }
  for (const [, channel] of Notifications.setNotificationChannelAsync.mock.calls) {
    expect(channel.bypassDnd).not.toBe(true);
    if (!channel.enableVibrate) expect(channel.vibrationPattern).toBeUndefined();
  }
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await act(async () => channels.resolve({ id: "channel" }));
  expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  await act(async () => {
    permission.resolve(granted);
    await pending;
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    content: {
      title: item().title,
      body: item().body,
      data: { studyTimerSession: true },
      sound: "alarm_bell.wav",
      priority: "high",
    },
    trigger: { type: "date", date: new Date(item().at), channelId: "study-alarm-v2-bell-vibrate-off" },
  });
  expect(hook.error).toBeNull();
});

it("uses absolute DATE triggers, skips passed deadlines, and defaults to classic with vibration", async () => {
  await mount();
  await schedule([item(NOW - 1), item(NOW), item(NOW + 1234)], "unknown");
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].trigger).toEqual({
    type: "date", date: new Date(NOW + 1234), channelId: "study-alarm-v2-classic-vibrate-on",
  });
});

it("rechecks deadlines after permission setup and each native scheduling call", async () => {
  const permission = deferred();
  Notifications.getPermissionsAsync.mockReturnValue(permission.promise);
  await mount();
  let pending;
  await act(async () => {
    pending = hook.scheduleChain([item(NOW + 100), item(NOW + 200), item(NOW + 300)], "chime");
  });
  Notifications.scheduleNotificationAsync.mockImplementation(async () => {
    Date.now.mockReturnValue(NOW + 300);
    return "id-1";
  });
  await act(async () => {
    Date.now.mockReturnValue(NOW + 100);
    permission.resolve(granted);
    await pending;
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].trigger.date).toEqual(new Date(NOW + 200));
});

it.each([2, 3, 4])("accepts iOS authorization status %s without Android channels", async (status) => {
  Platform.OS = "ios";
  Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, ios: { status } });
  await mount();
  await schedule();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].trigger.channelId).toBeUndefined();
  expect(hook.error).toBeNull();
});

it("reports denied permission and allows scheduling to retry after Settings changes", async () => {
  Notifications.getPermissionsAsync.mockResolvedValue(denied);
  await mount();
  expect(hook.error).toMatch(/Notification setup failed:.*permission is disabled/);
  await schedule();
  expect(hook.error).toMatch(/Notification scheduling failed:.*permission is disabled/);
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  Notifications.getPermissionsAsync.mockResolvedValue(granted);
  await schedule();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(hook.error).toBeNull();
});

it("does not let an old Settings failure overwrite a newer successful schedule", async () => {
  Notifications.getPermissionsAsync.mockResolvedValue(denied);
  await mount();
  const settings = deferred();
  Linking.openSettings.mockReturnValue(settings.promise);
  let pending;
  await act(async () => {
    pending = Alert.alert.mock.calls[0][2][1].onPress();
  });
  Notifications.getPermissionsAsync.mockResolvedValue(granted);
  await schedule();
  await act(async () => {
    settings.reject(new Error("Settings unavailable"));
    await pending;
  });
  expect(hook.error).toBeNull();
});

it.each([null, new Error("channel unavailable")])("reports channel setup failure and retries", async (failure) => {
  if (failure) Notifications.setNotificationChannelAsync.mockRejectedValue(failure);
  else Notifications.setNotificationChannelAsync.mockResolvedValue(null);
  await mount();
  expect(hook.error).toMatch(/Notification setup failed/);
  await schedule();
  expect(hook.error).toMatch(/Notification scheduling failed/);
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  Notifications.setNotificationChannelAsync.mockResolvedValue({ id: "channel" });
  await schedule();
  expect(hook.error).toBeNull();
});

it("rolls back a partial chain on scheduling failure and permits retry", async () => {
  await mount();
  Notifications.scheduleNotificationAsync.mockResolvedValueOnce("partial").mockRejectedValueOnce(new Error("native failure"));
  await schedule([item(), item(NOW + 120000)]);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("partial");
  expect(hook.error).toBe("Notification scheduling failed: native failure");
  await schedule();
  expect(hook.error).toBeNull();
});

it.each([NaN, Infinity, 1e20, undefined])("rejects invalid absolute deadline %s and rolls back partial work", async (at) => {
  await mount();
  await schedule([item(), { ...item(), at }]);
  expect(hook.error).toMatch(/deadlines must be absolute timestamps/);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("id-1");
});

it("retains failed cancellation IDs, blocks replacements, and retries them on scheduleChain", async () => {
  await mount();
  await schedule();
  Notifications.cancelScheduledNotificationAsync.mockRejectedValue(new Error("cancel unavailable"));
  await act(async () => { await hook.cancelAll(); });
  expect(hook.error).toMatch(/Notification cancellation failed:.*id-1: cancel unavailable/);
  await schedule();
  expect(hook.error).toMatch(/Notification scheduling failed:.*cancel unavailable/);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  await schedule();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  expect(hook.error).toBeNull();
});

it("clears a previous cancellation error when cancelAll is retried", async () => {
  await mount();
  await schedule();
  Notifications.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error("cancel unavailable"));
  await act(async () => { await hook.cancelAll(); });
  expect(typeof hook.error).toBe("string");
  await act(async () => { await hook.cancelAll(); });
  expect(hook.error).toBeNull();
});

it("cancels a late native ID before a newer chain starts, without deleting the newer chain", async () => {
  await mount();
  const native = deferred();
  Notifications.scheduleNotificationAsync.mockReturnValueOnce(native.promise);
  let first;
  let second;
  await act(async () => { first = hook.scheduleChain([item(), item()], "classic"); });
  await act(async () => { second = hook.scheduleChain([item()], "marimba"); });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    native.resolve("late-id");
    await Promise.all([first, second]);
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.cancelScheduledNotificationAsync.mock.calls).toEqual([["late-id"]]);
  expect(Notifications.cancelScheduledNotificationAsync.mock.invocationCallOrder[0]).toBeLessThan(
    Notifications.scheduleNotificationAsync.mock.invocationCallOrder[1]
  );
  await act(async () => { await hook.cancelAll(); });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenLastCalledWith("id-1");
});

it.each(["cancel", "unmount"])("cleans late native IDs after %s", async (action) => {
  await mount();
  const native = deferred();
  Notifications.scheduleNotificationAsync.mockReturnValueOnce(native.promise);
  let pending;
  let cancellation;
  await act(async () => { pending = hook.scheduleChain([item(), item()], "classic"); });
  await act(async () => {
    if (action === "cancel") cancellation = hook.cancelAll();
    else {
      renderer.unmount();
      renderer = null;
    }
  });
  await act(async () => {
    native.resolve("late-id");
    await pending;
    await cancellation;
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync.mock.calls).toEqual([["late-id"]]);
});

it("ignores a superseded scheduling failure and skips queued obsolete chains", async () => {
  await mount();
  const native = deferred();
  Notifications.scheduleNotificationAsync.mockReturnValueOnce(native.promise);
  let first;
  let second;
  let third;
  await act(async () => { first = hook.scheduleChain([item()], "classic"); });
  await act(async () => {
    second = hook.scheduleChain([item()], "bell");
    third = hook.scheduleChain([item()], "marimba");
    native.reject(new Error("obsolete failure"));
    await Promise.all([first, second, third]);
  });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.scheduleNotificationAsync.mock.calls[1][0].content.sound).toBe("alarm_marimba.wav");
  expect(hook.error).toBeNull();
});

it("invalidates pending permission setup on cancel", async () => {
  const permission = deferred();
  Notifications.getPermissionsAsync.mockReturnValue(permission.promise);
  await mount();
  let pending;
  let cancellation;
  await act(async () => { pending = hook.scheduleChain([item()], "classic"); });
  await act(async () => {
    cancellation = hook.cancelAll();
    permission.resolve(denied);
    await Promise.all([pending, cancellation]);
  });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(hook.error).toBeNull();
});

it("an empty chain cancels known IDs without scheduling or enumerating unrelated alerts", async () => {
  await mount();
  await schedule();
  await schedule([]);
  expect(Notifications.cancelScheduledNotificationAsync.mock.calls).toEqual([["id-1"]]);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
});

describe("cancelSessionNotifications", () => {
  it("enumerates persisted tagged orphans and exact legacy titles, leaving other alerts alone", async () => {
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: "orphan", content: { title: "Any title", data: { studyTimerSession: true } } },
      { identifier: "legacy", content: { title: "Study Timer" } },
      { identifier: "legacy-alarm", content: { title: "Study Timer \u23f0" } },
      { identifier: "unrelated", content: { title: "Reminder" } },
      { identifier: "prefix", content: { title: "Study Timer news" } },
      { identifier: "opt-out", content: { title: "Study Timer", data: { studyTimerSession: false } } },
      { identifier: "string-tag", content: { data: { studyTimerSession: "true" } } },
      { identifier: "no-content" },
    ]);
    await cancelSessionNotifications();
    expect(Notifications.cancelScheduledNotificationAsync.mock.calls).toEqual([
      ["orphan"], ["legacy"], ["legacy-alarm"],
    ]);
  });

  it("rejects enumeration failures for the startup caller to handle", async () => {
    Notifications.getAllScheduledNotificationsAsync.mockRejectedValue(new Error("read unavailable"));
    await expect(cancelSessionNotifications()).rejects.toThrow("Could not read scheduled session notifications: read unavailable");
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it("awaits every cancellation even when another fails, then rejects", async () => {
    Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: "bad", content: { data: { studyTimerSession: true } } },
      { identifier: "slow", content: { data: { studyTimerSession: true } } },
    ]);
    const slow = deferred();
    Notifications.cancelScheduledNotificationAsync.mockRejectedValueOnce(new Error("native failure")).mockReturnValueOnce(slow.promise);
    let settled = false;
    const pending = cancelSessionNotifications().catch((error) => {
      settled = true;
      return error;
    });
    await act(async () => {});
    expect(settled).toBe(false);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    slow.resolve();
    expect((await pending).message).toMatch(/Could not cancel session notifications.*bad: native failure/);
  });

  it("does not call unsupported notification APIs on web", async () => {
    Platform.OS = "web";
    await cancelSessionNotifications();
    await mount();
    expect(hook.error).toBeNull();
    await schedule();
    expect(hook.error).toMatch(/not supported on web/);
    expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
