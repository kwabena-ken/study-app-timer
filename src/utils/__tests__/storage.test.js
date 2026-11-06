import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  loadSubjects,
  saveSubject,
  updateSubjectColor,
  renameSubject,
  deleteSubject,
  moveSubject,
  loadSessions,
  saveSession,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  updateTemplate,
  duplicateTemplate,
  toggleTemplateFavorite,
  moveTemplate,
  MAX_NAME_LENGTH,
} from "../storage";

// AsyncStorage is replaced with the in-memory mock in jest.setup.js.
beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("settings", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.weeklyGoalEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.weeklyGoalMins).toBe(600);
    expect(DEFAULT_SETTINGS.weeklyGoalDays).toBe(5);
  });

  it("merges saved fields over the defaults", async () => {
    await saveSettings({ autoAdvance: false });
    const s = await loadSettings();
    expect(s.autoAdvance).toBe(false);
    expect(s.soundPreset).toBe(DEFAULT_SETTINGS.soundPreset); // untouched field preserved
  });

  it("does not lose updates when two saves run concurrently", async () => {
    // Without per-key serialization both saves read the same defaults snapshot
    // and the second write clobbers the first. withKeyLock must persist both.
    await Promise.all([
      saveSettings({ vibrate: false }),
      saveSettings({ keepAwake: false }),
    ]);
    const s = await loadSettings();
    expect(s.vibrate).toBe(false);
    expect(s.keepAwake).toBe(false);
  });
});

describe("subjects", () => {
  it("adds a new subject with an auto-assigned color", async () => {
    const subj = await saveSubject("Biology");
    expect(subj.name).toBe("Biology");
    expect(typeof subj.color).toBe("string");
    expect(await loadSubjects()).toHaveLength(1);
  });

  it("dedupes case-insensitively and returns the existing entry", async () => {
    const first = await saveSubject("Biology");
    const again = await saveSubject("biology");
    expect(again).toEqual(first);
    expect(await loadSubjects()).toHaveLength(1);
  });

  it("persists both when two distinct subjects are added concurrently", async () => {
    await Promise.all([saveSubject("Biology"), saveSubject("Chemistry")]);
    const names = (await loadSubjects()).map((s) => s.name).sort();
    expect(names).toEqual(["Biology", "Chemistry"]);
  });

  it("renames a subject and matching historical sessions", async () => {
    await saveSubject("Biology");
    await saveSession({
      sessionType: "1hr",
      label: "1-Hour Session",
      subject: "Biology",
      startedAt: "2026-01-01T00:00:00.000Z",
      phasesCompleted: 4,
      totalStudyMins: 60,
    });

    await renameSubject("Biology", "Life Science");
    expect((await loadSubjects())[0].name).toBe("Life Science");
    expect((await loadSessions())[0].subject).toBe("Life Science");
  });

  it("rejects a rename that duplicates another subject", async () => {
    await saveSubject("Biology");
    await saveSubject("Chemistry");
    await expect(renameSubject("Biology", "chemistry")).rejects.toThrow(
      "already exists"
    );
  });

  it("updates colors, reorders subjects, and deletes without changing history", async () => {
    await saveSubject("Biology");
    await saveSubject("Chemistry");
    await updateSubjectColor("Biology", "#123456");
    await moveSubject("Chemistry", -1);

    let subjects = await loadSubjects();
    expect(subjects.map((s) => s.name)).toEqual(["Chemistry", "Biology"]);
    expect(subjects[1].color).toBe("#123456");

    await deleteSubject("Biology");
    subjects = await loadSubjects();
    expect(subjects.map((s) => s.name)).toEqual(["Chemistry"]);
  });
});

describe("sessions", () => {
  const base = {
    sessionType: "1hr",
    label: "1-Hour Session",
    subject: "Biology",
    startedAt: "2026-01-01T00:00:00.000Z",
    phasesCompleted: 4,
    totalStudyMins: 60,
  };

  it("prepends newest sessions first", async () => {
    await saveSession({ ...base, startedAt: "2026-01-01T00:00:00.000Z" });
    await saveSession({ ...base, startedAt: "2026-01-02T00:00:00.000Z" });
    const sessions = await loadSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].startedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("defaults actualStudyMins to totalStudyMins when omitted", async () => {
    const rec = await saveSession(base);
    expect(rec.actualStudyMins).toBe(60);
  });

  it("keeps an explicit actualStudyMins for partial sessions", async () => {
    const rec = await saveSession({
      ...base,
      actualStudyMins: 12.5,
      completed: false,
    });
    expect(rec.actualStudyMins).toBe(12.5);
    expect(rec.completed).toBe(false);
  });
});

describe("templates", () => {
  const tpl = {
    label: "Pomodoro",
    phases: [
      { name: "Focus", duration: 25, emoji: "📖", tip: "Deep work." },
      { name: "Break", duration: 5, emoji: "☕", isBreak: true, tip: "Rest." },
    ],
  };

  it("returns an empty array when nothing is stored", async () => {
    expect(await loadTemplates()).toEqual([]);
  });

  it("assigns an id and round-trips the record", async () => {
    const rec = await saveTemplate(tpl);
    expect(typeof rec.id).toBe("string");
    expect(rec.label).toBe("Pomodoro");
    expect(rec.phases).toHaveLength(2);
    expect(rec.favorite).toBe(false);

    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(rec);
  });

  it("falls back to a default label when none is given", async () => {
    const rec = await saveTemplate({ phases: [] });
    expect(rec.label).toBe("Custom Session");
  });

  it("prepends newest templates first", async () => {
    await saveTemplate({ ...tpl, label: "First" });
    await saveTemplate({ ...tpl, label: "Second" });
    const loaded = await loadTemplates();
    expect(loaded.map((t) => t.label)).toEqual(["Second", "First"]);
  });

  it("deletes a template by id", async () => {
    const a = await saveTemplate({ ...tpl, label: "Keep" });
    const b = await saveTemplate({ ...tpl, label: "Remove" });
    await deleteTemplate(b.id);
    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(a.id);
  });

  it("persists both when two templates are saved concurrently", async () => {
    // withKeyLock must serialize the read-modify-write so neither save clobbers.
    await Promise.all([
      saveTemplate({ ...tpl, label: "A" }),
      saveTemplate({ ...tpl, label: "B" }),
    ]);
    const labels = (await loadTemplates()).map((t) => t.label).sort();
    expect(labels).toEqual(["A", "B"]);
  });

  it("updates a template name and phases", async () => {
    const saved = await saveTemplate(tpl);
    const phases = [{ ...tpl.phases[0], duration: 40 }];
    const updated = await updateTemplate(saved.id, {
      label: "Long Focus",
      phases,
    });
    expect(updated.label).toBe("Long Focus");
    expect(updated.phases).toEqual(phases);
    expect((await loadTemplates())[0].id).toBe(saved.id);
  });

  it("duplicates a template with independent phase objects", async () => {
    const saved = await saveTemplate(tpl);
    const copy = await duplicateTemplate(saved.id);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.label).toBe("Pomodoro Copy");
    expect(copy.phases).toEqual(saved.phases);
    expect(copy.phases[0]).not.toBe(saved.phases[0]);
    expect(await loadTemplates()).toHaveLength(2);
  });

  it("pins favorites and only reorders within the same group", async () => {
    const first = await saveTemplate({ ...tpl, label: "First" });
    const second = await saveTemplate({ ...tpl, label: "Second" });
    const third = await saveTemplate({ ...tpl, label: "Third" });

    await toggleTemplateFavorite(first.id);
    let loaded = await loadTemplates();
    expect(loaded[0].id).toBe(first.id);
    expect(loaded[0].favorite).toBe(true);

    // A favorite cannot be moved into the non-favorite group.
    await moveTemplate(first.id, 1);
    loaded = await loadTemplates();
    expect(loaded[0].id).toBe(first.id);

    await moveTemplate(third.id, 1);
    loaded = await loadTemplates();
    expect(loaded.map((template) => template.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });
});

// Storage is untrusted input: a backup restore or partially-written value can
// yield JSON that parses but has the wrong shape. A try/catch around JSON.parse
// does not catch that, so each loader normalizes instead.
describe("malformed storage values", () => {
  const SESSIONS_KEY = "@study_timer/sessions";
  const SUBJECTS_KEY = "@study_timer/subjects";
  const TEMPLATES_KEY = "@study_timer/templates";
  const SETTINGS_KEY = "@study_timer/settings";

  it("drops subject entries that are not objects with a name", async () => {
    await AsyncStorage.setItem(
      SUBJECTS_KEY,
      JSON.stringify([{ name: "Biology", color: "#4f8ef7" }, null, 42, "Math", { color: "#fff" }])
    );
    expect(await loadSubjects()).toEqual([{ name: "Biology", color: "#4f8ef7" }]);
  });

  it("returns an empty subject list for a non-array payload", async () => {
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify({ a: 1 }));
    expect(await loadSubjects()).toEqual([]);
  });

  it("falls back to a default color for a subject missing one", async () => {
    await AsyncStorage.setItem(SUBJECTS_KEY, JSON.stringify([{ name: "Physics" }]));
    const [subject] = await loadSubjects();
    expect(subject.name).toBe("Physics");
    expect(typeof subject.color).toBe("string");
  });

  it("keeps only session records carrying a string id", async () => {
    await AsyncStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify([{ id: "a", subject: "Math" }, null, { subject: "no id" }, 7])
    );
    const sessions = await loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("a");
  });

  it("returns an empty session list for a non-array payload", async () => {
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify("not-an-array"));
    expect(await loadSessions()).toEqual([]);
  });

  it("drops templates without usable phases instead of crashing the picker", async () => {
    await AsyncStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([
        { id: "good", label: "Good", phases: [{ name: "Study", duration: 10 }] },
        { id: "no-phases", label: "Broken" },
        { id: "bad-phases", label: "Also broken", phases: [] },
        { id: "bad-duration", label: "NaN", phases: [{ name: "X", duration: "ten" }] },
      ])
    );
    const templates = await loadTemplates();
    expect(templates.map((t) => t.id)).toEqual(["good"]);
  });

  it("prunes only the unusable phases from a partially bad template", async () => {
    await AsyncStorage.setItem(
      TEMPLATES_KEY,
      JSON.stringify([
        {
          id: "mixed",
          label: "Mixed",
          phases: [
            { name: "Study", duration: 10 },
            { name: "Broken", duration: 0 },
            { name: "Break", duration: 5, isBreak: true },
          ],
        },
      ])
    );
    const [template] = await loadTemplates();
    expect(template.phases).toHaveLength(2);
    expect(template.phases.map((p) => p.name)).toEqual(["Study", "Break"]);
  });

  it("ignores a settings payload that is not a plain object", async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(["not", "settings"]));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(null));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify("dark"));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("still merges valid saved settings", async () => {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ autoAdvance: false, soundPreset: "chime" })
    );
    const settings = await loadSettings();
    expect(settings.autoAdvance).toBe(false);
    expect(settings.soundPreset).toBe("chime");
    expect(settings.weeklyGoalMins).toBe(DEFAULT_SETTINGS.weeklyGoalMins);
  });

  it("caps over-long names at the storage boundary", async () => {
    const long = "B".repeat(500);
    const subject = await saveSubject(long);
    expect(subject.name).toHaveLength(MAX_NAME_LENGTH);

    const template = await saveTemplate({ label: long, phases: [{ name: "S", duration: 5 }] });
    expect(template.label).toHaveLength(MAX_NAME_LENGTH);
  });
});
