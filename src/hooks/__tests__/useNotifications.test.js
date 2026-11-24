import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  SOUND_PRESETS,
  channelIdFor,
  ensureAndroidChannels,
  scheduleNotificationChain,
  cancelAllNotifications,
  _resetNotificationStateForTests,
} from "../useNotifications";

jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  AndroidAudioUsage: { ALARM: 4 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  AndroidNotificationPriority: { MAX: "max", HIGH: "high" },
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  deleteNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("notif-id")),
}));

describe("useNotifications channel migration & queue serialization", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetNotificationStateForTests();
    Platform.OS = "android";
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  it("deletes legacy study-alarm-* channels and creates v2 Android alarm channels", async () => {
    await ensureAndroidChannels();

    expect(Notifications.deleteNotificationChannelAsync).toHaveBeenCalledTimes(
      SOUND_PRESETS.length
    );
    for (const preset of SOUND_PRESETS) {
      expect(Notifications.deleteNotificationChannelAsync).toHaveBeenCalledWith(
        `study-alarm-${preset}`
      );
      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        `study-alarm-v2-${preset}`,
        expect.objectContaining({
          importance: Notifications.AndroidImportance.MAX,
          sound: `alarm_${preset}.wav`,
          bypassDnd: true,
          enableVibrate: true,
          audioAttributes: expect.objectContaining({
            usage: Notifications.AndroidAudioUsage.ALARM,
          }),
        })
      );
      expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        `study-alarm-v2-${preset}-novib`,
        expect.objectContaining({
          sound: `alarm_${preset}.wav`,
          enableVibrate: false,
        })
      );
    }
  });

  it("awaits channel creation and uses DATE triggers with v2 channelId", async () => {
    const order = [];
    Notifications.setNotificationChannelAsync.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("channel");
    });
    Notifications.scheduleNotificationAsync.mockImplementation(async () => {
      order.push("schedule");
      return "id-1";
    });

    const targetMs = Date.now() + 60_000;
    await scheduleNotificationChain(
      [{ targetMs, title: "Study Timer ⏰", body: "Done" }],
      "chime",
      { vibrate: true }
    );

    expect(order[order.length - 1]).toBe("schedule");
    expect(order.filter((e) => e === "channel").length).toBe(
      SOUND_PRESETS.length * 2
    );
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          sound: "alarm_chime.wav",
        }),
        trigger: expect.objectContaining({
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: expect.any(Date),
          channelId: channelIdFor("chime", true),
        }),
      })
    );
  });

  it("uses -novib channel and empty vibrate array when vibrate is disabled", async () => {
    const targetMs = Date.now() + 60_000;
    await scheduleNotificationChain(
      [{ targetMs, title: "Study Timer ⏰", body: "Done" }],
      "bell",
      { vibrate: false }
    );

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          vibrate: [],
        }),
        trigger: expect.objectContaining({
          channelId: "study-alarm-v2-bell-novib",
        }),
      })
    );
  });

  it("serializes concurrent scheduleChain and cancelAll calls so superseded schedules are dropped", async () => {
    const scheduledPresets = [];
    Notifications.scheduleNotificationAsync.mockImplementation(async (req) => {
      await new Promise((r) => setTimeout(r, 15));
      scheduledPresets.push(req.content.sound);
      return `id-${scheduledPresets.length}`;
    });

    const targetMs = Date.now() + 60_000;
    const p1 = scheduleNotificationChain(
      [{ targetMs, title: "T", body: "1" }],
      "classic"
    );
    const p2 = scheduleNotificationChain(
      [{ targetMs, title: "T", body: "2" }],
      "marimba"
    );
    const p3 = cancelAllNotifications();

    await Promise.all([p1, p2, p3]);
    expect(scheduledPresets).toEqual([]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  it("is a clean no-op on Web without invoking native notification APIs", async () => {
    Platform.OS = "web";
    const targetMs = Date.now() + 60_000;
    await scheduleNotificationChain(
      [{ targetMs, title: "T", body: "1" }],
      "classic"
    );
    await cancelAllNotifications();

    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });
});
