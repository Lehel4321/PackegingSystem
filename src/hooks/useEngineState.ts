import { useEffect, useState } from 'react';
import { engine } from '../engine/PackagingEngine';

/**
 * Binds React to the engine: drives the fixed-timestep PLC scan from
 * requestAnimationFrame and re-renders on engine.notify().
 */
export function useEngineState() {
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setStamp(Date.now()));

    let lastTime = performance.now();
    let frameId: number;

    const loop = (time: number) => {
      let dt = (time - lastTime) / 1000;
      lastTime = time;
      if (dt > 0.05) dt = 0.05;

      if (engine.state.running) {
        engine.update(dt);
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => {
      unsubscribe();
      cancelAnimationFrame(frameId);
    };
  }, []);

  return { engine, stamp };
}
