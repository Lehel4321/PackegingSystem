import { PackagingEngine } from './PackagingEngine';

/** Push-out animation length (s) — visual only, counters commit at the pusher signal. */
const DIVERT_T = 1.0;

/**
 * FC39: Outfeed Belt + Reject Pusher
 *
 * Transports the discharged cartons away from the line. A pneumatic
 * pusher sits BEFORE the belt end (engine.rejectGatePos):
 * - reject bit = TRUE  -> the pusher shoves the carton perpendicular
 *                         off the belt onto the reject lane
 * - reject bit = FALSE -> the carton passes the pusher untouched and
 *                         runs off the belt end into the good bin
 *
 * This is the standard layout on real lines: the reject divert is a
 * side pusher mid-belt, the good product goes straight through. The
 * reject counter commits the instant the pusher fires — a real PLC
 * logs the reject at the valve signal, not when the carton lands.
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
  const gateAt = db.rejectGatePos();

  // Network 1: Belt motion (visual tracking of the belt surface)
  st.beltScroll += d;

  // Network 2: Move the cartons riding the belt. A carton being pushed
  // out has left the belt surface — it no longer travels forward.
  for (const c of db.outfeed) {
    if (!c.diverting) c.left += d;
  }

  // Network 3: Reject pusher + good bin
  for (let i = db.outfeed.length - 1; i >= 0; i--) {
    const c = db.outfeed[i];

    // Push-out in progress: count down, then remove from tracking
    // (the carton has settled on the reject lane).
    if (c.diverting) {
      c.divertT = (c.divertT ?? DIVERT_T) - dt;
      if (c.divertT <= 0) {
        db.outfeed.splice(i, 1);
        db.notify();
      }
      continue;
    }

    if (c.reject && c.left >= gateAt) {
      // Pusher fires: counter commits NOW, the perpendicular push-out
      // is the visible after-effect.
      st.rejects++;
      st.gateFlash = 0.35;
      c.diverting = true;
      c.divertT = DIVERT_T;
      db.notify();
    } else if (c.left >= db.config.outLen) {
      // Belt end: good carton into the good bin.
      st.packed++;
      // Good carton counts toward the current production order
      db.order.done++;
      db.outfeed.splice(i, 1);
      db.notify();
    }
  }
}
