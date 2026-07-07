import { engine } from '../engine/PackagingEngine';
import { NumField, inputCls, labelCls } from './NumField';

/**
 * Process Tuning editor (modal window).
 * Operator tuning that belongs to the process, not to the article
 * (recipe) or the physical build (machine build). Changeable any time,
 * so there is no interlock here.
 */
export function TuningPanel({ onClose }: { onClose: () => void }) {
  const handleChange = (key: keyof typeof engine.params, value: number) => {
    engine.updateParams({ [key]: value });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-6 w-[420px] max-w-full max-h-[90vh] overflow-auto text-slate-200 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3 border-b border-[#1c2736] pb-3">
          <h2 className="m-0 text-[0.85rem] font-bold tracking-wider uppercase text-slate-200">Process Tuning</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 cursor-pointer bg-transparent border-none">✕</button>
        </div>

        <div className="text-[10px] text-slate-500 mb-4">
          Operator tuning, changeable any time. Article data → Recipe. Machine build → Machine Build.
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Erect Dwell (s)</label>
            <NumField value={engine.params.erectT} min="0.05" step="0.05" onCommit={n => handleChange('erectT', n)} />
            <div className="text-[10px] text-slate-500">Erecting head down-time.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Fill Time (s / product)</label>
            <NumField value={engine.params.fillT} min="0.05" step="0.05" onCommit={n => handleChange('fillT', n)} />
            <div className="text-[10px] text-slate-500">One drop per raster; {engine.recipe.fillCount} products = {(engine.recipe.fillCount * engine.params.fillT).toFixed(2)} s.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Weigh Settle (s)</label>
            <NumField value={engine.params.weighT} min="0.05" step="0.05" onCommit={n => handleChange('weighT', n)} />
            <div className="text-[10px] text-slate-500">Scale settle time before the value is valid.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Seal Dwell (s)</label>
            <NumField value={engine.params.sealT} min="0.05" step="0.05" onCommit={n => handleChange('sealT', n)} />
            <div className="text-[10px] text-slate-500">Seal head down-time per carton.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Label Dwell (s)</label>
            <NumField value={engine.params.labelT} min="0.05" step="0.05" onCommit={n => handleChange('labelT', n)} />
            <div className="text-[10px] text-slate-500">Print &amp; apply time per label.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Outfeed Gain (×)</label>
            <NumField value={engine.params.outFac} min="1" step="0.1" onCommit={n => handleChange('outFac', n)} />
            <div className="text-[10px] text-slate-500">Outfeed belt speed vs. index speed.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Chain Slip (%)</label>
            <NumField value={engine.params.slipPct} min="0" max="10" step="0.5" onCommit={n => handleChange('slipPct', n)} />
            <div className="text-[10px] text-slate-500">Diagnostics only: simulates chain stretch vs. the encoder — enable the Registration Eye (Machine Build) to correct it.</div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Bad Product Weight (%)</label>
            <NumField value={engine.params.badWeightPct} min="10" max="200" step="5" onCommit={n => handleChange('badWeightPct', n)} />
            <div className="text-[10px] text-slate-500">Weight of an injected bad product vs. nominal.</div>
          </div>

          <div className="flex flex-col gap-1 col-span-2 pt-3 border-t border-[#1c2736]">
            <label className={labelCls}>On Hopper Low (level sensor)</label>
            <select
              value={engine.params.hopperMode}
              onChange={e => engine.updateParams({ hopperMode: e.target.value as 'stop' | 'runout' })}
              className={inputCls + " font-sans"}
            >
              <option value="stop">Stop at the cycle boundary (refill &amp; resume)</option>
              <option value="runout">Pack every carton the rest still fills, then stop</option>
            </select>
            <div className="text-[10px] text-slate-500">
              {engine.params.hopperMode === 'stop'
                ? 'The line stops cleanly the moment the level sensor reports LOW. Refill and press Start — nothing is lost.'
                : 'The erector only starts cartons the hopper can still fill completely; the line runs itself empty without a single short-filled carton.'}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 bg-[#1c2736] hover:bg-[#26344a] text-slate-200 font-semibold text-[0.75rem] tracking-wider uppercase px-4 py-2 rounded transition-colors cursor-pointer border border-[#26344a]"
        >
          Done
        </button>
      </div>
    </div>
  );
}
