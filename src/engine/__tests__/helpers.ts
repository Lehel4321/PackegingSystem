import { vi } from 'vitest';
import { PackagingEngine, SCAN_TIME } from '../PackagingEngine';
import { OB1_CyclicScan } from '../OB1_Main';
import { Carton } from '../../types';

/**
 * Pin Math.random so product weights (gaussian scatter) and the per-move
 * slip variance are deterministic. 0.5 gives moveSlipRand = 1.0 and a
 * product weight 0.6 % under nominal — well inside the 4 % tolerance.
 */
export function pinRandom(value = 0.5) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

/** Run N fixed 1 ms OB1 scans. */
export function scan(db: PackagingEngine, n = 1) {
  for (let i = 0; i < n; i++) OB1_CyclicScan(db, SCAN_TIME);
}

/**
 * Run OB1 scans until `pred` holds; returns the number of scans it took.
 * Throws if it never happens within `max` scans (default: 10 minutes
 * of machine time) so a regression fails instead of hanging.
 */
export function scanUntil(db: PackagingEngine, pred: () => boolean, max = 600_000): number {
  let n = 0;
  while (!pred()) {
    if (n >= max) throw new Error(`condition not reached within ${max} scans`);
    OB1_CyclicScan(db, SCAN_TIME);
    n++;
  }
  return n;
}

/** Fresh engine with the control on and production started. */
export function runningEngine(setup?: (db: PackagingEngine) => void): PackagingEngine {
  const db = new PackagingEngine();
  setup?.(db);
  db.setControlOn();
  db.setRun(true);
  return db;
}

/** Blank carton for FC test setups, sitting exactly on its slot center. */
export function carton(db: PackagingEngine, slot: number, patch: Partial<Carton> = {}): Carton {
  return {
    id: 1, slot, x: slot * db.config.pitch, fills: [], weighed: false, weight: null,
    sealed: false, labeled: false, reject: false, reason: '', ...patch,
  };
}

/** A full carton of nominal-weight products. */
export function nominalFills(db: PackagingEngine, n = db.recipe.fillCount) {
  return Array.from({ length: n }, () => ({ w: db.recipe.prodWeight, bad: false }));
}
