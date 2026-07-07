import { useEffect, useRef } from 'react';
import { engine, toMMin, STATION_META, SLOT } from '../engine/PackagingEngine';
import { ProductFill } from '../types';

function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, c: string, w: number = 1) {
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}

function txt(ctx: CanvasRenderingContext2D, x: number, y: number, t: string, c: string, a: CanvasTextAlign = 'center') {
  ctx.fillStyle = c;
  ctx.font = '11px ui-monospace';
  ctx.textAlign = a;
  ctx.fillText(t, x, y);
}

function fmt(mm: number) {
  return (mm > 0 ? '+' : '') + Math.round(mm);
}

function niceStep(span: number) {
  const raw = span / 10;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

/**
 * Draw one carton, centered at pixel cx on the chain row.
 * Renders the body, the products inside, open flaps / seal tape, the
 * applied label band and the reject flag.
 */
function drawCarton(
  ctx: CanvasRenderingContext2D,
  cx: number, yc: number, wPx: number,
  fills: ProductFill[], fillTarget: number,
  sealed: boolean, labelA: number | undefined, labelB: number | undefined,
  lenMm: number, reject: boolean, reason: string,
) {
  const hh = 21; // half height
  const x0 = cx - wPx / 2, x1 = cx + wPx / 2;

  // body
  ctx.fillStyle = reject ? '#7c3f34' : '#a4703f';
  ctx.fillRect(x0, yc - hh, wPx, hh * 2);
  ctx.strokeStyle = reject ? '#ef4444' : '#c98d54';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, yc - hh, wPx, hh * 2);

  // products inside (row of pucks)
  const n = Math.max(fillTarget, fills.length, 1);
  const cell = Math.min(14, (wPx - 8) / n);
  for (let i = 0; i < fills.length; i++) {
    const px = x0 + 4 + i * cell + cell / 2;
    ctx.fillStyle = fills[i].bad ? '#ef4444' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(px, yc + 6, Math.min(5, cell / 2 - 1), 0, Math.PI * 2);
    ctx.fill();
  }

  if (sealed) {
    // seal tape across the top
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 1, yc - hh + 2);
    ctx.lineTo(x1 - 1, yc - hh + 2);
    ctx.stroke();
  } else {
    // open flaps
    ctx.strokeStyle = '#c98d54';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, yc - hh);
    ctx.lineTo(x0 - wPx * 0.12, yc - hh - 8);
    ctx.moveTo(x1, yc - hh);
    ctx.lineTo(x1 + wPx * 0.12, yc - hh - 8);
    ctx.stroke();
  }

  // applied label band (measured from the leading = right edge) — drawn
  // on the upper half of the carton so the products stay visible below
  if (labelA !== undefined && labelB !== undefined) {
    const scale = wPx / lenMm;
    const bx1 = x1 - labelA * scale;
    const bx0 = x1 - labelB * scale;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(bx0, yc - 16, bx1 - bx0, 12);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(bx0 + 2, yc - 13, Math.max(0, bx1 - bx0 - 4), 1.5);
    ctx.fillRect(bx0 + 2, yc - 9, Math.max(0, bx1 - bx0 - 4) * 0.7, 1.5);
  }

  if (reject) {
    txt(ctx, cx, yc - hh - 12, 'REJECT' + (reason ? ' · ' + reason.toUpperCase() : ''), '#fca5a5');
  }
}

export function LineCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    function resize() {
      if (!cv) return;
      const r = cv.parentElement?.getBoundingClientRect();
      if (!r) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const resizeObserver = new ResizeObserver(resize);
    if (cv.parentElement) resizeObserver.observe(cv.parentElement);

    let frameId: number;

    function render() {
      if (!cv || !ctx) return;
      const g = engine.layout(cv.clientWidth, cv.clientHeight);
      ctx.clearRect(0, 0, g.w, g.h);

      const { yc, slots, outStart, outEnd, axisMin, axisMax, X, pxPerMm } = g;
      const st = engine.state;
      const ry = g.h - 22; // ruler baseline
      const cartonW = engine.recipe.cartonLen * pxPerMm;

      // ruler
      ctx.strokeStyle = '#1c2736';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(axisMin), ry); ctx.lineTo(X(axisMax), ry); ctx.stroke();
      const step = niceStep(axisMax - axisMin);
      const st0 = Math.ceil(axisMin / step) * step;
      for (let mm = st0; mm <= axisMax + 0.1; mm += step) {
        const z = Math.abs(mm) < 0.01;
        vline(ctx, X(mm), ry, ry + (z ? 9 : 5), z ? '#e2e8f0' : '#334155', z ? 2 : 1);
        txt(ctx, X(mm), ry + 16, z ? '0' : fmt(mm), z ? '#cbd5e1' : '#64748b');
      }

      // ---- indexing chain (slot 0 .. discharge) ----
      const chainTop = yc + 23;
      ctx.strokeStyle = '#1c2736';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(slots[0] - g.pitch * 0.45), chainTop, X(outStart) - X(slots[0] - g.pitch * 0.45), 9);
      // chain lugs travel with the PHYSICAL chain (state.tip)
      ctx.fillStyle = '#334155';
      const lugSpacing = g.pitch / 4;
      const lugPhase = ((st.tip + engine.drift) % lugSpacing + lugSpacing) % lugSpacing;
      for (let mm = slots[0] - g.pitch * 0.45 + lugPhase; mm < outStart; mm += lugSpacing) {
        ctx.fillRect(X(mm), chainTop + 2, 2, 5);
      }
      txt(ctx, (X(slots[0]) + X(outStart)) / 2, chainTop + 24,
        'INDEX CHAIN · pitch ' + g.pitch + 'mm · ' + toMMin(st.v).toFixed(1) + ' m/min', '#64748b');

      // ---- outfeed belt ----
      const beltPhase = (st.beltScroll * pxPerMm) % 18;
      ctx.strokeStyle = '#1c2736';
      ctx.strokeRect(X(outStart), chainTop, X(outEnd) - X(outStart), 9);
      ctx.fillStyle = '#475569';
      for (let x = X(outStart) + beltPhase; x < X(outEnd) - 4; x += 18) {
        ctx.beginPath(); ctx.moveTo(x, chainTop + 2); ctx.lineTo(x + 5, chainTop + 4.5); ctx.lineTo(x, chainTop + 7); ctx.fill();
      }
      txt(ctx, (X(outStart) + X(outEnd)) / 2, chainTop + 24,
        'OUTFEED · ' + engine.config.outLen + 'mm  (' + toMMin(engine.outSpeed()).toFixed(0) + ' m/min)', '#64748b');

      // ---- station boxes ----
      const stationActive: Record<string, boolean> = {
        erect: st.erectFlash > 0,
        fill: st.fillFlash > 0,
        weigh: st.weighFlash > 0,
        seal: st.sealFlash > 0,
        label: st.labelFlash > 0,
        out: st.gateFlash > 0,
      };
      const installed: Record<string, boolean> = {
        erect: true, fill: true,
        weigh: engine.config.hasWeigher,
        seal: true,
        label: engine.config.hasLabeler,
        out: true,
      };
      slots.forEach((mm, i) => {
        const meta = STATION_META[i];
        const on = installed[meta.key];
        const act = stationActive[meta.key];
        const bw = Math.min(cartonW + 26, g.pitch * pxPerMm * 0.86);
        const bx = X(mm) - bw / 2;
        ctx.strokeStyle = on ? (act ? meta.line : meta.dim) : '#1c2736';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(on ? [] : [4, 4]);
        ctx.strokeRect(bx, yc - 66, bw, 34);
        ctx.setLineDash([]);
        txt(ctx, X(mm), yc - 72, meta.name + (on ? (act ? ' ●' : '') : ' (n/a)'), on ? meta.line : '#475569');
        // tool symbol descending from the box while acting
        if (on && act && i !== SLOT.ERECT && i !== SLOT.DISCHARGE) {
          vline(ctx, X(mm), yc - 32, yc - 26, meta.line, 3);
        }
        // slot center coordinate mark
        ctx.save();
        ctx.setLineDash([3, 3]);
        vline(ctx, X(mm), chainTop + 30, ry, '#233043', 1);
        ctx.restore();
      });

      // hopper above the FILL slot
      const hx = X(slots[SLOT.FILL]);
      const low = st.supplyLow;
      ctx.strokeStyle = low ? '#f97316' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - 26, yc - 128);
      ctx.lineTo(hx + 26, yc - 128);
      ctx.lineTo(hx + 8, yc - 96);
      ctx.lineTo(hx - 8, yc - 96);
      ctx.closePath();
      ctx.stroke();
      const supStr = engine.hopperRemaining === Infinity ? '∞' : String(engine.hopperRemaining);
      txt(ctx, hx, yc - 112, supStr, low ? '#f97316' : '#cbd5e1');
      txt(ctx, hx, yc - 134, 'HOPPER' + (engine.config.hasHopperSensor ? (low ? ' ○ LOW' : ' ●') : ''), low ? '#f97316' : '#64748b');
      // product falling while the filler fires
      if (st.fillFlash > 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(hx, yc - 78 + (1 - st.fillFlash / 0.1) * 40, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // registration eye (watches the chain lugs, between LABEL and DISCHARGE)
      if (engine.config.hasReg) {
        const rx = X(slots[SLOT.LABEL] + g.pitch / 2);
        const sensing = st.regFlash > 0 || st.braking;
        const c = sensing ? '#22d3ee' : '#155e75';
        vline(ctx, rx, chainTop - 6, chainTop + 14, c, 1.5);
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(rx, chainTop - 10, 3, 0, Math.PI * 2); ctx.fill();
        txt(ctx, rx, chainTop - 18, 'REG EYE @' + engine.regSensorPos().toFixed(1) + (sensing ? ' ●' : ''), sensing ? '#22d3ee' : '#0e7490');
      }
      if (st.regFault) {
        txt(ctx, X(slots[2]), yc - 148, '⚠ REGISTRATION FAULT — eye did not confirm within the travel budget', '#f97316');
      }

      // ---- cartons on the chain ----
      for (const c of engine.cartons) {
        drawCarton(ctx, X(c.x), yc, cartonW, c.fills, engine.recipe.fillCount,
          c.sealed, c.labelA, c.labelB, engine.recipe.cartonLen, c.reject, c.reason);
        // alignment offset readout when noticeably off
        const off = c.x - c.slot * g.pitch;
        if (Math.abs(off) > 1) {
          txt(ctx, X(c.x), yc + 36, 'Δ' + off.toFixed(1), Math.abs(off) > engine.config.alignTol ? '#ef4444' : '#eab308');
        }
      }

      // ---- cartons on the outfeed ----
      for (const c of engine.outfeed) {
        drawCarton(ctx, X(outStart + c.left), yc, c.len * pxPerMm, c.fills, engine.recipe.fillCount,
          c.sealed, c.labelA, c.labelB, c.len, c.reject, c.reason);
      }

      // ---- reject gate + bins at the outfeed end ----
      const gx = X(outEnd);
      const gateHot = st.gateFlash > 0;
      vline(ctx, gx, yc - 44, yc + 30, gateHot ? '#ef4444' : '#475569', gateHot ? 3 : 1.5);
      txt(ctx, gx, yc - 50, gateHot ? 'GATE ▼' : 'GATE', gateHot ? '#ef4444' : '#64748b');
      txt(ctx, gx, yc + 44, st.packed + ' good', '#34d399');
      txt(ctx, gx, yc + 58, st.rejects + ' rej', st.rejects > 0 ? '#f87171' : '#475569');

      // ---- axis / phase readout (top left) ----
      const phaseStr = !st.running ? 'IDLE'
        : st.draining ? 'DRAINING'
        : st.phase === 'index' ? 'INDEXING' : 'PROCESS DWELL';
      txt(ctx, X(axisMin) + 2, 18, phaseStr, st.running ? '#34d399' : '#64748b', 'left');
      txt(ctx, X(axisMin) + 2, 33, 'D ' + st.D.toFixed(1) + 'mm · v ' + st.v.toFixed(0) + 'mm/s · drift ' + engine.drift.toFixed(2) + 'mm', '#475569', 'left');

      frameId = requestAnimationFrame(render);
    }
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      className="w-full h-full border border-dashed border-[#1c2736] rounded-xl overflow-hidden relative"
      style={{ background: 'radial-gradient(circle at 30% 20%, #101a29 0%, #0b1017 100%)' }}
    >
      <div className="absolute inset-0 opacity-15 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#1c2736 1px, transparent 1px), linear-gradient(90deg, #1c2736 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
      <canvas ref={canvasRef} className="block w-full h-full absolute inset-0 z-10" />
    </div>
  );
}
