import { PackagingEngine, NUM_SLOTS } from './PackagingEngine';

/**
 * FC10: Line Layout & Geometry
 *
 * Calculates the physical positions of the six pitch slots and the
 * outfeed belt along the line axis (in mm) from the machine build, and
 * the mm→pixel mapping for the HMI canvas. Slot n center = n · pitch;
 * the outfeed belt starts at the discharge slot.
 */
export function FC_Layout(db: PackagingEngine, w: number = 1100, h: number = 360) {
  const padL = 46, padR = 46;
  const pitch = db.config.pitch;

  // Slot centers along the line
  const slots = Array.from({ length: NUM_SLOTS }, (_, i) => i * pitch);

  // Outfeed belt: from the discharge slot to the gate/bins
  const outStart = (NUM_SLOTS - 1) * pitch;
  const outEnd = outStart + db.config.outLen;

  // Coordinate axis limits for the visualization
  const axisFrom = -0.55 * pitch;
  const lead = (outEnd - axisFrom) * 0.02;
  const axisMin = axisFrom - lead;
  const axisMax = outEnd + lead;

  // Scaling factor: pixels per millimetre
  const pxPerMm = (w - padL - padR) / (axisMax - axisMin);

  // Map a millimetre coordinate to a canvas pixel X-coordinate
  const X = (mm: number) => padL + (mm - axisMin) * pxPerMm;

  return {
    w, h,
    yc: h * 0.52, // Y-center of the chain/carton row
    pitch, slots, outStart, outEnd,
    axisMin, axisMax, pxPerMm, X,
  };
}
