/**
 * Pure geometry for the Session Dial — the app's signature timer.
 *
 * Kept free of React/SVG imports so the rendering component and the unit tests
 * share one definition of how a session's phases map onto arc segments and how
 * far the progress head has swept. All angles are SVG-standard: 0° points right
 * (3 o'clock) and sweeps clockwise, so the dial starts at the top (−90°).
 */

/**
 * One stroke-dash arc per phase, sized by its share of the whole session.
 *
 * Each segment is expressed the way `react-native-svg`'s <Circle> consumes it:
 * a `[drawn, gap]` dash array over the full circumference plus a dash offset
 * that rotates the drawn part to the phase's start angle. A small `gapDeg`
 * wedge is trimmed from both ends so neighbouring phases read as distinct.
 *
 * @param {{ phases: Array<{ duration: number }>, radius: number, gapDeg?: number }} opts
 * @returns {Array<{ dashArray: [number, number], dashOffset: number, circumference: number, fraction: number }>}
 */
export function computeDialSegments({ phases, radius, gapDeg = 3 }) {
  const circumference = 2 * Math.PI * radius;
  const total = (phases || []).reduce((a, p) => a + p.duration, 0) || 1;

  let angle = -90; // start at the top
  return (phases || []).map((p) => {
    const sweep = (p.duration / total) * 360;
    const startDeg = angle + gapDeg / 2;
    const endDeg = angle + sweep - gapDeg / 2;
    const drawn = Math.max(((endDeg - startDeg) / 360) * circumference, 0);
    const dashOffset = -(startDeg / 360) * circumference;
    angle += sweep;
    return {
      dashArray: [drawn, circumference - drawn],
      dashOffset,
      circumference,
      fraction: p.duration / total,
    };
  });
}

/**
 * How far through the whole session (breaks included) we are right now.
 *
 * @param {{ phases: Array<{ duration: number }>, phaseIndex: number, secondsLeft: number }} opts
 * @returns {{ fraction: number, elapsedSecs: number, totalSecs: number }}
 */
export function computeProgress({ phases, phaseIndex, secondsLeft }) {
  const totalSecs = (phases || []).reduce((a, p) => a + p.duration * 60, 0) || 1;
  const before = (phases || [])
    .slice(0, phaseIndex)
    .reduce((a, p) => a + p.duration * 60, 0);
  const current = phases && phases[phaseIndex]
    ? phases[phaseIndex].duration * 60 - secondsLeft
    : 0;
  const elapsed = Math.min(Math.max(before + current, 0), totalSecs);
  return { fraction: elapsed / totalSecs, elapsedSecs: elapsed, totalSecs };
}

/**
 * Cartesian position of the progress head on the ring for a given fraction.
 *
 * @param {{ fraction: number, cx: number, cy: number, radius: number }} opts
 * @returns {{ x: number, y: number }}
 */
export function headPoint({ fraction, cx, cy, radius }) {
  const deg = -90 + fraction * 360;
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}
