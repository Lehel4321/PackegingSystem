import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCAN_TIME, SLOT } from '../PackagingEngine';
import { computeMove } from '../MotionProfile';
import { pinRandom, runningEngine, scan, scanUntil } from './helpers';

beforeEach(() => { pinRandom(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('process dwell timing', () => {
  it('first cycle dwells for the erector only, then indexes', () => {
    const db = runningEngine();
    scan(db, 1);
    expect(db.state.phase).toBe('process');
    expect(db.cartons).toHaveLength(1);
    expect(db.state.procDwell).toBeCloseTo(db.params.erectT, 9); // 0.4 s

    const scans = 1 + scanUntil(db, () => db.state.phase === 'index');
    expect(scans * SCAN_TIME).toBeCloseTo(db.params.erectT, 2);
  });

  it('dwell = longest station action of the cycle (fill raster dominates)', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.phase === 'index');
    scanUntil(db, () => db.state.phase === 'process');
    scan(db, 1); // cycle start: carton at FILL + newly erected one
    expect(db.cartons.map(c => c.slot).sort()).toEqual([0, 1]);
    expect(db.state.procDwell).toBeCloseTo(db.recipe.fillCount * db.params.fillT, 9); // 1.5 s
  });

  it('dwell follows tuning changes (seal head slower than the filler)', () => {
    const db = runningEngine(d => d.updateParams({ sealT: 2.2 }));
    // Advance until a carton sits at the SEAL slot at cycle start.
    scanUntil(db, () => db.state.phase === 'process' && db.state.procDwell > 0 &&
      db.cartons.some(c => c.slot === SLOT.SEAL));
    expect(db.state.procDwell).toBeCloseTo(2.2, 9);
  });

  it('filler drops one product every fillT along the dwell', () => {
    const db = runningEngine();
    scanUntil(db, () => db.cartons.some(c => c.slot === SLOT.FILL));
    const c = db.cartons.find(k => k.slot === SLOT.FILL)!;
    expect(c.fills).toHaveLength(0);

    for (let k = 1; k <= db.recipe.fillCount; k++) {
      scanUntil(db, () => c.fills.length === k);
      expect(db.state.procElapsed).toBeCloseTo(k * db.params.fillT, 2);
    }
    expect(c.fills.every(f => !f.bad)).toBe(true);
  });

  it('seal closes at the END of its dwell, label after labelT', () => {
    const db = runningEngine();
    scanUntil(db, () => db.cartons.some(c => c.slot === SLOT.SEAL));
    const c = db.cartons.find(k => k.slot === SLOT.SEAL)!;
    expect(c.sealed).toBe(false);
    scanUntil(db, () => c.sealed);
    expect(db.state.procElapsed).toBeCloseTo(db.params.sealT, 2);

    scanUntil(db, () => c.slot === SLOT.LABEL && c.labeled);
    expect(db.state.procElapsed).toBeCloseTo(db.params.labelT, 2);
    expect(c.labelA).toBe(db.recipe.labelAt);
    expect(c.labelB).toBe(db.recipe.labelAt + db.config.labelLen);
  });
});

describe('index move', () => {
  it('moves exactly one pitch along a bounded S-curve', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.phase === 'index');

    let vMax = 0, aMax = 0, vMin = Infinity;
    const n = scanUntil(db, () => {
      vMax = Math.max(vMax, db.state.v);
      vMin = Math.min(vMin, db.state.v);
      aMax = Math.max(aMax, Math.abs(db.state.a));
      return db.state.phase === 'process';
    });

    expect(Math.abs(db.state.D - db.config.pitch)).toBeLessThan(0.1);
    expect(db.state.v).toBe(0);
    expect(db.cartons[0].slot).toBe(1);
    expect(Math.abs(db.cartons[0].x - db.config.pitch)).toBeLessThan(0.1);
    expect(vMin).toBeGreaterThanOrEqual(0);
    // The 1 ms discrete jerk controller settles onto the setpoint with a
    // ~1 % overshoot (one scan of acceleration) — allow that, no more.
    expect(vMax).toBeLessThanOrEqual(db.cruiseSpeed() * 1.015);
    expect(vMax).toBeGreaterThan(db.regApproachV()); // reached production speed
    expect(aMax).toBeLessThanOrEqual(db.config.axAmax + 1e-9);

    // Never faster than the ideal unrestricted S-curve; the registration
    // slow-down to the approach speed costs only a little extra.
    const ideal = computeMove(db.config.pitch, db.cruiseSpeed(), db.config.axAmax, db.config.axJerk)!;
    const t = n * SCAN_TIME;
    expect(t).toBeGreaterThanOrEqual(ideal.tp.t7 - 0.01);
    expect(t).toBeLessThan(ideal.tp.t7 + 0.3);
  });

  it.each([
    { spd: 100, hasReg: true },
    { spd: 400, hasReg: true },
    { spd: 800, hasReg: true },
    { spd: 1500, hasReg: true },
    { spd: 3000, hasReg: true }, // capped at axVmax
    { spd: 800, hasReg: false },
    { spd: 2000, hasReg: false },
    { spd: 1200, hasReg: false }, // regression: overshot 12.5 mm before the commitStopDist fix
  ])('lands on the slot center at spd=$spd mm/s (reg=$hasReg)', ({ spd, hasReg }) => {
    const db = runningEngine(d => {
      d.updateRecipe({ spd });
      d.updateConfig({ hasReg });
    });
    for (let k = 1; k <= 3; k++) {
      scanUntil(db, () => db.state.phase === 'index');
      scanUntil(db, () => db.state.phase === 'process');
      expect(Math.abs(db.state.D - k * db.config.pitch)).toBeLessThan(0.2);
      for (const c of db.cartons) {
        expect(Math.abs(c.x - c.slot * db.config.pitch)).toBeLessThan(0.5);
      }
    }
    expect(db.state.regFault).toBe(false);
  });

  it('steady-state cycle time roughly matches the cycle estimate', () => {
    const db = runningEngine();
    // Line full: slots 0-4 occupied during the index (slot 5 is
    // discharged at cycle start) -> dwell = longest station.
    scanUntil(db, () => db.cartons.length === 5 && db.state.phase === 'index');
    const t0 = db.state.simTime;
    scanUntil(db, () => db.state.phase === 'process');
    scanUntil(db, () => db.state.phase === 'index');
    const measured = db.state.simTime - t0;
    expect(measured).toBeGreaterThanOrEqual(db.cycle - 0.01);
    expect(measured).toBeLessThan(db.cycle + 0.3);
  });
});

describe('registration vs chain slip', () => {
  it('with the eye, 5 % slip is corrected every index (no misplaced cartons)', () => {
    const db = runningEngine(d => d.updateParams({ slipPct: 5 }));
    scanUntil(db, () => db.state.count >= 8);
    expect(db.log.filter(e => e.reject)).toEqual([]);
    expect(Math.abs(db.drift)).toBeLessThan(1);
    expect(db.state.regFault).toBe(false);
    expect(db.state.tip).toBeLessThan(db.state.D); // encoder ran ahead of the chain
  });

  it('without the eye, the same slip drifts cartons off their slots -> misplaced', () => {
    const db = runningEngine(d => {
      d.updateConfig({ hasReg: false });
      d.updateParams({ slipPct: 5 });
    });
    scanUntil(db, () => db.state.count >= 4);
    expect(db.drift).toBeLessThan(-db.config.alignTol);
    expect(db.log.some(e => e.reject && e.reason === 'misplaced')).toBe(true);
  });

  it('switching the eye back on re-aligns an already drifted chain', () => {
    const db = runningEngine(d => {
      d.updateConfig({ hasReg: false });
      d.updateParams({ slipPct: 5 });
    });
    // Hard stop at a cycle boundary once the chain is a few mm behind
    // (within the eye's regOver budget — beyond it a reg fault is the
    // designed reaction).
    scanUntil(db, () => db.state.phase === 'process' && db.drift < -6);
    db.setRun(false);
    db.setControlOff();
    db.updateConfig({ hasReg: true });
    db.setControlOn();
    expect(db.drift).toBeLessThan(-6); // hard stop is resumable, line kept

    db.setRun(true);
    scanUntil(db, () => db.state.phase === 'index');
    scanUntil(db, () => db.state.phase === 'process');
    expect(db.state.regFault).toBe(false);
    expect(Math.abs(db.drift)).toBeLessThan(1);
    for (const c of db.cartons) expect(Math.abs(c.x - c.slot * db.config.pitch)).toBeLessThan(1);

    const before = db.state.count;
    scanUntil(db, () => db.state.count >= before + 10);
    expect(db.log.slice(-5).every(e => !e.reject)).toBe(true);
  });
});

// Regressions for position errors that only show after hundreds of
// indexes (each index is targeted relative to where the last one ended).
describe('long-run position stability', () => {
  it('no eye, no slip: 250 cartons without drift or misplaced rejects', () => {
    const db = runningEngine(d => d.updateConfig({ hasReg: false }));
    scanUntil(db, () => db.state.count >= 250, 2_000_000);
    expect(Math.abs(db.drift)).toBeLessThan(0.01);
    expect(db.state.rejects).toBe(0);
  });

  it.each([
    { spd: 800, slipPct: 5 },
    { spd: 2000, slipPct: 10 },
  ])('eye at $slipPct % slip, $spd mm/s: drift stays bounded over 250 cartons', ({ spd, slipPct }) => {
    vi.restoreAllMocks(); // real per-move slip variance
    const db = runningEngine(d => {
      d.updateRecipe({ spd });
      d.updateParams({ slipPct });
    });
    let worst = 0;
    scanUntil(db, () => {
      if (db.state.phase === 'process') {
        for (const c of db.cartons) worst = Math.max(worst, Math.abs(c.x - c.slot * db.config.pitch));
      }
      return db.state.count >= 250;
    }, 2_000_000);
    expect(worst).toBeLessThan(db.config.alignTol / 4);
    expect(db.state.rejects).toBe(0);
  });

  it("eye never trips, 'stop' mode: halts with a fault, Start locked until acknowledged", () => {
    const db = runningEngine(d => {
      d.updateRecipe({ regFaultMode: 'stop' });
      // Extreme slip (beyond the HMI clamp) so the lug never reaches
      // the eye within pitch + regOver of encoder travel.
      d.params.slipPct = 60;
    });
    scanUntil(db, () => !db.state.running);
    expect(db.state.regFault).toBe(true);
    expect(db.state.phase).toBe('index');
    expect(db.state.mvD).toBeGreaterThanOrEqual(db.config.pitch + db.config.regOver);
    expect(db.state.needsReset).toBe(false);

    db.setRun(true);
    expect(db.state.running).toBe(false); // interlock
    db.clearRegFault();
    db.setRun(true);
    expect(db.state.running).toBe(true);
  });

  it("eye never trips, 'warn' mode: flags the fault and keeps packing", () => {
    const db = runningEngine(d => { d.params.slipPct = 60; });
    scanUntil(db, () => db.state.regFault);
    expect(db.state.running).toBe(true);
    scanUntil(db, () => db.state.phase === 'process');
    expect(db.cartons[0].slot).toBe(1);
    expect(db.state.mvD).toBeCloseTo(db.config.pitch + db.config.regOver, 0);
  });
});
