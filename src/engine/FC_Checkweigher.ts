import { PackagingEngine, SLOT } from './PackagingEngine';

/**
 * FC33: Check-Weigher (in-line scale at the WEIGH slot)
 *
 * Weighs the carton after filling and compares the NET weight against
 * the recipe: fillCount × prodWeight ± weighTolPct. Out of tolerance ->
 * the carton is flagged reject; the gate at the outfeed end kicks it
 * into the reject bin.
 *
 * This is the line's only quality eye: a bad product (wrong weight) or
 * a short fill is INVISIBLE to every other station. A machine built
 * without the weigher packs them straight into the good bin — the log
 * still records the true weight, so the blind spot shows up on paper.
 *
 * The weigher needs params.weighT of settle time before its value is
 * valid; it reads once per cycle.
 *
 * ENABLE GATING:
 * No `hasWeigher` check inside this FC. OB1 only calls it when the
 * scale is built in:  if (db.config.hasWeigher) FC_Checkweigher(db);
 */
export function FC_Checkweigher(db: PackagingEngine) {
  const c = db.cartons.find(k => k.slot === SLOT.WEIGH);
  if (!c || c.weighed) return;
  const st = db.state;

  // Network 1: Wait for the scale to settle.
  if (st.procElapsed < db.params.weighT) return;

  // Network 2: Read the gross weight (the scale sees whatever is there,
  // aligned or not — weighing has no alignment gate).
  c.weighed = true;
  c.weight = db.recipe.tare + c.fills.reduce((s, f) => s + f.w, 0);

  // Network 3: Tolerance check on the net weight.
  if (c.reject) return; // already rejected upstream — keep the first reason
  const net = c.weight - db.recipe.tare;
  const target = db.recipe.fillCount * db.recipe.prodWeight;
  if (c.fills.length < db.recipe.fillCount) {
    c.reject = true;
    c.reason = 'short fill';
  } else if (Math.abs(net - target) > target * db.recipe.weighTolPct / 100) {
    c.reject = true;
    c.reason = 'weight';
  }
}
