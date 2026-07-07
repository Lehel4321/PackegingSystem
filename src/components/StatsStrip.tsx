import { engine } from '../engine/PackagingEngine';

/**
 * Compact production stats strip: a single thin row of small tiles.
 */
export function StatsStrip() {
  const st = engine.state;
  const statusStr = st.estop ? 'E-STOP'
    : !st.controlOn ? 'Control OFF'
    : !st.running ? (st.regFault ? 'Reg fault'
      : st.supplyLow && engine.hopperRemaining < engine.recipe.fillCount ? 'Refill hopper'
      : engine.order.target > 0 && engine.order.done >= engine.order.target ? 'Order done' : 'Ready')
    : st.draining ? 'Draining'
    : st.stopReq ? 'Stopping'
    : (st.phase === 'index' ? 'Indexing' : 'Processing');
  const stateColor = st.estop ? 'text-red-500'
    : !st.controlOn ? 'text-amber-400'
    : st.running ? 'text-emerald-400' : 'text-slate-300';
  const cpm = (60 / engine.cycle).toFixed(1);
  const yieldRatio = st.count > 0 ? ((st.packed / st.count) * 100).toFixed(1) : '100.0';
  const supply = engine.hopperRemaining === Infinity ? '∞' : String(engine.hopperRemaining);

  const Tile = ({ label, value, cls }: { label: string; value: string | number; cls?: string }) => (
    <div className="flex flex-col px-4 py-2 flex-1 min-w-[90px]">
      <span className="text-[0.58rem] uppercase tracking-wider text-slate-500 font-semibold">{label}</span>
      <span className={`text-lg font-mono font-bold leading-tight ${cls || 'text-slate-100'}`}>{value}</span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-stretch bg-[#0d1420] border border-[#1c2736] rounded-xl divide-x divide-[#1c2736]">
      <Tile label="State" value={statusStr} cls={stateColor} />
      <Tile label="Packed" value={st.packed} cls="text-emerald-400" />
      <Tile label="Rejects" value={st.rejects} cls="text-red-400" />
      <Tile label="Yield" value={yieldRatio + '%'} cls="text-emerald-300" />
      <Tile label="Rate" value={cpm + ' ctn/min'} cls="text-cyan-400" />
      <Tile label="Cycle" value={engine.cycle.toFixed(2) + 's'} />
      <Tile label="Supply" value={supply} cls={engine.state.supplyLow ? 'text-orange-400' : 'text-slate-100'} />
    </div>
  );
}
