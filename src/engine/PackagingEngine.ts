import { Recipe, ProcessParams, MachineConfig, Order, Carton, OutCarton, LogEntry, MachineState } from '../types';
import { OB1_CyclicScan } from './OB1_Main';
import { stopDistance, computeMove, movePeakV, rampDistance } from './MotionProfile';
import { FC_Layout } from './FC_Layout';

/**
 * Fixed PLC scan time in seconds (1 ms).
 * OB1 is always executed with exactly this dt — never with the raw
 * frame time. This makes the simulation deterministic (same behavior
 * on a 60 Hz and a 144 Hz monitor).
 */
export const SCAN_TIME = 0.001;

/**
 * Unit conversion for the operator-facing chain speed.
 * The engine works internally in mm/s (millimetre geometry), but the
 * operator thinks in m/min. 60 m/min = 1000 mm/s.
 */
export const MM_S_PER_M_MIN = 1000 / 60;
export const toMMin = (mmPerSec: number) => mmPerSec / MM_S_PER_M_MIN;
export const toMmSec = (mPerMin: number) => mPerMin * MM_S_PER_M_MIN;

/** Hard cap on the registration approach speed: 60 m/min = 1000 mm/s. */
export const REG_APPROACH_CAP = 1000;

/**
 * The six pitch slots of the line, in chain order. Erector, filler,
 * sealer and the discharge pusher are core devices; the check-weigher,
 * labeler, hopper sensor and registration eye are optional.
 */
export const SLOT = { ERECT: 0, FILL: 1, WEIGH: 2, SEAL: 3, LABEL: 4, DISCHARGE: 5 } as const;
export const NUM_SLOTS = 6;

/** HMI identity of each station slot (canvas boxes, scope tracks, log). */
export const STATION_META = [
  { key: 'erect', name: 'ERECT', line: '#38bdf8', dim: '#075985' },
  { key: 'fill', name: 'FILL', line: '#f59e0b', dim: '#92400e' },
  { key: 'weigh', name: 'WEIGH', line: '#a78bfa', dim: '#5b21b6' },
  { key: 'seal', name: 'SEAL', line: '#10b981', dim: '#065f46' },
  { key: 'label', name: 'LABEL', line: '#f472b6', dim: '#9d174d' },
  { key: 'out', name: 'DISCHARGE', line: '#94a3b8', dim: '#475569' },
];

/** localStorage key for the recipe manager (browser only) */
const RECIPE_STORE_KEY = 'packagingsystem.recipes';

/**
 * DB1: Global Machine Data Block (and HMI Bridge)
 *
 * This class serves two purposes:
 * 1. For the "PLC" (backend logic): it is the Global Data Block holding
 *    all persistent configuration, tags and tracking arrays. `this` is
 *    passed to the Function Blocks (FCs) and to OB1.
 * 2. For the HMI (React frontend): it exposes an object-oriented API to
 *    subscribe to changes and trigger HMI button commands.
 *
 * The configuration is split into THREE levels (like on a real machine):
 *
 * | Block  | Contains                     | Who changes it   | When            |
 * |--------|------------------------------|------------------|-----------------|
 * | recipe | article/pack data            | operator         | machine stopped |
 * | params | process tuning (dwells etc.) | operator         | any time        |
 * | config | physical build (pitch,       | commissioning /  | control OFF     |
 * |        | which stations exist)        | maintenance only |                 |
 */
export class PackagingEngine {
  // --- Data Block: RECIPE (article data, operator, per product) ---
  public recipe: Recipe = {
    name: 'DEFAULT', fillCount: 6, spd: 800,
    prodWeight: 125, tare: 45, cartonLen: 220,
    labelAt: 130, weighTolPct: 4, regFaultMode: 'warn',
  }; // spd 800 mm/s = 48 m/min

  // --- Data Block: PROCESS PARAMETERS (operator tuning) ---
  public params: ProcessParams = {
    erectT: 0.4, fillT: 0.25, weighT: 0.5, sealT: 0.6, labelT: 0.4,
    outFac: 1.5, slipPct: 0, badWeightPct: 50, hopperMode: 'runout',
  };

  // --- Data Block: MACHINE BUILD (physical configuration, fixed) ---
  public config: MachineConfig = {
    pitch: 300, outLen: 900, labelLen: 60, alignTol: 12,
    hasWeigher: true, hasLabeler: true,
    hasHopperSensor: true, hopperLowAt: 24,
    hasReg: true, regConst: 2, regOver: 20, regApproachSpeed: 500,
    axVmax: 2000, axAmax: 20000, axJerk: 200000, // index axis servo data
  };

  // --- Data Block: MATERIAL (product supply) ---
  /** Products left in the hopper. Infinity = endless supply. */
  public hopperRemaining = Infinity;
  /** Queued bad products (operator test): the next N drops are bad. */
  public nextBadCount = 0;
  /**
   * Accumulated chain drift: physical travel minus the ideal
   * (index count × pitch). The erector places new cartons at this
   * offset — the whole chain (lugs + cartons) shifts as one rigid body.
   * With the registration eye active it stays near zero; without it,
   * chain slip makes it grow every index.
   */
  public drift = 0;

  // --- Data Block: PRODUCTION ORDER (job quantity + counter) ---
  public order: Order = { target: 0, done: 0, made: 0 };

  // --- Data Block: Runtime State Tags ---
  // Power-up condition: current is on, but machine control is OFF.
  public state: MachineState = {
    controlOn: false, estop: false, needsReset: false, supplyLow: false,
    running: false, phase: 'process', simTime: 0,
    D: 0, v: 0, a: 0, tip: 0, mvD: 0, mvTip: 0, moveStartD: 0, moveSlipRand: 1,
    braking: false, brakeD: 0, regFault: false,
    procElapsed: 0, procDwell: 0,
    count: 0, packed: 0, rejects: 0, beltScroll: 0,
    erectFlash: 0, fillFlash: 0, weighFlash: 0, sealFlash: 0,
    labelFlash: 0, regFlash: 0, gateFlash: 0,
    stopReq: false, draining: false,
  };

  // --- Data Block: Tracking Arrays ---
  public cartons: Carton[] = [];   // on the indexing chain
  public outfeed: OutCarton[] = []; // on the outfeed belt
  public log: LogEntry[] = [];
  public cartonSeq = 0;

  // --- HMI Event System (not PLC logic) ---
  private listeners: Set<() => void> = new Set();

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify() {
    this.listeners.forEach(l => l());
  }

  // --- Machine Properties ---

  /**
   * Estimated cycle time: index move from the real S-curve profile
   * (accel + cruise + brake over one pitch) plus the longest station
   * dwell — the stations all act in parallel while the chain stands.
   */
  public get cycle() {
    const mv = computeMove(this.config.pitch, this.cruiseSpeed(), this.config.axAmax, this.config.axJerk);
    const move = mv ? mv.tp.t7 : this.config.pitch / this.recipe.spd;
    let dwell = this.params.erectT;
    dwell = Math.max(dwell, this.recipe.fillCount * this.params.fillT);
    if (this.config.hasWeigher) dwell = Math.max(dwell, this.params.weighT);
    dwell = Math.max(dwell, this.params.sealT);
    if (this.config.hasLabeler) dwell = Math.max(dwell, this.params.labelT);
    return move + dwell;
  }

  public layout(w: number = 1100, h: number = 360) {
    return FC_Layout(this, w, h);
  }

  /** Outfeed belt speed (mm/s). */
  public outSpeed() { return this.recipe.spd * this.params.outFac; }

  /**
   * Travel position of the reject pusher on the outfeed (mm from the
   * discharge point). Sits before the belt end: rejects are pushed
   * sideways onto the reject lane here, good cartons continue straight
   * into the good bin at the end — like on a real line.
   */
  public rejectGatePos() { return Math.max(60, this.config.outLen - 200); }

  /** Nominal gross carton weight for the current recipe (g). */
  public targetWeight() { return this.recipe.tare + this.recipe.fillCount * this.recipe.prodWeight; }

  /** Good cartons still travelling on the chain (committed to the order). */
  public goodInFlight() { return this.cartons.filter(c => !c.reject).length; }

  // --- Index Axis (servo motor model) + Registration System ---

  /** Cruise speed of the index move: recipe speed, capped at the axis Vmax. */
  public cruiseSpeed() { return Math.min(this.recipe.spd, this.config.axVmax); }

  /**
   * PEAK velocity the chain ACTUALLY reaches on a one-pitch index
   * before any registration slow-down, from the motion profile. On a
   * short pitch the chain never reaches the commanded speed — the
   * profile classifies the move (shapes 2/4/6) and gives the true peak.
   */
  public regPeakV() { return movePeakV(this.config.pitch, this.cruiseSpeed(), this.config.axAmax, this.config.axJerk); }

  /**
   * Registration approach/creep speed: the chain must be down to this
   * speed by the time it reaches the eye, never faster than
   * config.regApproachSpeed (hard-capped at 60 m/min) and never faster
   * than the move peak itself (a slow recipe needs no slow-down).
   */
  public regApproachV() { return Math.min(this.config.regApproachSpeed, this.regPeakV()); }

  /**
   * Chain stop distance from the approach speed — jerk-limited S-curve
   * braking physics. Small and roughly constant because the approach
   * speed is capped, regardless of how fast production runs.
   */
  public regStopDist() { return stopDistance(this.regApproachV(), this.config.axAmax, this.config.axJerk); }

  /**
   * Reaction reserve: the PLC sees the eye input only at the next scan,
   * so the chain travels up to (speed × scan time) further before
   * braking can even start. The eye is placed that much earlier — a
   * fixed part of the position calculation, like on a commissioning
   * sheet.
   */
  public regReactDist() { return this.regApproachV() * SCAN_TIME; }

  /**
   * Auto-calculated registration eye trip point (mm of PHYSICAL chain
   * travel into the move): pitch − stop distance − reaction reserve −
   * correction constant. Recalculated from the axis data whenever the
   * recipe or build changes.
   */
  public regSensorPos() { return this.config.pitch - this.regStopDist() - this.regReactDist() - this.config.regConst; }

  /**
   * Distance needed to ramp DOWN from the move peak to the approach
   * speed (0 if the move never gets faster than the cap — no slow-down
   * phase needed).
   */
  public regRampDist() { return rampDistance(this.regPeakV(), this.regApproachV(), this.config.axAmax, this.config.axJerk); }

  /**
   * Approximate travel (mm into the move) where the chain starts
   * ramping down to the approach speed, ASSUMING it sits exactly at the
   * move peak with zero acceleration. For display only — FC_Indexer
   * decides the real moment reactively (commitRampDist from the actual
   * current v/a).
   */
  public regDecelStart() { return this.regSensorPos() - this.regRampDist(); }

  // --- Scan Cycle Accumulator (real time -> fixed 1 ms scans) ---
  private scanAcc = 0;

  // --- HMI Commands to PLC ---

  /**
   * Called once per animation frame with the REAL elapsed time.
   * Converts the variable frame time into N fixed 1 ms OB1 scans
   * (fixed-timestep accumulator).
   */
  public update(dtReal: number) {
    // Watchdog: cap real elapsed time (inactive browser tab, lag spike)
    if (dtReal > 0.05) dtReal = 0.05;

    this.scanAcc += dtReal;
    while (this.scanAcc >= SCAN_TIME) {
      OB1_CyclicScan(this, SCAN_TIME);
      this.scanAcc -= SCAN_TIME;
    }
  }

  /**
   * Illuminated push button: "Control ON".
   * Performs the safety check and enables the machine control.
   * Interlock: refused while the E-Stop button is still latched.
   * If the last E-Stop interrupted a running production (needsReset),
   * the line is cleared here — production starts over from zero.
   */
  public setControlOn() {
    if (this.state.estop) return;      // E-Stop still latched -> refuse
    if (this.state.controlOn) return;  // already on -> no action

    // Interrupted production cannot be resumed: clear the line
    if (this.state.needsReset) {
      this.clearLine();
      this.state.needsReset = false;
    }

    this.state.controlOn = true;
    this.notify();
  }

  public setControlOff() {
    if (!this.state.controlOn) return;
    if (this.state.running) this.state.needsReset = true;
    this.state.controlOn = false;
    this.state.running = false;
    this.state.stopReq = false;
    this.state.draining = false;
    this.state.v = 0;
    this.state.a = 0;
    this.notify();
  }

  /**
   * E-Stop button PRESSED (latches mechanically).
   * Kills the machine control immediately. If production was running,
   * it is marked as non-resumable (start over after the next
   * Control-ON — the cartons caught mid-line are lost).
   */
  public pressEStop() {
    if (this.state.estop) return; // already latched
    if (this.state.running) this.state.needsReset = true;
    this.state.estop = true;
    this.state.controlOn = false; // control voltage drops instantly
    this.state.running = false;
    this.state.stopReq = false;
    this.state.draining = false;
    this.state.v = 0; // drive power gone -> axis halts
    this.state.a = 0;
    this.notify();
  }

  /**
   * E-Stop button RELEASED (twisted out).
   * The control stays OFF — the operator must press Control-ON again.
   */
  public releaseEStop() {
    if (!this.state.estop) return;
    this.state.estop = false;
    this.notify();
  }

  /**
   * START / STOP.
   * START interlocks: machine control ON, no unacknowledged
   * registration fault, and the hopper must be able to fill at least
   * one carton. setRun(false) is a HARD stop (drive off immediately) —
   * used internally and by tests. The operator's Stop button uses
   * requestStop() instead, which runs the line empty first.
   */
  public setRun(on: boolean) {
    if (on && !this.state.controlOn) return;   // interlock: no control, no start
    if (on && this.state.regFault) return;     // interlock: fault must be acknowledged
    if (on && this.state.supplyLow && this.hopperRemaining < this.recipe.fillCount) return; // interlock: refill hopper
    this.state.running = on;
    if (on) { this.state.stopReq = false; this.state.draining = false; }
    if (!on) { this.state.v = 0; this.state.a = 0; this.state.stopReq = false; this.state.draining = false; }
    this.notify();
  }

  /**
   * Operator Stop button: a graceful (cycle) stop. The line does NOT
   * halt where it is — the erector stops starting new cartons, every
   * carton in flight is finished through discharge, the outfeed runs
   * empty, and only then does the line go idle. For an instant halt the
   * operator uses the E-Stop.
   */
  public requestStop() {
    if (!this.state.running) return;
    this.state.stopReq = true;
    this.notify();
  }

  /**
   * Operator acknowledgement of a registration fault ('stop' fault
   * mode): the eye never confirmed the carton arrival within the
   * allowed travel and the line halted. Clears the fault so Start is
   * unlocked again; maintenance should check the chain first.
   */
  public clearRegFault() {
    this.state.regFault = false;
    this.notify();
  }

  /**
   * Clear the line after an E-Stop interruption: cartons on the chain
   * and outfeed, axis position and dwell timers are reset. Shift
   * counters and the packing log are KEPT (a real machine does not
   * forget its shift statistics on an E-Stop).
   */
  private clearLine() {
    this.cartons = [];
    this.outfeed = [];
    this.state.phase = 'process';
    this.state.D = 0;
    this.state.v = 0;
    this.state.a = 0;
    this.state.tip = 0;
    this.state.mvD = 0;
    this.state.mvTip = 0;
    this.state.moveStartD = 0;
    this.state.moveSlipRand = 1;
    this.drift = 0;
    this.state.braking = false;
    this.state.brakeD = 0;
    this.state.regFault = false;
    this.state.procElapsed = 0;
    this.state.procDwell = 0;
    this.state.stopReq = false;
    this.state.draining = false;
    this.state.erectFlash = 0; this.state.fillFlash = 0; this.state.weighFlash = 0;
    this.state.sealFlash = 0; this.state.labelFlash = 0; this.state.regFlash = 0;
    this.scanAcc = 0;
  }

  /** Master reset: line, counters, log, order count and hopper. */
  public reset() {
    this.state.running = false;
    this.state.needsReset = false;
    this.clearLine();
    this.state.count = 0;
    this.state.packed = 0;
    this.state.rejects = 0;
    this.state.gateFlash = 0;
    this.order.done = 0;
    this.order.made = 0;
    this.log = [];
    this.cartonSeq = 0;
    this.state.simTime = 0;
    this.hopperRemaining = Infinity;
    this.state.supplyLow = false;
    this.nextBadCount = 0;
    this.notify();
  }

  /**
   * Operator test function: queue a bad product (wrong weight, set by
   * params.badWeightPct). The next product the filler drops is bad.
   * Device gating: only a machine WITH a check-weigher can catch it —
   * without one the line is blind and the carton reaches the good bin.
   */
  public injectBadProduct() {
    this.nextBadCount++;
    this.notify();
  }

  // --- MATERIAL: hopper supply simulation ---

  /**
   * Operator test function: cut the product supply down to a small
   * rest, like the hopper running empty. The level sensor (if built in)
   * reacts once the rest crosses its LOW threshold.
   */
  public endSupply() {
    if (this.hopperRemaining !== Infinity) return; // already finite
    this.hopperRemaining = this.config.hopperLowAt + this.recipe.fillCount * 2;
    this.notify();
  }

  /** Refill the hopper: supply endless again, LOW latch cleared. */
  public refillHopper() {
    this.hopperRemaining = Infinity;
    this.state.supplyLow = false;
    this.notify();
  }

  // --- PRODUCTION ORDER: quantity setpoint + counter ---

  /**
   * Set the order quantity (pack N good cartons, then auto-stop).
   * 0 = endless production. Changeable any time.
   */
  public setOrderTarget(n: number) {
    this.order.target = Math.max(0, Math.floor(n || 0));
    this.notify();
  }

  /** Counter reset button: starts a new order count from zero. */
  public resetOrderCounter() {
    this.order.done = 0;
    this.order.made = 0;
    this.notify();
  }

  // --- RECIPE: article data (operator, only while machine is stopped) ---

  /**
   * Change recipe values. INTERLOCK: refused while the machine is
   * running — the article cannot change mid-production. Invalid numeric
   * input KEEPS the previous value (a half-typed field must never snap
   * to an unrelated default).
   */
  public updateRecipe(updates: Partial<Recipe>): boolean {
    if (this.state.running) return false; // interlock: stop machine first
    const prev = this.recipe;
    const num = (v: number | undefined, fallback: number, min: number, max = Infinity) =>
      Number.isFinite(v) && (v as number) > 0 ? Math.min(max, Math.max(min, v as number)) : fallback;
    this.recipe = { ...prev, ...updates };
    this.recipe.name = (this.recipe.name || 'DEFAULT').toUpperCase().slice(0, 24);
    this.recipe.fillCount = Math.round(num(this.recipe.fillCount, prev.fillCount, 1, 12));
    this.recipe.spd = num(this.recipe.spd, prev.spd, 10);
    this.recipe.prodWeight = num(this.recipe.prodWeight, prev.prodWeight, 1);
    this.recipe.tare = Number.isFinite(this.recipe.tare) && this.recipe.tare >= 0 ? this.recipe.tare : prev.tare;
    this.recipe.cartonLen = num(this.recipe.cartonLen, prev.cartonLen, 40, Math.max(40, this.config.pitch - 40));
    this.recipe.weighTolPct = num(this.recipe.weighTolPct, prev.weighTolPct, 0.5, 50);
    const labelHi = Math.max(0, this.recipe.cartonLen - this.config.labelLen);
    const rawLabel = Number.isFinite(this.recipe.labelAt) && this.recipe.labelAt >= 0 ? this.recipe.labelAt : prev.labelAt;
    this.recipe.labelAt = Math.min(labelHi, Math.max(0, rawLabel));
    if (this.recipe.regFaultMode !== 'warn' && this.recipe.regFaultMode !== 'stop') this.recipe.regFaultMode = 'warn';
    this.notify();
    return true;
  }

  // --- PROCESS PARAMETERS: operator tuning (any time) ---

  public updateParams(updates: Partial<ProcessParams>) {
    this.params = { ...this.params, ...updates };
    const p = this.params;
    p.erectT = Math.max(0.05, p.erectT || 0.4);
    p.fillT = Math.max(0.05, p.fillT || 0.25);
    p.weighT = Math.max(0.05, p.weighT || 0.5);
    p.sealT = Math.max(0.05, p.sealT || 0.6);
    p.labelT = Math.max(0.05, p.labelT || 0.4);
    p.outFac = Math.max(1, p.outFac || 1.5);
    p.slipPct = Math.min(10, Math.max(0, Number.isFinite(p.slipPct) ? p.slipPct : 0));
    p.badWeightPct = Math.min(200, Math.max(10, p.badWeightPct || 50));
    if (p.hopperMode !== 'stop' && p.hopperMode !== 'runout') p.hopperMode = 'runout';
    this.notify();
  }

  // --- MACHINE BUILD: physical configuration (commissioning only) ---

  /**
   * Change the physical machine build (pitch, installed devices, motor
   * data). INTERLOCK: refused while the machine control is ON. You do
   * not unbolt a station on a live line — turn the control off first
   * (commissioning mode).
   */
  public updateConfig(updates: Partial<MachineConfig>): boolean {
    if (this.state.controlOn) return false; // interlock: control off first
    this.config = { ...this.config, ...updates };
    const c = this.config;
    c.pitch = Math.max(100, c.pitch || 300);
    c.outLen = Math.max(100, c.outLen || 900);
    c.labelLen = Math.max(10, c.labelLen || 60);
    c.alignTol = Math.max(2, c.alignTol || 12);
    c.hopperLowAt = Math.max(1, Math.round(c.hopperLowAt || 24));
    c.regConst = Math.max(0, Number.isFinite(c.regConst) ? c.regConst : 2);
    c.regOver = Math.max(5, Number.isFinite(c.regOver) ? c.regOver : 20);
    c.regApproachSpeed = Math.min(REG_APPROACH_CAP,
      Math.max(25, Number.isFinite(c.regApproachSpeed) ? c.regApproachSpeed : 500));
    c.axVmax = Math.max(50, c.axVmax || 2000);
    c.axAmax = Math.max(500, c.axAmax || 20000);
    c.axJerk = Math.max(5000, c.axJerk || 200000);
    // carton/label clamps may have changed with the pitch or label width
    this.updateRecipeClampOnly();
    this.notify();
    return true;
  }

  /** Re-clamp the recipe against the (changed) build without touching values otherwise. */
  private updateRecipeClampOnly() {
    this.recipe.cartonLen = Math.min(Math.max(40, this.config.pitch - 40), this.recipe.cartonLen);
    this.recipe.labelAt = Math.min(Math.max(0, this.recipe.cartonLen - this.config.labelLen), Math.max(0, this.recipe.labelAt));
  }

  // --- RECIPE MANAGER: save / load named recipes (persisted) ---

  private readRecipeStore(): Record<string, Recipe> {
    if (typeof localStorage === 'undefined') return this.memoryStore;
    try {
      return JSON.parse(localStorage.getItem(RECIPE_STORE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private writeRecipeStore(store: Record<string, Recipe>) {
    this.memoryStore = store;
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RECIPE_STORE_KEY, JSON.stringify(store));
  }

  // Fallback store for non-browser environments (tests)
  private memoryStore: Record<string, Recipe> = {};

  /** Names of all saved recipes (sorted). */
  public getRecipeNames(): string[] {
    return Object.keys(this.readRecipeStore()).sort();
  }

  /** Save the current recipe under its name. Overwrites existing. */
  public saveRecipe() {
    const store = this.readRecipeStore();
    store[this.recipe.name] = { ...this.recipe };
    this.writeRecipeStore(store);
    this.notify();
  }

  /**
   * Load a saved recipe by name.
   * INTERLOCK: like updateRecipe, refused while running.
   */
  public loadRecipe(name: string): boolean {
    if (this.state.running) return false;
    const store = this.readRecipeStore();
    const rec = store[name];
    if (!rec) return false;
    return this.updateRecipe({ ...rec });
  }

  /** Delete a saved recipe by name. */
  public deleteRecipe(name: string) {
    const store = this.readRecipeStore();
    delete store[name];
    this.writeRecipeStore(store);
    this.notify();
  }
}

export const engine = new PackagingEngine();
