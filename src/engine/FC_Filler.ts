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
      // Real product weight scatters NORMALLY around nominal (σ = 0.5 %)
      // — a gaussian, not a uniform band: most products land close to
      // nominal, the occasional one strays further out.
      const u1 = Math.max(1e-12, Math.random());
      const u2 = Math.random();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      w = db.recipe.prodWeight * (1 + 0.005 * gauss);
    }
    c.fills.push({ w, bad });
    if (db.hopperRemaining !== Infinity) db.hopperRemaining--;
    st.fillFlash = Math.min(0.1, db.params.fillT * 0.6);
  }
}
