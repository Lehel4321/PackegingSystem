import { PackagingEngine, SLOT } from './PackagingEngine';

/**
 * FC31: Carton Erector (blank magazine + erecting head)
 *
 * Starts a new carton at slot 0 at the beginning of a process cycle.
 * This block is the ONLY gate that decides whether the line takes on
 * more work — everything downstream just finishes what is in flight:
 *
 * - STOP REQUEST: a graceful stop (Stop button, order complete, coil of
 *   any other stop reason) means: no new cartons; the line cycles until
 *   the chain is empty, then drains the outfeed.
 * - ORDER GATE: with a target set, never start more cartons than the
 *   order still needs — committed good cartons (order.made) plus the
 *   good cartons still on the chain already cover the target. A carton
 *   rejected downstream frees its spot automatically (the count drops),
 *   so the erector tops the order up by exactly the rejected amount.
 * - HOPPER AFFORDABILITY ('runout' mode, needs the level sensor): only
 *   start a carton if the hopper still holds enough products for it AND
 *   for every carton ahead of it that still needs filling. This is what
 *   makes the run-out graceful — the last cartons all come out full.
 *
 * ENABLE GATING:
 * The erector is a core device — OB1 always calls it at the process
 * cycle start. All gating is production logic, not device existence.
 */
export function FC_Erector(db: PackagingEngine): boolean {
  const st = db.state;

  // Network 1: Graceful stop — no new work.
  if (st.stopReq) return false;

  // Network 2: Order gate.
  if (db.order.target > 0 && db.order.made + db.goodInFlight() >= db.order.target) {
    return false;
  }

  // Network 3: Hopper affordability (run-out intelligence — only
  // possible when the machine HAS a level sensor to know the rest).
  if (db.config.hasHopperSensor && st.supplyLow && db.params.hopperMode === 'runout') {
    const needingFill = db.cartons.filter(c => c.fills.length === 0 && c.slot <= SLOT.FILL).length + 1;
    if (db.hopperRemaining < needingFill * db.recipe.fillCount) return false;
  }

  // Network 4: Erect the carton onto the NEAREST lug at slot 0. Lugs
  // repeat every pitch, so the effective lug offset is the accumulated
  // chain drift wrapped into ±half a pitch.
  const lugOff = db.drift - Math.round(db.drift / db.config.pitch) * db.config.pitch;
  db.cartons.push({
    id: ++db.cartonSeq,
    slot: SLOT.ERECT,
    x: lugOff,
    fills: [],
    weighed: false,
    weight: null,
    sealed: false,
    labeled: false,
    reject: false,
    reason: '',
  });
  st.erectFlash = db.params.erectT;
  return true;
}
