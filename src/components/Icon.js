import React from "react";
import Svg, { Path, Circle, Rect } from "react-native-svg";

/**
 * Single stroke/fill icon set for the redesign, replacing the emoji that used
 * to stand in for controls. All icons share a 24×24 viewbox and inherit size
 * and color from props so they can sit anywhere the old glyphs did.
 *
 * Stroke icons (home, chart, clock, gear, reset, chevrons, edit…) use `color`
 * as the stroke; solid icons (play, pause, skip, flame) use it as the fill.
 *
 * @param {{ name: string, size?: number, color?: string, strokeWidth?: number }} props
 */
export default function Icon({ name, size = 24, color = "#ffffff", strokeWidth = 2 }) {
  const stroke = {
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  };
  const svg = (children) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </Svg>
  );

  switch (name) {
    case "home":
      return svg(
        <>
          <Path d="M3 10.5 12 3l9 7.5" {...stroke} />
          <Path d="M5 9.5V21h14V9.5" {...stroke} />
        </>
      );
    case "chart":
      return svg(
        <>
          <Path d="M5 21V10" {...stroke} />
          <Path d="M12 21V4" {...stroke} />
          <Path d="M19 21v-7" {...stroke} />
        </>
      );
    case "clock":
      return svg(
        <>
          <Circle cx="12" cy="12" r="9" {...stroke} />
          <Path d="M12 8v4l3 2" {...stroke} />
        </>
      );
    case "gear":
      return svg(
        <>
          <Circle cx="12" cy="12" r="3.2" {...stroke} />
          <Path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"
            {...stroke}
          />
        </>
      );
    case "play":
      return svg(<Path d="M7 5v14l11-7-11-7Z" fill={color} />);
    case "pause":
      return svg(
        <>
          <Rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
          <Rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
        </>
      );
    case "reset":
      return svg(<Path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" {...stroke} />);
    case "skip":
      return svg(
        <>
          <Path d="M5 5l9 7-9 7V5Z" fill={color} />
          <Rect x="17.5" y="5" width="2.6" height="14" rx="1" fill={color} />
        </>
      );
    case "chevron-left":
      return svg(<Path d="M15 5l-7 7 7 7" {...stroke} />);
    case "flame":
      return svg(
        <Path
          d="M12 2c1 3-2 4-2 7a2 2 0 0 0 4 0c2 2 3 4 3 6a5 5 0 0 1-10 0c0-4 5-6 5-13Z"
          fill={color}
        />
      );
    case "plus":
      return svg(<Path d="M12 5v14M5 12h14" {...stroke} />);
    case "minus":
      return svg(<Path d="M5 12h14" {...stroke} />);
    case "trash":
      return svg(
        <>
          <Path d="M3 6h18M8 6V4h8v2" {...stroke} />
          <Path d="M6 6l1 14h10l1-14" {...stroke} />
        </>
      );
    case "edit":
      return svg(
        <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" {...stroke} />
      );
    case "check":
      return svg(<Path d="M20 6 9 17l-5-5" {...stroke} />);
    case "close":
      return svg(<Path d="M6 6l12 12M18 6 6 18" {...stroke} />);
    case "bulb":
      return svg(
        <>
          <Path d="M9 18h6M10 21h4" {...stroke} />
          <Path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3Z" {...stroke} />
        </>
      );
    default:
      return null;
  }
}
