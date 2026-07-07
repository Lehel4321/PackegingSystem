import { PackagingEngine, SLOT } from './PackagingEngine';

/**
 * FC34: Seal Head (carton closer at the SEAL slot)
 *
 * Folds and seals the carton flaps. The head needs params.sealT of
 * dwell; the flaps close at the END of the dwell (the carton renders
 * open until then).
 *
 * ALIGNMENT GATE: the seal head comes straight down. A carton off its
 * slot center by more than config.alignTol would be crushed, not sealed
 * — the head stays up and the carton is flagged 'misplaced'. It leaves
 * the machine unsealed (double-flagged at discharge).
 *
 * ENABLE GATING:
 * The sealer is a core device — OB1 always calls it during 'process'.
 */
export function FC_Sealer(db: PackagingEngine) {
  const c = db.cartons.find(k => k.slot === SLOT.SEAL);
  if (!c || c.sealed) return;
  const st = db.state;

  if (st.procElapsed < db.params.sealT) return;

  // Alignment gate — never bring the head down on a misplaced carton.
  if (Math.abs(c.x - c.slot * db.config.pitch) > db.config.alignTol) {
    if (!c.reject) { c.reject = true; c.reason = 'misplaced'; }
    return;
  }

  c.sealed = true;
}
