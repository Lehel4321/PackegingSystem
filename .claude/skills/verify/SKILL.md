# Verify: PackLine CP-6 (packaging line simulator)

React + TS + Vite single-page HMI. Surface = browser GUI at
`http://localhost:3000`.

## Build & launch

```bash
npm install
npm run dev &        # vite on :3000
npm run lint         # tsc --noEmit (CI concern, not verification)
```

## Drive (Playwright, headless)

Chromium is pre-installed at `/opt/pw-browsers/chromium`; install the
`playwright` npm package in a scratch dir and launch with
`executablePath: '/opt/pw-browsers/chromium'`.

Flows worth driving:
1. **Happy path**: click `Control On` → `▶ Start`; after ~14 s the
   Packed tile should read ≥ 5 (cycle ≈ 2 s). Screenshot the canvas.
2. **Quality gate**: click `Inject Bad Product` while running → within
   ~12 s Rejects increments and the Packing history tab shows a red
   `✕ weight` row (deviation ≈ −60 g at default recipe).
3. **Control system**: E-Stop mid-run (banner, Control-On interlocked,
   restart clears the line); `■ Stop` drains chain + outfeed to
   `Ready` in ~20 s.
4. **Hopper run-out**: `End Supply` while running → HOPPER LOW banner,
   line stops itself, Start locked until `⟳ Refill Hopper`.
5. **Slip story**: Control Off → Machine Build → uncheck Registration
   Eye → Tuning → Chain Slip 5 → run: cartons drift (Δ readout) and
   reject `misplaced` (canvas text only — check the Rejects tile, not
   body.innerText). Re-enable the eye: no new rejects at same slip.
6. **Scope**: `◉ Scope` shows S-curve velocity humps + digital pulse
   tracks. Close via the overlay's ✕ (the overlay covers the header
   toggle — clicking the header button times out).

## Gotchas

- Stat tiles render uppercase via CSS: match `innerText` with `/PACKED\n(\d+)/i`.
- NumField inputs commit on blur/Enter, not on keystroke: `fill()` then `press('Enter')`.
- Canvas text (REJECT · MISPLACED, station labels) is not in the DOM;
  assert via stat tiles, history rows, or screenshots.
- Google Fonts import may ERR_CONNECTION_RESET behind the proxy —
  harmless fallback to ui-monospace.
