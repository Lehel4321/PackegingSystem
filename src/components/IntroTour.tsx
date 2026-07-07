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
    title: 'Welcome',
    body: (
      <>
        <p>
          This is <b className="text-emerald-400">PackLine CP-6</b>, a live simulation of an industrial carton
          packaging line — running as a virtual PLC right in your browser.
        </p>
        <p>
          Every button, sensor and interlock on the screen behaves the way it would on a real factory machine.
          Nothing here is a hard-coded demo: the line reacts to what you do, in real time.
        </p>
        <p className="text-slate-400 text-[13px] mt-3">
          This tour takes about two minutes and covers what the line does, the vocabulary used on the screen, and a
          few things to try. Feel free to skip it — you can reopen it any time from the header.
        </p>
      </>
    ),
  },
  {
    title: 'What the line does',
    body: (
      <>
        <p>
          It packs products into cartons. Six stations sit in a row along an indexing chain — think of it as a
          conveyor that moves one step at a time:
        </p>
        <div className="font-mono text-[13px] text-slate-300 bg-[#0b1017] border border-[#1c2736] rounded p-3 my-3 leading-relaxed">
          <span className="text-sky-400">ERECT</span> · <span className="text-amber-400">FILL</span> · <span className="text-violet-400">WEIGH</span> · <span className="text-emerald-400">SEAL</span> · <span className="text-pink-400">LABEL</span> · <span className="text-slate-400">DISCHARGE</span><br />
          <span className="text-slate-500">└──── indexing chain ────┘ → outfeed → gate → good / reject</span>
        </div>
        <p>
          A flat blank enters at the left, gets folded into a carton, filled with the right number of products,
          weighed, sealed, labeled, and pushed onto the outfeed belt. Bad cartons are rejected at the gate.
        </p>
      </>
    ),
  },
  {
    title: 'The two phases of a cycle',
    body: (
      <>
        <p>Every cycle alternates two phases. Watch the status text in the top-left of the line view:</p>
        <ul className="mt-2 space-y-2">
          <li>
            <b className="text-emerald-400">PROCESS DWELL</b> — the chain stands still. All the stations act in
            <span className="text-emerald-400"> parallel</span> on the cartons in front of them: the filler drops
            products one by one, the seal head presses down, and so on. The cycle waits for whichever station is
            <span className="text-emerald-400"> slowest</span>.
          </li>
          <li>
            <b className="text-cyan-400">INDEXING</b> — the chain moves forward by exactly one slot along a smooth
            accelerate-cruise-brake curve, then the process phase starts again.
          </li>
        </ul>
      </>
    ),
    hint: 'Open the Scope panel while the line is running — the velocity trace pulses (index moves) and the digital signal tracks fire during the flat parts (stations working).',
  },
  {
    title: 'What does "dwell" mean?',
    body: (
      <>
        <p>
          <b className="text-amber-400">Dwell</b> is the time an actuator holds still while it does its job.
          It's a word you'll see all over the Tuning panel:
        </p>
        <div className="grid grid-cols-2 gap-2 text-[12px] font-mono mt-3">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-emerald-400">Seal dwell 0.6 s</span><br />how long the seal head presses to close the flaps</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-amber-400">Fill 0.25 s/product</span><br />gap between each product drop</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-violet-400">Weigh settle 0.5 s</span><br />time the scale needs to stabilize</div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2"><span className="text-pink-400">Label dwell 0.4 s</span><br />time to print &amp; apply the label</div>
        </div>
        <p className="mt-3">
          Longer dwells make each station more reliable but slow the whole line down. That trade-off is exactly
          what an automation engineer tunes on a real machine.
        </p>
      </>
    ),
  },
  {
    title: 'Getting the line moving',
    body: (
      <>
        <p>Just like a real machine, nothing moves until three things are true:</p>
        <ol className="list-decimal list-inside mt-2 space-y-1">
          <li>The <b>E-Stop</b> is released (twist to release if it's latched)</li>
          <li><b className="text-emerald-400">CONTROL ON</b> is enabled (the "power" for the actuators)</li>
          <li><b className="text-emerald-400">▶ START</b> is pressed</li>
        </ol>
        <p className="mt-3">
          Two ways to stop: <b className="text-red-400">E-Stop</b> is instant and drastic (any carton on the line
          is lost). <b className="text-amber-400">Stop</b> is graceful — the line finishes every carton in
          progress and empties the belt before going idle. On a real production line, only the E-Stop is used for
          actual emergencies.
        </p>
      </>
    ),
    hint: 'Press Start, then hit the red E-Stop mushroom mid-run. Notice how Control-On stays disabled until the E-Stop is released. That interlock exists on every real machine.',
  },
  {
    title: 'Smooth motion + a self-correcting eye',
    body: (
      <>
        <p>
          The indexing chain is modeled as an actual servo motor. Each move follows a
          <b className="text-cyan-400"> jerk-limited S-curve</b> — the standard motion profile in industrial
          servo drives — so it accelerates smoothly instead of jerking to speed.
        </p>
        <p>
          Real chains also slip a little under load. The <b className="text-cyan-400">registration photo-eye</b>
          watches the actual chain position (not the encoder) and corrects the stop target on every single move.
          It's the same "touch probe" trick used on real packaging equipment.
        </p>
      </>
    ),
    hint: 'To see it fail: turn Control OFF → open Machine Build → uncheck Registration Eye. Then open Tuning and set Chain Slip to 5. Restart the line and cartons will drift off their slot centers and reject as "misplaced". Turn the eye back on and the drift disappears.',
  },
  {
    title: 'How the line detects bad cartons',
    body: (
      <>
        <p>
          The <b className="text-violet-400">check-weigher</b> is the line's only quality inspector. It weighs
          every carton and compares against the recipe's target weight — if a product is missing, wrong, or way
          too light, the weigher flags the carton and the gate at the end rejects it.
        </p>
        <p className="text-slate-400 text-[13px] mt-2">
          Interesting detail: if the check-weigher is removed from the machine build, the line becomes
          <b className="text-red-400"> blind</b>. Bad cartons walk straight into the good bin. The packing history
          still records the true weight, so the mistake is visible on paper — but the line itself can't act on it.
        </p>
        <div className="bg-amber-950/30 border border-amber-700/50 rounded p-3 text-[12px] mt-3">
          <b className="text-amber-400">Try it →</b> press <b>Inject Bad Product</b>. A few seconds later the
          weigher catches it and the reject tumbles into the bin at the gate. The Packing history tab shows a red
          <span className="text-red-400"> ✕ WEIGHT</span> row with the deviation in grams.
        </div>
      </>
    ),
  },
  {
    title: 'Three levels of configuration',
    body: (
      <>
        <p>The settings are split into three tiers — same discipline used on real machines:</p>
        <div className="space-y-2 mt-2">
          <div className="bg-[#0b1017] border-l-2 border-sky-500 pl-3 py-1">
            <b className="text-sky-400">Recipe</b> — the article being packed (how many products per carton,
            weights, carton size, label position). Editable only while the line is <b>stopped</b> — you don't
            change the product mid-run.
          </div>
          <div className="bg-[#0b1017] border-l-2 border-cyan-500 pl-3 py-1">
            <b className="text-cyan-400">Tuning</b> — dwell times, belt speeds, tolerances. Adjustable
            <b> any time</b>, even while packing.
          </div>
          <div className="bg-[#0b1017] border-l-2 border-slate-500 pl-3 py-1">
            <b className="text-slate-300">Machine Build</b> — the physical machine (chain pitch, which devices are
            installed, servo motor data). Editable only with <b>Control OFF</b> — you don't unbolt a station on a
            live line.
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'Things to try',
    body: (
      <>
        <p>Every button on the panel does something real. Some experiments to get you started:</p>
        <div className="grid grid-cols-1 gap-2 mt-2 text-[12px]">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-red-400">Inject Bad Product</b> — the weigher catches it, watch the reject fall
            into the bin.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-orange-400">End Supply</b> — the hopper runs low. In "runout" mode the line packs
            every carton it can still fill completely, then stops cleanly — no half-filled cartons ever leave the
            machine.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-red-400">E-Stop</b> mid-run — instant halt, then observe how the safety
            interlocks make you restart properly.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2">
            <b className="text-sky-400">Add Chain Slip</b> (Tuning) with the registration eye disabled (Machine
            Build) — watch cartons drift off their slots.
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'Under the hood',
    body: (
      <>
        <p>Three tools for looking deeper into how the line runs:</p>
        <div className="space-y-2 mt-2">
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-cyan-400">◉ Scope</b> (top-right) — a live logic analyzer. Chain velocity and every
            station's digital signal, with pause, drag-to-zoom, and A/B cursors for measuring timings.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-emerald-400">FC Lab</b> tab — run any single control function block (the indexer,
            the weigher, the hopper watchdog, …) in isolation against a fresh data snapshot. Effectively an
            in-browser test bench.
          </div>
          <div className="bg-[#0b1017] border border-[#1c2736] rounded p-2 text-[12px]">
            <b className="text-slate-300">Packing history</b> tab — one row per carton with weight deviation,
            applied vs. theoretical label position, and reject reasons.
          </div>
        </div>
        <p className="mt-4 text-emerald-400 text-center font-semibold">
          Enjoy exploring the line.
        </p>
        <p className="text-slate-500 text-[11px] text-center mt-1">
          The <b>? Intro</b> button in the header reopens this tour any time.
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
