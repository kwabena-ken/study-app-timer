import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  AndroidImportance,
  AndroidAudioUsage,
  AndroidAudioContentType,
  SchedulableTriggerInputTypes,
} from "expo-notifications";
import { alertDialog } from "../utils/confirm";

// Sound presets that ship with a bundled WAV + dedicated Android channel.
export const SOUND_PRESETS = ["classic", "chime", "bell", "marimba"];

const LEGACY_CHANNEL_PREFIX = "study-alarm-";
const CHANNEL_VERSION_PREFIX = "study-alarm-v2-";

export const normalizePreset = (preset) =>
  SOUND_PRESETS.includes(preset) ? preset : "classic";

// Android channel sound & vibration settings are immutable once created.
// Bumping to v2 migrates existing EAS dev-build installs off the old channels
// that cached broken WAV headers, and a `-novib` variant honors vibrate=false.
export const channelIdFor = (preset, vibrate = true) => {
  const key = normalizePreset(preset);
  return vibrate === false
    ? `${CHANNEL_VERSION_PREFIX}${key}-novib`
    : `${CHANNEL_VERSION_PREFIX}${key}`;
};

export const soundFileFor = (preset) => `alarm_${normalizePreset(preset)}.wav`;

// Show a silent foreground banner (visual feedback even if media volume is
// turned down), while keeping notification sound muted in foreground so
// SessionScreen's in-app alarm doesn't double up. When backgrounded or locked
// the OS delivers the notification with the channel's bundled alarm WAV.
if (Platform.OS !== "web" && Notifications.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// ── Module-level channel setup & async serialization mutex ──
let channelsReadyPromise = null;
let notificationQueue = Promise.resolve();
let latestOpSeq = 0;

function enqueueNotificationOp(task) {
  const run = notificationQueue.then(task, task);
  notificationQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Migrate legacy `study-alarm-*` Android channels and create all v2 channels.
 * Awaited by `scheduleChain` before any notification is scheduled.
 */
export function ensureAndroidChannels() {
  if (Platform.OS !== "android") return Promise.resolve();
  if (channelsReadyPromise) return channelsReadyPromise;

  channelsReadyPromise = (async () => {
    // Delete legacy v1 channels so stale broken sound configs are cleaned up.
    await Promise.all(
      SOUND_PRESETS.map((preset) =>
        Notifications.deleteNotificationChannelAsync?.(
          `${LEGACY_CHANNEL_PREFIX}${preset}`
        ).catch(() => {})
      )
    );

    // Create v2 channels (with vibration and silent-vibrate variants).
    await Promise.all(
      SOUND_PRESETS.flatMap((preset) => [
        Notifications.setNotificationChannelAsync(channelIdFor(preset, true), {
          name: `Study Timer — ${preset}`,
          importance: AndroidImportance.MAX,
          enableVibrate: true,
          vibrationPattern: [0, 500, 250, 500],
          lightColor: "#4f8ef7",
          sound: soundFileFor(preset),
          audioAttributes: {
            usage: AndroidAudioUsage.ALARM,
            contentType: AndroidAudioContentType.SONIFICATION,
          },
          bypassDnd: true,
        }),
        Notifications.setNotificationChannelAsync(channelIdFor(preset, false), {
          name: `Study Timer — ${preset} (no vibration)`,
          importance: AndroidImportance.MAX,
          enableVibrate: false,
          vibrationPattern: null,
          lightColor: "#4f8ef7",
          sound: soundFileFor(preset),
          audioAttributes: {
            usage: AndroidAudioUsage.ALARM,
            contentType: AndroidAudioContentType.SONIFICATION,
          },
          bypassDnd: true,
        }),
      ])
    );
  })().catch((e) => {
    channelsReadyPromise = null;
    console.warn("Failed to configure Android notification channels", e);
  });

  return channelsReadyPromise;
}

/**
 * Cancel every scheduled notification through the serialized async queue.
 */
export function cancelAllNotifications() {
  if (Platform.OS === "web") return Promise.resolve();

  latestOpSeq += 1;
  return enqueueNotificationOp(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync?.().catch(
      () => {}
    );
  });
}

/**
 * Schedule a drift-free chain of DATE-triggered phase-end notifications.
 * Awaits Android v2 channel readiness and serializes through a mutex so
 * rapid state/settings updates never race or leave duplicate alarms.
 *
 * @param {Array<{ targetMs?: number, seconds?: number, title: string, body: string }>} items
 * @param {string} soundPreset
 * @param {{ vibrate?: boolean }} [options]
 */
export function scheduleNotificationChain(items, soundPreset, options = {}) {
  if (Platform.OS === "web") return Promise.resolve([]);

  const vibrate = options?.vibrate !== false;
  const mySeq = ++latestOpSeq;

  return enqueueNotificationOp(async () => {
    if (mySeq !== latestOpSeq) return [];

    await ensureAndroidChannels();
    if (mySeq !== latestOpSeq) return [];

    await Notifications.cancelAllScheduledNotificationsAsync?.().catch(
      () => {}
    );
    if (mySeq !== latestOpSeq || !items || items.length === 0) return [];

    const preset = normalizePreset(soundPreset);
    const channelId = channelIdFor(preset, vibrate);
    const soundFile = soundFileFor(preset);
    const nowMs = Date.now();
    const ids = [];

    for (const item of items) {
      if (mySeq !== latestOpSeq) {
        await Notifications.cancelAllScheduledNotificationsAsync?.().catch(
          () => {}
        );
        return [];
      }

      const rawTargetMs =
        item.targetMs != null
          ? item.targetMs
          : nowMs + Math.max(Math.round(item.seconds || 0), 1) * 1000;

      // Never schedule notifications in the past.
      if (rawTargetMs <= Date.now()) continue;
      const fireDate = new Date(Math.max(rawTargetMs, Date.now() + 1000));

      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: item.title,
            body: item.body,
            sound: soundFile,
            priority:
              Notifications.AndroidNotificationPriority?.MAX ??
              Notifications.AndroidNotificationPriority?.HIGH,
            ...(vibrate === false ? { vibrate: [] } : {}),
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: fireDate,
            ...(Platform.OS === "android" ? { channelId } : {}),
          },
        });
        ids.push(id);
      } catch (e) {
        console.warn("Failed to schedule notification", e);
      }
    }

    if (mySeq !== latestOpSeq) {
      await Notifications.cancelAllScheduledNotificationsAsync?.().catch(
        () => {}
      );
      return [];
    }

    return ids;
  });
}

/**
 * Test helper to reset module-level channel/queue state between Jest cases.
 */
export function _resetNotificationStateForTests() {
  channelsReadyPromise = null;
  notificationQueue = Promise.resolve();
  latestOpSeq = 0;
}

/**
 * Hook that requests permissions on native platforms, initializes v2 Android
 * alarm channels, and returns serialized `scheduleChain` & `cancelAll` helpers.
 */
export function useNotifications() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") {
          alertDialog(
            "Notifications Disabled",
            "Enable notifications in Settings so alarms fire when the app is backgrounded."
          );
        }
      } catch (e) {
        console.warn("Failed to request notification permissions", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    ensureAndroidChannels();
  }, []);

  return {
    scheduleChain: scheduleNotificationChain,
    cancelAll: cancelAllNotifications,
  };
}
