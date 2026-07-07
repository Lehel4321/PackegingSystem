import { PackagingEngine } from './PackagingEngine';
import { commitStopDist, commitRampDist } from './MotionProfile';

/**
 * FC30: Index Axis Drive (indexing chain — servo motor model)
 *
 * Moves the carton chain exactly one pitch per cycle. The tag `D` is
 * the total encoder travel in mm (actual position of the servo axis).
 *
 * The axis moves like a REAL servo motor with the configured motor data
 * (config.axVmax / axAmax / axJerk): velocity follows a jerk-limited
 * S-curve — it ramps up at the start of every index and ramps down to
 * standstill at the target, using the trajectory math ported from
 * Lehel4321/MotionProfileSolver (see MotionProfile.ts).
 *
 * REGISTRATION MOVE, THREE phases — all derived reactively from the
 * axis' own current physics (v, a), never a precomputed schedule:
 *   1. Accelerate/cruise at full production speed.
 *   2. Once the committed distance to ramp down to the registration
 *      approach speed covers what's left before the eye, ramp DOWN and
 *      hold — the chain always arrives at the eye at a bounded,
 *      predictable speed no matter how fast production runs. Short
 *      pitches that never exceed the cap skip this phase.
 *   3. After the eye trips, brake fully to standstill at
 *      db.state.brakeD — short and consistent because phase 2 already
 *      capped the speed. Fallback: if the eye never trips, OB1 ends the
 *      move on the encoder overshoot budget (registration fault).
 *
 * ENABLE GATING (important convention):
 * This FC contains NO enable check. OB1 decides *whether* to call it:
 * only while the machine phase is 'index'. During 'process' the chain
 * must stand still, so OB1 simply does not call this block.
 *
 * @param dt Fixed scan time in seconds (SCAN_TIME = 0.001 s).
 */
export function FC_Indexer(db: PackagingEngine, dt: number) {
  const A = db.config.axAmax;
  const J = db.config.axJerk;
  const st = db.state;
  const regActive = db.config.hasReg && db.regSensorPos() > 0;

  // Network 1: Velocity setpoint.
  // Normal index: cruise at the recipe speed (capped at the axis Vmax).
  let vt = db.cruiseSpeed();

  const rem = st.brakeD - st.D;
  if (rem <= 0.001) {
    if (regActive && !st.braking) {
      // At the nominal index target but the eye hasn't confirmed yet
      // (heavy chain slip): creep forward until it trips (or the
      // overshoot budget runs out -> OB1 raises the registration fault).
      vt = 25;
    } else {
      vt = 0; // reached the target
    }
  } else if (commitStopDist(st.v, st.a, A, J) >= rem) {
    vt = 0; // committing to brake for the target
  } else if (st.braking) {
    // After the eye trip: hold the arrival speed to the corrected
    // target, never re-accelerate.
    vt = Math.min(vt, Math.max(st.v, 25));
  }

  // Phase 2: reactively ramp down to the approach speed BEFORE the eye.
  if (regActive && !st.braking) {
    const remToEye = db.regSensorPos() - st.mvTip;
    const approachV = db.regApproachV();
    if (remToEye > 0 && commitRampDist(st.v, st.a, approachV, A, J) >= remToEye) {
      if (approachV < vt) vt = approachV;
    }
  }

  // Network 2: Jerk-limited velocity tracking (S-curve).
  // vSettle = velocity we would end at if accel were ramped to zero now;
  // steer the jerk so vSettle converges on the setpoint.
  const vSettle = st.v + (st.a * Math.abs(st.a)) / (2 * J);
  const jerk = vSettle < vt ? J : -J;
  st.a = Math.max(-A, Math.min(A, st.a + jerk * dt));
  st.v += st.a * dt;

  // Snap to the setpoint when within one scan's resolution (avoids
  // limit-cycle chatter around the target velocity).
  if (Math.abs(st.v - vt) <= Math.abs(st.a) * dt + J * dt * dt && Math.abs(st.a) <= 2 * J * dt) {
    st.v = vt;
    st.a = 0;
  }
  if (st.v < 0) { st.v = 0; st.a = 0; } // the chain never runs backwards

  // Network 3: Advance the encoder position. While braking on the
  // corrected target, never overshoot it.
  let dD = st.v * dt;
  if (st.braking) dD = Math.min(dD, Math.max(0, st.brakeD - st.D));
  st.D += dD;
  st.mvD += dD;

  // Network 4: Advance the PHYSICAL chain. On a real line the drive can
  // slip against the chain (stretch, worn sprocket), so true physical
  // advance can lag the encoder — params.slipPct simulates that for
  // diagnostics. The cartons ride rigidly on the chain lugs.
  const dPhys = dD * (1 - db.params.slipPct / 100);
  st.tip += dPhys;
  st.mvTip += dPhys;
  for (const c of db.cartons) c.x += dPhys;
}
