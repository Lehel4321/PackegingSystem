import { PackagingEngine } from './PackagingEngine';

/** Divert-fall animation length (s) — visible only, counters commit at gate. */
const DIVERT_T = 1.0;

/**
 * FC39: Outfeed Belt + Reject Gate
 *
 * Transports the discharged cartons away from the line and sorts them
 * at the belt end:
 * - reject bit = TRUE  -> gate kicks the carton, it falls into the
 *                         reject bin (visible fall animation)
 * - reject bit = FALSE -> carton passes the gate into the good bin
 *
 * ENABLE GATING:
 * No enable check inside the FC. OB1 calls this block every scan (in
 * both phases and while draining) and passes the speed setpoint.
 *
 * @param speed Belt speed setpoint in mm/s (from OB1).
 * @param dt    Fixed scan time in seconds (SCAN_TIME = 0.001 s).
 */
export function FC_Outfeed(db: PackagingEngine, speed: number, dt: number) {
  const d = speed * dt;
  const st = db.state;

  // Network 1: Belt motion (visual tracking of the belt surface)
  st.beltScroll += d;

  // Network 2: Move all cartons still riding the belt. A diverting
  // carton has left the belt and falls in place — the belt no longer
  // carries it forward.
  for (const c of db.outfeed) {
    if (!c.diverting) c.left += d;
  }

  // Network 3: Gate + reject-fall animation
  for (let i = db.outfeed.length - 1; i >= 0; i--) {
    const c = db.outfeed[i];

    // Diverting: count down the fall timer, then remove from tracking.
    if (c.diverting) {
      c.divertT = (c.divertT ?? DIVERT_T) - dt;
      if (c.divertT <= 0) {
        db.outfeed.splice(i, 1);
        db.notify();
      }
      continue;
    }

    if (c.left >= db.config.outLen) {
      if (c.reject) {
        // Gate actuates + counter commits IMMEDIATELY — the fall is
        // just the visible after-effect. A real machine's PLC also
        // logs the reject at the gate signal, not when it hits the bin.
        st.rejects++;
        st.gateFlash = 0.25;
        c.diverting = true;
        c.divertT = DIVERT_T;
        db.notify();
      } else {
        st.packed++;
        // Good carton counts toward the current production order
        db.order.done++;
        db.outfeed.splice(i, 1);
        db.notify();
      }
    }
  }
}
