import { PackagingEngine } from './PackagingEngine';

/**
 * FC38: Registration Eye (chain position photo-eye)
 *
 * Optional photo-eye watching the carton lugs arrive at the index
 * target. Its trip point is auto-calculated per move as:
 *
 *     trip = pitch − stop distance − reaction reserve − correction constant
 *
 * where the stop distance is the axis' REAL jerk-limited braking
 * distance (MotionProfile.stopDistance) from the APPROACH speed
 * (db.regApproachV), not the production speed — FC_Indexer ramps the
 * chain down to that speed before it ever reaches the eye (3-phase
 * move). That keeps the final stop short and consistent regardless of
 * how fast production runs, which is what makes the eye an actual
 * POSITION MEASUREMENT.
 *
 * Unlike the encoder (D), which drifts under chain slip, the eye sees
 * the PHYSICAL chain travel (db.state.mvTip). When the lug reaches the
 * trip point, the PLC re-syncs its tracking and latches the corrected
 * stop target so the carton lands exactly on the slot center:
 *
 *     brakeD = D + (pitch − physical travel) / (1 − slip estimate)
 *
 * The live slip estimate is a touch-probe correction: the eye tells us
 * the true position, the encoder tells us how far the drive turned —
 * the ratio is the actual slip of this very index, so the remaining
 * travel is converted into encoder travel that lands on target even
 * while still slipping during the brake.
 *
 * ENABLE GATING:
 * No `hasReg` check inside this FC. OB1 only calls it when the eye is
 * installed:  if (db.config.hasReg) FC_Registration(db);
 */
export function FC_Registration(db: PackagingEngine) {
  const st = db.state;

  if (st.braking) return; // already tripped, waiting for standstill

  const pos = db.regSensorPos();
  if (pos <= 0) return; // stop distance + constant exceed the pitch

  // Network 1: Pre-trip, the move target is the nominal one-pitch
  // boundary. Refreshed every scan.
  st.brakeD = st.moveStartD + db.config.pitch;

  // Network 2: physical lug crossed the eye -> raise the input, correct
  // the stop target with the TRUE chain position.
  if (st.mvTip >= pos) {
    const slipEst = st.mvD > 1 ? Math.min(0.3, Math.max(0, 1 - st.mvTip / st.mvD)) : 0;
    const remEnc = (db.config.pitch - st.mvTip) / (1 - slipEst);

    st.braking = true;
    st.brakeD = st.D + Math.max(0, remEnc);
    st.regFlash = 0.15;
    st.regFault = false; // eye confirmed in time — clear any stale warning
  }
}
