import { PackagingEngine, SLOT } from './PackagingEngine';

/**
 * FC35: Labeler (print & apply head at the LABEL slot)
 *
 * Applies the article label onto the sealed carton at recipe.labelAt
 * (mm from the carton leading edge), config.labelLen wide. The head
 * needs params.labelT of dwell.
 *
 * ALIGNMENT GATE: the label is applied at a fixed machine position — a
 * misplaced carton would get its label half off the edge, so the head
 * skips it and flags 'misplaced'. At discharge the missing label is
 * caught again ('no label') even if alignment was the root cause.
 *
 * ENABLE GATING:
 * No `hasLabeler` check inside this FC. OB1 only calls it when the
 * labeler is built in:  if (db.config.hasLabeler) FC_Labeler(db);
 */
export function FC_Labeler(db: PackagingEngine) {
  const c = db.cartons.find(k => k.slot === SLOT.LABEL);
  if (!c || c.labeled) return;
  const st = db.state;

  if (st.procElapsed < db.params.labelT) return;

  // Alignment gate — never fire the applicator across a carton edge.
  if (Math.abs(c.x - c.slot * db.config.pitch) > db.config.alignTol) {
    if (!c.reject) { c.reject = true; c.reason = 'misplaced'; }
    return;
  }

  c.labeled = true;
  c.labelA = db.recipe.labelAt;
  c.labelB = Math.min(db.recipe.cartonLen, db.recipe.labelAt + db.config.labelLen);
}
