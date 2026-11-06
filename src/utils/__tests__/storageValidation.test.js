import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_SETTINGS,
  MAX_NAME_LENGTH,
  normalizeSettings,
  loadSettings,
  saveSettings,
  saveSession,
  loadSessions,
  updateSession,
  saveTemplate,
  loadTemplates,
  duplicateTemplate,
} from "../storage";

describe("storage validation and hardening", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe("normalizeSettings", () => {
    it("returns default settings when given null, undefined, or non-object input", () => {
      expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings("bad string")).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(12345)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
    });

    it("retains all valid settings fields", () => {
      const valid = {
        soundPreset: "bell",
        vibrate: false,
        keepAwake: false,
        autoAdvance: false,
        theme: "light",
        weeklyGoalEnabled: false,
        weeklyGoalMins: 450,
        weeklyGoalDays: 4,
      };
      expect(normalizeSettings(valid)).toEqual(valid);
    });

    it("preserves boolean false for all boolean flags", () => {
      const normalized = normalizeSettings({
        vibrate: false,
        keepAwake: false,
        autoAdvance: false,
        weeklyGoalEnabled: false,
      });
      expect(normalized.vibrate).toBe(false);
      expect(normalized.keepAwake).toBe(false);
      expect(normalized.autoAdvance).toBe(false);
      expect(normalized.weeklyGoalEnabled).toBe(false);
    });

    it("sanitizes soundPreset: non-empty string, fallback to default", () => {
      expect(normalizeSettings({ soundPreset: "" }).soundPreset).toBe(
        DEFAULT_SETTINGS.soundPreset
      );
      expect(normalizeSettings({ soundPreset: "   " }).soundPreset).toBe(
        DEFAULT_SETTINGS.soundPreset
      );
      expect(normalizeSettings({ soundPreset: null }).soundPreset).toBe(
        DEFAULT_SETTINGS.soundPreset
      );
      expect(normalizeSettings({ soundPreset: 42 }).soundPreset).toBe(
        DEFAULT_SETTINGS.soundPreset
      );
      expect(normalizeSettings({ soundPreset: "  marimba  " }).soundPreset).toBe(
        "marimba"
      );
    });

    it("sanitizes theme: non-empty string, fallback to default", () => {
      expect(normalizeSettings({ theme: "" }).theme).toBe(
        DEFAULT_SETTINGS.theme
      );
      expect(normalizeSettings({ theme: "   " }).theme).toBe(
        DEFAULT_SETTINGS.theme
      );
      expect(normalizeSettings({ theme: false }).theme).toBe(
        DEFAULT_SETTINGS.theme
      );
      expect(normalizeSettings({ theme: {} }).theme).toBe(
        DEFAULT_SETTINGS.theme
      );
      expect(normalizeSettings({ theme: "  nord  " }).theme).toBe("nord");
    });

    it("sanitizes boolean flags to fallback when non-boolean provided", () => {
      const customFallback = {
        ...DEFAULT_SETTINGS,
        vibrate: false,
        keepAwake: false,
      };

      const normalized = normalizeSettings(
        {
          vibrate: "yes",
          keepAwake: 1,
          autoAdvance: null,
          weeklyGoalEnabled: undefined,
        },
        customFallback
      );

      expect(normalized.vibrate).toBe(false);
      expect(normalized.keepAwake).toBe(false);
      expect(normalized.autoAdvance).toBe(DEFAULT_SETTINGS.autoAdvance);
      expect(normalized.weeklyGoalEnabled).toBe(
        DEFAULT_SETTINGS.weeklyGoalEnabled
      );
    });

    it("sanitizes weeklyGoalMins: must be finite number > 0", () => {
      expect(normalizeSettings({ weeklyGoalMins: -10 }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: 0 }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: NaN }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(
        normalizeSettings({ weeklyGoalMins: Infinity }).weeklyGoalMins
      ).toBe(DEFAULT_SETTINGS.weeklyGoalMins);
      expect(normalizeSettings({ weeklyGoalMins: "500" }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: 120 }).weeklyGoalMins).toBe(
        120
      );
      expect(normalizeSettings({ weeklyGoalMins: 0.5 }).weeklyGoalMins).toBe(
        0.5
      );
    });

    it("sanitizes weeklyGoalDays: number between 1 and 7 rounded to integer", () => {
      expect(normalizeSettings({ weeklyGoalDays: 0 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 8 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: -2 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: NaN }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: "3" }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 1 }).weeklyGoalDays).toBe(1);
      expect(normalizeSettings({ weeklyGoalDays: 7 }).weeklyGoalDays).toBe(7);
      expect(normalizeSettings({ weeklyGoalDays: 4.4 }).weeklyGoalDays).toBe(4);
      expect(normalizeSettings({ weeklyGoalDays: 4.6 }).weeklyGoalDays).toBe(5);
    });

    it("uses provided custom fallback instead of DEFAULT_SETTINGS", () => {
      const fallback = {
        soundPreset: "chime",
        vibrate: false,
        keepAwake: false,
        autoAdvance: false,
        theme: "light",
        weeklyGoalEnabled: false,
        weeklyGoalMins: 300,
        weeklyGoalDays: 3,
      };

      const normalized = normalizeSettings({}, fallback);
      expect(normalized).toEqual(fallback);
    });
  });

  describe("loadSettings & saveSettings sanitization integration", () => {
    it("loadSettings returns normalized settings when storage contains corrupted fields", async () => {
      const corrupted = {
        soundPreset: "",
        vibrate: "not-a-bool",
        keepAwake: 123,
        autoAdvance: null,
        theme: "   ",
        weeklyGoalEnabled: "true",
        weeklyGoalMins: -50,
        weeklyGoalDays: 15,
      };
      await AsyncStorage.setItem(
        "@study_timer/settings",
        JSON.stringify(corrupted)
      );

      const loaded = await loadSettings();
      expect(loaded).toEqual(DEFAULT_SETTINGS);
    });

    it("saveSettings sanitizes invalid input against current settings", async () => {
      // First save valid baseline
      await saveSettings({
        theme: "light",
        weeklyGoalMins: 500,
        weeklyGoalDays: 4,
      });

      // Now save invalid partial updates
      const saved = await saveSettings({
        theme: "",
        weeklyGoalMins: -100,
        weeklyGoalDays: 9,
        vibrate: "invalid",
      });

      // Invalid fields should have fallen back to current settings
      expect(saved.theme).toBe("light");
      expect(saved.weeklyGoalMins).toBe(500);
      expect(saved.weeklyGoalDays).toBe(4);
      expect(saved.vibrate).toBe(DEFAULT_SETTINGS.vibrate);

      // Verify persistence matches
      const reloaded = await loadSettings();
      expect(reloaded).toEqual(saved);
    });
  });

  describe("updateSession whitelisting and length enforcement", () => {
    it("updates only whitelisted keys and discards unwhitelisted keys", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Original Label",
        subject: "Mathematics",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        actualStudyMins: 25,
        completed: false,
      });

      await updateSession(session.id, {
        // Whitelisted keys
        subject: "Physics",
        label: "Updated Label",
        completed: true,
        actualStudyMins: 50,
        phasesCompleted: 4,
        // Unwhitelisted keys (should all be ignored)
        id: "tampered-id",
        startedAt: "1999-01-01T00:00:00.000Z",
        completedAt: "1999-01-01T01:00:00.000Z",
        sessionType: "2hr",
        totalStudyMins: 999,
        maliciousKey: "injected",
      });

      const [updated] = await loadSessions();
      expect(updated.id).toBe(session.id);
      expect(updated.startedAt).toBe(session.startedAt);
      expect(updated.completedAt).toBe(session.completedAt);
      expect(updated.sessionType).toBe(session.sessionType);
      expect(updated.totalStudyMins).toBe(session.totalStudyMins);
      expect(updated.maliciousKey).toBeUndefined();

      expect(updated.subject).toBe("Physics");
      expect(updated.label).toBe("Updated Label");
      expect(updated.completed).toBe(true);
      expect(updated.actualStudyMins).toBe(50);
      expect(updated.phasesCompleted).toBe(4);
    });

    it("enforces MAX_NAME_LENGTH (64 chars) and trims on subject and label", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Session",
        subject: "Biology",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });

      const longString = "A".repeat(100);

      await updateSession(session.id, {
        subject: `  ${longString}  `,
        label: `  ${longString}  `,
      });

      const [updated] = await loadSessions();
      expect(updated.subject).toBe("A".repeat(MAX_NAME_LENGTH));
      expect(updated.subject.length).toBe(MAX_NAME_LENGTH);
      expect(updated.label).toBe("A".repeat(MAX_NAME_LENGTH));
      expect(updated.label.length).toBe(MAX_NAME_LENGTH);
    });

    it("falls back to 'Unspecified' when subject update trims to empty string", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Session",
        subject: "Biology",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });

      await updateSession(session.id, {
        subject: "    ",
      });

      const [updated] = await loadSessions();
      expect(updated.subject).toBe("Unspecified");
    });

    it("validates types on completed, actualStudyMins, and phasesCompleted", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Session",
        subject: "Biology",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        actualStudyMins: 25,
        completed: false,
      });

      // Pass invalid types
      await updateSession(session.id, {
        completed: "not-a-bool",
        actualStudyMins: -15,
        phasesCompleted: "two",
      });

      let [current] = await loadSessions();
      expect(current.completed).toBe(false);
      expect(current.actualStudyMins).toBe(25);
      expect(current.phasesCompleted).toBe(2);

      // Pass valid decimal phasesCompleted to verify Math.floor
      await updateSession(session.id, {
        actualStudyMins: 45.5,
        phasesCompleted: 3.9,
      });

      [current] = await loadSessions();
      expect(current.actualStudyMins).toBe(45.5);
      expect(current.phasesCompleted).toBe(3);
    });

    it("safely ignores non-object updates parameter", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Session",
        subject: "Biology",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });

      await expect(updateSession(session.id, null)).resolves.toBeUndefined();
      await expect(
        updateSession(session.id, "string")
      ).resolves.toBeUndefined();

      const [current] = await loadSessions();
      expect(current.subject).toBe("Biology");
    });

    it("updates only matching session id without altering other sessions", async () => {
      const s1 = await saveSession({
        sessionType: "1hr",
        label: "Session 1",
        subject: "Biology",
        startedAt: "2026-02-01T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });
      const s2 = await saveSession({
        sessionType: "1hr",
        label: "Session 2",
        subject: "Chemistry",
        startedAt: "2026-02-01T11:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });

      await updateSession(s1.id, { subject: "Advanced Biology" });

      const loaded = await loadSessions();
      const updatedS1 = loaded.find((s) => s.id === s1.id);
      const unchangedS2 = loaded.find((s) => s.id === s2.id);

      expect(updatedS1.subject).toBe("Advanced Biology");
      expect(unchangedS2.subject).toBe("Chemistry");
    });
  });

  describe("duplicateTemplate truncation", () => {
    it("slices duplicated template label to MAX_NAME_LENGTH (64 chars)", async () => {
      // 64-character label: 64 'X' chars
      const maxLabel = "X".repeat(MAX_NAME_LENGTH);
      const original = await saveTemplate({
        label: maxLabel,
        phases: [{ name: "Focus", duration: 25 }],
      });

      const copy = await duplicateTemplate(original.id);

      expect(copy.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(copy.label.length).toBe(MAX_NAME_LENGTH);
      // It should be the first 64 characters of `${maxLabel} Copy`
      expect(copy.label).toBe(`${maxLabel} Copy`.slice(0, MAX_NAME_LENGTH));

      const loaded = await loadTemplates();
      const storedCopy = loaded.find((t) => t.id === copy.id);
      expect(storedCopy.label.length).toBe(MAX_NAME_LENGTH);
    });

    it("preserves '${label} Copy' intact when within MAX_NAME_LENGTH", async () => {
      const original = await saveTemplate({
        label: "Short",
        phases: [{ name: "Focus", duration: 25 }],
      });

      const copy = await duplicateTemplate(original.id);
      expect(copy.label).toBe("Short Copy");
      expect(copy.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    });
  });
});
