# Study Timer

A focused, guided study-session timer for Android and iOS. Pick a subject, choose a
guided 1- or 2-hour session (or build your own), and let structured study/break phases
keep you on track — with alarms that fire even when the app is backgrounded or the
screen is locked.

Built with Expo + React Native.

## Features

- **Guided sessions** — ready-made 1-hour and 2-hour study plans with alternating
  study phases and breaks, each with a suggested activity tip.
- **Custom session builder** — set a total time, add study/break tags (presets or your
  own), and fine-tune each phase's duration with sliders and steppers. Sessions cannot
  start or be saved until all selected minutes are assigned, with a one-tap option to
  assign remaining minutes to the last phase.
- **Saved templates** — save a custom session as a reusable template and launch it again
  in one tap from the session picker.
- **Subjects** — tag every session with a subject; each gets an auto-assigned color used
  across history and stats. Manage saved subjects from Settings by renaming, recoloring,
  reordering, or deleting them; renaming updates matching history records.
- **Background & locked-screen alarms** — phase-complete alarms fire through a native
  Android alarm notification channel, so they sound even when the app isn't in the
  foreground. Choose from several bundled alarm sounds with live in-app previews.
- **Live auto-advance** — automatically roll into the next phase when one ends, or pause
  at each boundary. Toggleable mid-session.
- **Vibration & keep-awake** — optional haptics on alarms/controls, and an optional
  screen-awake lock held only while the timer runs.
- **Stats & history** — per-subject study totals across Day/Week/Month/All ranges, and a
  day-grouped history with search, subject/status/date filters, inline subject editing,
  and delete.
- **Eight themes** — Dark, Light, OLED Black, Matcha, Espresso, Synthwave, Deep
  Ocean, and Sakura Dusk, switchable live from Settings and persisted across launches.
- **Focus dashboard** — a home-screen streak card, seven-day activity markers,
  quick-start actions, and today/week/session recaps.
- **Weekly study goals** — choose focused-time and active-day targets in Settings,
  then track Monday-to-Sunday progress on Home and Stats.
- **Session dial** — one segmented ring shows the complete study plan, completed
  phases, the active phase, upcoming phases, and overall progress.
- **Refresh and recovery states** — pull to refresh Home, History, and Stats, with
  explicit retry actions when local data cannot be loaded.
- **Accessibility** — icon-only controls and toggles expose screen-reader labels and
  state.

## Tech stack

- [Expo](https://expo.dev/) SDK 54
- React Native 0.81.5 / React 19
- Pure JavaScript (no TypeScript)
- Local persistence via `@react-native-async-storage/async-storage`
- `expo-notifications`, `expo-audio`, `expo-haptics`, `expo-keep-awake`
- `expo-linear-gradient`, `expo-blur`, `react-native-svg`
- Jest (`jest-expo`) for unit tests

## Getting started

```bash
npm install
npx expo start
```

Then open the project in [Expo Go](https://expo.dev/go) on a physical device, or launch
an Android/iOS simulator from the Expo CLI.

> **Note:** Native alarms, background notifications, vibration, and the keep-awake lock
> require a real device or a development build — they do not work in the web preview.

## Testing

```bash
npm test
```

Runs the Jest suite (storage/templates, theme palettes, time and session-math helpers).
Use `npm run test:watch` for watch mode.

## Project structure

```
App.js                     Navigation switch + providers (ErrorBoundary, ThemeProvider)
src/
  screens/                 One file per screen (Home, SubjectPicker, SessionPicker,
                           CustomSession, Session, Done, History, Stats, Settings)
  components/              Shared UI (SessionDial, TabBar, Icon, ErrorBoundary)
  hooks/                   useTimer, useNotifications, useAlarmSound
  theme/                   Eight palettes + ThemeProvider/useTheme context + typography
  constants/               Built-in session definitions
  utils/                   Storage (sessions, subjects, templates, settings) + helpers
```

## How it works

Navigation is a lightweight `useState` screen switch in [App.js](App.js) rather than a
router, so each screen remounts on visit. Colors flow through a semantic theme palette
(`src/theme/themes.js`) consumed via `useTheme()` and a per-screen `makeStyles(theme)`
factory; subject and phase identity colors are treated as data and stay constant across
themes. All persistence goes through `src/utils/storage.js`, whose mutating helpers are
serialized per storage key to avoid lost-update races.

## Improvement tracker

Planned and completed quality-of-life work is tracked in
[IMPROVEMENTS.md](IMPROVEMENTS.md).
