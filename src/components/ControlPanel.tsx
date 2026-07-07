import { useState } from 'react';
import { engine, toMMin } from '../engine/PackagingEngine';
import { RecipePanel } from './RecipePanel';
import { TuningPanel } from './TuningPanel';
import { NumField, inputCls } from './NumField';

export function ControlPanel({ onOpenBuild }: { onOpenBuild: () => void }) {
  const [showRecipe, setShowRecipe] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const st = engine.state;
  const hopperBlocked = st.supplyLow && engine.hopperRemaining < engine.recipe.fillCount;

  return (
    <div className="flex flex-col gap-4">
      {/* Machine Control Panel */}
      <div className="bg-[#0d1420] p-4 rounded-xl border border-[#1c2736]">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-slate-500 font-semibold">Line Control</h3>
          <span className="text-[10px] text-slate-500">Safety chain → Control ON → Start</span>
        </div>

        {/* Status banner: shows the machine control state at all times */}
        {st.estop ? (
          <div className="mb-3 px-3 py-2 rounded border border-red-700 bg-red-950/60 text-red-400 text-[0.75rem] font-bold uppercase tracking-wider animate-pulse">
            ⛔ E-STOP ACTIVE — machine control OFF. Release the E-Stop button, then press CONTROL ON.
            {st.needsReset && <span className="block font-semibold text-red-300 normal-case tracking-normal mt-1">Production was interrupted — after Control ON the line is cleared (cartons on the chain are lost).</span>}
          </div>
        ) : !st.controlOn ? (
          <div className="mb-3 px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-amber-400 text-[0.75rem] font-bold uppercase tracking-wider">
            ⚠ CONTROL OFF — press CONTROL ON (safety check).
            {st.needsReset && <span className="block font-semibold text-amber-300 normal-case tracking-normal mt-1">Production was interrupted by E-Stop — Control ON will clear the line (start over).</span>}
          </div>
        ) : (
          <div className="mb-3 px-3 py-2 rounded border border-emerald-800 bg-emerald-950/40 text-emerald-400 text-[0.75rem] font-bold uppercase tracking-wider">
            ● CONTROL ON — {st.running ? 'line RUNNING' : 'ready to start'}
          </div>
        )}

        {/* Graceful-stop banner */}
        {st.stopReq && st.running && (
          <div className="mb-3 px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-amber-400 text-[0.75rem] font-bold uppercase tracking-wider">
            ■ STOPPING — {st.draining
              ? 'outfeed carrying the last cartons to the gate…'
              : 'finishing the cartons still on the chain…'}
          </div>
        )}

        {/* Registration fault banner */}
        {st.regFault && (
          <div className="mb-3 px-3 py-2 rounded border border-orange-700 bg-orange-950/40 text-orange-400 text-[0.75rem] font-bold uppercase tracking-wider flex items-center justify-between gap-3">
            <span>
              ⚠ REGISTRATION FAULT — the eye didn't confirm the index within the allowed travel.
              {!st.running && <span className="block font-semibold text-orange-300 normal-case tracking-normal mt-1">Line halted. Check the chain, then acknowledge to restart.</span>}
            </span>
            {!st.running && (
              <button
                onClick={() => engine.clearRegFault()}
                className="border border-orange-600 text-orange-300 text-[0.7rem] font-semibold uppercase px-3 py-[6px] rounded hover:bg-orange-900/50 transition-all cursor-pointer whitespace-nowrap"
              >
                Acknowledge
              </button>
            )}
          </div>
        )}

        {/* Hopper-low banner */}
        {st.supplyLow && (
          <div className="mb-3 px-3 py-2 rounded border border-orange-700 bg-orange-950/40 text-orange-400 text-[0.75rem] font-bold uppercase tracking-wider">
            ⚠ HOPPER LOW — {st.running
              ? 'packing every carton the rest can still fill'
              : hopperBlocked
                ? `only ${engine.hopperRemaining} products left (< ${engine.recipe.fillCount}/carton). Refill the hopper — START is locked.`
                : 'level below threshold. Refill soon, or the line stops itself.'}
          </div>
        )}

        <div className="flex gap-4 flex-wrap items-center">
          <div className="flex rounded border border-[#1c2736] overflow-hidden">
            {/* Illuminated push button: Control ON */}
            <button
              onClick={() => engine.setControlOn()}
              disabled={st.estop || st.controlOn}
              title={st.estop ? 'Interlocked: release E-Stop first' : 'Turn machine control on (safety check)'}
              className={`flex items-center gap-2 border-r border-[#1c2736] px-[12px] py-[8px] text-[0.75rem] font-semibold uppercase transition-all
                ${st.controlOn
                  ? 'bg-emerald-950/60 text-emerald-400 cursor-default'
                  : st.estop
                    ? 'bg-[#0b1017] text-slate-600 cursor-not-allowed'
                    : 'bg-transparent text-emerald-400 hover:bg-emerald-950 cursor-pointer'}`}
            >
              <span className={`w-3 h-3 rounded-full border ${st.controlOn ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_8px_#34d399]' : 'bg-emerald-950 border-emerald-800'}`}></span>
              Control On
            </button>
            <button
              onClick={() => engine.setControlOff()}
              disabled={!st.controlOn}
              title="Turn machine control off"
              className={`flex items-center gap-2 px-[12px] py-[8px] text-[0.75rem] font-semibold uppercase transition-all
                ${!st.controlOn
                  ? 'bg-[#0b1017] text-slate-600 cursor-not-allowed'
                  : 'bg-transparent text-red-400 hover:bg-red-950 cursor-pointer'}`}
            >
              Off
            </button>
          </div>

          {/* START */}
          <button
            onClick={() => engine.setRun(true)}
            disabled={!st.controlOn || st.running || st.regFault || hopperBlocked}
            title={!st.controlOn ? 'Interlocked: turn Control ON first'
              : st.regFault ? 'Interlocked: acknowledge the registration fault first'
              : hopperBlocked ? 'Interlocked: refill the hopper first'
              : st.running ? 'Already running' : 'Start the line'}
            className={`border rounded px-[12px] py-[8px] text-[0.75rem] font-semibold uppercase transition-all
              ${!st.controlOn || st.running || st.regFault || hopperBlocked
                ? 'border-[#1c2736] bg-[#0b1017] text-slate-600 cursor-not-allowed'
                : 'border-emerald-800 bg-transparent text-emerald-400 hover:bg-emerald-950 cursor-pointer'}`}
          >
            ▶ Start
          </button>

          {/* STOP: graceful cycle stop */}
          <button
            onClick={() => engine.requestStop()}
            disabled={!st.running || st.stopReq}
            title="Graceful stop: finishes every carton on the chain, empties the outfeed, then stops. Use E-Stop for an instant halt."
            className={`border rounded px-[12px] py-[8px] text-[0.75rem] font-semibold uppercase transition-all
              ${!st.running || st.stopReq
                ? 'border-[#1c2736] bg-[#0b1017] text-slate-600 cursor-not-allowed'
                : 'border-amber-700 bg-transparent text-amber-400 hover:bg-amber-950/50 cursor-pointer'}`}
          >
            {st.stopReq ? '■ Stopping…' : '■ Stop'}
          </button>

          {/* E-STOP mushroom */}
          <button
            onClick={() => st.estop ? engine.releaseEStop() : engine.pressEStop()}
            title={st.estop ? 'Twist to release the E-Stop button' : 'Emergency stop: kills machine control immediately'}
            className={`flex items-center gap-2 border-2 rounded-full px-[16px] py-[8px] text-[0.75rem] font-bold uppercase transition-all cursor-pointer
              ${st.estop
                ? 'border-red-500 bg-red-950 text-red-300 shadow-[0_0_10px_#ef444455]'
                : 'border-red-900 bg-[#2a0a0a] text-red-500 hover:bg-red-950'}`}
          >
            <span className="w-4 h-4 rounded-full bg-red-600 border-2 border-amber-400"></span>
            {st.estop ? 'Latched — click to release' : 'E-Stop'}
          </button>

          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => engine.reset()}
              className="border border-[#1c2736] bg-[#0b1017] text-slate-100 text-[0.75rem] font-semibold uppercase px-[12px] py-[6px] rounded flex items-center transition-all hover:bg-[#1c2736] cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={() => engine.injectBadProduct()}
              title="Queue a bad product (wrong weight): the next product the filler drops is bad. Only a check-weigher can catch it."
              className="border border-[#1c2736] bg-[#0b1017] text-slate-100 text-[0.75rem] font-semibold uppercase px-[12px] py-[6px] rounded flex items-center transition-all hover:bg-[#1c2736] cursor-pointer"
            >
              Inject Bad Product{engine.nextBadCount > 0 ? ` (${engine.nextBadCount})` : ''}
            </button>
            {engine.hopperRemaining === Infinity ? (
              <button
                onClick={() => engine.endSupply()}
                title="Simulate the product supply running out: only a small rest is left in the hopper"
                className="border border-orange-800 bg-[#0b1017] text-orange-400 text-[0.75rem] font-semibold uppercase px-[12px] py-[6px] rounded flex items-center transition-all hover:bg-orange-950/50 cursor-pointer"
              >
                End Supply
              </button>
            ) : (
              <button
                onClick={() => engine.refillHopper()}
                title="Refill the hopper: supply endless again, LOW latch cleared"
                className="border border-emerald-800 bg-[#0b1017] text-emerald-400 text-[0.75rem] font-semibold uppercase px-[12px] py-[6px] rounded flex items-center transition-all hover:bg-emerald-950 cursor-pointer"
              >
                ⟳ Refill Hopper
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CONFIG SUMMARY + ORDER — compact cards, editing happens in modals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* PRODUCTION ORDER */}
        <div className="bg-[#0d1420] p-3 rounded-xl border border-[#1c2736] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[0.6rem] uppercase tracking-[0.05em] text-slate-400 font-semibold flex items-center gap-2">
              <span className="w-1 h-3 bg-emerald-500"></span>Order
            </h3>
            <button
              onClick={() => engine.resetOrderCounter()}
              title="Start a new order count from zero"
              className="text-[0.6rem] text-slate-400 hover:text-white font-semibold uppercase cursor-pointer"
            >
              ↺ reset
            </button>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col">
              <label className="text-[0.55rem] uppercase tracking-[0.05em] text-slate-500 font-semibold mb-1">Target (0=∞)</label>
              <NumField
                value={engine.order.target} min="0" step="1"
                onCommit={n => engine.setOrderTarget(n)}
                cls={inputCls + " w-16"}
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[0.55rem] uppercase tracking-[0.05em] text-slate-500 font-semibold">Good</span>
              <span className="text-xl font-mono font-bold text-emerald-400 leading-none mt-1">
                {engine.order.done}
                <small className="text-xs text-slate-500"> / {engine.order.target > 0 ? engine.order.target : '∞'}</small>
              </span>
            </div>
          </div>
          {engine.order.target > 0 && engine.order.done >= engine.order.target && (
            <span className="text-[0.6rem] text-emerald-400 font-bold uppercase tracking-wider">✔ complete — reset to restart</span>
          )}
        </div>

        {/* ACTIVE RECIPE */}
        <button
          onClick={() => setShowRecipe(true)}
          className="text-left bg-[#0d1420] p-3 rounded-xl border border-[#1c2736] hover:border-sky-800 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[0.6rem] uppercase tracking-[0.05em] text-slate-400 font-semibold flex items-center gap-2">
              <span className="w-1 h-3 bg-sky-500"></span>Recipe
            </h3>
            <span className="text-[0.6rem] text-sky-400 font-semibold uppercase">{st.running ? '🔒 view' : 'edit ✎'}</span>
          </div>
          <div className="text-sm font-mono font-bold text-sky-400 leading-tight truncate">{engine.recipe.name}</div>
          <div className="text-[10px] text-slate-500 font-mono">
            {engine.recipe.fillCount}× {engine.recipe.prodWeight}g · {toMMin(engine.recipe.spd).toFixed(0)}m/min · carton {engine.recipe.cartonLen}mm
          </div>
        </button>

        {/* PROCESS TUNING */}
        <button
          onClick={() => setShowTuning(true)}
          className="text-left bg-[#0d1420] p-3 rounded-xl border border-[#1c2736] hover:border-cyan-800 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[0.6rem] uppercase tracking-[0.05em] text-slate-400 font-semibold flex items-center gap-2">
              <span className="w-1 h-3 bg-cyan-500"></span>Tuning
            </h3>
            <span className="text-[0.6rem] text-cyan-400 font-semibold uppercase">edit ✎</span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono mt-1 leading-relaxed">
            fill {engine.params.fillT}s/pc · seal {engine.params.sealT}s · outfeed ×{engine.params.outFac}
          </div>
        </button>

        {/* MACHINE BUILD */}
        <button
          onClick={onOpenBuild}
          className="text-left bg-[#0d1420] p-3 rounded-xl border border-[#1c2736] hover:border-slate-600 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[0.6rem] uppercase tracking-[0.05em] text-slate-400 font-semibold flex items-center gap-2">
              <span className="w-1 h-3 bg-slate-500"></span>Machine Build
            </h3>
            <span className="text-[0.6rem] font-semibold uppercase text-slate-400">{st.controlOn ? '🔒 view' : 'edit ⚙'}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-1 leading-relaxed">
            pitch {engine.config.pitch}mm · {engine.config.hasWeigher ? 'weigher' : 'no weigher'} · {engine.config.hasLabeler ? 'labeler' : 'no labeler'} · {engine.config.hasReg ? 'reg eye' : 'no reg'}
          </div>
        </button>
      </div>

      {showRecipe && <RecipePanel onClose={() => setShowRecipe(false)} />}
      {showTuning && <TuningPanel onClose={() => setShowTuning(false)} />}
    </div>
  );
}
