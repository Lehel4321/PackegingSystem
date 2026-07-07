import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { engine } from './engine/PackagingEngine';
import './index.css';

// Expose the engine on window so tests + the browser console can poke it.
// Harmless in production — this is a client-only simulator, no secrets.
(window as unknown as { engine: typeof engine }).engine = engine;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
