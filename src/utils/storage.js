import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateId } from "./generateId";

const STORAGE_KEY = "@study_timer/sessions";
const SUBJECTS_KEY = "@study_timer/subjects";

// ────────────────────────────────────────────
//  Per-key write serialization
// ────────────────────────────────────────────
// Every mutating helper below is read-modify-write (load → change → setItem).
// If two run concurrently they can read the same snapshot and the later write
// clobbers the earlier one (lost update) — reachable in-app, e.g. the session
// screen's auto-advance toggle saving settings while the settings screen also
// saves. withKeyLock chains operations that touch the same key so they run one
// at a time; operations on different keys still run in parallel.
const keyLocks = new Map();

function withKeyLock(key, task) {
  const prev = keyLocks.get(key) || Promise.resolve();
  // Run `task` after whatever is already queued for this key, whether that
  // prior operation resolved or rejected.
  const run = prev.then(task, task);
  // Keep the chain alive for the next caller without letting a rejection wedge
  // the key. Callers still receive the real result/rejection via `run`.
  keyLocks.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}

// ── Preset colors for auto-assigning to new subjects ──
export const SUBJECT_COLORS = [
  "#4f8ef7", // blue
  "#4caf6e", // green
  "#b06ce0", // purple
  "#e0a030", // amber
  "#30b8c8", // teal
  "#e06070", // coral
  "#7c8cf7", // indigo
  "#e07830", // orange
  "#50c090", // mint
  "#c06098", // pink
];

// ────────────────────────────────────────────
//  Subjects
// ────────────────────────────────────────────

/**
 * Load all saved subjects from local storage.
 * @returns {Promise<Array<{ name: string, color: string }>>}
 */
export async function loadSubjects() {
  try {
    const raw = await AsyncStorage.getItem(SUBJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save a subject. If it already exists (case-insensitive), returns the
 * existing entry. Otherwise creates a new entry with an auto-assigned color.
 *
 * @param {string} name - Subject name
 * @returns {Promise<{ name: string, color: string }>}
 */
export async function saveSubject(name) {
  const trimmed = name.trim();
  if (!trimmed) return { name: "Unspecified", color: SUBJECT_COLORS[0] };

  return withKeyLock(SUBJECTS_KEY, async () => {
    const subjects = await loadSubjects();
    const existing = subjects.find(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;

    const color = SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
    const newSubject = { name: trimmed, color };
    await AsyncStorage.setItem(
      SUBJECTS_KEY,
      JSON.stringify([...subjects, newSubject])
    );
    return newSubject;
  });
}

/**
 * Update the color assigned to a subject.
 *
 * @param {string} name - Subject name (case-insensitive match)
 * @param {string} color - New hex color
 */
export async function updateSubjectColor(name, color) {
  return withKeyLock(SUBJECTS_KEY, async () => {
    const subjects = await loadSubjects();
    const updated = subjects.map((s) =>
      s.name.toLowerCase() === name.toLowerCase() ? { ...s, color } : s
    );
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify(updated));
  });
}

/** Rename a subject and update matching historical session records. */
export async function renameSubject(currentName, nextName) {
  const trimmed = nextName.trim();
  if (!trimmed) throw new Error("Subject name cannot be empty");

  const renamed = await withKeyLock(SUBJECTS_KEY, async () => {
    const subjects = await loadSubjects();
    const currentIndex = subjects.findIndex(
      (s) => s.name.toLowerCase() === currentName.toLowerCase()
    );
    if (currentIndex < 0) throw new Error("Subject not found");

    const duplicate = subjects.some(
      (s, index) =>
        index !== currentIndex && s.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) throw new Error("A subject with that name already exists");

    const updatedSubject = { ...subjects[currentIndex], name: trimmed };
    const updated = [...subjects];
    updated[currentIndex] = updatedSubject;
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify(updated));
    return updatedSubject;
  });

  await withKeyLock(STORAGE_KEY, async () => {
    const sessions = await loadSessions();
    const updated = sessions.map((s) =>
      (s.subject || "").toLowerCase() === currentName.toLowerCase()
        ? { ...s, subject: trimmed }
        : s
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  });

  return renamed;
}

/** Delete a saved subject without altering historical session records. */
export async function deleteSubject(name) {
  return withKeyLock(SUBJECTS_KEY, async () => {
    const subjects = await loadSubjects();
    const updated = subjects.filter(
      (s) => s.name.toLowerCase() !== name.toLowerCase()
    );
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify(updated));
  });
}

/** Move a subject one position in the saved picker order. */
export async function moveSubject(name, direction) {
  return withKeyLock(SUBJECTS_KEY, async () => {
    const subjects = await loadSubjects();
    const from = subjects.findIndex(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
    const to = from + direction;
    if (from < 0 || to < 0 || to >= subjects.length) return subjects;

    const updated = [...subjects];
    [updated[from], updated[to]] = [updated[to], updated[from]];
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify(updated));
    return updated;
  });
}

// ────────────────────────────────────────────
//  Sessions
// ────────────────────────────────────────────

/**
 * Save a completed or partial session record to local storage.
 * Prepends to the existing array so newest sessions come first.
 * Also ensures the subject is saved to the subjects list.
 *
 * @param {Object} params
 * @param {string} params.sessionType      - "1hr" or "2hr"
 * @param {string} params.label            - e.g. "1-Hour Session"
 * @param {string} params.subject          - e.g. "Biology"
 * @param {string} params.startedAt        - ISO timestamp
 * @param {number} params.phasesCompleted  - number of study phases completed
 * @param {number} params.totalStudyMins   - total study minutes in the template
 * @param {number} [params.actualStudyMins] - actual minutes studied (for partial sessions)
 * @param {boolean} [params.completed=true] - whether the session was fully completed
 */
export async function saveSession({
  sessionType,
  label,
  subject,
  startedAt,
  phasesCompleted,
  totalStudyMins,
  actualStudyMins,
  completed = true,
}) {
  const record = {
    id: generateId(),
    sessionType,
    label,
    subject: subject || "Unspecified",
    startedAt,
    completedAt: new Date().toISOString(),
    phasesCompleted,
    totalStudyMins,
    actualStudyMins: actualStudyMins != null ? actualStudyMins : totalStudyMins,
    completed,
  };

  // Ensure the subject exists in our subjects list (locks SUBJECTS_KEY).
  await saveSubject(record.subject);

  // Serialize the sessions read-modify-write on STORAGE_KEY.
  return withKeyLock(STORAGE_KEY, async () => {
    const existing = await loadSessions();
    const updated = [record, ...existing];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return record;
  });
}

/**
 * Load all saved session records from local storage.
 * Returns newest first. Returns [] if nothing is stored.
 *
 * @returns {Promise<Array>} Array of session records
 */
export async function loadSessions() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Failed to load sessions:", e);
    return [];
  }
}

/**
 * Delete a single session record by id.
 *
 * @param {string} id - The session id to delete
 */
export async function deleteSession(id) {
  return withKeyLock(STORAGE_KEY, async () => {
    const sessions = await loadSessions();
    const updated = sessions.filter((s) => s.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  });
}

/**
 * Update fields on a single session record.
 *
 * @param {string} id - The session id to update
 * @param {Object} updates - Fields to merge into the record
 */
export async function updateSession(id, updates) {
  return withKeyLock(STORAGE_KEY, async () => {
    const sessions = await loadSessions();
    const updated = sessions.map((s) => (s.id === id ? { ...s, ...updates } : s));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  });
}

/**
 * Delete all saved session records.
 */
export async function clearSessions() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ────────────────────────────────────────────
//  Custom session templates
// ────────────────────────────────────────────
// A template is a reusable custom session the user built in CustomSessionScreen:
// { id, label, phases: [{ name, duration, emoji, isBreak, tip }] } — the same
// shape as the built-in SESSIONS entries plus an id. Launched through the normal
// custom-session path, so no special-casing is needed downstream.

const TEMPLATES_KEY = "@study_timer/templates";

/**
 * Load all saved custom-session templates (newest first). [] if none.
 * @returns {Promise<Array<{ id: string, label: string, phases: Array }>>}
 */
export async function loadTemplates() {
  try {
    const raw = await AsyncStorage.getItem(TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("Failed to load templates:", e);
    return [];
  }
}

/**
 * Save a custom-session template. Assigns an id and prepends so newest come
 * first. Serialized on TEMPLATES_KEY so concurrent saves don't clobber.
 *
 * @param {{ label: string, phases: Array }} template
 * @returns {Promise<{ id: string, label: string, phases: Array }>} the stored record
 */
export async function saveTemplate({ label, phases }) {
  const record = {
    id: generateId(),
    label: (label && label.trim()) || "Custom Session",
    phases: phases || [],
  };

  return withKeyLock(TEMPLATES_KEY, async () => {
    const existing = await loadTemplates();
    await AsyncStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([record, ...existing])
    );
    return record;
  });
}

/**
 * Delete a single template by id.
 * @param {string} id
 */
export async function deleteTemplate(id) {
  return withKeyLock(TEMPLATES_KEY, async () => {
    const templates = await loadTemplates();
    const updated = templates.filter((t) => t.id !== id);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  });
}

// ────────────────────────────────────────────
//  Settings
// ────────────────────────────────────────────

const SETTINGS_KEY = "@study_timer/settings";

export const DEFAULT_SETTINGS = {
  soundPreset: "classic",
  vibrate: true,
  keepAwake: true,
  autoAdvance: true,
  theme: "dark",
  weeklyGoalEnabled: true,
  weeklyGoalMins: 600,
  weeklyGoalDays: 5,
};

/**
 * Load user settings from local storage.
 */
export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save user settings to local storage. Merges the given fields over the current
 * saved settings; serialized on SETTINGS_KEY so concurrent saves don't clobber.
 */
export async function saveSettings(settings) {
  try {
    return await withKeyLock(SETTINGS_KEY, async () => {
      const current = await loadSettings();
      const updated = { ...current, ...settings };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  } catch (e) {
    console.warn("Failed to save settings", e);
    return DEFAULT_SETTINGS;
  }
}
