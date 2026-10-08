/**
 * Every function block in isolation against a fresh data block — the
 * same setups the FC Lab runs, turned into assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NUM_SLOTS, PackagingEngine, SLOT } from '../PackagingEngine';
import { FC_Layout } from '../FC_Layout';
import { FC_Indexer } from '../FC_Indexer';
import { FC_Registration } from '../FC_Registration';
import { FC_Hopper } from '../FC_Hopper';
import { FC_Erector } from '../FC_Erector';
import { FC_Filler } from '../FC_Filler';
import { FC_Checkweigher } from '../FC_Checkweigher';
import { FC_Sealer } from '../FC_Sealer';
import { FC_Labeler } from '../FC_Labeler';
import { FC_Discharge } from '../FC_Discharge';
import { FC_Outfeed } from '../FC_Outfeed';
import { carton, nominalFills, pinRandom } from './helpers';

beforeEach(() => { pinRandom(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('FC10 Layout', () => {
  it('places six slots one pitch apart and maps the axis onto the canvas', () => {
    const db = new PackagingEngine();
    const L = FC_Layout(db, 1100, 360);
    expect(L.slots).toEqual(Array.from({ length: NUM_SLOTS }, (_, i) => i * 300));
    expect(L.outStart).toBe(5 * 300);
    expect(L.outEnd).toBe(5 * 300 + db.config.outLen);
    expect(L.X(L.axisMin)).toBeCloseTo(46, 9);
    expect(L.X(L.axisMax)).toBeCloseTo(1100 - 46, 9);
    expect(L.X(L.slots[1]) - L.X(L.slots[0])).toBeCloseTo(300 * L.pxPerMm, 9);
  });
});

describe('FC30 Indexer + FC38 Registration', () => {
  function indexSetup(db: PackagingEngine) {
    db.state.phase = 'index';
    db.state.moveStartD = 0;
    db.state.brakeD = db.config.pitch;
    db.cartons = [carton(db, 2)];
  }

  it('lands the axis on the pitch target with the carton riding along', () => {
    const db = new PackagingEngine();
    indexSetup(db);
    for (let i = 0; i < 2000; i++) {
      FC_Indexer(db, 0.001);
      FC_Registration(db);
    }
    expect(db.state.D).toBeCloseTo(300, 6);
    expect(db.state.v).toBe(0);
    expect(db.state.mvTip).toBeCloseTo(300, 6);
    expect(db.cartons[0].x).toBeCloseTo(3 * 300, 6);
  });

  it('without the eye, the encoder target is never overshot', () => {
    const db = new PackagingEngine();
    db.config.hasReg = false;
    db.recipe.spd = 2000;
    indexSetup(db);
    let maxD = 0;
    for (let i = 0; i < 2000; i++) {
      FC_Indexer(db, 0.001);
      maxD = Math.max(maxD, db.state.D);
    }
    expect(maxD).toBeLessThanOrEqual(300 + 1e-9);
    expect(db.state.D).toBeCloseTo(300, 6);
  });

  it('chain slip: physical travel lags the encoder', () => {
    const db = new PackagingEngine();
    db.config.hasReg = false;
    db.params.slipPct = 5;
    indexSetup(db);
    for (let i = 0; i < 2000; i++) FC_Indexer(db, 0.001);
    expect(db.state.D).toBeCloseTo(300, 6);
    expect(db.state.mvTip).toBeLessThan(300 * (1 - 0.05 * 0.35) + 1e-6);
    expect(db.state.mvTip).toBeGreaterThan(300 * 0.95 - 1e-6);
  });

  it('eye trip corrects the stop target with the live slip estimate', () => {
    const db = new PackagingEngine();
    db.params.slipPct = 3;
    db.state.phase = 'index';
    db.state.moveStartD = 0;
    db.state.mvTip = db.regSensorPos() + 0.5;
    db.state.mvD = db.state.mvTip / (1 - 0.03);
    db.state.D = db.state.mvD;
    db.state.v = db.regApproachV();
    db.state.regFault = true; // stale warning

    FC_Registration(db);
    expect(db.state.braking).toBe(true);
    expect(db.state.regFault).toBe(false);
    expect(db.state.regFlash).toBeGreaterThan(0);
    // Remaining physical travel converted to encoder travel at 3 % slip.
    expect(db.state.brakeD).toBeCloseTo(db.state.D + (300 - db.state.mvTip) / 0.97, 6);
  });

  it('before the eye, the target is the nominal one-pitch boundary', () => {
    const db = new PackagingEngine();
    db.state.moveStartD = 600;
    db.state.mvTip = 10;
    FC_Registration(db);
    expect(db.state.braking).toBe(false);
    expect(db.state.brakeD).toBe(900);
  });

  it('eye position = pitch − stop distance − reaction reserve − constant', () => {
    const db = new PackagingEngine();
    const expected = db.config.pitch - db.regStopDist() - db.regApproachV() * 0.001 - db.config.regConst;
    expect(db.regSensorPos()).toBeCloseTo(expected, 9);
    expect(db.regApproachV()).toBe(500); // capped below the 800 mm/s production speed
    db.updateRecipe({ spd: 300 });
    expect(db.regApproachV()).toBeCloseTo(300, 6); // a slow recipe needs no slow-down
    expect(db.regSensorPos()).toBeGreaterThan(expected); // shorter stop -> eye moves closer to target
  });
});

describe('FC37 Hopper sensor', () => {
  it("'stop' mode latches LOW and halts the line", () => {
    const db = new PackagingEngine();
    db.state.running = true;
    db.hopperRemaining = db.config.hopperLowAt - 1;
    db.params.hopperMode = 'stop';
    FC_Hopper(db);
    expect(db.state).toMatchObject({ supplyLow: true, running: false });
  });

  it("'runout' mode latches LOW and keeps running", () => {
    const db = new PackagingEngine();
    db.state.running = true;
    db.hopperRemaining = db.config.hopperLowAt - 1;
    FC_Hopper(db);
    expect(db.state).toMatchObject({ supplyLow: true, running: true });
  });

  it('above the threshold nothing happens', () => {
    const db = new PackagingEngine();
    db.state.running = true;
    db.hopperRemaining = db.config.hopperLowAt + 1;
    FC_Hopper(db);
    expect(db.state.supplyLow).toBe(false);
  });
});

describe('FC31 Erector', () => {
  it('declines when the order is already covered by made + in-flight cartons', () => {
    const db = new PackagingEngine();
    db.order.target = 2;
    db.order.made = 1;
    db.cartons = [carton(db, 3, { sealed: true })];
    expect(FC_Erector(db)).toBe(false);
    expect(db.cartons).toHaveLength(1);
  });

  it('a rejected carton in flight frees its spot in the order', () => {
    const db = new PackagingEngine();
    db.order.target = 2;
    db.order.made = 1;
    db.cartons = [carton(db, 3, { reject: true, reason: 'weight' })];
    expect(FC_Erector(db)).toBe(true);
  });

  it('erects at slot 0 on an endless order', () => {
    const db = new PackagingEngine();
    expect(FC_Erector(db)).toBe(true);
    expect(db.cartons[0]).toMatchObject({ id: 1, slot: SLOT.ERECT, x: 0, fills: [], reject: false });
    expect(db.state.erectFlash).toBe(db.params.erectT);
  });

  it('declines on a stop request', () => {
    const db = new PackagingEngine();
    db.state.stopReq = true;
    expect(FC_Erector(db)).toBe(false);
  });

  it('runout: only erects if the hopper can fill it and every unfilled carton ahead', () => {
    const db = new PackagingEngine();
    db.state.supplyLow = true;
    db.cartons = [carton(db, SLOT.FILL)]; // still needs its 6 products
    db.hopperRemaining = 11;
    expect(FC_Erector(db)).toBe(false);
    db.hopperRemaining = 12;
    expect(FC_Erector(db)).toBe(true);
  });

  it('places the carton on the nearest lug (drift wrapped to ±½ pitch)', () => {
    const db = new PackagingEngine();
    db.drift = -310; // a full pitch plus 10 mm behind
    FC_Erector(db);
    expect(db.cartons[0].x).toBeCloseTo(-10, 9);
  });
});

describe('FC32 Filler', () => {
  it('drops the whole raster; an injected bad product weighs badWeightPct', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.FILL)];
    db.nextBadCount = 1;
    db.state.procElapsed = db.recipe.fillCount * db.params.fillT;
    FC_Filler(db);
    const { fills } = db.cartons[0];
    expect(fills).toHaveLength(db.recipe.fillCount);
    expect(fills[0]).toEqual({ w: db.recipe.prodWeight * 0.5, bad: true });
    expect(fills.slice(1).every(f => !f.bad && Math.abs(f.w / db.recipe.prodWeight - 1) < 0.02)).toBe(true);
    expect(db.nextBadCount).toBe(0);
  });

  it('drops only what the elapsed time allows', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.FILL)];
    db.state.procElapsed = 2.5 * db.params.fillT;
    FC_Filler(db);
    expect(db.cartons[0].fills).toHaveLength(2);
  });

  it('stops dropping when the hopper is physically empty (short fill)', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.FILL)];
    db.hopperRemaining = 4;
    db.state.procElapsed = 10;
    FC_Filler(db);
    expect(db.cartons[0].fills).toHaveLength(4);
    expect(db.hopperRemaining).toBe(0);
  });

  it('a misplaced carton is not filled', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.FILL, { x: 300 + 13 })];
    db.state.procElapsed = 10;
    FC_Filler(db);
    expect(db.cartons[0]).toMatchObject({ fills: [], reject: true, reason: 'misplaced' });
  });
});

describe('FC33 Check-weigher', () => {
  function weigh(fills: { w: number; bad: boolean }[], patch = {}) {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.WEIGH, { fills, ...patch })];
    db.state.procElapsed = db.params.weighT;
    FC_Checkweigher(db);
    return { db, c: db.cartons[0] };
  }

  it('one half-weight product -> reject "weight"', () => {
    const db0 = new PackagingEngine();
    const fills = nominalFills(db0);
    fills[0] = { w: db0.recipe.prodWeight * 0.5, bad: true };
    const { db, c } = weigh(fills);
    expect(c).toMatchObject({ weighed: true, reject: true, reason: 'weight' });
    expect(c.weight).toBe(db.recipe.tare + 5.5 * db.recipe.prodWeight);
  });

  it('nominal carton passes; the tolerance edge is inclusive', () => {
    const db0 = new PackagingEngine();
    expect(weigh(nominalFills(db0)).c.reject).toBe(false);
    // +4 % on the net weight exactly at the edge
    const edge = nominalFills(db0).map(f => ({ ...f, w: f.w * 1.04 }));
    expect(weigh(edge).c.reject).toBe(false);
    const over = nominalFills(db0).map(f => ({ ...f, w: f.w * 1.041 }));
    expect(weigh(over).c.reason).toBe('weight');
  });

  it('missing products -> "short fill"', () => {
    const db0 = new PackagingEngine();
    expect(weigh(nominalFills(db0, 5)).c.reason).toBe('short fill');
  });

  it('waits for the scale to settle', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.WEIGH, { fills: nominalFills(db) })];
    db.state.procElapsed = db.params.weighT - 0.01;
    FC_Checkweigher(db);
    expect(db.cartons[0].weighed).toBe(false);
  });

  it('keeps the first reject reason', () => {
    const db0 = new PackagingEngine();
    const { c } = weigh(nominalFills(db0, 2), { reject: true, reason: 'misplaced' });
    expect(c).toMatchObject({ weighed: true, reason: 'misplaced' });
  });
});

describe('FC34 Sealer', () => {
  it('seals an aligned carton after sealT', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.SEAL)];
    db.state.procElapsed = db.params.sealT - 0.001;
    FC_Sealer(db);
    expect(db.cartons[0].sealed).toBe(false);
    db.state.procElapsed = db.params.sealT;
    FC_Sealer(db);
    expect(db.cartons[0]).toMatchObject({ sealed: true, reject: false });
  });

  it('leaves a carton 20 mm off its slot open and flags it misplaced', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.SEAL, { x: SLOT.SEAL * 300 - 20 })];
    db.state.procElapsed = db.params.sealT;
    FC_Sealer(db);
    expect(db.cartons[0]).toMatchObject({ sealed: false, reject: true, reason: 'misplaced' });
  });
});

describe('FC35 Labeler', () => {
  it('applies the label band at recipe.labelAt', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.LABEL, { sealed: true })];
    db.state.procElapsed = db.params.labelT;
    FC_Labeler(db);
    expect(db.cartons[0]).toMatchObject({ labeled: true, labelA: 130, labelB: 190 });
  });

  it('skips a misplaced carton', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.LABEL, { sealed: true, x: SLOT.LABEL * 300 + 15 })];
    db.state.procElapsed = db.params.labelT;
    FC_Labeler(db);
    expect(db.cartons[0]).toMatchObject({ labeled: false, reject: true, reason: 'misplaced' });
  });
});

describe('FC36 Discharge', () => {
  it('transfers the finished carton to the outfeed, commits it and logs it', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.DISCHARGE, {
      fills: nominalFills(db), sealed: true, labeled: true, labelA: 130, labelB: 190, weighed: true,
    })];
    FC_Discharge(db);
    expect(db.cartons).toHaveLength(0);
    expect(db.outfeed).toHaveLength(1);
    expect(db.outfeed[0]).toMatchObject({ left: 0, len: db.recipe.cartonLen, reject: false });
    expect(db.state.count).toBe(1);
    expect(db.order.made).toBe(1);
    expect(db.log[0]).toMatchObject({
      n: 1, products: 6, weight: db.targetWeight(), targetW: db.targetWeight(), reject: false,
    });
  });

  it('final checks: unsealed or unlabeled cartons are rejected and not committed', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.DISCHARGE, { fills: nominalFills(db), sealed: true })];
    FC_Discharge(db);
    expect(db.outfeed[0]).toMatchObject({ reject: true, reason: 'no label' });

    db.cartons = [carton(db, SLOT.DISCHARGE, { fills: nominalFills(db), labeled: true })];
    FC_Discharge(db);
    expect(db.outfeed[1]).toMatchObject({ reject: true, reason: 'not sealed' });
    expect(db.order.made).toBe(0);
    expect(db.state.count).toBe(2);
  });

  it('leaves cartons that have not reached the discharge slot', () => {
    const db = new PackagingEngine();
    db.cartons = [carton(db, SLOT.LABEL)];
    FC_Discharge(db);
    expect(db.cartons).toHaveLength(1);
    expect(db.state.count).toBe(0);
  });

  it('caps the packing log at 200 entries', () => {
    const db = new PackagingEngine();
    for (let i = 0; i < 205; i++) {
      db.cartons = [carton(db, SLOT.DISCHARGE, { sealed: true, labeled: true })];
      FC_Discharge(db);
    }
    expect(db.log).toHaveLength(200);
    expect(db.log[0].n).toBe(6);
  });
});

describe('FC39 Outfeed', () => {
  it('good carton runs off the belt end into the good bin; reject is pushed off at the gate', () => {
    const db = new PackagingEngine();
    db.outfeed = [
      { left: 895, len: 220, reject: false, reason: '', fills: [], sealed: true },
      { left: 890, len: 220, reject: true, reason: 'weight', fills: [], sealed: true },
    ];
    for (let i = 0; i < 100; i++) FC_Outfeed(db, 1200, 0.001);

    expect(db.state.packed).toBe(1);
    expect(db.order.done).toBe(1);
    expect(db.state.rejects).toBe(1);
    expect(db.outfeed).toHaveLength(1);
    expect(db.outfeed[0]).toMatchObject({ reject: true, diverting: true });
    expect(db.outfeed[0].left).toBeCloseTo(891.2, 9); // one belt step to reach the check, then stops travelling

    for (let i = 0; i < 1000; i++) FC_Outfeed(db, 1200, 0.001);
    expect(db.outfeed).toHaveLength(0);
    expect(db.state.rejects).toBe(1); // counted once
  });

  it('the reject pusher sits 200 mm before the belt end', () => {
    const db = new PackagingEngine();
    expect(db.rejectGatePos()).toBe(db.config.outLen - 200);
    db.outfeed = [{ left: 0, len: 220, reject: true, reason: 'weight', fills: [], sealed: true }];
    let n = 0;
    while (!db.outfeed[0].diverting) { FC_Outfeed(db, 1000, 0.001); n++; }
    expect(n).toBe(700);
  });
});
