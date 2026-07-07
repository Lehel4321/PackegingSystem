/**
 * RECIPE — product data (DB "Recipe").
 * Everything that describes THE PRODUCT/PACK being produced: which
 * carton, how many products go in, how fast the line indexes, where the
 * label sits. The operator loads a recipe per article. Recipes can be
 * saved/loaded by name (recipe manager). Only changeable while the
 * machine is STOPPED.
 */
export interface Recipe {
  name: string;
  fillCount: number;   // products per carton
  spd: number;         // index (conveyor) speed for this article (mm/s)
  prodWeight: number;  // nominal single-product weight (g)
  tare: number;        // empty carton weight (g)
  cartonLen: number;   // carton length along the line (mm), must fit the pitch
  labelAt: number;     // label position (mm from the carton leading edge)
  weighTolPct: number; // check-weigher tolerance on the NET weight (± %)
  /**
   * What to do if the registration photo-eye never confirms the carton
   * arrival within the allowed travel (pitch + config.regOver):
   * 'warn' = finish the index on the encoder, flag a warning and keep
   *          packing (maintenance reviews later).
   * 'stop' = halt the line immediately — a real fault, needs operator
   *          acknowledgement before restart.
   */
  regFaultMode: 'warn' | 'stop';
}

/**
 * PROCESS PARAMETERS — operator-adjustable tuning (DB "Tuning").
 * Values the operator/supervisor may tune at the HMI. They belong to
 * the process, not to a specific article and not to the machine build.
 */
export interface ProcessParams {
  erectT: number;   // carton erector dwell (s)
  fillT: number;    // filler dwell PER PRODUCT dropped (s)
  weighT: number;   // check-weigher settle time (s)
  sealT: number;    // seal head dwell (s)
  labelT: number;   // labeler dwell (s)
  outFac: number;   // outfeed belt speed gain (× index speed)
  /**
   * DIAGNOSTICS ONLY — not a real machine parameter. Simulates chain
   * stretch / drive slip on the indexing conveyor (physical advance <
   * encoder D) so the registration system's correction can be
   * demonstrated/tested. 0 = no slip (encoder is perfectly accurate).
   */
  slipPct: number;
  /** Weight of an injected bad product as a % of nominal (test function). */
  badWeightPct: number;
  /**
   * Reaction when the hopper level sensor reports LOW:
   * 'stop'   = finish the cycle in progress, then stop (refill & resume)
   * 'runout' = keep packing every carton that can still be filled
   *            completely; never start a carton the hopper can't fill
   */
  hopperMode: 'stop' | 'runout';
}

/**
 * MACHINE BUILD — physical configuration (DB "MachineData").
 * What the line physically IS: which stations are built in, the chain
 * pitch, the servo motor data. Set at commissioning — NOT operator
 * accessible. Only changeable while the machine control is OFF.
 *
 * The line has SIX fixed pitch slots:
 *   0 ERECT · 1 FILL · 2 WEIGH · 3 SEAL · 4 LABEL · 5 DISCHARGE
 * Erector, filler, sealer and discharge pusher are core devices.
 * Check-weigher, labeler, hopper sensor and registration eye are
 * optional — a slot without its device just passes the carton through.
 */
export interface MachineConfig {
  pitch: number;       // slot-to-slot distance of the indexing chain (mm)
  outLen: number;      // outfeed belt length after the discharge pusher (mm)
  labelLen: number;    // label width along the carton (mm)
  /**
   * Maximum carton offset from its slot center (mm) at which the
   * stations can still work the carton. A carton landing further off
   * (registration off/faulted + chain slip) is flagged 'misplaced'.
   */
  alignTol: number;
  hasWeigher: boolean;      // check-weigher built into slot 2
  hasLabeler: boolean;      // labeler built into slot 4
  hasHopperSensor: boolean; // hopper low-level sensor built in
  hopperLowAt: number;      // sensor threshold: products remaining at LOW
  hasReg: boolean;          // registration photo-eye on the chain
  /**
   * INDEX AXIS MOTOR DATA (servo drive limits of the indexing chain).
   * The chain moves like a real motor: it accelerates and brakes along
   * a jerk-limited S-curve (MotionProfile.ts) instead of jumping
   * between speeds. The registration eye position is derived from these
   * values: braking distance = stopDistance(approach speed).
   */
  axVmax: number; // index axis maximum velocity (mm/s) — recipe speed is capped here
  axAmax: number; // index axis maximum acceleration (mm/s²)
  axJerk: number; // index axis maximum jerk (mm/s³)
  /**
   * Correction constant (mm) added to the registration stop distance to
   * reserve margin for other factors (eye response, valve delay, etc.).
   */
  regConst: number;
  /**
   * Index overshoot budget (mm) beyond the nominal pitch. The chain may
   * run this far past the encoder-nominal index target before the move
   * is force-completed as a fallback — so slip can never stretch an
   * index forever if the registration eye fails to trip.
   */
  regOver: number;
  /**
   * Registration approach/creep speed cap (mm/s). Before the eye, the
   * chain must ramp down to at most this speed — the final
   * stop-from-eye distance is then short and consistent regardless of
   * production speed, which is what makes the eye an actual POSITION
   * MEASUREMENT rather than a rough stop from whatever speed the chain
   * happened to be going.
   */
  regApproachSpeed: number;
}

/**
 * PRODUCTION ORDER / JOB — how many cartons to pack NOW.
 * Deliberately NOT part of the recipe: the same article can be ordered
 * in any quantity. Lives on the main screen next to the counter.
 */
export interface Order {
  target: number; // pack this many GOOD cartons, then stop. 0 = endless
  done: number;   // good cartons that have reached the good bin
  /**
   * Good cartons already DISCHARGED for this order (committed), whether
   * or not they have reached the bin yet. The erector gate uses this
   * plus the good cartons still on the chain, so the line never starts
   * more cartons than the order needs.
   */
  made: number;
}

/** One product sitting inside a carton. */
export interface ProductFill {
  w: number;    // actual weight (g)
  bad: boolean; // injected bad product (wrong weight)
}

/**
 * A carton travelling on the indexing chain. `slot` is its logical
 * pitch position (0 = erector), incremented on every completed index.
 * `x` is its PHYSICAL position along the line in mm — with chain slip
 * it can lag the ideal slot center, which is exactly what the
 * registration eye corrects and the alignment check watches.
 */
export interface Carton {
  id: number;
  slot: number;
  x: number;              // physical center position (mm, slot n center = n · pitch)
  fills: ProductFill[];   // products dropped in so far
  weighed: boolean;
  weight: number | null;  // gross weight the check-weigher saw (g)
  sealed: boolean;
  labeled: boolean;
  labelA?: number;        // applied label band on the carton (mm from leading edge)
  labelB?: number;
  reject: boolean;
  reason: string;
}

/** A finished carton on the outfeed belt, heading for the gate. */
export interface OutCarton {
  left: number;  // leading-edge distance travelled on the outfeed (mm)
  len: number;
  reject: boolean;
  reason: string;
  fills: ProductFill[];
  labelA?: number;
  labelB?: number;
  sealed: boolean;
}

/** One row of the packing history. */
export interface LogEntry {
  n: number;
  products: number;     // products in the carton
  weight: number;       // true gross weight (g) — logged even on a blind machine
  targetW: number;      // nominal gross weight for the recipe (g)
  weighed: boolean;     // did a check-weigher actually verify it?
  reject: boolean;
  reason: string;
  labeled: boolean;
  labelA?: number;
  labelB?: number;
  fillsBad: boolean[];  // per-product bad flags for the row visual
  t: number;
  cyc: number;
  recipe?: { name: string; fillCount: number; cartonLen: number; labelAt: number };
}

export interface MachineState {
  /**
   * Machine control enabled (control voltage on). FALSE after power-up
   * and after every E-Stop. Turned on with the illuminated push button
   * (safety check must pass first). No actuator moves while FALSE.
   */
  controlOn: boolean;
  /** E-Stop button is latched (pressed). Release before Control-ON. */
  estop: boolean;
  /**
   * E-Stop tripped while production was running. The interrupted run
   * cannot be resumed: the next Control-ON clears the line (cartons on
   * the chain are lost) so production starts over cleanly.
   */
  needsReset: boolean;
  /**
   * Hopper level sensor latched LOW. In 'stop' mode START is
   * interlocked once the hopper can't fill a carton — refill first.
   */
  supplyLow: boolean;
  running: boolean;
  /**
   * 'index'   = the chain is moving one pitch (servo S-curve move)
   * 'process' = the chain stands still, stations act on their cartons
   */
  phase: 'index' | 'process';
  simTime: number;

  // --- index axis (servo) ---
  D: number;    // encoder travel (mm, total)
  v: number;    // actual velocity (mm/s) — follows the jerk-limited S-curve
  a: number;    // actual acceleration (mm/s²)
  tip: number;  // PHYSICAL chain travel (mm, total) — lags D under slip
  mvD: number;   // encoder travel of the move in progress
  mvTip: number; // physical travel of the move in progress
  moveStartD: number;
  /** TRUE while ramping down after the registration eye tripped. */
  braking: boolean;
  /** Encoder position at which the chain reaches standstill. */
  brakeD: number;
  /**
   * TRUE when the registration eye failed to trip within the allowed
   * travel (pitch + regOver). In 'stop' fault mode the line is halted,
   * waiting for the operator to acknowledge before restart.
   */
  regFault: boolean;

  // --- process phase ---
  procElapsed: number; // time into the current process dwell (s)
  procDwell: number;   // total dwell of the current process phase (s)

  // --- counters ---
  count: number;   // cartons discharged (total, good + reject)
  packed: number;  // good cartons in the good bin
  rejects: number; // cartons kicked out at the gate
  beltScroll: number;

  // --- HMI flash timers (digital outputs for the scope) ---
  erectFlash: number;
  fillFlash: number;
  weighFlash: number;
  sealFlash: number;
  labelFlash: number;
  regFlash: number;
  gateFlash: number;

  /**
   * A graceful stop has been requested (Stop button, order complete, or
   * hopper run-out). The erector stops starting new cartons; the line
   * keeps cycling until every carton in flight is finished and the
   * outfeed is empty — it does NOT halt instantly (that is the E-Stop).
   */
  stopReq: boolean;
  /**
   * Draining phase of a graceful stop: the chain is empty and stands
   * still, only the outfeed belt runs, carrying the last cartons to the
   * gate. When the outfeed is empty the line goes idle.
   */
  draining: boolean;
}
