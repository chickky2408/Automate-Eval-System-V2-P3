import React, { useState } from 'react';
import { useTestStore } from '../../store/useTestStore';
import HighPerformanceWaveformViewer from '../waveform/HighPerformanceWaveformViewer';
import MultiArtifactDownloadPanel from '../jobs/MultiArtifactDownloadPanel';
import { Play, Sparkles, Sliders, Layers, FileCode, ArrowRight } from 'lucide-react';

const Workspace = () => {
  const { vcdFiles, firmwareFiles, addJob } = useTestStore();
  const [iterations, setIterations] = useState(1);
  const [activeTab, setActiveTab] = useState('waveform'); // 'waveform' | 'artifacts' | 'setup'

  const handleCreateJob = (vcd, fw) => {
    const newJob = {
      id: crypto.randomUUID(),
      vcd: vcd,
      firmware: fw,
      iterations: iterations,
      status: 'pending',
      timestamp: new Date().toLocaleString()
    };
    addJob?.(newJob);
    alert("Job Created and Added to Queue!");
  };

  return (
    <div className="flex-1 p-6 space-y-6 max-w-7xl mx-auto">
      {/* Workspace Header with Quick Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <span>Silicon Evaluation & Waveform Workspace</span>
          </h2>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Interactive Logic Analyzer, High-Speed Scope, and Artifact Analysis
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('waveform')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'waveform' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Waveform Scope
          </button>
          <button
            onClick={() => setActiveTab('artifacts')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'artifacts' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Artifacts & Tolerances
          </button>
          <button
            onClick={() => setActiveTab('setup')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'setup' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Job Dispatch Setup
          </button>
        </div>
      </div>

      {/* 1. Waveform Scope View */}
      {activeTab === 'waveform' && (
        <div className="space-y-4">
          <HighPerformanceWaveformViewer 
            title="KR260-01 Live Capture Stream (SPI / CML Signals)"
            sampleRateMhz={100}
            totalSamples={50000}
          />
        </div>
      )}

      {/* 2. Artifacts & Tolerances View */}
      {activeTab === 'artifacts' && (
        <div className="space-y-4">
          <MultiArtifactDownloadPanel 
            resultId="res-20260826-kr260-01"
            passed={true}
            durationSeconds={3.45}
            onOpenWaveform={() => setActiveTab('waveform')}
          />
        </div>
      )}

      {/* 3. Job Dispatch Setup */}
      {activeTab === 'setup' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h3 className="text-base font-bold mb-4 text-indigo-400 flex items-center gap-2">
            <Sliders className="w-5 h-5" />
            <span>Setup New Hardware Test Execution</span>
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-6 flex flex-col items-center justify-center min-h-[160px] bg-slate-950/40 transition-colors">
              <FileCode className="w-8 h-8 text-indigo-400 mb-2" />
              <span className="text-slate-200 font-semibold text-sm">Select Test Vector (.bin)</span>
              <span className="text-slate-500 text-xs mt-1">Direct instruction sequence for FPGA PL</span>
            </div>
            
            <div className="border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-xl p-6 flex flex-col items-center justify-center min-h-[160px] bg-slate-950/40 transition-colors">
              <Layers className="w-8 h-8 text-amber-400 mb-2" />
              <span className="text-slate-200 font-semibold text-sm">Select FPGA Bitstream (.bin / .bit)</span>
              <span className="text-slate-500 text-xs mt-1">Target bitstream firmware for KR260 / Zybo</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400 font-mono">Loop Iterations:</label>
              <input 
                type="number" 
                min="1"
                max="100"
                value={iterations} 
                onChange={(e) => setIterations(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white w-20 outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <button 
              onClick={() => handleCreateJob(vcdFiles?.[0], firmwareFiles?.[0])}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all"
            >
              <Play className="w-4 h-4" />
              <span>Dispatch Test Job</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workspace;