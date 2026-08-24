import { THEMES, THEME_OPTIONS, getTheme } from "../themes";

describe("theme palettes", () => {
  const names = Object.keys(THEMES);

  it("exposes the eight expected themes", () => {
    expect(names.sort()).toEqual([
      "dark",
      "espresso",
      "forest",
      "light",
      "ocean",
      "oled",
      "sakura",
      "synthwave",
    ]);
  });

  it("gives every palette an identical set of keys", () => {
    // A screen referencing t.<role> for a role missing from one theme would
    // silently render `undefined` and break that style only in that theme, so
    // guard the key set here rather than discovering it on-device.
    const reference = Object.keys(THEMES.dark).sort();
    for (const name of names) {
      expect(Object.keys(THEMES[name]).sort()).toEqual(reference);
    }
  });

  it("marks dark palettes as dark, light as not", () => {
    expect(THEMES.dark.isDark).toBe(true);
    expect(THEMES.oled.isDark).toBe(true);
    expect(THEMES.forest.isDark).toBe(true);
    expect(THEMES.espresso.isDark).toBe(true);
    expect(THEMES.synthwave.isDark).toBe(true);
    expect(THEMES.ocean.isDark).toBe(true);
    expect(THEMES.sakura.isDark).toBe(true);
    expect(THEMES.light.isDark).toBe(false);
  });

  it("gives each palette a name matching its key", () => {
    for (const name of names) {
      expect(THEMES[name].name).toBe(name);
    }
  });

  it("has no undefined or empty color values", () => {
    for (const name of names) {
      for (const [role, value] of Object.entries(THEMES[name])) {
        if (role === "isDark") continue;
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getTheme", () => {
  it("resolves a known name to its palette", () => {
    expect(getTheme("light")).toBe(THEMES.light);
    expect(getTheme("oled")).toBe(THEMES.oled);
  });

  it("falls back to dark for unknown or missing names", () => {
    expect(getTheme("sepia")).toBe(THEMES.dark);
    expect(getTheme(undefined)).toBe(THEMES.dark);
  });
});

describe("THEME_OPTIONS", () => {
  it("lists one option per theme, each with a label and emoji", () => {
    expect(THEME_OPTIONS).toHaveLength(Object.keys(THEMES).length);
    for (const opt of THEME_OPTIONS) {
      expect(THEMES[opt.key]).toBeDefined();
      expect(typeof opt.name).toBe("string");
      expect(typeof opt.emoji).toBe("string");
    }
  });
});
