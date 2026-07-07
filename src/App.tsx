import { useState } from 'react';
import { useEngineState } from './hooks/useEngineState';
import { LineCanvas } from './components/LineCanvas';
import { ControlPanel } from './components/ControlPanel';
import { StatsStrip } from './components/StatsStrip';
import { PackingLog } from './components/PackingLog';
import { BuildPanel } from './components/BuildPanel';
import { ScopeView } from './components/ScopeView';
import { FCLab } from './components/FCLab';

export default function App() {
  const [tab, setTab] = useState<'line' | 'history' | 'lab'>('line');
  const [showBuild, setShowBuild] = useState(false);
  const [showScope, setShowScope] = useState(false);

  useEngineState(); // drives the PLC scan and binds React to engine updates

  const TabBtn = ({ id, label }: { id: 'line' | 'history' | 'lab'; label: string }) => (
    <button
      className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full cursor-pointer transition-colors
        ${tab === id ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40'
          : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#0b1017] text-[#dbe3ee] font-sans">
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1c2736] bg-[#0d1420] flex-shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 bg-emerald-500/30"></div>
            <h1 className="text-lg font-bold tracking-tight uppercase m-0">
              PackLine <span className="text-emerald-500">CP-6</span>
              <span className="text-slate-600 text-xs font-semibold ml-2">CARTON PACKER</span>
            </h1>
          </div>
          <nav className="flex gap-2">
            <TabBtn id="line" label="Line" />
            <TabBtn id="history" label="Packing history" />
            <TabBtn id="lab" label="FC Lab" />
          </nav>
        </div>
        <button
          onClick={() => setShowScope(!showScope)}
          className={`text-xs font-bold uppercase px-3 py-1.5 rounded-full transition-colors border cursor-pointer
            ${showScope ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40'
              : 'bg-transparent text-slate-500 border-slate-800 hover:text-slate-300'}`}
        >
          ◉ Scope
        </button>
      </header>

      <div className="flex-1 p-5 overflow-auto">
        {tab === 'line' && (
          <div className="flex flex-col gap-4 mx-auto max-w-[1320px] relative">
            {showScope && <ScopeView onClose={() => setShowScope(false)} />}
            <div className="relative h-[360px]">
              <LineCanvas />
            </div>
            <StatsStrip />
            <ControlPanel onOpenBuild={() => setShowBuild(true)} />
          </div>
        )}

        {tab === 'history' && (
          <div className="mx-auto max-w-[1320px]">
            <PackingLog />
          </div>
        )}

        {tab === 'lab' && (
          <div className="mx-auto max-w-[1320px]">
            <FCLab />
          </div>
        )}
      </div>

      <footer className="px-5 py-1.5 bg-[#0d1420] border-t border-[#1c2736] flex justify-between items-center flex-shrink-0">
        <span className="text-[10px] font-mono text-slate-600">PLC: SIM · SCAN 1 ms</span>
        <span className="text-[10px] text-slate-500 font-bold">LINE ID: <span className="text-slate-600">CP6-001</span></span>
      </footer>

      {showBuild && <BuildPanel onClose={() => setShowBuild(false)} />}
    </div>
  );
}
