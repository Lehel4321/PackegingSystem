import { useEffect, useRef, useState } from 'react';
import { engine } from '../engine/PackagingEngine';
import { ScopeSample } from '../types';

// The trace itself is recorded INSIDE the PLC cycle (OB1 Network 1a,
// 4 ms resolution) into engine.scopeTrace — this panel only reads it.
// Recording at the HMI framerate instead would alias the servo ramps
// into fake instant jumps. The time axis is MACHINE time (simTime),
// exactly like a real drive scope bound to the PLC.

const SIGNALS: { key: keyof ScopeSample; label: string; color: string; when?: () => boolean }[] = [
  { key: 'idx', label: 'INDEX MOVE', color: '#34d399' },
  { key: 'reg', label: 'REG EYE / BRAKE', color: '#22d3ee', when: () => engine.config.hasReg },
  { key: 'fill', label: 'FILL DROP', color: '#f59e0b' },
  { key: 'weigh', label: 'WEIGH READ', color: '#a78bfa', when: () => engine.config.hasWeigher },
  { key: 'seal', label: 'SEAL HEAD', color: '#10b981' },
  { key: 'label', label: 'LABEL APPLY', color: '#f472b6', when: () => engine.config.hasLabeler },
  { key: 'gate', label: 'REJECT GATE', color: '#ef4444' },
  { key: 'low', label: 'HOPPER LOW', color: '#f97316', when: () => engine.config.hasHopperSensor },
];

export function ScopeView({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [timeSpan, setTimeSpan] = useState(5000); // 5s default (~2 cycles)
  const [customView, setCustomView] = useState<{ tMin: number, tMax: number } | null>(null);

  // Cursors (X pixel positions)
  const [cursorA, setCursorA] = useState<number | null>(null);
  const [cursorB, setCursorB] = useState<number | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<string>('v');

  // Live cursor values
  const [cursorData, setCursorData] = useState<{ A: { t: number; sample: ScopeSample } | null; B: { t: number; sample: ScopeSample } | null } | null>(null);

  // Zoom box state
  const [dragZoomStart, setDragZoomStart] = useState<number | null>(null);
  const [dragZoomCurrent, setDragZoomCurrent] = useState<number | null>(null);

  const currentViewRef = useRef<{ tMin: number, tMax: number }>({ tMin: 0, tMax: 0 });
  // Machine time (ms) the display is frozen at while paused. The PLC
  // keeps recording; pause only freezes the view.
  const frozenNowRef = useRef(0);

  // Leaving pause discards any zoom view
  useEffect(() => {
    if (!paused) {
      setCustomView(null);
    }
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const render = () => {
      const samples = engine.scopeTrace;

      // Draw
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#0b1017';
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = '#141d2b';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += w / 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += h / 10) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      if (samples.length < 2) {
        frameId = requestAnimationFrame(render);
        return;
      }

      // View anchor: newest machine time while live, frozen while paused.
      if (!paused) frozenNowRef.current = samples[samples.length - 1].t;
      const now = frozenNowRef.current;

      let tMin = now - timeSpan;
      let tMax = now;

      if (customView) {
        tMin = customView.tMin;
        tMax = customView.tMax;
      }

      currentViewRef.current = { tMin, tMax };

      const vSpan = Math.max(1, tMax - tMin);
      const X = (t: number) => ((t - tMin) / vSpan) * w;

      const activeSignals = SIGNALS.filter(s => !s.when || s.when());
      const trackH = 34;
      const analogH = Math.max(60, h - (activeSignals.length * trackH) - 44);

      // Filter visible samples
      let startIndex = 0;
      let endIndex = samples.length - 1;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].t >= tMin) {
          startIndex = Math.max(0, i - 1);
          break;
        }
      }
      for (let i = startIndex; i < samples.length; i++) {
        if (samples[i].t > tMax) {
          endIndex = i;
          break;
        }
      }
      const visibleSamples = samples.slice(startIndex, endIndex + 1);

      if (visibleSamples.length > 0) {
        // Analog track: chain velocity
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const maxV = Math.max(100, engine.config.axVmax);
        for (let i = 0; i < visibleSamples.length; i++) {
          const s = visibleSamples[i];
          const x = X(s.t);
          const y = 25 + analogH - (s.v / maxV) * analogH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.fillStyle = '#38bdf8';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('CHAIN VELOCITY', 5, 15);

      // Digital tracks
      let yOffset = 25 + analogH + 30;

      const drawDigital = (label: string, color: string, valueFn: (s: ScopeSample) => boolean) => {
        ctx.fillStyle = color;
        ctx.fillText(label, 5, yOffset - 5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        if (visibleSamples.length > 0) {
          ctx.beginPath();
          for (let i = 0; i < visibleSamples.length; i++) {
            const s = visibleSamples[i];
            const x = X(s.t);
            const val = valueFn(s);
            const y = yOffset + (val ? -20 : 0);
            if (i === 0) ctx.moveTo(x, y);
            else {
              const prevVal = valueFn(visibleSamples[i - 1]);
              if (prevVal !== val) {
                ctx.lineTo(x, y); // vertical edge
              }
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }

        // draw baseline faintly
        ctx.strokeStyle = color + '40';
        ctx.beginPath(); ctx.moveTo(0, yOffset); ctx.lineTo(w, yOffset); ctx.stroke();

        yOffset += trackH;
      };

      activeSignals.forEach(sig => {
        drawDigital(sig.label, sig.color, s => !!s[sig.key]);
      });

      frameId = requestAnimationFrame(render);
    };

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, [timeSpan, paused, customView]);

  // Compute cursor data
  useEffect(() => {
    const updateCursorData = () => {
      const samples = engine.scopeTrace;
      if (samples.length < 2) return;
      const { tMin, tMax } = currentViewRef.current;
      const vSpan = Math.max(1, tMax - tMin);

      const getSampleAtPixel = (px: number) => {
        const t = tMin + (px / (canvasRef.current?.width || 1)) * vSpan;
        let closest = samples[0];
        let minDist = Infinity;
        for (const s of samples) {
          const d = Math.abs(s.t - t);
          if (d < minDist) {
            minDist = d;
            closest = s;
          }
        }
        return { t, sample: closest };
      };

      const datA = cursorA !== null ? getSampleAtPixel(cursorA) : null;
      const datB = cursorB !== null ? getSampleAtPixel(cursorB) : null;

      setCursorData({ A: datA, B: datB });
    };

    if (!paused) {
      const id = setInterval(updateCursorData, 100);
      return () => clearInterval(id);
    } else {
      updateCursorData();
    }
  }, [cursorA, cursorB, paused, timeSpan, customView]);

  // Pointer interactions
  const [dragging, setDragging] = useState<'A' | 'B' | null>(null);

  const handlePointerDown = (e: React.PointerEvent, id: 'A' | 'B') => {
    setDragging(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (dragging) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setDragZoomStart(x);
    setDragZoomCurrent(x);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    if (dragging === 'A') setCursorA(x);
    else if (dragging === 'B') setCursorB(x);
    else if (dragZoomStart !== null) setDragZoomCurrent(x);
  };

  const handlePointerUp = () => {
    if (dragging) {
      setDragging(null);
    } else if (dragZoomStart !== null && dragZoomCurrent !== null) {
      const x1 = Math.min(dragZoomStart, dragZoomCurrent);
      const x2 = Math.max(dragZoomStart, dragZoomCurrent);
      if (x2 - x1 > 10) { // minimum drag to zoom
        const { tMin, tMax } = currentViewRef.current;
        const w = containerRef.current?.clientWidth || 1;
        const t1 = tMin + (x1 / w) * (tMax - tMin);
        const t2 = tMin + (x2 / w) * (tMax - tMin);
        setCustomView({ tMin: t1, tMax: t2 });
        setPaused(true);
        // Map cursors to the new coordinate space if active
        if (cursorA !== null) {
          const cAt = tMin + (cursorA / w) * (tMax - tMin);
          setCursorA(((cAt - t1) / (t2 - t1)) * w);
        }
        if (cursorB !== null) {
          const cBt = tMin + (cursorB / w) * (tMax - tMin);
          setCursorB(((cBt - t1) / (t2 - t1)) * w);
        }
      }
      setDragZoomStart(null);
      setDragZoomCurrent(null);
    }
  };

  // Ensure canvas matches container size
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getSignalValue = (s: ScopeSample, sig: string) => {
    if (sig === 'v') return s.v.toFixed(1) + ' mm/s';
    const val = s[sig as keyof ScopeSample];
    return typeof val === 'boolean' ? (val ? '1' : '0') : '-';
  };

  const getSignalNum = (s: ScopeSample, sig: string) => {
    if (sig === 'v') return s.v;
    const val = s[sig as keyof ScopeSample];
    return typeof val === 'boolean' ? (val ? 1 : 0) : 0;
  };

  return (
    <div className="fixed inset-4 bg-[#0d1420]/95 backdrop-blur-md border border-[#1c2736] rounded-xl p-4 shadow-2xl z-50 flex flex-col">
      <div className="flex justify-between items-center mb-4 border-b border-[#1c2736] pb-2">
        <h2 className="text-cyan-400 font-bold uppercase tracking-wider text-lg m-0">Signal Scope · Logic Analyzer</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-white cursor-pointer bg-transparent border-none text-xl">✕</button>
      </div>

      <div className="flex gap-4 mb-4 items-center">
        <button
          onClick={() => setPaused(!paused)}
          className={`px-4 py-2 rounded font-bold uppercase text-xs transition-colors cursor-pointer ${paused ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 uppercase font-bold">Time Span:</span>
          <select
            value={timeSpan}
            onChange={e => { setTimeSpan(Number(e.target.value)); setCustomView(null); }}
            disabled={!!customView}
            className="bg-[#0b1017] border border-[#1c2736] text-slate-300 rounded px-2 py-1 font-mono disabled:opacity-50"
          >
            <option value={2000}>2 Seconds</option>
            <option value={5000}>5 Seconds</option>
            <option value={10000}>10 Seconds</option>
            <option value={30000}>30 Seconds</option>
            <option value={60000}>1 Minute</option>
            <option value={120000}>2 Minutes</option>
          </select>
        </div>

        {customView && (
          <button
            onClick={() => setCustomView(null)}
            className="px-3 py-1 bg-[#1c2736] hover:bg-[#26344a] text-cyan-400 rounded text-xs font-bold uppercase transition-colors border border-cyan-500/50 cursor-pointer"
          >
            Reset Zoom
          </button>
        )}

        <div className="flex items-center gap-2 text-xs ml-auto">
          <span className="text-slate-500 uppercase font-bold">Measure Signal:</span>
          <select
            value={selectedSignal}
            onChange={e => setSelectedSignal(e.target.value)}
            className="bg-[#0b1017] border border-[#1c2736] text-slate-300 rounded px-2 py-1 font-mono"
          >
            <option value="v">Chain Velocity</option>
            {SIGNALS.filter(s => !s.when || s.when()).map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => {
            if (cursorA === null) {
              setCursorA(100); setCursorB(300); setPaused(true);
            } else {
              setCursorA(null); setCursorB(null);
            }
          }}
          className="px-3 py-1 bg-[#1c2736] hover:bg-[#26344a] text-slate-300 rounded text-xs font-bold uppercase transition-colors cursor-pointer"
        >
          {cursorA !== null ? 'Hide Cursors' : 'Show Cursors'}
        </button>
      </div>

      <div className="text-slate-500 text-[10px] uppercase font-bold mb-2">
        Tip: Drag on the graph to zoom into a specific time window.
      </div>

      <div
        className="flex-1 relative bg-[#0b1017] rounded border border-[#1c2736] overflow-hidden select-none cursor-crosshair"
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />

        {/* Zoom drag box */}
        {dragZoomStart !== null && dragZoomCurrent !== null && (
          <div
            className="absolute top-0 bottom-0 bg-sky-500/20 border-x border-sky-500/50 pointer-events-none"
            style={{
              left: Math.min(dragZoomStart, dragZoomCurrent),
              width: Math.abs(dragZoomCurrent - dragZoomStart)
            }}
          />
        )}

        {/* Cursor A */}
        {cursorA !== null && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 cursor-ew-resize hover:bg-cyan-300 hover:w-[4px] hover:-ml-[1px]"
            style={{ left: cursorA }}
            onPointerDown={e => handlePointerDown(e, 'A')}
          >
            <div className="absolute top-2 -left-3 bg-cyan-400 text-black text-[10px] font-bold px-1 rounded">A</div>
          </div>
        )}

        {/* Cursor B */}
        {cursorB !== null && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-fuchsia-400 cursor-ew-resize hover:bg-fuchsia-300 hover:w-[4px] hover:-ml-[1px]"
            style={{ left: cursorB }}
            onPointerDown={e => handlePointerDown(e, 'B')}
          >
            <div className="absolute top-8 -left-3 bg-fuchsia-400 text-black text-[10px] font-bold px-1 rounded">B</div>
          </div>
        )}
      </div>

      {/* Measurements */}
      {(cursorA !== null || cursorB !== null) && (
        <div className="mt-4 grid grid-cols-3 gap-4 bg-[#0b1017] border border-[#1c2736] rounded p-3 font-mono text-xs">
          <div className="flex flex-col border-r border-[#1c2736] pr-4">
            <span className="text-cyan-400 font-bold mb-1">CURSOR A</span>
            {cursorData?.A ? (
              <>
                <div className="flex justify-between"><span className="text-slate-500">Time</span> <span className="text-slate-300">{(cursorData.A.t / 1000).toFixed(3)} s</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Value</span> <span className="text-slate-300">{getSignalValue(cursorData.A.sample, selectedSignal)}</span></div>
              </>
            ) : <span className="text-slate-600">Off</span>}
          </div>
          <div className="flex flex-col border-r border-[#1c2736] px-4">
            <span className="text-fuchsia-400 font-bold mb-1">CURSOR B</span>
            {cursorData?.B ? (
              <>
                <div className="flex justify-between"><span className="text-slate-500">Time</span> <span className="text-slate-300">{(cursorData.B.t / 1000).toFixed(3)} s</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Value</span> <span className="text-slate-300">{getSignalValue(cursorData.B.sample, selectedSignal)}</span></div>
              </>
            ) : <span className="text-slate-600">Off</span>}
          </div>
          <div className="flex flex-col pl-4">
            <span className="text-emerald-400 font-bold mb-1">DIFFERENCE (Δ)</span>
            {cursorData?.A && cursorData?.B ? (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-500">Δ Time</span>
                  <span className="text-emerald-300 font-bold">{Math.abs(cursorData.B.t - cursorData.A.t).toFixed(0)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Δ Value</span>
                  <span className="text-slate-300">
                    {(getSignalNum(cursorData.B.sample, selectedSignal) - getSignalNum(cursorData.A.sample, selectedSignal)).toFixed(selectedSignal === 'v' ? 1 : 0)}
                  </span>
                </div>
              </>
            ) : <span className="text-slate-600">Need both cursors</span>}
          </div>
        </div>
      )}
    </div>
  );
}
