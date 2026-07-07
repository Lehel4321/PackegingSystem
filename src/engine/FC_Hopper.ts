import { PackagingEngine } from './PackagingEngine';

/**
 * FC37: Hopper Level Sensor (product supply watchdog)
 *
 * A level sensor in the product hopper above the filler. Its digital
 * input goes LOW once fewer than config.hopperLowAt products remain.
 *
 * Reaction on the falling edge (params.hopperMode):
 * - 'stop'   : halt the line at the next cycle boundary. Nothing is
 *              lost — the operator refills the hopper and presses
 *              Start; the line resumes exactly where it stood.
 * - 'runout' : keep packing, but the ERECTOR checks affordability
 *              before every new carton (see FC_Erector): a carton is
 *              only started if the hopper still holds enough products
 *              to fill it AND every unfilled carton ahead of it. The
 *              line runs itself empty gracefully — no half-filled
 *              cartons, no wasted blanks.
 *
 * In both cases `supplyLow` latches. START is interlocked once the rest
 * cannot fill a single carton — refill first (refillHopper).
 *
 * ENABLE GATING:
 * No enable check inside this FC. OB1 calls it at the START of the
 * process cycle (like the PLC input image) and only when the sensor is
 * built in:  if (db.config.hasHopperSensor) FC_Hopper(db);
 * Without the sensor the line is blind: it packs until the hopper is
 * physically empty and produces short-filled cartons — which only a
 * check-weigher (if installed) can catch.
 */
export function FC_Hopper(db: PackagingEngine) {
  const st = db.state;

  // Network 1: Falling edge of the level input -> latch LOW
  if (db.hopperRemaining <= db.config.hopperLowAt && !st.supplyLow) {
    st.supplyLow = true;

    if (db.params.hopperMode === 'stop') {
      st.running = false; // safe stop at the cycle boundary (resumable)
    }
    db.notify();
  }
}
