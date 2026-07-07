import { PackagingEngine, SLOT } from './PackagingEngine';
import { OutCarton } from '../types';

/**
 * FC36: Discharge Pusher (chain -> outfeed transfer) + packing log
 *
 * At the start of every process cycle, transfers the carton that
 * reached the DISCHARGE slot onto the outfeed belt, runs the final
 * completeness checks and writes the packing-log entry. This is the
 * commit point of a carton: order.made counts good cartons HERE, so the
 * erector gate never starts more cartons than the order needs while
 * finished ones are still travelling out on the (long) outfeed.
 *
 * FINAL CHECKS (belt and braces, independent of the stations):
 * - a carton that should carry a label but doesn't -> 'no label'
 * - a carton that is not sealed -> 'not sealed'
 * Both normally only fire as a CONSEQUENCE of an upstream problem
 * (misplaced carton skipped by the seal/label head), in which case the
 * first reason is kept.
 *
 * ENABLE GATING:
 * The pusher is a core device — OB1 always calls it at cycle start.
 */
export function FC_Discharge(db: PackagingEngine) {
  const st = db.state;
  let pushed = false;

  for (const c of [...db.cartons]) {
    if (c.slot < SLOT.DISCHARGE) continue;
    db.cartons.splice(db.cartons.indexOf(c), 1);

    // Network 1: Final completeness checks.
    if (!c.reject && db.config.hasLabeler && !c.labeled) {
      c.reject = true;
      c.reason = 'no label';
    }
    if (!c.reject && !c.sealed) {
      c.reject = true;
      c.reason = 'not sealed';
    }

    // Network 2: Commit the carton to the order.
    st.count++;
    if (!c.reject) db.order.made++;

    // Network 3: Hand over to the outfeed belt.
    const out: OutCarton = {
      left: 0,
      len: db.recipe.cartonLen,
      reject: c.reject,
      reason: c.reason,
      fills: c.fills,
      labelA: c.labelA,
      labelB: c.labelB,
      sealed: c.sealed,
    };
    db.outfeed.push(out);

    // Network 4: Packing log entry. The TRUE weight is always logged —
    // even on a line without a weigher (blind spots show up on paper).
    const weight = db.recipe.tare + c.fills.reduce((s, f) => s + f.w, 0);
    db.log.push({
      n: st.count,
      products: c.fills.length,
      weight: Math.round(weight * 10) / 10,
      targetW: db.targetWeight(),
      weighed: c.weighed,
      reject: c.reject,
      reason: c.reason,
      labeled: c.labeled,
      labelA: c.labelA,
      labelB: c.labelB,
      fillsBad: c.fills.map(f => f.bad),
      t: st.simTime,
      cyc: db.cycle,
      recipe: {
        name: db.recipe.name,
        fillCount: db.recipe.fillCount,
        cartonLen: db.recipe.cartonLen,
        labelAt: db.recipe.labelAt,
      },
    });
    if (db.log.length > 200) db.log.shift();
    pushed = true;
  }

  if (pushed) db.notify();
}
