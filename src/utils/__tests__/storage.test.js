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
});
