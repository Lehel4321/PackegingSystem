import { engine } from '../engine/PackagingEngine';

/**
 * Packing history: one row per discharged carton, newest first.
 * The visual column redraws the carton: product pucks (bad ones red),
 * the applied label band, and the theoretical label position as a
 * dashed outline — so an off-spec carton is readable at a glance.
 */
export function PackingLog() {
  const total = engine.state.count;
  const rate = (60 / engine.cycle).toFixed(1);

  return (
    <div className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3 border-b border-[#1c2736] pb-3">
        <h2 className="m-0 text-[14px] font-bold tracking-wider uppercase text-slate-200">Packing history</h2>
        <span className="text-[12px] text-slate-500">
          Total: <b className="text-slate-200">{total}</b> &nbsp;·&nbsp;
          Rate: <b className="text-slate-200">{rate}</b> ctn/min
        </span>
      </div>
      <div className="max-h-[480px] overflow-y-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-[#0d1420] z-10">
            <tr>
              <th className="text-left font-semibold text-slate-500 tracking-wider uppercase text-[0.65rem] p-[8px_10px] border-b border-[#1c2736] w-20">Carton</th>
              <th className="text-left font-semibold text-slate-500 tracking-wider uppercase text-[0.65rem] p-[8px_10px] border-b border-[#1c2736] w-28">Weight</th>
              <th className="text-left font-semibold text-slate-500 tracking-wider uppercase text-[0.65rem] p-[8px_10px] border-b border-[#1c2736]">Contents</th>
              <th className="text-left font-semibold text-slate-500 tracking-wider uppercase text-[0.65rem] p-[8px_10px] border-b border-[#1c2736] w-24">Status</th>
              <th className="text-left font-semibold text-slate-500 tracking-wider uppercase text-[0.65rem] p-[8px_10px] border-b border-[#1c2736] w-20">Time</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {engine.log.length === 0 ? (
              <tr><td colSpan={5} className="text-slate-500 text-center p-[30px] font-sans">No cartons packed yet</td></tr>
            ) : (
              [...engine.log].reverse().map(r => {
                const dev = r.weight - r.targetW;
                const cartonLen = r.recipe?.cartonLen || engine.recipe.cartonLen;
                const labelLen = engine.config.labelLen;
                const theoA = r.recipe && engine.config.hasLabeler ? r.recipe.labelAt : null;
                return (
                  <tr key={r.n} className={`border-b border-[#1c2736]/50 ${r.reject ? "bg-red-950/10" : "hover:bg-[#1c2736]/20"}`}>
                    <td className={`p-[9px_10px] ${r.reject ? 'text-red-400' : 'text-slate-500'}`}>
                      <div>#{r.n}</div>
                      {r.recipe && <div className="text-[9px] text-slate-600 uppercase mt-0.5" title={`Recipe: ${r.recipe.name}`}>{r.recipe.name.substring(0, 8)}</div>}
                    </td>
                    <td className={`p-[9px_10px] ${r.reject ? 'text-red-400' : 'text-slate-200'}`}>
                      {r.weight} g
                      <div className={`text-[9px] ${Math.abs(dev) < 0.05 ? 'text-slate-600' : dev > 0 ? 'text-amber-500' : 'text-sky-500'}`}>
                        {dev >= 0 ? '+' : ''}{dev.toFixed(1)} g {r.weighed ? '' : '· unverified'}
                      </div>
                    </td>
                    <td className="p-[9px_10px]">
                      <div className="flex flex-col justify-center h-full gap-1">
                        <div
                          className={`relative w-full max-w-sm h-[18px] rounded-sm overflow-hidden border ${r.reject ? 'border-red-700' : 'border-[#c98d54]/40'}`}
                          style={{ backgroundColor: r.reject ? '#4a2620' : '#5c3d22' }}
                        >
                          {/* product pucks (bottom half, so the label band never hides them) */}
                          {r.fillsBad.map((bad, i) => (
                            <div
                              key={'p' + i}
                              className="absolute bottom-[2px] w-[7px] h-[7px] rounded-full"
                              style={{
                                left: `${4 + i * 10}px`,
                                backgroundColor: bad ? '#ef4444' : '#38bdf8',
                              }}
                              title={bad ? 'bad product' : 'product'}
                            ></div>
                          ))}

                          {/* applied label band (from the leading = right edge, upper half) */}
                          {r.labelA !== undefined && r.labelB !== undefined && (
                            <div
                              className="absolute top-0 h-[9px] bg-slate-100"
                              style={{
                                right: `${(r.labelA / cartonLen) * 100}%`,
                                width: `${((r.labelB - r.labelA) / cartonLen) * 100}%`,
                              }}
                            >
                              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2/3 h-[2px] bg-slate-400"></div>
                            </div>
                          )}

                          {/* theoretical label position (dashed outline) */}
                          {theoA !== null && !r.reject && (
                            <div
                              className="absolute top-0 bottom-0 z-20 border-x border-dashed"
                              style={{
                                right: `${(theoA / cartonLen) * 100}%`,
                                width: `${(Math.min(labelLen, cartonLen - theoA) / cartonLen) * 100}%`,
                                borderColor: 'rgba(255,255,255,0.45)',
                              }}
                            ></div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-[9px_10px]">
                      {r.reject
                        ? <span className="text-[10px] text-red-400 uppercase tracking-wider">✕ {r.reason || 'reject'}</span>
                        : <span className="text-[10px] text-emerald-400 uppercase tracking-wider">✔ good</span>}
                      <div className="text-[9px] text-slate-600">{r.products} pcs{r.labeled ? ' · label' : ''}</div>
                    </td>
                    <td className={`p-[9px_10px] ${r.reject ? 'text-red-400/70' : 'text-slate-400'}`}>{r.t.toFixed(1)} s</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
