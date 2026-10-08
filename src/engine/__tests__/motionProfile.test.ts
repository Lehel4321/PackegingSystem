import { describe, expect, it } from 'vitest';
import {
  commitRampDist, commitStopDist, computeMove, defineShape, evalAt, movePeakV,
  rampDistance, stopDistance, stopTime,
} from '../MotionProfile';

// Default index axis motor data: va = A²/J ≈ 1067 mm/s, sa = 2A³/J² ≈ 284 mm
const A = 8000;
const J = 60000;

describe('computeMove / evalAt', () => {
  it.each([
    { s: 300, vmax: 800, shape: 1 },  // default index move
    { s: 200, vmax: 2000, shape: 2 },
    { s: 250, vmax: 800, shape: 3 },
    { s: 100, vmax: 800, shape: 4 },
    { s: 1000, vmax: 2000, shape: 5 },
    { s: 500, vmax: 2000, shape: 6 },
  ])('shape $shape (s=$s, vmax=$vmax) ends at rest on the target within the limits', ({ s, vmax, shape }) => {
    const mv = computeMove(s, vmax, A, J)!;
    expect(mv).not.toBeNull();
    expect(mv.shape).toBe(shape);

    const { tp } = mv;
    const ts = [tp.t1, tp.t2, tp.t3, tp.t4, tp.t5, tp.t6, tp.t7];
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] - 1e-12);

    const [, aEnd, vEnd, pEnd] = evalAt(J, tp, tp.t7);
    expect(pEnd).toBeCloseTo(s, 6);
    expect(vEnd).toBeCloseTo(0, 6);
    expect(aEnd).toBeCloseTo(0, 6);

    // Sample the profile: never faster than vmax, never above amax, never backwards.
    let prevP = 0;
    for (let k = 0; k <= 400; k++) {
      const [, a, v, p] = evalAt(J, tp, (tp.t7 * k) / 400);
      expect(v).toBeLessThanOrEqual(vmax + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.abs(a)).toBeLessThanOrEqual(A + 1e-6);
      expect(p).toBeGreaterThanOrEqual(prevP - 1e-9);
      prevP = p;
    }
  });

  it('rejects invalid input', () => {
    expect(computeMove(0, 800, A, J)).toBeNull();
    expect(computeMove(300, 0, A, J)).toBeNull();
    expect(computeMove(300, 800, -1, J)).toBeNull();
    expect(computeMove(300, 800, A, 0)).toBeNull();
  });

  it('classifies the exact va / sa boundary instead of falling through', () => {
    const va = (A * A) / J;
    const sa = (2 * A ** 3) / (J * J);
    expect(defineShape(A, J, va, sa).sh).not.toBeNull();
  });

  it('movePeakV: full speed on a long move, less on a short one', () => {
    expect(movePeakV(300, 800, A, J)).toBeCloseTo(800, 6);
    const peak = movePeakV(200, 2000, A, J); // shape 2 never reaches vmax
    expect(peak).toBeLessThan(2000);
    expect(peak).toBeCloseTo(J * Math.cbrt(200 / (2 * J)) ** 2, 6);
  });
});

describe('braking distances', () => {
  it('stopDistance / stopTime match the S-curve formulas', () => {
    expect(stopDistance(0, A, J)).toBe(0);
    expect(stopTime(0, A, J)).toBe(0);
    // triangular decel (v·j < a²)
    expect(stopDistance(500, A, J)).toBeCloseTo(500 * Math.sqrt(500 / J), 9);
    expect(stopTime(500, A, J)).toBeCloseTo(2 * Math.sqrt(500 / J), 9);
    // trapezoidal decel
    expect(stopDistance(2000, A, J)).toBeCloseTo(1000 * (2000 / A + A / J), 9);
    expect(stopTime(2000, A, J)).toBeCloseTo(2000 / A + A / J, 9);
    expect(stopDistance(500, 0, J)).toBe(Infinity);
  });

  it('stopDistance is half of a full accel+decel round trip (solver sv)', () => {
    for (const v of [300, 800, 1500, 2000]) {
      expect(stopDistance(v, A, J)).toBeCloseTo(defineShape(A, J, v, 1).sv / 2, 9);
    }
  });

  it('rampDistance(v, 0) = stopDistance(v); commit* at a = 0 = the plain ramps', () => {
    for (const v of [300, 800, 2000]) {
      expect(rampDistance(v, 0, A, J)).toBeCloseTo(stopDistance(v, A, J), 9);
      expect(commitStopDist(v, 0, A, J)).toBeCloseTo(stopDistance(v, A, J), 9);
      expect(commitRampDist(v, 0, 200, A, J)).toBeCloseTo(rampDistance(v, 200, A, J), 9);
    }
    expect(commitRampDist(400, 0, 500, A, J)).toBe(0); // already below the target speed
  });

  // Integrate the jerk-limited stop the way FC_Indexer drives it (ramp a
  // to zero at -J, then the S-ramp to standstill) with a fine time step
  // and compare with the closed-form committed distance.
  function simulateCommittedStop(v0: number, a0: number) {
    const dt = 1e-6;
    let v = v0, a = a0, d = 0;
    while (a > 0) { a = Math.max(0, a - J * dt); v += a * dt; d += v * dt; }
    return d + stopDistance(v, A, J);
  }

  it.each([
    { v: 600, a: 8000 },
    { v: 300, a: 4000 },
    { v: 1000, a: 2000 },
  ])('commitStopDist is exact while still accelerating (v=$v, a=$a)', ({ v, a }) => {
    // Regression: the a→0 ramp was integrated as the mean of the end
    // velocities, under-estimating by a³/12J² (~12 mm at a = 8000).
    expect(commitStopDist(v, a, A, J)).toBeCloseTo(simulateCommittedStop(v, a), 2);
    const vAfter = v + (a * a) / (2 * J);
    expect(commitRampDist(v, a, 200, A, J) - rampDistance(vAfter, 200, A, J))
      .toBeCloseTo(commitStopDist(v, a, A, J) - stopDistance(vAfter, A, J), 9);
  });
});
