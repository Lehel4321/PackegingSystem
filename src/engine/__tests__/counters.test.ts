import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackagingEngine } from '../PackagingEngine';
import { pinRandom, runningEngine, scanUntil } from './helpers';

beforeEach(() => { pinRandom(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Every discharged carton is either packed, rejected, or still on the belt. */
function expectCountersConsistent(db: PackagingEngine) {
  const onBelt = db.outfeed.filter(c => !c.diverting).length;
  expect(db.state.count).toBe(db.state.packed + db.state.rejects + onBelt);
}

describe('packed / reject counters', () => {
  it('first good carton reaches the good bin after 5 indexes + the outfeed', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.count === 1);
    expect(db.state.packed).toBe(0); // discharged, still on the belt
    expect(db.outfeed).toHaveLength(1);
    expect(db.order.made).toBe(1);
    expect(db.order.done).toBe(0);

    const n = scanUntil(db, () => db.state.packed === 1);
    // 900 mm of outfeed at 1.5 × 800 mm/s = 0.75 s (belt runs in both phases)
    expect(n / 1000).toBeCloseTo(db.config.outLen / db.outSpeed(), 1);
    expect(db.order.done).toBe(1);
    expectCountersConsistent(db);
  });

  it('order target: packs exactly N good cartons, then stops on its own', () => {
    const db = runningEngine(d => d.setOrderTarget(3));
    scanUntil(db, () => !db.state.running);

    expect(db.state.packed).toBe(3);
    expect(db.state.rejects).toBe(0);
    expect(db.state.count).toBe(3);
    expect(db.cartonSeq).toBe(3); // the erector never over-produced
    expect(db.order).toEqual({ target: 3, done: 3, made: 3 });
    expect(db.log).toHaveLength(3);
    for (const e of db.log) {
      expect(e.reject).toBe(false);
      expect(e.products).toBe(db.recipe.fillCount);
      expect(e.weighed).toBe(true);
      expect(e.labeled).toBe(true);
    }
    expectCountersConsistent(db);
  });

  it('a bad product is rejected by the weigher; the order is topped up', () => {
    const db = runningEngine(d => {
      d.setOrderTarget(3);
      d.injectBadProduct();
    });
    scanUntil(db, () => !db.state.running);

    expect(db.state.rejects).toBe(1);
    expect(db.state.packed).toBe(3);
    expect(db.state.count).toBe(4);
    expect(db.cartonSeq).toBe(4);
    expect(db.order.done).toBe(3);
    expect(db.log[0]).toMatchObject({ reject: true, reason: 'weight', weighed: true });
    expect(db.log[0].fillsBad[0]).toBe(true);
    expect(db.log[0].weight).toBeLessThan(db.targetWeight());
    expectCountersConsistent(db);
  });

  it('reject counter commits at the pusher, before the push-out animation ends', () => {
    const db = runningEngine(d => d.injectBadProduct());
    scanUntil(db, () => db.state.rejects === 1);
    expect(db.outfeed.some(c => c.diverting)).toBe(true);
    expect(db.state.packed).toBe(0);
    scanUntil(db, () => !db.outfeed.some(c => c.diverting));
    expect(db.state.rejects).toBe(1);
  });

  it('a line without a weigher packs the bad product into the good bin', () => {
    const db = runningEngine(d => {
      d.updateConfig({ hasWeigher: false });
      d.setOrderTarget(2);
      d.injectBadProduct();
    });
    scanUntil(db, () => !db.state.running);
    expect(db.state.packed).toBe(2);
    expect(db.state.rejects).toBe(0);
    expect(db.log[0]).toMatchObject({ reject: false, weighed: false });
    expect(db.log[0].fillsBad[0]).toBe(true); // the log still shows the truth
  });

  it('a line without a labeler ships unlabeled cartons as good', () => {
    const db = runningEngine(d => {
      d.updateConfig({ hasLabeler: false });
      d.setOrderTarget(1);
    });
    scanUntil(db, () => !db.state.running);
    expect(db.state.packed).toBe(1);
    expect(db.log[0]).toMatchObject({ reject: false, labeled: false });
  });
});

describe('hopper supply', () => {
  it("'runout' mode: packs only cartons the rest can fill completely, then idles", () => {
    const db = runningEngine(d => d.endSupply());
    const supply = db.hopperRemaining; // hopperLowAt + 2 cartons = 36
    scanUntil(db, () => !db.state.running);

    expect(db.state.supplyLow).toBe(true);
    expect(db.state.rejects).toBe(0);
    expect(db.state.packed).toBe(Math.floor(supply / db.recipe.fillCount));
    expect(db.log.every(e => e.products === db.recipe.fillCount)).toBe(true);
    expect(db.hopperRemaining).toBeGreaterThanOrEqual(0);
    expect(db.hopperRemaining).toBeLessThan(db.recipe.fillCount);

    // Start interlock: the rest cannot fill one carton.
    db.setRun(true);
    expect(db.state.running).toBe(false);
    db.refillHopper();
    db.setRun(true);
    expect(db.state.running).toBe(true);
  });

  it("'stop' mode: halts at the cycle boundary, resumes after refill", () => {
    const db = runningEngine(d => {
      d.updateParams({ hopperMode: 'stop' });
      d.endSupply();
    });
    scanUntil(db, () => !db.state.running);

    expect(db.state.supplyLow).toBe(true);
    expect(db.state.phase).toBe('process');
    expect(db.state.needsReset).toBe(false);
    expect(db.hopperRemaining).toBeLessThanOrEqual(db.config.hopperLowAt);
    const onChain = db.cartons.length;
    expect(onChain).toBeGreaterThan(0); // nothing lost, line stands as it was

    db.refillHopper();
    expect(db.state.supplyLow).toBe(false);
    db.setRun(true);
    expect(db.state.running).toBe(true);
    const packed = db.state.packed;
    scanUntil(db, () => db.state.packed > packed);
    expect(db.state.rejects).toBe(0);
  });

  it('without a level sensor the hopper runs dry -> short fills, caught by the weigher', () => {
    const db = runningEngine(d => {
      d.updateConfig({ hasHopperSensor: false });
      d.hopperRemaining = 3 * d.recipe.fillCount + 2;
    });
    scanUntil(db, () => db.state.count >= 5);

    expect(db.log.slice(0, 3).every(e => !e.reject)).toBe(true);
    expect(db.log[3]).toMatchObject({ reject: true, reason: 'short fill', products: 2 });
    expect(db.log[4]).toMatchObject({ reject: true, reason: 'short fill', products: 0 });
    expect(db.hopperRemaining).toBe(0);
  });
});
