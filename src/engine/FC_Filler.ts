import { PackagingEngine, SLOT } from './PackagingEngine';

/**
 * FC32: Filler (product dropper below the hopper)
 *
 * Drops recipe.fillCount products into the carton at the FILL slot, one
 * product every params.fillT seconds along the process dwell — the
 * dominant station of most cycles.
 *
 * ALIGNMENT GATE: products fall straight down. A carton that landed
 * further off its slot center than config.alignTol (chain slip without
 * registration) would not catch them — the drop is suppressed and the
 * carton is flagged 'misplaced'.
 *
 * BAD PRODUCT (operator test): if a bad product is queued
 * (db.nextBadCount), the next drop weighs params.badWeightPct % of
 * nominal. The filler itself cannot tell — only the check-weigher (if
 * installed) catches it downstream.
 *
 * SHORT FILL: if the hopper runs physically empty mid-carton (only
 * possible on a line without the level sensor, or in 'stop' mode races)
 * the remaining drops simply do not happen. The weigher — again, if
 * installed — rejects the carton as 'short fill'.
 *
 * ENABLE GATING:
 * The filler is a core device — OB1 always calls it during 'process'.
 */
export function FC_Filler(db: PackagingEngine) {
  const c = db.cartons.find(k => k.slot === SLOT.FILL);
  if (!c) return;
  const st = db.state;

  // Network 1: Alignment gate — a misplaced carton cannot be filled.
  if (Math.abs(c.x - c.slot * db.config.pitch) > db.config.alignTol) {
    if (!c.reject) { c.reject = true; c.reason = 'misplaced'; }
    return;
  }

  // Network 2: Drop products on the fill raster (k · fillT).
  while (c.fills.length < db.recipe.fillCount &&
         st.procElapsed >= (c.fills.length + 1) * db.params.fillT) {
    if (db.hopperRemaining < 1) return; // hopper physically empty -> short fill

    let w: number;
    let bad = false;
    if (db.nextBadCount > 0) {
      db.nextBadCount--;
      bad = true;
      w = db.recipe.prodWeight * db.params.badWeightPct / 100;
    } else {
      // Real products scatter a little around nominal (±1.2 %)
      w = db.recipe.prodWeight * (1 + (Math.random() - 0.5) * 0.024);
    }
    c.fills.push({ w, bad });
    if (db.hopperRemaining !== Infinity) db.hopperRemaining--;
    st.fillFlash = Math.min(0.1, db.params.fillT * 0.6);
  }
}
