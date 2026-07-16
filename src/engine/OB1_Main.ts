import { PackagingEngine, SLOT } from './PackagingEngine';
import { FC_Indexer } from './FC_Indexer';
import { FC_Registration } from './FC_Registration';
import { FC_Hopper } from './FC_Hopper';
import { FC_Erector } from './FC_Erector';
import { FC_Filler } from './FC_Filler';
import { FC_Checkweigher } from './FC_Checkweigher';
import { FC_Sealer } from './FC_Sealer';
import { FC_Labeler } from './FC_Labeler';
import { FC_Discharge } from './FC_Discharge';
import { FC_Outfeed } from './FC_Outfeed';

/**
 * OB1: Main Cyclic Execution Block
 *
 * In an S7 PLC, OB1 runs continuously in an endless loop. This
 * simulation runs OB1 with a FIXED scan time: `dt` is always SCAN_TIME
 * (1 ms) — see PackagingEngine.update(), which converts real elapsed
 * frame time into N fixed 1 ms scans. A fixed cycle makes the machine
 * deterministic: the same inputs always produce exactly the same
 * behavior, independent of the monitor refresh rate.
 *
 * THE LINE CYCLE alternates between two phases:
 *   'process' — the chain stands still, all stations act in parallel
 *               on the carton sitting in front of them (erect, fill,
 *               weigh, seal, label, discharge), each on its own timer.
 *   'index'   — the servo chain moves exactly one pitch along its
 *               jerk-limited S-curve, watched by the registration eye.
 *
 * DEVICE GATING CONVENTION:
 * Every optional device has its own FC file. The FCs contain NO enable
 * checks — OB1 decides here which devices exist on this line and only
 * calls the FCs of installed devices. To remove a device from a machine
 * variant, remove (or gate) its call in this block only.
 */
export function OB1_CyclicScan(db: PackagingEngine, dt: number) {
  // Safety gate: without machine control (Control-ON) nothing moves.
  if (!db.state.controlOn) return;
  if (!db.state.running) return;

  const st = db.state;

  // Network 1: Update global timers
  st.simTime += dt;
  if (st.erectFlash > 0) st.erectFlash -= dt;
  if (st.fillFlash > 0) st.fillFlash -= dt;
  if (st.weighFlash > 0) st.weighFlash -= dt;
  if (st.sealFlash > 0) st.sealFlash -= dt;
  if (st.labelFlash > 0) st.labelFlash -= dt;
  if (st.regFlash > 0) st.regFlash -= dt;
  if (st.gateFlash > 0) st.gateFlash -= dt;

  // Network 1a: PLC trace recorder for the HMI scope. A real drive
  // scope records inside the PLC cycle, never at the HMI refresh —
  // sampling the servo ramps at screen framerate would alias the
  // S-curve into fake instant jumps. Every 4th scan = 4 ms resolution.
  db.traceScan++;
  if (db.traceScan >= 4) {
    db.traceScan = 0;
    db.scopeTrace.push({
      t: st.simTime * 1000,
      v: st.v,
      idx: st.phase === 'index' && !st.draining,
      fill: st.fillFlash > 0,
      weigh: st.weighFlash > 0,
      seal: st.sealFlash > 0,
      label: st.labelFlash > 0,
      gate: st.gateFlash > 0,
      low: st.supplyLow,
      reg: st.regFlash > 0 || st.braking,
    });
    // Ring buffer: keep the last ~2 minutes (30 000 samples at 4 ms).
    if (db.scopeTrace.length > 33000) db.scopeTrace.splice(0, db.scopeTrace.length - 30000);
  }

  // Network 1b: Draining phase of a graceful stop. The chain is empty
  // and stands still; only the outfeed belt runs, carrying the last
  // cartons to the gate. When the outfeed is empty, the line goes idle.
  if (st.draining) {
    FC_Outfeed(db, db.outSpeed(), dt);
    if (db.outfeed.length === 0) {
      st.running = false;
      st.draining = false;
      st.stopReq = false;
      st.phase = 'process'; // clean boundary for the next Start
      st.procDwell = 0;
      st.procElapsed = 0;
      db.notify();
    }
    return;
  }

  // Network 2: Production order management.
  // Request a graceful stop once the target-th GOOD carton has been
  // discharged (order.made) — the erector gate already prevents starting
  // more cartons than the order needs, so this drains the line exactly
  // onto the target. target = 0 means endless production.
  if (db.order.target > 0 && db.order.made >= db.order.target) {
    st.stopReq = true;
  }

  if (st.phase === 'process') {
    // --- PROCESS: chain stands, stations act in parallel ---

    // Network 3: Cycle start (one-shot when entering the phase).
    if (st.procDwell === 0) {
      // Hopper level sensor read FIRST, like the PLC input image at the
      // start of the cycle — in 'stop' mode it halts the line at this
      // clean boundary (refill and resume, nothing is lost).
      if (db.config.hasHopperSensor) {
        FC_Hopper(db);
        if (!st.running) return;
      }

      // Discharge pusher: transfer the carton at the last slot onto the
      // outfeed belt and write its packing-log entry.
      FC_Discharge(db);

      // Erector: start a new carton (gated by stop request, order
      // fulfilment and hopper affordability).
      FC_Erector(db);

      // Line empty and nothing new started -> drain the outfeed.
      if (db.cartons.length === 0) {
        st.draining = true;
        st.v = 0;
        st.a = 0;
        db.notify();
        return;
      }

      // Dwell = the longest station action of this cycle. Slots without
      // a carton (or without a device) cost nothing.
      st.procDwell = Math.max(0.05, planDwell(db));
      st.procElapsed = 0;
    }

    // Outfeed belt keeps running while the chain stands
    FC_Outfeed(db, db.outSpeed(), dt);

    st.procElapsed += dt;

    // Network 4: Station actions — all in parallel, each fires at its
    // own moment within the dwell. Optional devices are gated HERE.
    FC_Filler(db);
    if (db.config.hasWeigher) FC_Checkweigher(db);
    FC_Sealer(db);
    if (db.config.hasLabeler) FC_Labeler(db);

    // Network 5: Dwell over -> set up the next one-pitch index move.
    if (st.procElapsed >= st.procDwell) {
      st.phase = 'index';
      st.moveStartD = st.D;
      st.mvD = 0;
      st.mvTip = 0;
      st.braking = false;
      st.brakeD = st.D + db.config.pitch;
      // No two moves slip alike: sample this move's slip variance
      // (±20 % around the set diagnostics value, see FC_Indexer).
      st.moveSlipRand = 0.8 + Math.random() * 0.4;
    }
    return;
  }

  // --- INDEX: the servo chain moves one pitch ---

  // Index axis drive (S-curve velocity tracking, 3-phase move)
  FC_Indexer(db, dt);

  // Registration eye: only called if the line has one.
  if (db.config.hasReg) FC_Registration(db);

  // Outfeed belt runs during the index too
  FC_Outfeed(db, db.outSpeed(), dt);

  // Network 6: Registration fallback — overshoot budget exhausted
  // without an eye trip. A genuine fault (recipe.regFaultMode):
  // 'warn' completes the index on the encoder and flags it; 'stop'
  // halts the line, waiting for operator acknowledgement.
  const regActive = db.config.hasReg && db.regSensorPos() > 0;
  if (regActive && !st.braking && st.mvD >= db.config.pitch + db.config.regOver) {
    st.regFault = true;
    if (db.recipe.regFaultMode === 'stop') {
      st.running = false;
      st.v = 0;
      st.a = 0;
      db.notify();
      return;
    }
    // 'warn': force-complete the index where the chain is now.
    st.braking = true;
    st.brakeD = st.D;
    st.v = 0;
    st.a = 0;
  }

  // Network 7: Index complete — chain at standstill on the brake target.
  if (st.D >= st.brakeD - 0.01 && st.v < 1) {
    st.v = 0;
    st.a = 0;
    st.braking = false;
    // Chain drift bookkeeping: how far the PHYSICAL travel of this move
    // missed the ideal pitch. The erector places new cartons at the
    // accumulated drift (carton lugs move rigidly with the chain).
    db.drift += st.mvTip - db.config.pitch;
    for (const c of db.cartons) c.slot++;
    st.phase = 'process';
    st.procDwell = 0;
    st.procElapsed = 0;
  }
}

/**
 * Dwell planning: the stations act in parallel while the chain stands,
 * so the process dwell is the LONGEST action among the stations that
 * actually have a carton in front of them this cycle. Also raises the
 * per-station "acting" flash bits for the HMI/scope.
 */
function planDwell(db: PackagingEngine): number {
  const st = db.state;
  const p = db.params;
  let dwell = 0;

  // Erector dwell only if a carton was actually erected this cycle
  // (FC_Erector raised erectFlash).
  if (st.erectFlash > 0) dwell = Math.max(dwell, p.erectT);

  if (db.cartons.some(c => c.slot === SLOT.FILL)) {
    dwell = Math.max(dwell, db.recipe.fillCount * p.fillT);
  }
  if (db.config.hasWeigher && db.cartons.some(c => c.slot === SLOT.WEIGH)) {
    dwell = Math.max(dwell, p.weighT);
    st.weighFlash = p.weighT;
  }
  if (db.cartons.some(c => c.slot === SLOT.SEAL)) {
    dwell = Math.max(dwell, p.sealT);
    st.sealFlash = p.sealT;
  }
  if (db.config.hasLabeler && db.cartons.some(c => c.slot === SLOT.LABEL)) {
    dwell = Math.max(dwell, p.labelT);
    st.labelFlash = p.labelT;
  }
  return dwell;
}
