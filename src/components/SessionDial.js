import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import {
  computeDialSegments,
  computeProgress,
  headPoint,
} from "../utils/dialGeometry";

/**
 * Session Dial — the app's signature timer.
 *
 * One ring encodes the whole session: every phase is an arc sized by its
 * minutes and colored by its identity color (breaks in slate). Completed arcs
 * are solid, the active phase glows, upcoming phases dim, and a white head
 * marks how far the session has swept. Center content is passed as children.
 *
 * @param {{
 *   phases: Array<{ duration: number, isBreak?: boolean }>,
 *   phaseIndex: number,
 *   secondsLeft: number,
 *   getPhaseColor: (index: number) => string,
 *   activeColor: string,
 *   glowColor: string,
 *   trackColor: string,
 *   size?: number,
 *   strokeWidth?: number,
 *   children?: React.ReactNode,
 * }} props
 */
export default function SessionDial({
  phases,
  phaseIndex,
  secondsLeft,
  getPhaseColor,
  activeColor,
  glowColor,
  trackColor,
  size = 260,
  strokeWidth = 16,
  children,
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - strokeWidth) / 2 - 2;

  const segments = useMemo(
    () => computeDialSegments({ phases, radius, gapDeg: 3.5 }),
    [phases, radius]
  );

  const { fraction } = computeProgress({ phases, phaseIndex, secondsLeft });
  const head = headPoint({ fraction, cx, cy, radius });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Faint full-circle track under everything */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Glow underlay for the active phase (fakes a soft bloom without a filter) */}
        {segments.map((s, i) =>
          i === phaseIndex ? (
            <Circle
              key={`glow-${i}`}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={glowColor}
              strokeWidth={strokeWidth + 10}
              strokeLinecap="round"
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
              opacity={0.18}
              fill="none"
            />
          ) : null
        )}

        {/* Phase segments: done = solid, active = full, upcoming = dim */}
        {segments.map((s, i) => {
          const opacity = i < phaseIndex ? 0.9 : i === phaseIndex ? 1 : 0.24;
          return (
            <Circle
              key={`seg-${i}`}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={getPhaseColor(i)}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
              opacity={opacity}
              fill="none"
            />
          );
        })}

        {/* Progress head */}
        <G>
          <Circle cx={head.x} cy={head.y} r={strokeWidth / 2 + 3} fill="#ffffff" />
          <Circle cx={head.x} cy={head.y} r={strokeWidth / 2 - 1} fill={activeColor} />
        </G>
      </Svg>

      <View style={styles.center}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
});
