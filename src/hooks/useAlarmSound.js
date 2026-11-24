import { useEffect } from "react";
import { Platform } from "react-native";
import { Asset } from "expo-asset";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { loadSettings } from "../utils/storage";

const SOUND_FILES = {
  classic: require("../../assets/alarm_classic.wav"),
  chime: require("../../assets/alarm_chime.wav"),
  bell: require("../../assets/alarm_bell.wav"),
  marimba: require("../../assets/alarm_marimba.wav"),
};

// Module-level singleton controller so unmounting SessionScreen on the final
// phase never cuts off an active alarm sound.
let activePlayer = null;
let activeSub = null;
let activeWebAudio = null;
let activeWebAudioCleanup = null;
let activeWebAudioCtx = null;
let activeWebOscTimer = null;
let activeSafetyTimer = null;
let activePlaybackToken = 0;

let audioModePromise = null;
const downloadedSources = new Map();
let preloadedAll = false;

function cleanupActive({ pauseMedia = true } = {}) {
  if (activeSafetyTimer) {
    clearTimeout(activeSafetyTimer);
    activeSafetyTimer = null;
  }
  if (activeWebOscTimer) {
    clearTimeout(activeWebOscTimer);
    activeWebOscTimer = null;
  }
  if (activeSub) {
    try {
      activeSub.remove?.();
    } catch {
      // Ignore cleanup errors.
    }
    activeSub = null;
  }
  if (activePlayer) {
    const player = activePlayer;
    activePlayer = null;
    if (pauseMedia) {
      try {
        player.pause?.();
      } catch {
        // Ignore if already paused/released.
      }
    }
    try {
      player.remove?.();
    } catch {
      // Ignore if already removed.
    }
  }
  if (activeWebAudioCleanup) {
    try {
      activeWebAudioCleanup();
    } catch {
      // Ignore.
    }
    activeWebAudioCleanup = null;
  }
  if (activeWebAudio) {
    const audio = activeWebAudio;
    activeWebAudio = null;
    if (pauseMedia) {
      try {
        audio.pause();
      } catch {
        // Ignore.
      }
    }
  }
  if (activeWebAudioCtx) {
    const ctx = activeWebAudioCtx;
    activeWebAudioCtx = null;
    try {
      ctx.close?.();
    } catch {
      // Ignore.
    }
  }
}

function ensureAudioMode() {
  if (Platform.OS === "web") return Promise.resolve();
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
      shouldRouteThroughEarpiece: false,
    }).catch((e) => {
      audioModePromise = null;
      console.warn("Failed to set audio mode", e);
    });
  }
  return audioModePromise;
}

async function resolveNativeAlarmSource(soundKey) {
  const fileAsset = SOUND_FILES[soundKey] || SOUND_FILES.classic;
  if (downloadedSources.has(soundKey)) {
    return downloadedSources.get(soundKey);
  }
  try {
    const asset = Asset.fromModule(fileAsset);
    if (!asset.localUri) {
      await asset.downloadAsync();
    }
    const resolved = asset.localUri ? { uri: asset.localUri } : fileAsset;
    downloadedSources.set(soundKey, resolved);
    return resolved;
  } catch {
    return fileAsset;
  }
}

function resolveWebAlarmUri(soundKey) {
  const fileAsset = SOUND_FILES[soundKey] || SOUND_FILES.classic;
  if (typeof fileAsset === "string") return fileAsset;
  if (fileAsset && typeof fileAsset === "object") {
    if (typeof fileAsset.uri === "string") return fileAsset.uri;
    if (typeof fileAsset.default === "string") return fileAsset.default;
  }
  try {
    const asset = Asset.fromModule(fileAsset);
    return asset?.localUri || asset?.uri || null;
  } catch {
    return null;
  }
}

function playWebAudioToneFallback(soundKey, token, onFinish) {
  if (activePlaybackToken !== token) return;
  cleanupActive({ pauseMedia: true });

  const AudioCtx =
    typeof window !== "undefined"
      ? window.AudioContext || window.webkitAudioContext
      : null;

  if (!AudioCtx) {
    onFinish?.();
    return;
  }

  try {
    const ctx = new AudioCtx();
    activeWebAudioCtx = ctx;

    const presets = {
      classic: [880, 880, 880],
      chime: [523.25, 659.25, 783.99],
      bell: [440, 880],
      marimba: [587.33, 659.25, 783.99, 880],
    };
    const notes = presets[soundKey] || presets.classic;
    const step = 0.25;

    const scheduleNotes = () => {
      if (activePlaybackToken !== token) return;
      const start = ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = soundKey === "classic" ? "sine" : "triangle";
        osc.frequency.setValueAtTime(freq, start + i * step);
        gain.gain.setValueAtTime(0.001, start + i * step);
        gain.gain.exponentialRampToValueAtTime(0.2, start + i * step + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + (i + 1) * step);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start + i * step);
        osc.stop(start + (i + 1) * step + 0.02);
      });

      const totalMs = Math.ceil((notes.length * step + 0.1) * 1000);
      activeWebOscTimer = setTimeout(() => {
        if (activePlaybackToken !== token) return;
        cleanupActive({ pauseMedia: false });
        onFinish?.();
      }, totalMs);
    };

    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      Promise.resolve(ctx.resume())
        .then(scheduleNotes)
        .catch(() => {
          if (activePlaybackToken !== token) return;
          cleanupActive({ pauseMedia: false });
          onFinish?.();
        });
    } else {
      scheduleNotes();
    }
  } catch {
    if (activePlaybackToken === token) {
      cleanupActive({ pauseMedia: false });
      onFinish?.();
    }
  }
}

/**
 * Play the alarm sound for a given presetKey (or the user's saved default).
 *
 * Uses a module-level singleton so navigating away from SessionScreen on the
 * final phase never aborts playback. Supports an optional `onFinish` callback
 * for UI previews (e.g. resetting Settings' "Stop" button back to "Preview").
 *
 * @param {string} [presetKey]
 * @param {{ onFinish?: () => void }} [options]
 */
export async function playAlarm(presetKey, options = {}) {
  const { onFinish } = options || {};
  const token = ++activePlaybackToken;

  cleanupActive({ pauseMedia: true });

  let soundKey = presetKey;
  if (!soundKey) {
    try {
      const settings = await loadSettings();
      soundKey = settings.soundPreset || "classic";
    } catch {
      soundKey = "classic";
    }
  }
  if (!SOUND_FILES[soundKey]) {
    soundKey = "classic";
  }

  if (activePlaybackToken !== token) return;

  // Web: use HTMLAudioElement directly (expo-audio's AudioPlayerWeb leaves
  // media.play() promise rejections uncaught and omits ended status events),
  // with a Web Audio API tone fallback for browser autoplay edge cases.
  if (Platform.OS === "web") {
    const uri = resolveWebAlarmUri(soundKey);
    if (uri && typeof Audio !== "undefined") {
      try {
        const audio = new Audio(uri);
        activeWebAudio = audio;

        const handleEnded = () => {
          if (activePlaybackToken !== token) return;
          cleanupActive({ pauseMedia: false });
          onFinish?.();
        };

        const handleError = () => {
          if (activePlaybackToken !== token) return;
          playWebAudioToneFallback(soundKey, token, onFinish);
        };

        audio.addEventListener("ended", handleEnded, { once: true });
        audio.addEventListener("error", handleError, { once: true });
        activeWebAudioCleanup = () => {
          audio.removeEventListener("ended", handleEnded);
          audio.removeEventListener("error", handleError);
        };

        activeSafetyTimer = setTimeout(() => {
          if (activePlaybackToken !== token) return;
          cleanupActive({ pauseMedia: false });
          onFinish?.();
        }, 4500);

        const playResult = audio.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {
            if (activePlaybackToken !== token) return;
            playWebAudioToneFallback(soundKey, token, onFinish);
          });
        }
        return;
      } catch {
        if (activePlaybackToken === token) {
          playWebAudioToneFallback(soundKey, token, onFinish);
        }
        return;
      }
    }

    playWebAudioToneFallback(soundKey, token, onFinish);
    return;
  }

  // Native (iOS / Android EAS dev build): ensure audio session + local cached
  // WAV asset, then play through expo-audio and release on didJustFinish.
  try {
    await ensureAudioMode();
    const source = await resolveNativeAlarmSource(soundKey);
    if (activePlaybackToken !== token) return;

    const player = createAudioPlayer(source, {
      updateInterval: 100,
      downloadFirst: typeof source === "number",
    });
    activePlayer = player;

    if (typeof player.addListener === "function") {
      activeSub = player.addListener("playbackStatusUpdate", (status) => {
        if (status?.didJustFinish && activePlaybackToken === token) {
          cleanupActive({ pauseMedia: false });
          onFinish?.();
        }
      });
    }

    activeSafetyTimer = setTimeout(() => {
      if (activePlaybackToken !== token) return;
      cleanupActive({ pauseMedia: false });
      onFinish?.();
    }, 5000);

    await Promise.resolve(player.play()).catch((e) => {
      console.warn("Could not play alarm sound", e);
      if (activePlaybackToken === token) {
        cleanupActive({ pauseMedia: false });
        onFinish?.();
      }
    });
  } catch (e) {
    console.warn("Could not play alarm sound", e);
    if (activePlaybackToken === token) {
      cleanupActive({ pauseMedia: false });
      onFinish?.();
    }
  }
}

/**
 * Stop any currently playing alarm or preview immediately.
 */
export async function stopAlarm() {
  activePlaybackToken += 1;
  cleanupActive({ pauseMedia: true });
}

/**
 * Hook returning stable singleton alarm controls. Preloads native audio mode
 * and bundled WAV assets on mount, and intentionally does NOT stop active
 * alarms on unmount so final-phase alarms finish playing cleanly on DoneScreen.
 */
export function useAlarmSound() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    ensureAudioMode();
    if (!preloadedAll) {
      preloadedAll = true;
      Object.keys(SOUND_FILES).forEach((key) => {
        resolveNativeAlarmSource(key).catch(() => {});
      });
    }
  }, []);

  return { playAlarm, stopAlarm };
}
