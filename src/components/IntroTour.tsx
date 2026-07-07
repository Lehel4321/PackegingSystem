import { useState } from 'react';

/**
 * Interactive machine introduction (tour). Ten stepped pages covering
 * the line layout, the two-phase cycle, dwell, safety chain, servo
 * motion & registration eye, the quality gate, three-level config,
 * operator tests, and the debugging tools. Auto-opens on first visit
 * (localStorage flag), reopenable from the header any time.
 */

const INTRO_SEEN_KEY = 'packlinecp6.introSeen';

interface Page {
  title: string;
  body: React.ReactNode;
  hint?: string;
}

const pages: Page[] = [
  {
    title: 'Welcome to PackLine CP-6',
    body: (
      <>
        <p>
          You're looking at a real-time simulation of a PLC-driven carton packaging line. Every button, sensor and
          interlock behaves the way it would on an actual machine — not a demo.
        </p>
        <p>
          You can build recipes, tune the process, run production, break things on purpose, and see exactly what
          happens end-to-end. Same control philosophy as its sister project <span className="text-emerald-400 font-semibold">CuttingMaschine</span>.
        </p>
      </>
    ),
  },
  {
    title: 'The line at a glance',
    body: (
      <>
        <p>Six stations sit in a chain. A blank enters at slot 0 and travels one pitch per cycle:</p>
        <div className="font-mono text-[13px] text-slate-300 bg-[#0b1017] border border-[#1c2736] rounded p-3 my-3 leading-relaxed">
          <span className="text-sky-400">ERECT</span> · <span className="text-amber-400">FILL</span> · <span className="text-violet-400">WEIGH</span> · <span className="text-emerald-400">SEAL</span> · <span className="text-pink-400">LABEL</span> · <span className="text-slate-400">DISCHARGE</span><br />
          <span className="text-slate-500">└─ indexing chain (servo axis) ─┘ → outfeed belt → gate → good / reject</span>
        </div>
        <p>
          Each station acts on the carton in front of it. Slots without a carton (or without a device installed)
          simply cost nothing.
        </p>
      </>
    ),
  },
  {
    title: 'Two phases per cycle',
    body: (
      <>
        <p>Every cycle alternates two phases (watch the top-left status while the line runs):</p>
        <ul className="mt-2 space-y-2">
          <li>
            <b className="text-emerald-400">PROCESS DWELL</b> — the chain stands still. All stations act in
            <span className="text-emerald-400"> parallel</span> on their cartons: the filler drops products one by
            one, the seal head presses down, the labeler applies the label, and so on. The cycle waits for the
            <span className="text-emerald-400"> slowest</span> station.
          </li>
          <li>
            <b className="text-cyan-400">INDEXING</b> — the servo chain moves exactly one pitch forward along a
            jerk-limited S-curve, then process starts again.
          </li>
        </ul>
      </>
    ),
    hint: 'Open the Scope panel and you can literally see the two phases: the velocity trace pulses (index), and the digital tracks fire during the flat parts (process).',
  },
  {
    title: 'What does "dwell" mean?',
    body: (
      <>
        <p>
          <b className="text-amber-400">Dwell</b> = the time an actuator holds still while it does its job.
        </p>
        <div className="grid grid-cols-2 gap-2 text-[12px] font-mono mt-3">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-emerald-400">Seal 0.6 s</span><br />press flaps closed</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-amber-400">Fill 0.25 s/pc</span><br />per product drop</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-violet-400">Weigh 0.5 s</span><br />scale settle time</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-pink-400">Label 0.4 s</span><br />apply the label</div>
        </div>
        <p className="mt-3">
          Longer dwell = more reliable operation but slower cycle. All dwells live in the
          <span className="text-cyan-400"> Tuning</span> panel.
        </p>
      </>
    ),
  },
  {
    title: 'The safety chain',
    body: (
      <>
        <p>No actuator moves without this sequence:</p>
        <ol className="list-decimal list-inside mt-2 space-y-1">
          <li><b>Release the E-Stop</b> if latched (twist to release)</li>
          <li>Press <b className="text-emerald-400">CONTROL ON</b> — enables machine control</li>
          <li>Press <b className="text-emerald-400">▶ START</b> — production begins</li>
        </ol>
        <p className="mt-3">
          <b className="text-red-400">E-Stop</b> is instant and non-resumable (production interrupted, cartons in
          flight are lost). <b className="text-amber-400">Stop</b> is graceful: finishes every carton on the chain,
          empties the outfeed, then goes idle. Use E-Stop only in emergencies.
        </p>
      </>
    ),
    hint: 'Try it: press Start, then E-Stop mid-run — banner turns red, Control-On is interlocked, restart clears the line.',
  },
  {
    title: 'Servo motion + registration eye',
    body: (
      <>
        <p>
          The indexing chain is a real servo axis with a <b className="text-cyan-400">jerk-limited S-curve</b> — the
          same motion solver ported from your <span className="text-emerald-400">MotionProfileSolver</span>.
        </p>
        <p>
          A real chain drifts under mechanical slip. The <b className="text-cyan-400">registration photo-eye</b>
          watches the <em>actual</em> lug position (not the encoder) and corrects the stop target every index —
          a live touch-probe correction.
        </p>
      </>
    ),
    hint: 'Try it: turn Control OFF → Machine Build → uncheck the Registration Eye → Tuning → set Chain Slip to 5. Watch cartons drift off their slots and reject as "misplaced". Turn the eye back on and the drift vanishes.',
  },
  {
    title: 'The check-weigher is your ONLY quality gate',
    body: (
      <>
        <p>
          The line is <b className="text-red-400">blind</b> to bad products, short fills and wrong counts — unless
          the check-weigher is installed. Without it, a bad carton walks straight into the good bin (the log still
          records the true weight, so the mistake shows up on paper).
        </p>
        <div className="bg-amber-950/30 border border-amber-700/50 rounded p-3 text-[12px] mt-3">
          <b className="text-amber-400">Try it:</b> press <b>Inject Bad Product</b>, wait a few seconds, and watch
          the weigher catch it. The reject falls into the bin at the gate. The Packing history shows a red
          <span className="text-red-400"> ✕ weight</span> row with the deviation in grams.
        </div>
      </>
    ),
  },
  {
    title: 'Three-level configuration',
    body: (
      <>
        <p>Same discipline as a real machine — three tiers, each with its own interlock:</p>
        <div className="space-y-2 mt-2">
          <div className="bg-[#0b1017] border-l-2 border-sky-500 pl-3 py-1">
            <b className="text-sky-400">Recipe</b> — the article (product count, weights, carton size, label
            position). Editable only while <b>stopped</b> (you don't change the product mid-run).
          </div>
          <div className="bg-[#0b1017] border-l-2 border-cyan-500 pl-3 py-1">
            <b className="text-cyan-400">Tuning</b> — dwell times, gains, diagnostics. Editable <b>any time</b>.
          </div>
          <div className="bg-[#0b1017] border-l-2 border-slate-500 pl-3 py-1">
            <b className="text-slate-300">Machine Build</b> — physical build (chain pitch, installed devices, servo
            motor data). Editable only with <b>Control OFF</b> (commissioning mode — you don't unbolt a station on
            a running line).
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'Break things safely',
    body: (
      <>
        <p>Every operator button on the panel does something real. Combine them to see how devices interact:</p>
        <div className="grid grid-cols-1 gap-2 mt-2 text-[12px]">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-red-400">Inject Bad Product</b> — queues a wrong-weight product for the filler.
            Caught by the weigher (if installed). Blind on a line without it.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-orange-400">End Supply</b> — cuts the hopper down to a small rest. The hopper-low
            logic kicks in: 'stop' halts at the cycle boundary, 'runout' packs every carton the rest can still
            fill — no short-filled cartons ever leave the machine.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-red-400">E-Stop mushroom</b> — instant halt. Try it and watch the interlocks
            protect the restart.
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'Debugging tools + you\'re ready',
    body: (
      <>
        <div className="space-y-2">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-cyan-400">◉ Scope</b> — logic analyzer: chain velocity + every station's digital
            output. Pause, drag to zoom, drop A/B cursors to measure Δt.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-emerald-400">FC Lab</b> — run any function block (indexer, weigher, hopper, …) in
            isolation against a fresh data block. The test bench.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-slate-300">Packing history</b> — per-carton log with weight deviation, applied vs.
            theoretical label position, reject reason.
          </div>
        </div>
        <p className="mt-4 text-emerald-400 text-center font-semibold">
          You can reopen this tour any time from the <b>? Intro</b> button in the header.
        </p>
      </>
    ),
  },
];

export function IntroTour({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const total = pages.length;
  const p = pages[page];
  const first = page === 0;
  const last = page === total - 1;

  const close = () => {
    try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* ignore */ }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={close}>
      <div
        className="bg-[#0d1420] border border-[#1c2736] rounded-xl w-[560px] max-w-full max-h-[90vh] overflow-hidden text-slate-200 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-4 pb-3 border-b border-[#1c2736]">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-emerald-400 border border-emerald-500/50 rounded-full px-2 py-0.5 uppercase tracking-wider">
              Tour · {page + 1} / {total}
            </span>
          </div>
          <button
            onClick={close}
            className="text-slate-500 hover:text-white cursor-pointer bg-transparent border-none text-xl"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-emerald-400 mb-3">{p.title}</h2>
          <div className="text-sm text-slate-300 leading-relaxed space-y-2">{p.body}</div>
          {p.hint && (
            <div className="mt-4 bg-cyan-950/30 border border-cyan-500/40 rounded p-3 text-[12px] text-cyan-300">
              <b className="text-cyan-400 uppercase tracking-wider text-[10px]">Try it →</b> {p.hint}
            </div>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 py-2 border-t border-[#1c2736]">
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`w-2 h-2 rounded-full cursor-pointer transition-colors
                ${i === page ? 'bg-emerald-400'
                  : i < page ? 'bg-emerald-800 hover:bg-emerald-600'
                    : 'bg-slate-700 hover:bg-slate-600'}`}
              title={pages[i].title}
            />
          ))}
        </div>

        {/* Footer navigation */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-[#1c2736] bg-[#0b1017]/50">
          <button
            onClick={() => setPage(page - 1)}
            disabled={first}
            className={`px-4 py-2 rounded text-xs font-semibold uppercase tracking-wider transition-colors
              ${first ? 'text-slate-700 cursor-not-allowed' : 'text-slate-300 hover:bg-[#1c2736] cursor-pointer border border-[#1c2736]'}`}
          >
            ← Back
          </button>
          <button
            onClick={close}
            className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider cursor-pointer"
          >
            Skip tour
          </button>
          {last ? (
            <button
              onClick={close}
              className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-colors"
            >
              Start packing ▶
            </button>
          ) : (
            <button
              onClick={() => setPage(page + 1)}
              className="px-4 py-2 rounded text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-colors"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read the first-visit flag from localStorage (safe on SSR / private modes). */
export function shouldAutoOpenIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}
