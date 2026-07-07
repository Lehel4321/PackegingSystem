# PackLine CP-6 — Packaging Line Simulator

A PLC-style simulation of a six-slot indexing carton packing line, built
with React + TypeScript + Vite. A sister machine to
[CuttingMaschine](https://github.com/Lehel4321/CuttingMaschine): same
control philosophy (OB1 cyclic scan, FC function blocks, a global data
block, three-level configuration, hard interlocks), applied to a
completely different machine.

## The machine

```
 HOPPER
   ▽
ERECT · FILL · WEIGH · SEAL · LABEL · DISCHARGE ──▶ outfeed ──▶ GATE ▶ good / reject
  0      1      2       3       4        5
└──────────────── indexing chain (servo axis) ────────────────┘
```

Cartons ride on an indexing chain that moves exactly one pitch per
cycle. While the chain stands, all stations act in parallel: the erector
starts a new carton, the filler drops the recipe's product count, the
check-weigher verifies the net weight, the seal head closes the flaps,
the labeler applies the article label and the discharge pusher transfers
the finished carton onto the outfeed belt, where the gate sorts good
cartons from rejects.

## Features

- **Realistic servo motion** — the index axis follows a jerk-limited
  7-phase S-curve (motion solver ported from
  [MotionProfileSolver](https://github.com/Lehel4321/MotionProfileSolver)):
  shape classification, commit-distance braking, reactive slow-down.
- **Registration system** — a photo-eye watches the physical chain (not
  the encoder) and corrects every index stop with a live slip estimate.
  Its trip point is auto-calculated from the axis motor data:
  `pitch − stop distance − PLC reaction − correction constant`.
- **Chain slip diagnostics** — dial in chain stretch and watch cartons
  drift off their slot centers ('misplaced' rejects) unless the
  registration eye is there to correct it.
- **Control system** — Control-ON safety chain, latching E-Stop
  (production not resumable), graceful stop that runs the line empty,
  production orders with an erector gate that never over-produces, and
  hard interlocks on recipe/build editing.
- **Check-weigher quality gate** — net-weight tolerance per recipe; bad
  products and short fills are caught only if the scale is actually
  installed (a blind line packs them into the good bin — the log still
  shows the truth).
- **Hopper run-out logic** — level sensor with 'stop at cycle boundary'
  or 'graceful run-out' modes; the erector only starts cartons the rest
  can still fill.
- **Signal scope** — logic-analyzer view of the chain velocity and every
  station's digital output, with pause, time spans, drag-zoom and A/B
  measurement cursors.
- **Packing history** — per-carton log with weight deviation, product
  pucks, applied vs. theoretical label position and reject reasons.
- **FC Lab** — run every function block in isolation against a fresh
  data block and inspect the output (test bench).

## Architecture

| Block | Role |
|---|---|
| `OB1_Main` | cyclic scan (fixed 1 ms), phase sequencing, device gating |
| `PackagingEngine` | DB1: global data block + HMI bridge |
| `FC_Indexer` / `FC_Registration` | servo chain + photo-eye stop correction |
| `FC_Erector` … `FC_Discharge` | one FC per station, no enable checks inside |
| `FC_Outfeed` | outfeed belt + reject gate |
| `FC_Hopper` | product supply watchdog |
| `MotionProfile` | FC40: S-curve trajectory math |

Configuration is split three ways, each with its own interlock:
**Recipe** (article data, editable only while stopped), **Process
Tuning** (dwells and gains, editable any time), **Machine Build**
(physical configuration, editable only with the control OFF).

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm run lint    # typecheck
npm run build
```

Turn **Control On**, press **Start**, and try *Inject Bad Product*,
*End Supply*, some *Chain Slip* (Process Tuning) with the registration
eye off (Machine Build) — then open the **Scope** and watch the line
breathe.
