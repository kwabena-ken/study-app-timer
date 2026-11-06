import { useEffect, useRef, useCallback, useState } from "react";
import { Platform, Alert, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import {
  AndroidImportance,
  AndroidAudioUsage,
  AndroidAudioContentType,
  IosAuthorizationStatus,
  SchedulableTriggerInputTypes,
} from "expo-notifications";

// Sound presets that ship with a bundled WAV + dedicated Android channels.
const SOUND_PRESETS = ["classic", "chime", "bell", "marimba"];

// Sound and vibration are channel settings; version IDs to replace shipped
// channels without inheriting their immutable defaults.
const channelIdFor = (preset, vibrate) =>
  `study-alarm-v2-${preset}-vibrate-${vibrate ? "on" : "off"}`;
const soundFileFor = (preset) => `alarm_${preset}.wav`;

const normalizePreset = (preset) =>
  SOUND_PRESETS.includes(preset) ? preset : "classic";

// iOS reports authorization through a nested `ios.status` — provisional and
// ephemeral grants still deliver notifications, so treat them as usable rather
// than only checking the coarse root `granted` flag.
function isPermissionUsable(settings) {
  if (!settings) return false;
  if (settings.granted) return true;
  const iosStatus = settings.ios?.status;
  return (
    iosStatus === IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === IosAuthorizationStatus.EPHEMERAL
  );
}

// Channels must exist before requesting permission on Android 13+.
async function ensureAndroidChannels() {
  if (Platform.OS !== "android") return;
  await Promise.all(
    SOUND_PRESETS.flatMap((preset) =>
      [true, false].map(async (vibrate) => {
        const channel = await Notifications.setNotificationChannelAsync(
          channelIdFor(preset, vibrate),
          {
            name: `Study Timer - ${preset}${vibrate ? "" : " (no vibration)"}`,
            importance: AndroidImportance.MAX,
            enableVibrate: vibrate,
            ...(vibrate && { vibrationPattern: [0, 500, 250, 500] }),
            lightColor: "#4f8ef7",
            sound: soundFileFor(preset),
            audioAttributes: {
              usage: AndroidAudioUsage.ALARM,
              contentType: AndroidAudioContentType.SONIFICATION,
            },
          }
        );
        if (!channel) throw new Error("Could not create notification channel.");
      })
    )
  );
}

// Keep failed IDs so a later cancel/retry can try them again. Wait for every
// cancellation, including failures, before allowing another chain to start.
async function cancelNotificationIds(ids) {
  const failures = [];
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
        ids.delete(id);
      } catch (error) {
        failures.push(`${id}: ${error?.message || String(error)}`);
      }
    })
  );
  if (failures.length) {
    throw new Error(`Could not cancel session notifications (${failures.join("; ")}).`);
  }
}

/** Cancel persisted session alarms, including orphans from a previous process.
 * Call at startup before scheduling a new session. Does not cancel other alerts.
 * Rejects on enumeration/cancellation failure so the caller can surface/retry it.
 */
export async function cancelSessionNotifications() {
  if (Platform.OS === "web") return;
  let scheduled;
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    throw new Error(
      `Could not read scheduled session notifications: ${error?.message || String(error)}`
    );
  }
  const ids = new Set(
    scheduled
      .filter(({ content }) =>
        content?.data?.studyTimerSession === true ||
        // Only untagged alerts need the exact pre-tagging title fallback.
        (content?.data?.studyTimerSession == null &&
          (content?.title === "Study Timer" ||
            content?.title === "Study Timer \u23f0"))
      )
      .map(({ identifier }) => identifier)
  );
  await cancelNotificationIds(ids);
}

// In the foreground we swallow the notification entirely (no banner, no tray
// entry, no sound): SessionScreen plays the in-app alarm and drives the phase
// UI itself, so a system notification would just double up. When the app is
// backgrounded or locked this handler does NOT run, so the notification is
// shown by the system and the channel's own sound (the user's chosen preset)
// plays — which is exactly the background alarm we want.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Hook that manages notification permissions, per-preset Android channels,
 * and scheduling/cancelling a chain of phase-end notifications.
 */
export function useNotifications() {
  const [error, setError] = useState(null);
  const scheduledIdsRef = useRef(new Set());
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const queueRef = useRef(Promise.resolve());
  const setupRef = useRef(null);

  // Share the mount-time permission prompt with scheduleChain. Once complete,
  // each new schedule checks again (e.g. after returning from system Settings).
  const ensureReady = useCallback(() => {
    if (!setupRef.current) {
      setupRef.current = (async () => {
        if (Platform.OS === "web") {
          throw new Error("Session notifications are not supported on web.");
        }
        await ensureAndroidChannels();
        let settings = await Notifications.getPermissionsAsync();
        if (!isPermissionUsable(settings) && settings?.canAskAgain !== false) {
          settings = await Notifications.requestPermissionsAsync();
        }
        if (!isPermissionUsable(settings)) {
          if (mountedRef.current) {
            Alert.alert(
              "Notifications Disabled",
              "Enable notifications for session alerts while the app is backgrounded or locked.",
              [
                { text: "Not Now", style: "cancel" },
                {
                  text: "Open Settings",
                  onPress: () => {
                    const generation = generationRef.current;
                    return Linking.openSettings().catch((cause) => {
                      if (mountedRef.current && generationRef.current === generation) {
                        setError(`Could not open notification settings: ${cause?.message || String(cause)}`);
                      }
                    });
                  },
                },
              ]
            );
          }
          throw new Error("Notification permission is disabled. Enable it in Settings and retry.");
        }
      })().finally(() => {
        setupRef.current = null;
      });
    }
    return setupRef.current;
  }, []);

  // Serialize native work, but invalidate old work immediately. This lets a
  // cancel await IDs that have not yet returned from the native scheduler.
  const enqueue = useCallback((generation, label, operation) => {
    const pending = queueRef.current.then(operation).catch((cause) => {
      const message = `${label}: ${cause?.message || String(cause)}`;
      if (!mountedRef.current) console.warn(message);
      else if (generationRef.current === generation) setError(message);
    });
    queueRef.current = pending;
    return pending;
  }, []);

  const cancelAll = useCallback(() => {
    const generation = ++generationRef.current;
    if (mountedRef.current) setError(null);
    return enqueue(generation, "Notification cancellation failed", () =>
      cancelNotificationIds(scheduledIdsRef.current)
    );
  }, [enqueue]);

  /**
   * Schedule a chain of phase-end notifications. Any previously scheduled
   * chain is cancelled first. Safe against overlapping calls: each invocation
   * claims a generation token and stops (undoing partial work) the moment a
   * newer schedule/cancel supersedes it.
   *
   * @param {Array<{at:number,title:string,body:string}>} items
   *   Absolute Unix timestamps in milliseconds. Past deadlines are skipped.
   * @param {string} soundPreset - which preset sound/channel to use.
   * @param {boolean} vibrate - Android channel vibration (default true).
   *   iOS does not expose per-notification vibration control.
   */
  const scheduleChain = useCallback((items, soundPreset, vibrate = true) => {
    const myGen = ++generationRef.current;
    if (mountedRef.current) setError(null);
    const isCurrent = () => mountedRef.current && generationRef.current === myGen;
    return enqueue(myGen, "Notification scheduling failed", async () => {
      if (!isCurrent()) return;
      await cancelNotificationIds(scheduledIdsRef.current);
      if (!isCurrent() || !items || items.length === 0) return;
      await ensureReady();
      if (!isCurrent()) return;
      const preset = normalizePreset(soundPreset);
      try {
        for (const item of items) {
          if (!isCurrent()) return;
          if (!Number.isFinite(item.at) || !Number.isFinite(new Date(item.at).getTime())) {
            throw new Error("Notification deadlines must be absolute timestamps in milliseconds (at).");
          }
          // Check after all async setup and before each native call.
          if (item.at <= Date.now()) continue;
          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title: item.title,
              body: item.body,
              data: { studyTimerSession: true },
              sound: soundFileFor(preset),
              priority: Notifications.AndroidNotificationPriority.HIGH,
            },
            trigger: {
              type: SchedulableTriggerInputTypes.DATE,
              date: new Date(item.at),
              ...(Platform.OS === "android" && { channelId: channelIdFor(preset, vibrate) }),
            },
          });
          scheduledIdsRef.current.add(id);
          if (!isCurrent()) {
            await cancelNotificationIds(scheduledIdsRef.current);
            return;
          }
        }
      } catch (cause) {
        // Do not leave a partially scheduled chain after a native failure.
        try {
          await cancelNotificationIds(scheduledIdsRef.current);
        } catch (cleanupError) {
          throw new Error(`${cause?.message || String(cause)} ${cleanupError.message}`);
        }
        throw cause;
      }
    });
  }, [enqueue, ensureReady]);

  useEffect(() => {
    mountedRef.current = true;
    const generation = generationRef.current;
    let active = true;
    if (Platform.OS !== "web") {
      ensureReady().catch((cause) => {
        if (active && generationRef.current === generation) {
          setError(`Notification setup failed: ${cause?.message || String(cause)}`);
        }
      });
    }
    return () => {
      active = false;
      mountedRef.current = false;
      cancelAll();
    };
  }, [cancelAll, ensureReady]);

  return { scheduleChain, cancelAll, error };
}
