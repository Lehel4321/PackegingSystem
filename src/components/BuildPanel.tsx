import { engine, toMMin, toMmSec, REG_APPROACH_CAP } from '../engine/PackagingEngine';
import { NumField, inputCls, labelCls } from './NumField';

/**
 * Machine Build — the PHYSICAL configuration of the line
 * (which stations are installed, chain pitch, servo motor data).
 * This is commissioning/maintenance territory, not operator territory:
 * it can only be changed while the machine control is OFF.
 */
export function BuildPanel({ onClose }: { onClose: () => void }) {
  const locked = engine.state.controlOn; // interlock: control off = commissioning mode

  const set = (key: keyof typeof engine.config, value: unknown) => {
    engine.updateConfig({ [key]: value });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#0d1420] border border-[#1c2736] rounded-xl p-6 w-[420px] max-w-full max-h-[90vh] overflow-auto text-slate-200 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3 border-b border-[#1c2736] pb-3">
          <h2 className="m-0 text-[0.85rem] font-bold tracking-wider uppercase text-slate-200">Machine Build</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 cursor-pointer bg-transparent border-none">✕</button>
        </div>

        <div className="text-[10px] text-slate-500 mb-4">
          Physical build of the line (commissioning). Article data → Recipe panel. Dwell times &amp; tuning → Process Tuning panel.
        </div>

        {locked ? (
          <div className="mb-4 px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-amber-400 text-[0.7rem] font-bold uppercase tracking-wider">
            🔒 Locked — machine control is ON. Turn the control off to modify the build.
          </div>
        ) : (
          <div className="mb-4 px-3 py-2 rounded border border-sky-800 bg-sky-950/30 text-sky-400 text-[0.7rem] font-bold uppercase tracking-wider">
            🔧 Commissioning mode — control is OFF, build editable.
          </div>
        )}

        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Chain pitch (mm)</label>
            <NumField value={engine.config.pitch} min="100" step="10" disabled={locked} onCommit={n => set('pitch', n)} />
            <div className="text-[10px] text-slate-500">Slot-to-slot distance. Six slots: erect · fill · weigh · seal · label · discharge.</div>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Outfeed belt length (mm)</label>
            <NumField value={engine.config.outLen} min="100" step="50" disabled={locked} onCommit={n => set('outLen', n)} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Alignment tolerance (± mm)</label>
            <NumField value={engine.config.alignTol} min="2" step="1" disabled={locked} onCommit={n => set('alignTol', n)} />
            <div className="text-[10px] text-slate-500">
              Max carton offset from the slot center at which the stations still work it. Further off → 'misplaced' reject. Chain slip without the registration eye drifts past this within a few indexes.
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#1c2736]">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-violet-400 font-bold">Check-Weigher installed (slot 2)</h3>
              <input
                type="checkbox"
                checked={engine.config.hasWeigher} disabled={locked}
                onChange={e => set('hasWeigher', e.target.checked)}
                className="cursor-pointer accent-violet-500 disabled:cursor-not-allowed"
              />
            </div>
            <div className="text-[10px] text-slate-500">
              The line's only quality eye: catches bad products, short fills and wrong counts by NET weight.
              Without it the line packs them blind into the good bin — the log still records the true weight.
              Tolerance is per-recipe; settle time is in Process Tuning.
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#1c2736]">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-pink-400 font-bold">Labeler installed (slot 4)</h3>
              <input
                type="checkbox"
                checked={engine.config.hasLabeler} disabled={locked}
                onChange={e => set('hasLabeler', e.target.checked)}
                className="cursor-pointer accent-pink-500 disabled:cursor-not-allowed"
              />
            </div>
            {engine.config.hasLabeler && (
              <div className="flex flex-col gap-1">
                <label className={labelCls}>Label width (mm)</label>
                <NumField value={engine.config.labelLen} min="10" step="5" disabled={locked} onCommit={n => set('labelLen', n)} />
                <div className="text-[10px] text-slate-500">Label position on the carton lives in the Recipe.</div>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[#1c2736]">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-orange-400 font-bold">Hopper Level Sensor installed</h3>
              <input
                type="checkbox"
                checked={engine.config.hasHopperSensor} disabled={locked}
                onChange={e => set('hasHopperSensor', e.target.checked)}
                className="cursor-pointer accent-orange-500 disabled:cursor-not-allowed"
              />
            </div>
            {engine.config.hasHopperSensor && (
              <div className="flex flex-col gap-1">
                <label className={labelCls}>LOW threshold (products)</label>
                <NumField value={engine.config.hopperLowAt} min="1" step="1" disabled={locked} onCommit={n => set('hopperLowAt', n)} />
                <div className="text-[10px] text-slate-500">
                  Sensor reports LOW at this rest. Reaction (stop / run-out) → Process Tuning. Without the sensor the line
                  short-fills blindly when the hopper empties — only a check-weigher can catch that.
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[#1c2736]">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-amber-400 font-bold">Index Axis — Servo Motor Data</h3>
            </div>
            <div className="space-y-3">
              <div className="text-[10px] text-slate-500">
                The chain moves like a real servo axis: jerk-limited S-curve acceleration and braking (MotionProfileSolver).
                The registration eye's trip point is calculated from these values at the actual approach speed.
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Vmax (mm/s)</label>
                  <NumField value={engine.config.axVmax} min="50" step="100" disabled={locked} onCommit={n => set('axVmax', n)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Amax (mm/s²)</label>
                  <NumField value={engine.config.axAmax} min="500" step="1000" disabled={locked} onCommit={n => set('axAmax', n)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Jerk (mm/s³)</label>
                  <NumField value={engine.config.axJerk} min="5000" step="10000" disabled={locked} onCommit={n => set('axJerk', n)} />
                </div>
              </div>
              {engine.recipe.spd > engine.config.axVmax && (
                <div className="text-[10px] text-orange-400">
                  ⚠ Recipe speed ({engine.recipe.spd.toFixed(0)} mm/s) exceeds the axis Vmax — the chain runs capped at {engine.config.axVmax.toFixed(0)} mm/s.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#1c2736]">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-[0.65rem] uppercase tracking-[0.05em] text-cyan-400 font-bold">Registration Eye installed (chain)</h3>
              <input
                type="checkbox"
                checked={engine.config.hasReg} disabled={locked}
                onChange={e => set('hasReg', e.target.checked)}
                className="cursor-pointer accent-cyan-400 disabled:cursor-not-allowed"
              />
            </div>
            {engine.config.hasReg && (
              <div className="space-y-3">
                <div className="text-[10px] text-slate-500">
                  Photo-eye watching the chain lugs arrive at the index target. It sees the REAL chain position, so every
                  index lands on the slot centers even when the drive slips against the chain. Its trip point is
                  recalculated from the axis data before every move: slower approach → shorter stop → trip point closer
                  to the target.
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Correction constant (mm)</label>
                  <NumField value={engine.config.regConst} min="0" step="0.5" disabled={locked} onCommit={n => set('regConst', n)} />
                  <div className="text-[10px] text-slate-500">Reserve for other factors (eye response, drive lag…).</div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Index overshoot budget (mm)</label>
                  <NumField value={engine.config.regOver} min="5" step="1" disabled={locked} onCommit={n => set('regOver', n)} />
                  <div className="text-[10px] text-slate-500">
                    Total allowed travel per index = pitch + this budget. If the eye still hasn't tripped by then it's a
                    fault — what happens next (warn, or stop) is set per-recipe.
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Approach speed cap (m/min, max 60)</label>
                  <NumField
                    value={+toMMin(engine.config.regApproachSpeed).toFixed(1)} min="1" max="60" step="1" disabled={locked}
                    onCommit={n => set('regApproachSpeed', toMmSec(n))}
                  />
                  <div className="text-[10px] text-slate-500">
                    Before the eye, the chain must ramp DOWN to this speed (never above {toMMin(REG_APPROACH_CAP).toFixed(0)} m/min) so the final
                    stop-from-eye is short and consistent — that's what makes the eye a position measurement,
                    not just a rough stop from whatever speed production happens to run.
                  </div>
                </div>
                <div className="bg-[#0b1017] border border-cyan-900 rounded px-2 py-1.5 text-[11px] font-mono text-cyan-400">
                  Commanded speed = {engine.cruiseSpeed().toFixed(0)} mm/s ({toMMin(engine.cruiseSpeed()).toFixed(0)} m/min)<br />
                  Move peak over {engine.config.pitch} mm (motion profile) = <b>{engine.regPeakV().toFixed(0)} mm/s</b>
                  {engine.regPeakV() < engine.cruiseSpeed() - 1 && <span className="text-cyan-300"> — pitch too short to reach the commanded speed</span>}<br />
                  Approach speed (capped) = <b>{engine.regApproachV().toFixed(0)} mm/s</b> ({toMMin(engine.regApproachV()).toFixed(1)} m/min)
                  {engine.regApproachV() < engine.regPeakV() - 1
                    ? <span className="text-cyan-300"> — chain ramps down before the eye</span>
                    : <span className="text-cyan-300"> — move never exceeds the cap, no slow-down needed</span>}<br />
                  Ramp-down distance = {engine.regRampDist().toFixed(2)} mm → decel starts at +{engine.regDecelStart().toFixed(2)} mm<br />
                  Brake dist @ approach speed (S-curve) = {engine.regStopDist().toFixed(2)} mm<br />
                  PLC reaction (1 scan) = {engine.regReactDist().toFixed(2)} mm<br />
                  Eye trip point = {engine.config.pitch} − {engine.regStopDist().toFixed(2)} − {engine.regReactDist().toFixed(2)} − {engine.config.regConst} = <b>{engine.regSensorPos().toFixed(2)} mm</b><br />
                  Total allowed travel (fault limit) = {engine.config.pitch} + {engine.config.regOver} = <b>{(engine.config.pitch + engine.config.regOver).toFixed(0)} mm</b>
                </div>
                {engine.regSensorPos() <= 0 && (
                  <div className="text-[10px] text-orange-400">
                    ⚠ Trip point ≤ 0: braking from the approach speed needs more distance than the whole pitch — no eye
                    position can give the stop signal early enough. The registration system is inactive (encoder index).
                    Lower the approach speed cap, or raise Amax/Jerk so the chain stops shorter.
                  </div>
                )}
              </div>
            )}
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
