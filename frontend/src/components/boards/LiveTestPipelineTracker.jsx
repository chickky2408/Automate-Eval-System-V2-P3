import React, { useMemo } from 'react';
import { 
  Zap, 
  Radio, 
  Rocket, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Gauge, 
  Loader2,
  Layers
} from 'lucide-react';

/**
 * LiveTestPipelineTracker
 * Stepped visual pipeline progress tracker for FPGA Test Jobs
 * Stages: Flash Bitstream ➔ DMA S2MM Capture ➔ LZ4 Compression & Stream ➔ Server Ingestion & Decode ➔ Result
 */
export default function LiveTestPipelineTracker({
  currentStage = 'lz4', // 'idle' | 'flash' | 'dma' | 'lz4' | 'server' | 'completed' | 'error'
  elapsedSeconds = 2.4,
  throughputMb = 615.9,
  compressedSizeMb = 5.3,
  rawSizeMb = 100.0,
  isPassed = true,
  errorMessage = null,
}) {
  const stages = useMemo(() => [
    {
      id: 'flash',
      label: 'Flash Bitstream',
      short: 'Bitstream',
      icon: Zap,
      desc: 'fpgautil / xmutil PL Load',
      color: 'amber',
    },
    {
      id: 'dma',
      label: 'DMA Capture',
      short: 'AXI DMA',
      icon: Radio,
      desc: 'S2MM Ring Buffer Read',
      color: 'sky',
    },
    {
      id: 'lz4',
      label: 'LZ4 Streaming',
      short: 'LZ4 Stream',
      icon: Rocket,
      desc: 'RAM ➔ Gigabit LAN',
      color: 'indigo',
    },
    {
      id: 'server',
      label: 'Server Ingest',
      short: 'H5 / VCD Dec',
      icon: Cpu,
      desc: 'Multi-Core Decode & DB',
      color: 'purple',
    },
    {
      id: 'completed',
      label: isPassed ? 'Passed' : 'Failed',
      short: isPassed ? 'PASS' : 'FAIL',
      icon: isPassed ? CheckCircle2 : XCircle,
      desc: isPassed ? 'Test Validated' : (errorMessage || 'Check Logs'),
      color: isPassed ? 'emerald' : 'rose',
    },
  ], [isPassed, errorMessage]);

  const stageOrder = ['idle', 'flash', 'dma', 'lz4', 'server', 'completed', 'error'];
  const currentIndex = stageOrder.indexOf(currentStage);

  return (
    <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-3 shadow-inner">
      {/* Top Status Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              currentStage === 'completed' ? 'bg-emerald-400' : currentStage === 'error' ? 'bg-rose-400' : 'bg-indigo-400'
            }`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              currentStage === 'completed' ? 'bg-emerald-500' : currentStage === 'error' ? 'bg-rose-500' : 'bg-indigo-500'
            }`} />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Pipeline: <span className="text-indigo-400 font-mono">{currentStage.toUpperCase()}</span>
          </span>
        </div>

        {/* Live Metrics Telemetry Badges */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>{elapsedSeconds.toFixed(1)}s</span>
          </span>
          
          {currentStage === 'lz4' && (
            <span className="flex items-center gap-1 text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/80 animate-pulse">
              <Rocket className="w-3 h-3 text-indigo-400" />
              <span>{throughputMb.toFixed(0)} MB/s</span>
            </span>
          )}

          {rawSizeMb > 0 && (
            <span className="text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              {compressedSizeMb > 0 ? `${compressedSizeMb.toFixed(1)} MB (${(rawSizeMb/compressedSizeMb).toFixed(0)}x)` : `${rawSizeMb} MB`}
            </span>
          )}
        </div>
      </div>

      {/* Stepped Pipeline Tracker Track */}
      <div className="relative grid grid-cols-5 gap-2 pt-1">
        {stages.map((stage, idx) => {
          const stepIndex = idx + 1; // 1 to 5
          const isDone = currentIndex > stepIndex || (currentIndex === 5 && idx === 4);
          const isCurrent = currentIndex === stepIndex;
          const isPending = currentIndex < stepIndex;

          const IconComponent = stage.icon;

          return (
            <div key={stage.id} className="flex flex-col items-center gap-1.5 relative">
              {/* Connector Bar */}
              {idx < 4 && (
                <div 
                  className={`absolute top-4 left-1/2 w-full h-0.5 z-0 transition-all duration-500 ${
                    currentIndex > stepIndex ? 'bg-indigo-500' : 'bg-slate-800'
                  }`}
                />
              )}

              {/* Step Node Circle */}
              <div 
                className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-300 ${
                  isDone 
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                    : isCurrent 
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-400/40 animate-pulse' 
                    : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}
              >
                {isCurrent ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <IconComponent className="w-4 h-4" />
                )}
              </div>

              {/* Step Label */}
              <div className="text-center">
                <p className={`text-[11px] font-bold leading-tight ${
                  isCurrent ? 'text-indigo-300 font-semibold' : isDone ? 'text-slate-200' : 'text-slate-500'
                }`}>
                  {stage.short}
                </p>
                <p className="text-[9px] text-slate-500 hidden sm:block">
                  {stage.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
