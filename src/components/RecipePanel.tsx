import { useState } from 'react';
import { engine, toMMin, toMmSec } from '../engine/PackagingEngine';
import { NumField, inputCls, labelCls } from './NumField';

/**
 * Recipe editor + manager (modal window).
 * Article/pack data only — order quantity lives on the main screen,
 * the machine build lives in Machine Build.
 * Interlock: recipe only changeable while the machine is stopped.
 */
export function RecipePanel({ onClose }: { onClose: () => void }) {
  const [selRecipe, setSelRecipe] = useState('');
  const locked = engine.state.running;

  const handleChange = (key: keyof typeof engine.recipe, value: number | string) => {
    engine.updateRecipe({ [key]: value });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-6 w-[460px] max-w-full max-h-[90vh] overflow-auto text-slate-200 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3 border-b border-[#1c2736] pb-3">
          <h2 className="m-0 text-[0.85rem] font-bold tracking-wider uppercase text-slate-200">Recipe · Article Data</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 cursor-pointer bg-transparent border-none">✕</button>
        </div>

        {locked ? (
          <div className="mb-4 px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-amber-400 text-[0.7rem] font-bold uppercase tracking-wider">
            🔒 Locked — line is running. Stop the line to change or load a recipe.
          </div>
        ) : (
          <div className="mb-4 text-[10px] text-slate-500">
            Describes the ARTICLE. Order quantity → main screen. Machine build → Machine Build.
          </div>
        )}

        {/* Recipe manager: save / load named recipes */}
        <div className="space-y-3 mb-4 pb-4 border-b border-[#1c2736]">
          <div className="flex gap-2 items-end">
            <div className="flex flex-col flex-1">
              <label className={labelCls}>Recipe Name</label>
              <input
                type="text" value={engine.recipe.name} disabled={locked}
                onChange={e => handleChange('name', e.target.value)}
                className={inputCls + " uppercase"}
              />
            </div>
            <button
              onClick={() => engine.saveRecipe()}
              disabled={locked}
              title="Save the current values under this recipe name"
              className="border border-sky-800 text-sky-400 text-[0.7rem] font-semibold uppercase px-3 py-[8px] rounded hover:bg-sky-950/50 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              💾 Save
            </button>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex flex-col flex-1">
              <label className={labelCls}>Saved Recipes</label>
              <select
                value={selRecipe} disabled={locked}
                onChange={e => setSelRecipe(e.target.value)}
                className={inputCls + " font-sans"}
              >
                <option value="">— select —</option>
                {engine.getRecipeNames().map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button
              onClick={() => { if (selRecipe) engine.loadRecipe(selRecipe); }}
              disabled={locked || !selRecipe}
              title="Load the selected recipe (line must be stopped)"
              className="border border-emerald-800 text-emerald-400 text-[0.7rem] font-semibold uppercase px-3 py-[8px] rounded hover:bg-emerald-950 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Load
            </button>
            <button
              onClick={() => { if (selRecipe) { engine.deleteRecipe(selRecipe); setSelRecipe(''); } }}
              disabled={!selRecipe}
              title="Delete the selected recipe from storage"
              className="border border-red-900 text-red-400 text-[0.7rem] font-semibold uppercase px-3 py-[8px] rounded hover:bg-red-950 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Recipe values */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Products / Carton</label>
            <NumField
              value={engine.recipe.fillCount} min="1" max="12" step="1" disabled={locked}
              onCommit={n => handleChange('fillCount', n)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Index Speed (m/min)</label>
            <NumField
              value={+toMMin(engine.recipe.spd).toFixed(1)} min="1" step="1" disabled={locked}
              onCommit={n => handleChange('spd', toMmSec(n))}
              cls={inputCls + " text-emerald-400"}
            />
            <div className="text-[10px] text-slate-500">= {Math.round(engine.recipe.spd)} mm/s
              {engine.recipe.spd > engine.config.axVmax &&
                <span className="text-orange-400"> — capped at axis Vmax ({Math.round(engine.config.axVmax)} mm/s)</span>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Product Weight (g)</label>
            <NumField
              value={engine.recipe.prodWeight} min="1" step="1" disabled={locked}
              onCommit={n => handleChange('prodWeight', n)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Carton Tare (g)</label>
            <NumField
              value={engine.recipe.tare} min="0" step="1" disabled={locked}
              onCommit={n => handleChange('tare', n)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Carton Length (mm)</label>
            <NumField
              value={engine.recipe.cartonLen} min="40" step="10" disabled={locked}
              onCommit={n => handleChange('cartonLen', n)}
            />
            <div className="text-[10px] text-slate-500">Max pitch − 40 = {Math.max(40, engine.config.pitch - 40)} mm.</div>
          </div>
          {engine.config.hasLabeler && (
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Label At (mm from front)</label>
              <NumField
                value={engine.recipe.labelAt} min="0" step="5" disabled={locked}
                onCommit={n => handleChange('labelAt', n)}
              />
              <div className="text-[10px] text-slate-500">Label width {engine.config.labelLen} mm (Machine Build).</div>
            </div>
          )}
          {engine.config.hasWeigher && (
            <div className="flex flex-col gap-1 col-span-2">
              <label className={labelCls}>Weight Tolerance (± % of net)</label>
              <NumField
                value={engine.recipe.weighTolPct} min="0.5" max="50" step="0.5" disabled={locked}
                onCommit={n => handleChange('weighTolPct', n)}
              />
              <div className="text-[10px] text-slate-500">
                Net target = {engine.recipe.fillCount} × {engine.recipe.prodWeight} g = {engine.recipe.fillCount * engine.recipe.prodWeight} g.
                Reject outside ±{(engine.recipe.fillCount * engine.recipe.prodWeight * engine.recipe.weighTolPct / 100).toFixed(1)} g.
              </div>
            </div>
          )}
          {engine.config.hasReg && (
            <div className="flex flex-col gap-1 col-span-2">
              <label className={labelCls}>If the registration eye doesn't confirm in time</label>
              <select
                value={engine.recipe.regFaultMode} disabled={locked}
                onChange={e => handleChange('regFaultMode', e.target.value)}
                className={inputCls + " font-sans"}
              >
                <option value="warn">Warn &amp; finish the index on the encoder — keep packing</option>
                <option value="stop">Stop — halt the line, wait for operator</option>
              </select>
              <div className="text-[10px] text-slate-500">
                Applies when the chain has travelled pitch + overshoot budget (Machine Build) and the eye still
                hasn't seen the lug.
              </div>
            </div>
          )}
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
