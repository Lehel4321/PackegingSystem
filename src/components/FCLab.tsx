import { useState } from 'react';
import { PackagingEngine, SLOT } from '../engine/PackagingEngine';
import { FC_Layout } from '../engine/FC_Layout';
import { FC_Indexer } from '../engine/FC_Indexer';
import { FC_Registration } from '../engine/FC_Registration';
import { FC_Hopper } from '../engine/FC_Hopper';
import { FC_Erector } from '../engine/FC_Erector';
import { FC_Filler } from '../engine/FC_Filler';
import { FC_Checkweigher } from '../engine/FC_Checkweigher';
import { FC_Sealer } from '../engine/FC_Sealer';
import { FC_Labeler } from '../engine/FC_Labeler';
import { FC_Discharge } from '../engine/FC_Discharge';
import { FC_Outfeed } from '../engine/FC_Outfeed';
import { computeMove, stopDistance, stopTime, SHAPE_NAMES } from '../engine/MotionProfile';
import { Carton } from '../types';

/** Blank carton for test setups. */
function carton(slot: number, patch: Partial<Carton> = {}): Carton {
  return {
    id: 1, slot, x: slot * 300, fills: [], weighed: false, weight: null,
    sealed: false, labeled: false, reject: false, reason: '', ...patch,
  };
}

/**
 * FC Lab: run every Function Block in isolation against a fresh data
 * block and inspect its output — the packaging line's test bench.
 */
export function FCLab() {
  const [activeFC, setActiveFC] = useState<string>('FC_Layout');
  const [output, setOutput] = useState<unknown>(null);
  const [dbState, setDbState] = useState<PackagingEngine | null>(null);

  const runLayout = () => {
    const db = new PackagingEngine();
    const result = FC_Layout(db);
    setOutput(result);
    setDbState(db);
  };

  const runMotionProfile = () => {
    const db = new PackagingEngine();
    // Solve the one-pitch index move with the axis motor data — same
    // math as Lehel4321/MotionProfileSolver.
    const mv = computeMove(db.config.pitch, db.cruiseSpeed(), db.config.axAmax, db.config.axJerk);
    setOutput({
      move_s_mm: db.config.pitch,
      motor: { vmax: db.config.axVmax, amax: db.config.axAmax, jerk: db.config.axJerk },
      cruise_mm_s: db.cruiseSpeed(),
      shape: mv ? mv.shape : null,
      shapeName: mv ? SHAPE_NAMES[mv.shape] : 'unsolvable',
      va_mm_s: mv?.va,
      sa_mm: mv?.sa,
      sv_mm: mv?.sv,
      phaseTimes_s: mv?.tp,
      moveTime_s: mv?.tp.t7,
      stopDistFromCruise_mm: stopDistance(db.cruiseSpeed(), db.config.axAmax, db.config.axJerk),
      stopTimeFromCruise_s: stopTime(db.cruiseSpeed(), db.config.axAmax, db.config.axJerk),
    });
    setDbState(db);
  };

  const runIndexer = () => {
    const db = new PackagingEngine();
    db.state.phase = 'index';
    db.state.moveStartD = 0;
    db.state.brakeD = db.config.pitch;
    db.cartons = [carton(2)];

    // Execute 2000 fixed scans of 1 ms = 2.0 s — more than enough for
    // one 300 mm index at 800 mm/s. Registration refreshes brakeD.
    for (let i = 0; i < 2000; i++) {
      FC_Indexer(db, 0.001);
      if (db.config.hasReg) FC_Registration(db);
    }

    setOutput({
      scans: 2000,
      pitch_mm: db.config.pitch,
      end_D_mm: db.state.D,
      end_velocity_mm_s: db.state.v,
      physical_travel_mm: db.state.mvTip,
      carton_x_after: db.cartons[0].x,
      note: 'axis lands on the pitch target along the S-curve; carton rode the chain',
    });
    setDbState(db);
  };

  const runRegistration = () => {
    const db = new PackagingEngine();
    db.params.slipPct = 3; // chain slipping 3 %
    db.state.phase = 'index';
    db.state.moveStartD = 0;
    // Mid-move state: the eye is about to see the lug. Encoder is ahead
    // of the physical chain because of the slip.
    db.state.mvTip = db.regSensorPos() + 0.5;
    db.state.mvD = db.state.mvTip / (1 - 0.03);
    db.state.D = db.state.mvD;
    db.state.v = db.regApproachV();

    FC_Registration(db);
    setOutput({
      eyeTripPoint_mm: db.regSensorPos(),
      stopDistAtApproach_mm: db.regStopDist(),
      // The stop distance follows the REAL S-curve physics — slower
      // approach needs a much shorter distance:
      stopDist_at_100mms: stopDistance(100, db.config.axAmax, db.config.axJerk),
      stopDist_at_500mms: stopDistance(500, db.config.axAmax, db.config.axJerk),
      stopDist_at_1000mms: stopDistance(1000, db.config.axAmax, db.config.axJerk),
      braking: db.state.braking,
      brakeD_corrected: db.state.brakeD,
      slipEstimate_pct: (1 - db.state.mvTip / db.state.mvD) * 100,
      expectedToTrigger: db.state.mvTip >= db.regSensorPos(),
      note: 'brakeD is converted to ENCODER travel with the live slip estimate',
    });
    setDbState(db);
  };

  const runHopper = () => {
    const db = new PackagingEngine();
    db.state.running = true;
    db.hopperRemaining = db.config.hopperLowAt - 1; // below the LOW threshold
    db.params.hopperMode = 'stop';
    FC_Hopper(db);
    const stopMode = { supplyLow: db.state.supplyLow, running: db.state.running };

    const db2 = new PackagingEngine();
    db2.state.running = true;
    db2.hopperRemaining = db2.config.hopperLowAt - 1;
    db2.params.hopperMode = 'runout';
    FC_Hopper(db2);

    setOutput({
      threshold: db.config.hopperLowAt,
      remaining: db.hopperRemaining,
      stopMode,
      runoutMode: { supplyLow: db2.state.supplyLow, running: db2.state.running },
      expected: "'stop' halts the line at the cycle boundary; 'runout' latches LOW and lets the erector gate decide",
    });
    setDbState(db2);
  };

  const runErector = () => {
    const db = new PackagingEngine();
    // Order of 2, 1 already made, 1 good carton still on the chain ->
    // the order is covered, the erector must decline.
    db.order.target = 2;
    db.order.made = 1;
    db.cartons = [carton(3, { sealed: true })];
    const declined = FC_Erector(db);

    // Endless order -> erects.
    const db2 = new PackagingEngine();
    const erected = FC_Erector(db2);

    setOutput({
      orderCovered: { erected: declined, cartonsOnChain: db.cartons.length },
      endless: { erected, newCarton: db2.cartons[0] },
      expected: 'covered order declines (false); endless order erects at slot 0',
    });
    setDbState(db2);
  };

  const runFiller = () => {
    const db = new PackagingEngine();
    db.cartons = [carton(SLOT.FILL)];
    db.nextBadCount = 1; // first drop is a bad product
    // Elapse the whole fill raster: fillCount drops.
    db.state.procElapsed = db.recipe.fillCount * db.params.fillT;
    FC_Filler(db);

    setOutput({
      fillCount: db.recipe.fillCount,
      fillsDropped: db.cartons[0].fills.length,
      fills: db.cartons[0].fills,
      expected: 'all products dropped; the first one flagged bad (injected)',
    });
    setDbState(db);
  };

  const runCheckweigher = () => {
    const db = new PackagingEngine();
    // Carton with one bad (half-weight) product among nominal ones.
    const fills = Array.from({ length: db.recipe.fillCount }, (_, i) => ({
      w: i === 0 ? db.recipe.prodWeight * 0.5 : db.recipe.prodWeight,
      bad: i === 0,
    }));
    db.cartons = [carton(SLOT.WEIGH, { fills })];
    db.state.procElapsed = db.params.weighT;
    FC_Checkweigher(db);

    setOutput({
      grossWeight_g: db.cartons[0].weight,
      netTarget_g: db.recipe.fillCount * db.recipe.prodWeight,
      tolerance_pct: db.recipe.weighTolPct,
      reject: db.cartons[0].reject,
      reason: db.cartons[0].reason,
      expected: 'net weight out of tolerance -> reject "weight"',
    });
    setDbState(db);
  };

  const runSealer = () => {
    const db = new PackagingEngine();
    db.cartons = [carton(SLOT.SEAL), carton(SLOT.SEAL, { id: 2, x: SLOT.SEAL * 300 - 20 })];
    db.cartons.pop(); // test the aligned carton first
    db.state.procElapsed = db.params.sealT;
    FC_Sealer(db);
    const aligned = { sealed: db.cartons[0].sealed, reject: db.cartons[0].reject };

    // Misplaced carton (20 mm off with 12 mm tolerance) -> head stays up.
    const db2 = new PackagingEngine();
    db2.cartons = [carton(SLOT.SEAL, { x: SLOT.SEAL * 300 - 20 })];
    db2.state.procElapsed = db2.params.sealT;
    FC_Sealer(db2);

    setOutput({
      aligned,
      misplaced: { sealed: db2.cartons[0].sealed, reject: db2.cartons[0].reject, reason: db2.cartons[0].reason },
      alignTol_mm: db2.config.alignTol,
      expected: 'aligned carton sealed; carton 20 mm off flagged misplaced, left open',
    });
    setDbState(db2);
  };

  const runLabeler = () => {
    const db = new PackagingEngine();
    db.cartons = [carton(SLOT.LABEL, { sealed: true })];
    db.state.procElapsed = db.params.labelT;
    FC_Labeler(db);

    setOutput({
      labeled: db.cartons[0].labeled,
      labelBand_mm: [db.cartons[0].labelA, db.cartons[0].labelB],
      recipeLabelAt: db.recipe.labelAt,
      labelWidth: db.config.labelLen,
      expected: 'label applied at recipe.labelAt from the carton leading edge',
    });
    setDbState(db);
  };

  const runDischarge = () => {
    const db = new PackagingEngine();
    const fills = Array.from({ length: db.recipe.fillCount }, () => ({ w: db.recipe.prodWeight, bad: false }));
    db.cartons = [carton(SLOT.DISCHARGE, { fills, sealed: true, labeled: true, labelA: 130, labelB: 190, weighed: true })];
    FC_Discharge(db);

    setOutput({
      cartonsLeftOnChain: db.cartons.length,
      outfeed: db.outfeed,
      orderMade: db.order.made,
      logEntry: db.log[0],
      expected: 'carton transferred to the outfeed, order.made = 1, log entry written',
    });
    setDbState(db);
  };

  const runOutfeed = () => {
    const db = new PackagingEngine();
    db.config.outLen = 900;
    // Two cartons close to the gate: one good, one reject.
    db.outfeed = [
      { left: 895, len: 220, reject: false, reason: '', fills: [], sealed: true },
      { left: 890, len: 220, reject: true, reason: 'weight', fills: [], sealed: true },
    ];

    // Run the belt at 1200 mm/s for 100 scans (0.1 s -> 120 mm travel)
    for (let i = 0; i < 100; i++) FC_Outfeed(db, 1200, 0.001);

    setOutput({
      packed: db.state.packed,
      rejects: db.state.rejects,
      cartonsLeftOnBelt: db.outfeed,
      expected: 'both cartons sorted at the gate: packed=1, rejects=1',
    });
    setDbState(db);
  };

  const tabs = [
    { id: 'FC_Layout', name: 'FC10: Layout', fn: runLayout, desc: 'Calculates the slot and outfeed geometry from the machine build.' },
    { id: 'MotionProfile', name: 'FC40: Motion Profile', fn: runMotionProfile, desc: 'S-curve trajectory solver for the index axis (ported from MotionProfileSolver): shape, phase times, stop distance.' },
    { id: 'FC_Indexer', name: 'FC30: Indexer', fn: runIndexer, desc: 'Index axis drive. Runs 2000 fixed 1 ms scans (= 2 s) of a one-pitch move. Only called by OB1 in INDEX phase.' },
    { id: 'FC_Registration', name: 'FC38: Registration', fn: runRegistration, desc: 'Chain photo-eye: corrects the stop target from the real chain position. Only called by OB1 if hasReg = TRUE.' },
    { id: 'FC_Hopper', name: 'FC37: Hopper Sensor', fn: runHopper, desc: 'Product level watchdog: stop at the cycle boundary or graceful run-out. Only called by OB1 if hasHopperSensor = TRUE.' },
    { id: 'FC_Erector', name: 'FC31: Erector', fn: runErector, desc: 'Carton erector + the order/stop/hopper gate. Core device, called at every cycle start.' },
    { id: 'FC_Filler', name: 'FC32: Filler', fn: runFiller, desc: 'Drops products on the fill raster; bad-product injection lands here. Core device.' },
    { id: 'FC_Checkweigher', name: 'FC33: Check-Weigher', fn: runCheckweigher, desc: 'Weighs the carton, net-weight tolerance check. Only called by OB1 if hasWeigher = TRUE.' },
    { id: 'FC_Sealer', name: 'FC34: Sealer', fn: runSealer, desc: 'Seal head with the alignment gate (misplaced cartons stay open). Core device.' },
    { id: 'FC_Labeler', name: 'FC35: Labeler', fn: runLabeler, desc: 'Print & apply head. Only called by OB1 if hasLabeler = TRUE.' },
    { id: 'FC_Discharge', name: 'FC36: Discharge', fn: runDischarge, desc: 'Chain -> outfeed transfer, final checks, packing-log entry. Core device.' },
    { id: 'FC_Outfeed', name: 'FC39: Outfeed', fn: runOutfeed, desc: 'Outfeed belt motion + reject gate sorting (good bin / reject bin).' },
  ];

  const activeTabObj = tabs.find(t => t.id === activeFC);

  return (
    <div className="flex gap-6 h-[calc(100vh-150px)]">
      {/* Sidebar */}
      <div className="w-64 bg-[#0d1420] border border-[#1c2736] rounded-xl flex flex-col overflow-hidden flex-shrink-0">
        <div className="bg-[#1c2736] px-4 py-2 font-bold text-xs uppercase tracking-wider text-slate-300">
          Function Blocks (FC)
        </div>
        <div className="flex flex-col p-2 gap-1 overflow-y-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => { setActiveFC(t.id); setOutput(null); setDbState(null); }}
              className={`text-left px-3 py-2 rounded text-sm font-mono transition-colors cursor-pointer ${activeFC === t.id ? 'bg-[#26344a] text-white' : 'text-slate-400 hover:bg-[#1c2736] hover:text-slate-200'}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-4 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold text-white mb-1 font-mono">{activeTabObj?.name}</h2>
            <p className="text-sm text-slate-400">{activeTabObj?.desc}</p>
          </div>
          <button
            onClick={activeTabObj?.fn}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-6 rounded uppercase tracking-wider text-sm transition-colors cursor-pointer"
          >
            Run FC Test
          </button>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
          <div className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-4 flex flex-col overflow-hidden">
            <h3 className="text-xs uppercase font-bold text-slate-500 mb-2">FC Output Data</h3>
            <div className="flex-1 overflow-auto bg-[#0b1017] rounded p-3 border border-[#1c2736]">
              {output ? (
                <pre className="text-xs font-mono text-emerald-400 whitespace-pre-wrap">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <div className="text-slate-600 text-sm italic">Click "Run FC Test" to generate output…</div>
              )}
            </div>
          </div>

          <div className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-4 flex flex-col overflow-hidden">
            <h3 className="text-xs uppercase font-bold text-slate-500 mb-2">Global Data Block (DB) State</h3>
            <div className="flex-1 overflow-auto bg-[#0b1017] rounded p-3 border border-[#1c2736]">
              {dbState ? (
                <pre className="text-xs font-mono text-sky-400 whitespace-pre-wrap">
                  {JSON.stringify({
                    state: dbState.state,
                    recipe: dbState.recipe,
                    params: dbState.params,
                    config: dbState.config,
                    cartons: dbState.cartons,
                    outfeed: dbState.outfeed,
                  }, null, 2)}
                </pre>
              ) : (
                <div className="text-slate-600 text-sm italic">DB state will appear here…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
