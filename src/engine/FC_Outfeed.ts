import { PackagingEngine } from './PackagingEngine';

/**
 * FC39: Outfeed Belt + Reject Gate
 *
 * Transports the discharged cartons away from the line and sorts them
 * at the belt end:
 * - reject bit = TRUE  -> gate kicks the carton into the reject bin
 * - reject bit = FALSE -> carton continues into the good bin
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

  // Network 2: Move all cartons riding on the belt
  for (const c of db.outfeed) c.left += d;

  // Network 3: Gate at the belt end
  for (let i = db.outfeed.length - 1; i >= 0; i--) {
    if (db.outfeed[i].left >= db.config.outLen) {
      if (db.outfeed[i].reject) {
        st.rejects++;
        st.gateFlash = 0.25; // gate actuator fires
      } else {
        st.packed++;
        // Good carton counts toward the current production order
        db.order.done++;
      }

      // Carton has left the machine -> remove from tracking
      db.outfeed.splice(i, 1);

      // Notify HMI (counters changed)
      db.notify();
    }
  }
}
