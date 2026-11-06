import fs from "fs";
import path from "path";
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
  deleteSession,
  saveTemplate,
  loadTemplates,
  duplicateTemplate,
} from "../storage";

describe("Milestone 1 Empirical Challenge & Stress Harness", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  // =========================================================================
  // 1. CONCURRENCY: saveSettings & loadSettings
  // =========================================================================
  describe("Concurrency: saveSettings and loadSettings", () => {
    it("preserves all disjoint updates under 40 simultaneous concurrent saveSettings calls", async () => {
      // Baseline settings
      await saveSettings({
        soundPreset: "classic",
        theme: "dark",
        vibrate: true,
        keepAwake: true,
        autoAdvance: true,
        weeklyGoalEnabled: true,
        weeklyGoalMins: 600,
        weeklyGoalDays: 5,
      });

      // Launch concurrent saves targeting distinct fields repeatedly
      const promises = [];
      promises.push(saveSettings({ theme: "light" }));
      promises.push(saveSettings({ soundPreset: "marimba" }));
      promises.push(saveSettings({ vibrate: false }));
      promises.push(saveSettings({ keepAwake: false }));
      promises.push(saveSettings({ autoAdvance: false }));
      promises.push(saveSettings({ weeklyGoalEnabled: false }));
      promises.push(saveSettings({ weeklyGoalMins: 480 }));
      promises.push(saveSettings({ weeklyGoalDays: 4 }));

      // Add redundant interleaved calls in flight
      for (let i = 0; i < 32; i++) {
        if (i % 4 === 0) promises.push(saveSettings({ theme: "nord" }));
        if (i % 4 === 1) promises.push(saveSettings({ soundPreset: "bell" }));
        if (i % 4 === 2) promises.push(saveSettings({ weeklyGoalMins: 550 }));
        if (i % 4 === 3) promises.push(saveSettings({ weeklyGoalDays: 6 }));
      }

      await Promise.all(promises);

      const finalSettings = await loadSettings();

      // Invariant: All 8 fields must be present and correctly typed
      expect(typeof finalSettings.soundPreset).toBe("string");
      expect(typeof finalSettings.theme).toBe("string");
      expect(typeof finalSettings.vibrate).toBe("boolean");
      expect(typeof finalSettings.keepAwake).toBe("boolean");
      expect(typeof finalSettings.autoAdvance).toBe("boolean");
      expect(typeof finalSettings.weeklyGoalEnabled).toBe("boolean");
      expect(typeof finalSettings.weeklyGoalMins).toBe("number");
      expect(typeof finalSettings.weeklyGoalDays).toBe("number");

      // Verify booleans that were set to false were NOT clobbered by defaults
      expect(finalSettings.vibrate).toBe(false);
      expect(finalSettings.keepAwake).toBe(false);
      expect(finalSettings.autoAdvance).toBe(false);
      expect(finalSettings.weeklyGoalEnabled).toBe(false);
    });

    it("ensures loadSettings never returns corrupted data during high-throughput saveSettings loop", async () => {
      const iterations = 50;
      let loadCount = 0;

      const workers = Array.from({ length: iterations }, async (_, idx) => {
        if (idx % 2 === 0) {
          const res = await saveSettings({
            theme: `theme-${idx}`,
            weeklyGoalMins: 100 + idx,
            weeklyGoalDays: (idx % 7) + 1,
          });
          expect(res).toBeDefined();
          expect(res.weeklyGoalMins).toBe(100 + idx);
        } else {
          loadCount++;
          const snapshot = await loadSettings();
          expect(snapshot).toBeDefined();
          expect(typeof snapshot.theme).toBe("string");
          expect(snapshot.theme.length).toBeGreaterThan(0);
          expect(Number.isFinite(snapshot.weeklyGoalMins)).toBe(true);
          expect(snapshot.weeklyGoalMins).toBeGreaterThan(0);
          expect(snapshot.weeklyGoalDays).toBeGreaterThanOrEqual(1);
          expect(snapshot.weeklyGoalDays).toBeLessThanOrEqual(7);
        }
      });

      await Promise.all(workers);
      expect(loadCount).toBeGreaterThan(0);

      const finalState = await loadSettings();
      expect(finalState).toBeDefined();
      expect(Number.isInteger(finalState.weeklyGoalDays)).toBe(true);
    });

    it("survives concurrent saveSettings calls with hostile/invalid payloads", async () => {
      const hostilePayloads = [
        { theme: null, weeklyGoalMins: -999 },
        { soundPreset: 12345, weeklyGoalDays: 100 },
        { vibrate: "yes", keepAwake: 0 },
        { autoAdvance: {}, weeklyGoalEnabled: [] },
        { weeklyGoalMins: NaN, weeklyGoalDays: -5 },
        { weeklyGoalMins: Infinity, weeklyGoalDays: 0 },
        { soundPreset: "   ", theme: "" },
      ];

      const validPayload = {
        theme: "solarized",
        soundPreset: "chime",
        weeklyGoalMins: 350,
        weeklyGoalDays: 5,
        vibrate: false,
      };

      // Fire hostile payloads and valid payload simultaneously
      await Promise.all([
        ...hostilePayloads.map((bad) => saveSettings(bad)),
        saveSettings(validPayload),
      ]);

      const state = await loadSettings();
      // Valid bounds must never be violated
      expect(state.weeklyGoalMins).toBeGreaterThan(0);
      expect(Number.isFinite(state.weeklyGoalMins)).toBe(true);
      expect(state.weeklyGoalDays).toBeGreaterThanOrEqual(1);
      expect(state.weeklyGoalDays).toBeLessThanOrEqual(7);
      expect(typeof state.theme).toBe("string");
      expect(state.theme.trim().length).toBeGreaterThan(0);
      expect(typeof state.soundPreset).toBe("string");
      expect(state.soundPreset.trim().length).toBeGreaterThan(0);
      expect(typeof state.vibrate).toBe("boolean");
      expect(typeof state.keepAwake).toBe("boolean");
      expect(typeof state.autoAdvance).toBe("boolean");
      expect(typeof state.weeklyGoalEnabled).toBe("boolean");
    });
  });

  // =========================================================================
  // 2. CONCURRENCY: updateSession
  // =========================================================================
  describe("Concurrency: updateSession", () => {
    it("handles multiple concurrent updateSession calls on the SAME session without losing fields", async () => {
      const session = await saveSession({
        sessionType: "1hr",
        label: "Initial Label",
        subject: "Initial Subject",
        startedAt: "2026-03-01T08:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 60,
        actualStudyMins: 10,
        completed: false,
      });

      // Simultaneously fire 5 updates touching different whitelisted fields
      await Promise.all([
        updateSession(session.id, { subject: "Concurrent Math" }),
        updateSession(session.id, { label: "Concurrent Label" }),
        updateSession(session.id, { completed: true }),
        updateSession(session.id, { actualStudyMins: 55 }),
        updateSession(session.id, { phasesCompleted: 4 }),
      ]);

      const [updated] = await loadSessions();
      expect(updated.id).toBe(session.id);
      expect(updated.subject).toBe("Concurrent Math");
      expect(updated.label).toBe("Concurrent Label");
      expect(updated.completed).toBe(true);
      expect(updated.actualStudyMins).toBe(55);
      expect(updated.phasesCompleted).toBe(4);
      // Immutables remain intact
      expect(updated.totalStudyMins).toBe(60);
      expect(updated.startedAt).toBe("2026-03-01T08:00:00.000Z");
    });

    it("handles 50 concurrent updates across 5 different sessions without data loss", async () => {
      // Create 5 sessions
      const sessions = [];
      for (let i = 0; i < 5; i++) {
        const s = await saveSession({
          sessionType: "1hr",
          label: `Session ${i}`,
          subject: `Subject ${i}`,
          startedAt: new Date(Date.now() - i * 10000).toISOString(),
          phasesCompleted: 1,
          totalStudyMins: 25,
        });
        sessions.push(s);
      }

      // Fire 50 updates randomly targeting the 5 sessions
      const updates = Array.from({ length: 50 }, (_, idx) => {
        const target = sessions[idx % sessions.length];
        return updateSession(target.id, {
          actualStudyMins: idx * 2,
          phasesCompleted: (idx % 6) + 1,
          label: `Updated ${target.id.slice(0, 4)} #${idx}`,
        });
      });

      await Promise.all(updates);

      const loaded = await loadSessions();
      expect(loaded).toHaveLength(5);

      // Verify every session still has valid structure and was updated
      for (const s of loaded) {
        expect(s.actualStudyMins).toBeGreaterThanOrEqual(0);
        expect(s.phasesCompleted).toBeGreaterThanOrEqual(1);
        expect(s.label).toMatch(/^Updated/);
      }
    });

    it("safely handles concurrent updateSession with unwhitelisted and prototype pollution attempts", async () => {
      const session = await saveSession({
        sessionType: "2hr",
        label: "Secure Session",
        subject: "Chemistry",
        startedAt: "2026-03-01T09:00:00.000Z",
        phasesCompleted: 2,
        totalStudyMins: 100,
        actualStudyMins: 50,
      });

      await Promise.all([
        updateSession(session.id, {
          __proto__: { polluted: true },
          constructor: { polluted: true },
          id: "hacked-id",
          startedAt: "2000-01-01T00:00:00.000Z",
          totalStudyMins: 99999,
          maliciousField: "drop database",
        }),
        updateSession(session.id, {
          subject: "Clean Subject",
          actualStudyMins: 60,
        }),
      ]);

      const [current] = await loadSessions();
      expect(current.id).toBe(session.id);
      expect(current.startedAt).toBe(session.startedAt);
      expect(current.totalStudyMins).toBe(100);
      expect(current.maliciousField).toBeUndefined();
      expect(current.polluted).toBeUndefined();
      expect(current.subject).toBe("Clean Subject");
      expect(current.actualStudyMins).toBe(60);
    });

    it("serializes concurrent updateSession, saveSession, and deleteSession without race conditions", async () => {
      const s1 = await saveSession({
        sessionType: "1hr",
        label: "Session To Delete",
        subject: "History",
        startedAt: "2026-03-01T10:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });
      const s2 = await saveSession({
        sessionType: "1hr",
        label: "Session To Keep",
        subject: "Art",
        startedAt: "2026-03-01T11:00:00.000Z",
        phasesCompleted: 1,
        totalStudyMins: 25,
      });

      // Fire concurrent delete on s1, update on s2, and save of s3
      await Promise.all([
        deleteSession(s1.id),
        updateSession(s2.id, { subject: "Modern Art", actualStudyMins: 25 }),
        saveSession({
          sessionType: "1hr",
          label: "Session 3",
          subject: "Music",
          startedAt: "2026-03-01T12:00:00.000Z",
          phasesCompleted: 1,
          totalStudyMins: 25,
        }),
      ]);

      const remaining = await loadSessions();
      expect(remaining.find((s) => s.id === s1.id)).toBeUndefined();
      const updatedS2 = remaining.find((s) => s.id === s2.id);
      expect(updatedS2).toBeDefined();
      expect(updatedS2.subject).toBe("Modern Art");
      expect(updatedS2.actualStudyMins).toBe(25);
      const savedS3 = remaining.find((s) => s.subject === "Music");
      expect(savedS3).toBeDefined();
    });
  });

  // =========================================================================
  // 3. BOUNDARY TESTING: normalizeSettings & updateSession
  // =========================================================================
  describe("Boundary Testing: normalizeSettings and updateSession", () => {
    describe("normalizeSettings extreme boundaries", () => {
      it("handles Object.create(null) safely", () => {
        const nullProto = Object.create(null);
        nullProto.theme = "light";
        nullProto.weeklyGoalMins = 300;
        const normalized = normalizeSettings(nullProto);
        expect(normalized.theme).toBe("light");
        expect(normalized.weeklyGoalMins).toBe(300);
      });

      it("handles weeklyGoalMins edge cases", () => {
        // Exactly 0 -> default
        expect(normalizeSettings({ weeklyGoalMins: 0 }).weeklyGoalMins).toBe(
          DEFAULT_SETTINGS.weeklyGoalMins
        );
        // Smallest positive float -> accepted
        expect(normalizeSettings({ weeklyGoalMins: 0.00001 }).weeklyGoalMins).toBe(0.00001);
        // Number.MIN_VALUE -> accepted (> 0)
        expect(normalizeSettings({ weeklyGoalMins: Number.MIN_VALUE }).weeklyGoalMins).toBe(
          Number.MIN_VALUE
        );
        // Number.MAX_SAFE_INTEGER -> accepted
        expect(
          normalizeSettings({ weeklyGoalMins: Number.MAX_SAFE_INTEGER }).weeklyGoalMins
        ).toBe(Number.MAX_SAFE_INTEGER);
        // Negative -> default
        expect(normalizeSettings({ weeklyGoalMins: -0.00001 }).weeklyGoalMins).toBe(
          DEFAULT_SETTINGS.weeklyGoalMins
        );
        // String number -> default (strict type check)
        expect(normalizeSettings({ weeklyGoalMins: "120" }).weeklyGoalMins).toBe(
          DEFAULT_SETTINGS.weeklyGoalMins
        );
      });

      it("handles weeklyGoalDays boundary clamping and rounding", () => {
        // Below 1 -> default
        expect(normalizeSettings({ weeklyGoalDays: 0.999 }).weeklyGoalDays).toBe(
          DEFAULT_SETTINGS.weeklyGoalDays
        );
        // Exactly 1 -> 1
        expect(normalizeSettings({ weeklyGoalDays: 1 }).weeklyGoalDays).toBe(1);
        // 1.49 rounds to 1
        expect(normalizeSettings({ weeklyGoalDays: 1.49 }).weeklyGoalDays).toBe(1);
        // 1.5 rounds to 2
        expect(normalizeSettings({ weeklyGoalDays: 1.5 }).weeklyGoalDays).toBe(2);
        // Exactly 7 -> 7
        expect(normalizeSettings({ weeklyGoalDays: 7 }).weeklyGoalDays).toBe(7);
        // 7.0001 > 7 -> default
        expect(normalizeSettings({ weeklyGoalDays: 7.0001 }).weeklyGoalDays).toBe(
          DEFAULT_SETTINGS.weeklyGoalDays
        );
        // 8 -> default
        expect(normalizeSettings({ weeklyGoalDays: 8 }).weeklyGoalDays).toBe(
          DEFAULT_SETTINGS.weeklyGoalDays
        );
      });

      it("handles strings with emoji and unicode whitespace", () => {
        const emojiTheme = "  🎨 dark-vibrant 🚀  ";
        const normalized = normalizeSettings({ theme: emojiTheme });
        expect(normalized.theme).toBe("🎨 dark-vibrant 🚀");

        // String with only tabs and newlines -> fallback
        expect(normalizeSettings({ soundPreset: "\t\n  \r" }).soundPreset).toBe(
          DEFAULT_SETTINGS.soundPreset
        );
      });
    });

    describe("updateSession boundary conditions", () => {
      it("clamps subject and label at exactly MAX_NAME_LENGTH (64 characters)", async () => {
        const session = await saveSession({
          sessionType: "1hr",
          label: "Test",
          subject: "Test",
          startedAt: "2026-03-01T10:00:00.000Z",
          phasesCompleted: 1,
          totalStudyMins: 25,
        });

        // 64-char string: exactly at threshold
        const exact64 = "X".repeat(MAX_NAME_LENGTH);
        await updateSession(session.id, { subject: exact64, label: exact64 });
        let [s] = await loadSessions();
        expect(s.subject).toBe(exact64);
        expect(s.subject.length).toBe(64);
        expect(s.label).toBe(exact64);
        expect(s.label.length).toBe(64);

        // 65-char string: exceeds threshold by 1
        const over65 = "Y".repeat(MAX_NAME_LENGTH + 1);
        await updateSession(session.id, { subject: over65, label: over65 });
        [s] = await loadSessions();
        expect(s.subject).toBe("Y".repeat(MAX_NAME_LENGTH));
        expect(s.subject.length).toBe(64);
        expect(s.label).toBe("Y".repeat(MAX_NAME_LENGTH));
        expect(s.label.length).toBe(64);

        // 5000-char string: large overload
        const massive = "Z".repeat(5000);
        await updateSession(session.id, { subject: massive, label: massive });
        [s] = await loadSessions();
        expect(s.subject).toBe("Z".repeat(MAX_NAME_LENGTH));
        expect(s.subject.length).toBe(64);
        expect(s.label).toBe("Z".repeat(MAX_NAME_LENGTH));
        expect(s.label.length).toBe(64);
      });

      it("handles actualStudyMins boundary values (0, negative, float, invalid types)", async () => {
        const session = await saveSession({
          sessionType: "1hr",
          label: "Test",
          subject: "Test",
          startedAt: "2026-03-01T10:00:00.000Z",
          phasesCompleted: 1,
          totalStudyMins: 25,
          actualStudyMins: 20,
        });

        // 0 is valid (e.g. abandoned session with 0 mins studied)
        await updateSession(session.id, { actualStudyMins: 0 });
        let [s] = await loadSessions();
        expect(s.actualStudyMins).toBe(0);

        // Floats are valid
        await updateSession(session.id, { actualStudyMins: 12.75 });
        [s] = await loadSessions();
        expect(s.actualStudyMins).toBe(12.75);

        // Negative value must be rejected (retaining previous value)
        await updateSession(session.id, { actualStudyMins: -5 });
        [s] = await loadSessions();
        expect(s.actualStudyMins).toBe(12.75);

        // NaN must be rejected
        await updateSession(session.id, { actualStudyMins: NaN });
        [s] = await loadSessions();
        expect(s.actualStudyMins).toBe(12.75);

        // Infinity must be rejected
        await updateSession(session.id, { actualStudyMins: Infinity });
        [s] = await loadSessions();
        expect(s.actualStudyMins).toBe(12.75);
      });

      it("handles phasesCompleted boundary values (0, float flooring, negative, invalid types)", async () => {
        const session = await saveSession({
          sessionType: "1hr",
          label: "Test",
          subject: "Test",
          startedAt: "2026-03-01T10:00:00.000Z",
          phasesCompleted: 1,
          totalStudyMins: 25,
        });

        // 0 is valid
        await updateSession(session.id, { phasesCompleted: 0 });
        let [s] = await loadSessions();
        expect(s.phasesCompleted).toBe(0);

        // Float is floored
        await updateSession(session.id, { phasesCompleted: 3.99 });
        [s] = await loadSessions();
        expect(s.phasesCompleted).toBe(3);

        // Negative value must be rejected
        await updateSession(session.id, { phasesCompleted: -1 });
        [s] = await loadSessions();
        expect(s.phasesCompleted).toBe(3);

        // Non-number must be rejected
        await updateSession(session.id, { phasesCompleted: "5" });
        [s] = await loadSessions();
        expect(s.phasesCompleted).toBe(3);
      });

      it("safely handles non-existent session ID without crashing or corrupting store", async () => {
        const session = await saveSession({
          sessionType: "1hr",
          label: "Real Session",
          subject: "Biology",
          startedAt: "2026-03-01T10:00:00.000Z",
          phasesCompleted: 1,
          totalStudyMins: 25,
        });

        // Update with non-existent id
        await expect(
          updateSession("non-existent-id-9999", { subject: "Ghost Subject" })
        ).resolves.not.toThrow();

        const [s] = await loadSessions();
        expect(s.id).toBe(session.id);
        expect(s.subject).toBe("Biology");
      });
    });

    describe("duplicateTemplate repeated chaining", () => {
      it("repeatedly duplicating templates never exceeds MAX_NAME_LENGTH (64 chars)", async () => {
        let template = await saveTemplate({
          label: "Base Custom Session",
          phases: [{ name: "Focus", duration: 25 }],
        });

        // Chain duplicate 15 times
        for (let i = 0; i < 15; i++) {
          template = await duplicateTemplate(template.id);
          expect(template.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        }

        expect(template.label.length).toBe(MAX_NAME_LENGTH);

        // Verify stored templates all satisfy MAX_NAME_LENGTH
        const all = await loadTemplates();
        expect(all.length).toBe(16);
        for (const t of all) {
          expect(t.label.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
        }
      });
    });
  });

  // =========================================================================
  // 4. CONFIGURATION CONFORMANCE & SCHEMA TESTING
  // =========================================================================
  describe("Configuration Schema & Type Conformance", () => {
    const rootDir = path.resolve(__dirname, "../../../");

    it("app.json conforms strictly to required types and properties", () => {
      const appJsonPath = path.join(rootDir, "app.json");
      expect(fs.existsSync(appJsonPath)).toBe(true);

      const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
      expect(appJson).toBeDefined();
      expect(appJson.expo).toBeDefined();

      const expo = appJson.expo;
      expect(typeof expo.name).toBe("string");
      expect(typeof expo.slug).toBe("string");
      expect(typeof expo.version).toBe("string");

      const android = expo.android;
      expect(android).toBeDefined();

      // versionCode must be strictly number and >= 1
      expect(typeof android.versionCode).toBe("number");
      expect(Number.isInteger(android.versionCode)).toBe(true);
      expect(android.versionCode).toBe(1);

      // allowBackup must be strictly boolean false
      expect(typeof android.allowBackup).toBe("boolean");
      expect(android.allowBackup).toBe(false);

      // permissions must be an array
      expect(Array.isArray(android.permissions)).toBe(true);

      // Must include android.permission.POST_NOTIFICATIONS
      expect(android.permissions).toContain("android.permission.POST_NOTIFICATIONS");

      // Must NOT contain old/deprecated NOTIFICATIONS
      expect(android.permissions).not.toContain("NOTIFICATIONS");
    });

    it("eas.json conforms strictly to EAS schema and specifies APK for preview", () => {
      const easJsonPath = path.join(rootDir, "eas.json");
      expect(fs.existsSync(easJsonPath)).toBe(true);

      const easJson = JSON.parse(fs.readFileSync(easJsonPath, "utf-8"));
      expect(easJson).toBeDefined();
      expect(easJson.build).toBeDefined();

      // preview profile
      const preview = easJson.build.preview;
      expect(preview).toBeDefined();
      expect(preview.distribution).toBe("internal");
      expect(preview.android).toBeDefined();
      expect(typeof preview.android.buildType).toBe("string");
      expect(preview.android.buildType).toBe("apk");

      // development profile
      const development = easJson.build.development;
      expect(development).toBeDefined();
      expect(development.developmentClient).toBe(true);

      // production profile
      const production = easJson.build.production;
      expect(production).toBeDefined();
    });

    it(".gitignore excludes all specified secrets, keys, and build artifacts", () => {
      const gitignorePath = path.join(rootDir, ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, "utf-8");
      const lines = content.split(/\r?\n/).map((l) => l.trim());

      const requiredPatterns = [
        ".env*",
        "*.jks",
        "*.keystore",
        "*.p8",
        "*.p12",
        "*.key",
        "*.mobileprovision",
        "*.apk",
        "*.aab",
        "android/",
        "ios/",
        ".jest-cache/",
      ];

      for (const pattern of requiredPatterns) {
        expect(lines).toContain(pattern);
      }
    });
  });
});
