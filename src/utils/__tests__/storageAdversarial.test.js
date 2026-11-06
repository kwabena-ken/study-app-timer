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

describe("Milestone 1 Empirical Challenge: storage.js Stress Test", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    // Clean up any prototype pollution attempts if any succeeded
    delete Object.prototype.polluted;
    delete Object.prototype.injected;
    delete Object.prototype.isAdmin;
  });

  describe("1. normalizeSettings with Adversarial Inputs", () => {
    it("handles null, undefined, arrays, functions, and symbols gracefully", () => {
      expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(["soundPreset", "theme"])).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(() => {})).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(function () {})).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(Symbol("settings"))).toEqual(DEFAULT_SETTINGS);
    });

    it("handles primitives (strings, numbers, booleans) gracefully", () => {
      expect(normalizeSettings("malformed string")).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings("")).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(0)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(12345)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(-999)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(true)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(false)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(NaN)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(Infinity)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings(-Infinity)).toEqual(DEFAULT_SETTINGS);
    });

    it("handles circular objects without recursion errors or exceptions", () => {
      const circular = {};
      circular.self = circular;
      circular.nested = { back: circular };

      const result = normalizeSettings(circular);
      expect(result).toEqual(DEFAULT_SETTINGS);

      // Circular reference placed directly on fields
      const circularFields = {
        soundPreset: circular,
        theme: circular,
        vibrate: circular,
        keepAwake: circular,
        autoAdvance: circular,
        weeklyGoalEnabled: circular,
        weeklyGoalMins: circular,
        weeklyGoalDays: circular,
      };
      circularFields.loop = circularFields;

      const fieldResult = normalizeSettings(circularFields);
      expect(fieldResult).toEqual(DEFAULT_SETTINGS);
    });

    it("handles NaN, -Infinity, +Infinity, and extreme numbers for weeklyGoalMins", () => {
      expect(normalizeSettings({ weeklyGoalMins: NaN }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: -Infinity }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: Infinity }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: -0 }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: 0 }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );
      expect(normalizeSettings({ weeklyGoalMins: -1e10 }).weeklyGoalMins).toBe(
        DEFAULT_SETTINGS.weeklyGoalMins
      );

      // Valid huge positive finite numbers are accepted
      expect(normalizeSettings({ weeklyGoalMins: 1e30 }).weeklyGoalMins).toBe(1e30);
      expect(
        normalizeSettings({ weeklyGoalMins: Number.MAX_SAFE_INTEGER }).weeklyGoalMins
      ).toBe(Number.MAX_SAFE_INTEGER);
      expect(
        normalizeSettings({ weeklyGoalMins: Number.MAX_VALUE }).weeklyGoalMins
      ).toBe(Number.MAX_VALUE);
    });

    it("handles negative days, out-of-range days, and non-finite days for weeklyGoalDays", () => {
      expect(normalizeSettings({ weeklyGoalDays: -100 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: -1 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: -0 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 0 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 8 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 1e30 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: Number.MAX_VALUE }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: NaN }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: -Infinity }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: Infinity }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
    });

    it("handles floating point days between 1 and 7 with Math.round", () => {
      expect(normalizeSettings({ weeklyGoalDays: 1.0 }).weeklyGoalDays).toBe(1);
      expect(normalizeSettings({ weeklyGoalDays: 1.4 }).weeklyGoalDays).toBe(1);
      expect(normalizeSettings({ weeklyGoalDays: 1.5 }).weeklyGoalDays).toBe(2);
      expect(normalizeSettings({ weeklyGoalDays: 6.6 }).weeklyGoalDays).toBe(7);
      expect(normalizeSettings({ weeklyGoalDays: 7.0 }).weeklyGoalDays).toBe(7);

      // Boundaries outside [1, 7] must fall back to default
      expect(normalizeSettings({ weeklyGoalDays: 0.9 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
      expect(normalizeSettings({ weeklyGoalDays: 7.1 }).weeklyGoalDays).toBe(
        DEFAULT_SETTINGS.weeklyGoalDays
      );
    });

    it("handles non-string, empty, and whitespace sounds and themes", () => {
      const nonStringValues = [
        null,
        undefined,
        123,
        0,
        false,
        true,
        [],
        {},
        Symbol("sound"),
        () => "bell",
        "",
        "   ",
        "\t\n  \r",
      ];

      for (const val of nonStringValues) {
        const normalized = normalizeSettings({
          soundPreset: val,
          theme: val,
        });
        expect(normalized.soundPreset).toBe(DEFAULT_SETTINGS.soundPreset);
        expect(normalized.theme).toBe(DEFAULT_SETTINGS.theme);
      }
    });

    it("resists prototype pollution payloads via __proto__ and constructor", () => {
      const maliciousPayload = JSON.parse(
        '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}}'
      );

      const normalized = normalizeSettings(maliciousPayload);

      expect(normalized.polluted).toBeUndefined();
      expect(({}).polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();

      // Ensure keys returned are strictly the 8 standard settings keys
      const returnedKeys = Object.keys(normalized).sort();
      const expectedKeys = Object.keys(DEFAULT_SETTINGS).sort();
      expect(returnedKeys).toEqual(expectedKeys);
    });

    it("handles malformed custom fallback objects safely", () => {
      expect(normalizeSettings({}, null)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings({}, undefined)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings({}, "not-an-object")).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings({}, [1, 2, 3])).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings({}, () => {})).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("2. loadSettings and saveSettings Adversarial Stress", () => {
    it("loadSettings recovers from all kinds of corrupted JSON in AsyncStorage", async () => {
      const badStorageValues = [
        "null",
        "undefined",
        "true",
        "false",
        "12345",
        "\"a plain string\"",
        "[]",
        "[1, 2, 3]",
        "{ malformed json",
        "{\"soundPreset\": null, \"weeklyGoalDays\": -99}",
        "{\"__proto__\": {\"polluted\": true}}",
      ];

      for (const val of badStorageValues) {
        await AsyncStorage.setItem("@study_timer/settings", val);
        const settings = await loadSettings();
        expect(settings).toEqual(DEFAULT_SETTINGS);
        expect(({}).polluted).toBeUndefined();
      }
    });

    it("saveSettings survives non-object inputs and preserves current settings", async () => {
      // Establish initial state
      await saveSettings({ theme: "dracula", weeklyGoalMins: 350 });

      expect(await saveSettings(null)).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings(undefined)).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings([1, 2, 3])).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings("just a string")).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings(42)).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings(() => {})).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
      expect(await saveSettings(Symbol("foo"))).toEqual(
        expect.objectContaining({ theme: "dracula", weeklyGoalMins: 350 })
      );
    });

    it("saveSettings safely serializes circular objects without throwing", async () => {
      const circular = { soundPreset: "chime" };
      circular.self = circular;

      // saveSettings must not throw "Converting circular structure to JSON"
      const result = await saveSettings(circular);
      expect(result.soundPreset).toBe("chime");
      expect(result.self).toBeUndefined();

      // Check persisted state in AsyncStorage
      const raw = await AsyncStorage.getItem("@study_timer/settings");
      expect(() => JSON.parse(raw)).not.toThrow();
      const parsed = JSON.parse(raw);
      expect(parsed.soundPreset).toBe("chime");
      expect(parsed.self).toBeUndefined();
    });

    it("saveSettings prevents prototype pollution", async () => {
      const payload = JSON.parse(
        '{"__proto__": {"isAdmin": true}, "constructor": {"prototype": {"isAdmin": true}}}'
      );

      await saveSettings(payload);

      expect(({}).isAdmin).toBeUndefined();
      expect(Object.prototype.isAdmin).toBeUndefined();

      const loaded = await loadSettings();
      expect(loaded.isAdmin).toBeUndefined();
    });
  });

  describe("3. updateSession Adversarial Stress", () => {
    let session;

    beforeEach(async () => {
      session = await saveSession({
        sessionType: "1hr",
        label: "Deep Work",
        subject: "Computer Science",
        startedAt: "2026-03-01T08:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 50,
        actualStudyMins: 45,
        completed: false,
      });
    });

    it("strictly discards forbidden keys (id, startedAt, completedAt, totalStudyMins, sessionType, __proto__)", async () => {
      await updateSession(session.id, {
        id: "evil-hacked-id",
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: "1970-01-01T01:00:00.000Z",
        totalStudyMins: 999999,
        sessionType: "evilType",
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
        injectedKey: "DROP TABLE users;",
      });

      const [stored] = await loadSessions();
      expect(stored.id).toBe(session.id);
      expect(stored.startedAt).toBe("2026-03-01T08:00:00.000Z");
      expect(stored.completedAt).toBe(session.completedAt);
      expect(stored.totalStudyMins).toBe(50);
      expect(stored.sessionType).toBe("1hr");
      expect(stored.injectedKey).toBeUndefined();
      expect(stored.isAdmin).toBeUndefined();
      expect(({}).isAdmin).toBeUndefined();
    });

    it("enforces MAX_NAME_LENGTH (64 chars) and trims subject and label", async () => {
      const oversized1000 = "Z".repeat(1000);

      await updateSession(session.id, {
        subject: `   ${oversized1000}   `,
        label: `   ${oversized1000}   `,
      });

      const [stored] = await loadSessions();
      expect(stored.subject).toBe("Z".repeat(MAX_NAME_LENGTH));
      expect(stored.subject.length).toBe(MAX_NAME_LENGTH);
      expect(stored.label).toBe("Z".repeat(MAX_NAME_LENGTH));
      expect(stored.label.length).toBe(MAX_NAME_LENGTH);
    });

    it("ignores non-string subjects and preserves previous subject", async () => {
      const maliciousSubjects = [
        null,
        undefined,
        12345,
        true,
        false,
        [],
        ["Math"],
        { name: "Hacked" },
        Symbol("Hacked"),
        () => "Hacked",
      ];

      for (const subj of maliciousSubjects) {
        await updateSession(session.id, { subject: subj });
        const [stored] = await loadSessions();
        expect(stored.subject).toBe("Computer Science");
      }
    });

    it("resets to 'Unspecified' when subject is empty or whitespace only", async () => {
      await updateSession(session.id, { subject: "" });
      let [stored] = await loadSessions();
      expect(stored.subject).toBe("Unspecified");

      await updateSession(session.id, { subject: "     " });
      [stored] = await loadSessions();
      expect(stored.subject).toBe("Unspecified");
    });

    it("rejects negative study mins, NaN, and non-finite numbers", async () => {
      const invalidStudyMins = [
        -1,
        -0.001,
        -100,
        -Infinity,
        Infinity,
        NaN,
        "45",
        null,
        undefined,
        {},
        [],
      ];

      for (const mins of invalidStudyMins) {
        await updateSession(session.id, { actualStudyMins: mins });
        const [stored] = await loadSessions();
        expect(stored.actualStudyMins).toBe(45); // Unchanged from original 45
      }

      // Valid boundary values are accepted
      await updateSession(session.id, { actualStudyMins: 0 });
      let [stored] = await loadSessions();
      expect(stored.actualStudyMins).toBe(0);

      await updateSession(session.id, { actualStudyMins: 22.5 });
      [stored] = await loadSessions();
      expect(stored.actualStudyMins).toBe(22.5);
    });

    it("rejects negative, non-finite, and non-numeric phasesCompleted", async () => {
      const invalidPhases = [-1, -Infinity, Infinity, NaN, "3", null, undefined, {}];

      for (const p of invalidPhases) {
        await updateSession(session.id, { phasesCompleted: p });
        const [stored] = await loadSessions();
        expect(stored.phasesCompleted).toBe(2); // Unchanged
      }

      // Valid 0 and decimal floored
      await updateSession(session.id, { phasesCompleted: 0 });
      let [stored] = await loadSessions();
      expect(stored.phasesCompleted).toBe(0);

      await updateSession(session.id, { phasesCompleted: 3.99 });
      [stored] = await loadSessions();
      expect(stored.phasesCompleted).toBe(3);
    });

    it("safely handles circular objects passed as updates", async () => {
      const circular = { actualStudyMins: 30 };
      circular.loop = circular;

      await expect(updateSession(session.id, circular)).resolves.not.toThrow();

      const [stored] = await loadSessions();
      expect(stored.actualStudyMins).toBe(30);
      expect(stored.loop).toBeUndefined();
    });

    it("safely ignores non-object updates parameters", async () => {
      await updateSession(session.id, null);
      await updateSession(session.id, undefined);
      await updateSession(session.id, "string");
      await updateSession(session.id, 999);
      await updateSession(session.id, [1, 2, 3]);

      const [stored] = await loadSessions();
      expect(stored.subject).toBe("Computer Science");
      expect(stored.actualStudyMins).toBe(45);
    });
  });

  describe("4. duplicateTemplate Adversarial Stress", () => {
    it("clamps label to MAX_NAME_LENGTH (64 chars) even on long labels and repeated duplication", async () => {
      const maxLabel = "K".repeat(MAX_NAME_LENGTH);
      const original = await saveTemplate({
        label: maxLabel,
        phases: [{ name: "Focus", duration: 25 }],
      });

      // First duplicate
      const copy1 = await duplicateTemplate(original.id);
      expect(copy1.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(copy1.label.length).toBe(MAX_NAME_LENGTH);
      expect(copy1.label).toBe(`${maxLabel} Copy`.slice(0, MAX_NAME_LENGTH));

      // Repeated duplicates
      let current = copy1;
      for (let i = 0; i < 5; i++) {
        current = await duplicateTemplate(current.id);
        expect(current.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(current.label.length).toBe(MAX_NAME_LENGTH);
      }

      const all = await loadTemplates();
      expect(all.length).toBe(7); // original + 6 duplicates
      for (const t of all) {
        expect(t.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      }
    });

    it("handles empty or whitespace template labels cleanly", async () => {
      // Inject raw template with empty label directly to simulate edge-case data
      const rawTemplate = {
        id: "raw-empty-label",
        label: "",
        phases: [{ name: "Work", duration: 20 }],
        favorite: false,
      };
      await AsyncStorage.setItem(
        "@study_timer/templates",
        JSON.stringify([rawTemplate])
      );

      const copy = await duplicateTemplate(rawTemplate.id);
      expect(copy.label).toBe(" Copy");
      expect(copy.label.length).toBe(5);

      const templates = await loadTemplates();
      expect(templates.find((t) => t.id === copy.id)).toBeDefined();
    });

    it("handles special characters, unicode, emojis, RTL, and injection payloads", async () => {
      const specialLabels = [
        "🍅 Pomodoro 🔥 Turbo 🚀 Session ⏱️",
        "\u200F\u0627\u0644\u0639\u0631\u0628\u064A\u0629 Hebrew: \u05E2\u05D1\u05E8\u05D9\u05EA",
        "Line1\nLine2\r\nLine3\tTabbed",
        "Null\0ByteInString",
        "Quotes: \"double\" 'single' `backtick` \\backslash",
        "<script>alert(\"XSS\")</script>",
        "Robert'); DROP TABLE Templates;--",
      ];

      for (const label of specialLabels) {
        const template = await saveTemplate({
          label,
          phases: [{ name: "Focus", duration: 25 }],
        });

        const copy = await duplicateTemplate(template.id);
        expect(copy.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        expect(copy.label).toBe(`${template.label} Copy`.slice(0, MAX_NAME_LENGTH));

        // Ensure template successfully persisted and reloaded
        const loaded = await loadTemplates();
        const found = loaded.find((t) => t.id === copy.id);
        expect(found).toBeDefined();
        expect(found.label).toBe(copy.label);
      }
    });

    it("throws when duplicating non-existent template ID", async () => {
      await expect(duplicateTemplate("non-existent-id")).rejects.toThrow(
        "Template not found"
      );
    });
  });
});
