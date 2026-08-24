// ── Theme palettes ──
//
// The entire app collapses to the ~25 color roles below. Each theme provides
// the same set of keys so any screen can reference `theme.<role>` safely (a
// missing key would surface as `undefined` and break a style — the theme test
// guards against that by asserting all three palettes share an identical key
// set).
//
// Roles are semantic, not literal: `overlayBtn`/`dotIdle`/`textFaint` are the
// SessionScreen "glassy" chrome, which is white-on-dark for dark/OLED and
// black-on-light for the light theme so the immersive timer reads correctly on
// a light background.
//
// NOTE: subject colors (SUBJECT_COLORS in storage.js) and study/break phase
// colors (studyColors/breakColor in constants/sessions.js) are DATA, not theme
// — they are identity colors that flow through the `subjectColor` prop and the
// per-phase `color`, and are intentionally not themed here.

const dark = {
  name: "dark",
  isDark: true,

  bg: "#090d14",
  bgSession: "#0d1117",
  surface: "#131920",
  surfaceAlt: "#0d1117",
  surfaceActive: "#131c28",
  border: "#1e2a38",
  hairline: "rgba(255,255,255,0.07)",

  textPrimary: "#f0f6ff",
  textSecondary: "#aab4c8",
  textTertiary: "#9aabbc",
  textMuted: "#556070",
  textDisabled: "#445566",
  onAccent: "#ffffff",

  accent: "#4f8ef7",
  success: "#4caf6e",
  danger: "#e06070",
  warning: "#e0a030",
  neutral: "#778899",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

const oled = {
  ...dark,
  name: "oled",
  isDark: true,

  bg: "#000000",
  bgSession: "#000000",
  surface: "#0a0e14",
  surfaceAlt: "#05070a",
  surfaceActive: "#0d1420",
  border: "#161d26",
  hairline: "rgba(255,255,255,0.06)",

  overlayBtn: "rgba(255,255,255,0.06)",
  progressTrack: "rgba(255,255,255,0.06)",
};

const light = {
  name: "light",
  isDark: false,

  bg: "#f4f6fb",
  bgSession: "#eef1f7",
  surface: "#ffffff",
  surfaceAlt: "#e7ebf3",
  surfaceActive: "#dbe6fb",
  border: "#d4dae6",
  hairline: "rgba(0,0,0,0.08)",

  textPrimary: "#10151f",
  textSecondary: "#3d4757",
  textTertiary: "#55617a",
  textMuted: "#8a93a6",
  textDisabled: "#aab2c2",
  onAccent: "#ffffff",

  accent: "#2f6fe0",
  success: "#2e9e5b",
  danger: "#d64550",
  warning: "#c98a1e",
  neutral: "#6b7788",

  timerText: "#10151f",
  textFaint: "rgba(0,0,0,0.4)",
  overlayBtn: "rgba(0,0,0,0.06)",
  progressTrack: "rgba(0,0,0,0.08)",
  dotIdle: "rgba(0,0,0,0.15)",
};

const forest = {
  name: "forest",
  isDark: true,

  bg: "#0c1612",
  bgSession: "#0f1c17",
  surface: "#14241e",
  surfaceAlt: "#0f1c17",
  surfaceActive: "#1a3028",
  border: "#203a30",
  hairline: "rgba(255,255,255,0.07)",

  textPrimary: "#eaf5f0",
  textSecondary: "#a0c4b4",
  textTertiary: "#7fa896",
  textMuted: "#4b6e5f",
  textDisabled: "#365246",
  onAccent: "#ffffff",

  accent: "#34d399",
  success: "#10b981",
  danger: "#f87171",
  warning: "#fbbf24",
  neutral: "#6b7280",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

const espresso = {
  name: "espresso",
  isDark: true,

  bg: "#140f0c",
  bgSession: "#1a1410",
  surface: "#221a15",
  surfaceAlt: "#1a1410",
  surfaceActive: "#2e221b",
  border: "#3a2c23",
  hairline: "rgba(255,255,255,0.07)",

  textPrimary: "#f7eee8",
  textSecondary: "#d6c2b4",
  textTertiary: "#b89f8f",
  textMuted: "#735d50",
  textDisabled: "#544339",
  onAccent: "#ffffff",

  accent: "#e69b52",
  success: "#4caf6e",
  danger: "#e06070",
  warning: "#f3b779",
  neutral: "#8c7b70",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

const synthwave = {
  name: "synthwave",
  isDark: true,

  bg: "#0b0719",
  bgSession: "#100a24",
  surface: "#170f33",
  surfaceAlt: "#100a24",
  surfaceActive: "#22164a",
  border: "#32206d",
  hairline: "rgba(255,255,255,0.08)",

  textPrimary: "#fae8ff",
  textSecondary: "#d8b4fe",
  textTertiary: "#c084fc",
  textMuted: "#6b43a3",
  textDisabled: "#4c2e78",
  onAccent: "#ffffff",

  accent: "#d946ef",
  success: "#34d399",
  danger: "#ff4d6d",
  warning: "#f59e0b",
  neutral: "#818cf8",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

const ocean = {
  name: "ocean",
  isDark: true,

  bg: "#06111e",
  bgSession: "#081729",
  surface: "#0d2038",
  surfaceAlt: "#081729",
  surfaceActive: "#122a4a",
  border: "#1a3960",
  hairline: "rgba(255,255,255,0.07)",

  textPrimary: "#e0f2fe",
  textSecondary: "#93c5fd",
  textTertiary: "#60a5fa",
  textMuted: "#3b82f6",
  textDisabled: "#1e3a8a",
  onAccent: "#ffffff",

  accent: "#38bdf8",
  success: "#34d399",
  danger: "#fb7185",
  warning: "#fbbf24",
  neutral: "#64748b",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

const sakura = {
  name: "sakura",
  isDark: true,

  bg: "#180c14",
  bgSession: "#21101b",
  surface: "#2c1624",
  surfaceAlt: "#21101b",
  surfaceActive: "#3a1d30",
  border: "#4f2742",
  hairline: "rgba(255,255,255,0.07)",

  textPrimary: "#fce7f3",
  textSecondary: "#f472b6",
  textTertiary: "#e879f9",
  textMuted: "#863b6e",
  textDisabled: "#5e294d",
  onAccent: "#ffffff",

  accent: "#fb7185",
  success: "#34d399",
  danger: "#f43f5e",
  warning: "#fbbf24",
  neutral: "#a21caf",

  timerText: "#ffffff",
  textFaint: "rgba(255,255,255,0.4)",
  overlayBtn: "rgba(255,255,255,0.08)",
  progressTrack: "rgba(255,255,255,0.08)",
  dotIdle: "rgba(255,255,255,0.18)",
};

export const THEMES = { dark, oled, light, forest, espresso, synthwave, ocean, sakura };

// Ordered list for rendering the theme picker (label + emoji live with the data).
export const THEME_OPTIONS = [
  { key: "dark", name: "Dark Mode", emoji: "🌙" },
  { key: "light", name: "Light", emoji: "☀️" },
  { key: "oled", name: "OLED Black", emoji: "🖤" },
  { key: "forest", name: "Matcha", emoji: "🌿" },
  { key: "espresso", name: "Espresso", emoji: "☕" },
  { key: "synthwave", name: "Synthwave", emoji: "🎆" },
  { key: "ocean", name: "Deep Ocean", emoji: "🌊" },
  { key: "sakura", name: "Sakura Dusk", emoji: "🌸" },
];

// Resolve a persisted theme name to a palette, falling back to dark for any
// unknown/legacy value.
export function getTheme(name) {
  return THEMES[name] || THEMES.dark;
}
