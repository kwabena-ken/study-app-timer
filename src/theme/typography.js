/**
 * App typography — the two-face system from the redesign.
 *
 * Space Grotesk carries display text and the tabular timer/number readouts (it
 * reads like a precise instrument); Inter carries body and UI labels. When a
 * custom family is applied, the weight is baked into the family name, so styles
 * set `fontFamily` from FONTS and should NOT also set `fontWeight` (Android
 * renders the wrong face otherwise).
 *
 * FONT_MAP is handed to `useFonts` in App.js; nothing renders these families
 * until that resolves, so App.js gates the first paint on it.
 */
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

export const FONT_MAP = {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

export const FONTS = {
  // display / numerals — Space Grotesk
  display: "SpaceGrotesk_600SemiBold",
  displayBold: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_500Medium",
  // body / UI — Inter
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemibold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
};
