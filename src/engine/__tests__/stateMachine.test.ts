import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackagingEngine } from '../PackagingEngine';
import { pinRandom, runningEngine, scan, scanUntil } from './helpers';

beforeEach(() => { pinRandom(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Control On / Off', () => {
  it('powers up with the control OFF and refuses Start', () => {
    const db = new PackagingEngine();
    expect(db.state.controlOn).toBe(false);
    expect(db.state.running).toBe(false);

    db.setRun(true);
    expect(db.state.running).toBe(false);
  });

  it('does nothing in OB1 while the control is OFF or the line is not running', () => {
    const db = new PackagingEngine();
    scan(db, 100);
    expect(db.state.simTime).toBe(0);

    db.setControlOn();
    scan(db, 100);
    expect(db.state.simTime).toBe(0);
    expect(db.cartons).toHaveLength(0);
  });

  it('starts production after Control On + Start', () => {
    const db = runningEngine();
    expect(db.state.controlOn).toBe(true);
    expect(db.state.running).toBe(true);
    scan(db, 10);
    expect(db.state.simTime).toBeCloseTo(0.01, 9);
    expect(db.cartons).toHaveLength(1); // erector started the first carton
  });

  it('Control Off while running halts the axis and makes the run non-resumable', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.phase === 'index' && db.state.v > 100);

    db.setControlOff();
    expect(db.state.controlOn).toBe(false);
    expect(db.state.running).toBe(false);
    expect(db.state.needsReset).toBe(true);
    expect(db.state.v).toBe(0);
    expect(db.state.a).toBe(0);

    // Next Control On clears the line, production starts over.
    db.setControlOn();
    expect(db.state.needsReset).toBe(false);
    expect(db.cartons).toHaveLength(0);
    expect(db.state.D).toBe(0);
    expect(db.state.phase).toBe('process');
  });

  it('Control Off while idle keeps the line resumable', () => {
    const db = new PackagingEngine();
    db.setControlOn();
    db.setControlOff();
    expect(db.state.needsReset).toBe(false);
  });
});

describe('Start / Stop', () => {
  it('setRun(false) is a hard stop: axis halts where it is, resumable', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.phase === 'index' && db.state.v > 100);
    const D = db.state.D;

    db.setRun(false);
    expect(db.state.running).toBe(false);
    expect(db.state.v).toBe(0);
    expect(db.state.a).toBe(0);
    scan(db, 100);
    expect(db.state.D).toBe(D); // nothing moves

    db.setRun(true);
    expect(db.state.running).toBe(true);
    expect(db.state.needsReset).toBe(false);
    scanUntil(db, () => db.state.phase === 'process');
    expect(db.cartons[0].slot).toBe(1); // the interrupted index completed
  });

  it('requestStop is ignored while not running', () => {
    const db = new PackagingEngine();
    db.setControlOn();
    db.requestStop();
    expect(db.state.stopReq).toBe(false);
  });

  it('graceful stop finishes every carton in flight, drains the outfeed, then goes idle', () => {
    const db = runningEngine();
    scanUntil(db, () => db.cartons.length >= 3);
    const erected = db.cartonSeq;

    db.requestStop();
    expect(db.state.stopReq).toBe(true);
    expect(db.state.running).toBe(true); // NOT an instant halt

    scanUntil(db, () => db.state.draining);
    expect(db.cartons).toHaveLength(0);
    expect(db.state.v).toBe(0); // chain stands while the outfeed drains

    scanUntil(db, () => !db.state.running);
    expect(db.cartonSeq).toBe(erected); // no new carton after the stop request
    expect(db.outfeed).toHaveLength(0);
    expect(db.state.packed).toBe(erected);
    expect(db.state.count).toBe(erected);
    expect(db.state.rejects).toBe(0);
    expect(db.state.stopReq).toBe(false);
    expect(db.state.draining).toBe(false);
    expect(db.state.phase).toBe('process');
    expect(db.state.controlOn).toBe(true); // control stays on, ready for Start
  });

  it('Start after a graceful stop begins a fresh cycle', () => {
    const db = runningEngine();
    scanUntil(db, () => db.cartons.length >= 1);
    db.requestStop();
    scanUntil(db, () => !db.state.running);
    const packed = db.state.packed;

    db.setRun(true);
    expect(db.state.running).toBe(true);
    scanUntil(db, () => db.state.packed > packed);
  });
});

describe('E-Stop and reset', () => {
  it('E-Stop kills control instantly; production is not resumable', () => {
    const db = runningEngine();
    scanUntil(db, () => db.state.packed >= 1);
    const { count, packed } = db.state;
    const logLen = db.log.length;
    expect(db.cartons.length).toBeGreaterThan(0);

    db.pressEStop();
    expect(db.state.estop).toBe(true);
    expect(db.state.controlOn).toBe(false);
    expect(db.state.running).toBe(false);
    expect(db.state.needsReset).toBe(true);
    expect(db.state.v).toBe(0);

    const t = db.state.simTime;
    scan(db, 500);
    expect(db.state.simTime).toBe(t); // OB1 frozen

    // Interlock: Control On refused while the E-Stop is latched.
    db.setControlOn();
    expect(db.state.controlOn).toBe(false);

    // Releasing the E-Stop does NOT re-enable the control.
    db.releaseEStop();
    expect(db.state.estop).toBe(false);
    expect(db.state.controlOn).toBe(false);
    expect(db.cartons.length).toBeGreaterThan(0); // line not cleared yet

    // Control On clears the line; shift counters and log survive.
    db.setControlOn();
    expect(db.state.controlOn).toBe(true);
    expect(db.state.needsReset).toBe(false);
    expect(db.cartons).toHaveLength(0);
    expect(db.outfeed).toHaveLength(0);
    expect(db.state.D).toBe(0);
    expect(db.state.phase).toBe('process');
    expect(db.state.count).toBe(count);
    expect(db.state.packed).toBe(packed);
    expect(db.log).toHaveLength(logLen);

    // ...and production restarts from slot 0.
    db.setRun(true);
    scan(db, 1);
    expect(db.cartons).toHaveLength(1);
    expect(db.cartons[0].slot).toBe(0);
  });

  it('E-Stop while not running does not demand a line reset', () => {
    const db = new PackagingEngine();
    db.setControlOn();
    db.pressEStop();
    expect(db.state.needsReset).toBe(false);
    db.pressEStop(); // already latched: no-op
    db.releaseEStop();
    db.setControlOn();
    expect(db.state.controlOn).toBe(true);
  });

  it('master reset clears counters, log, order count and hopper', () => {
    const db = runningEngine();
    db.endSupply();
    db.injectBadProduct();
    scanUntil(db, () => db.state.count >= 2);
    db.setRun(false);

    db.reset();
    expect(db.state.running).toBe(false);
    expect(db.state.count).toBe(0);
    expect(db.state.packed).toBe(0);
    expect(db.state.rejects).toBe(0);
    expect(db.state.simTime).toBe(0);
    expect(db.order.done).toBe(0);
    expect(db.order.made).toBe(0);
    expect(db.log).toHaveLength(0);
    expect(db.scopeTrace).toHaveLength(0);
    expect(db.cartons).toHaveLength(0);
    expect(db.outfeed).toHaveLength(0);
    expect(db.cartonSeq).toBe(0);
    expect(db.hopperRemaining).toBe(Infinity);
    expect(db.state.supplyLow).toBe(false);
    expect(db.nextBadCount).toBe(0);
  });
});

describe('interlocks', () => {
  it('recipe is locked while running', () => {
    const db = runningEngine();
    expect(db.updateRecipe({ fillCount: 3 })).toBe(false);
    expect(db.recipe.fillCount).toBe(6);
    db.setRun(false);
    expect(db.updateRecipe({ fillCount: 3 })).toBe(true);
    expect(db.recipe.fillCount).toBe(3);
  });

  it('machine build is locked while the control is ON', () => {
    const db = new PackagingEngine();
    db.setControlOn();
    expect(db.updateConfig({ hasWeigher: false })).toBe(false);
    expect(db.config.hasWeigher).toBe(true);
    db.setControlOff();
    expect(db.updateConfig({ hasWeigher: false })).toBe(true);
    expect(db.config.hasWeigher).toBe(false);
  });

  it('recipe input is clamped; invalid numbers keep the previous value', () => {
    const db = new PackagingEngine();
    db.updateRecipe({ fillCount: 99, cartonLen: 1000, spd: NaN, name: 'small box' });
    expect(db.recipe.fillCount).toBe(12);
    expect(db.recipe.cartonLen).toBe(db.config.pitch - 40); // must fit the pitch
    expect(db.recipe.spd).toBe(800);
    expect(db.recipe.name).toBe('SMALL BOX');
    expect(db.recipe.labelAt).toBeLessThanOrEqual(db.recipe.cartonLen - db.config.labelLen);
  });

  it('shrinking the pitch re-clamps the carton length', () => {
    const db = new PackagingEngine();
    db.updateConfig({ pitch: 200 });
    expect(db.recipe.cartonLen).toBe(160);
    expect(db.recipe.labelAt).toBeLessThanOrEqual(160 - db.config.labelLen);
  });

  it('saved recipes round-trip through the recipe manager, load locked while running', () => {
    const db = new PackagingEngine();
    db.updateRecipe({ name: 'big', fillCount: 8 });
    db.saveRecipe();
    db.updateRecipe({ name: 'other', fillCount: 2 });
    expect(db.getRecipeNames()).toEqual(['BIG']);

    db.setControlOn();
    db.setRun(true);
    expect(db.loadRecipe('BIG')).toBe(false);
    db.setRun(false);
    expect(db.loadRecipe('BIG')).toBe(true);
    expect(db.recipe.fillCount).toBe(8);
    expect(db.loadRecipe('MISSING')).toBe(false);

    db.deleteRecipe('BIG');
    expect(db.getRecipeNames()).toEqual([]);
  });

  it('update() runs fixed 1 ms scans and caps a lag spike at 50 ms', () => {
    const db = runningEngine();
    db.update(0.0105);
    expect(db.state.simTime).toBeCloseTo(0.010, 6);
    db.update(5); // inactive tab for 5 s -> watchdog
    expect(db.state.simTime).toBeLessThan(0.0105 + 0.0505);
    expect(db.state.simTime).toBeGreaterThan(0.0105 + 0.0485);
  });
});
