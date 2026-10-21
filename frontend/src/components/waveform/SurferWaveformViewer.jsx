import React, { useState, useRef, useEffect } from 'react';
import { 
  Activity, 
  ExternalLink, 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  Upload, 
  Cpu, 
  CheckCircle2, 
  Sparkles, 
  HelpCircle, 
  Radio, 
  Download,
  Info
} from 'lucide-react';

/**
 * SurferWaveformViewer
 * -------------------------------------------------------------
 * Embedded WebAssembly + WebGL Waveform Viewer powered by Surfer (surfer-project.org).
 * 
 * Supports:
 * - Native .fst (Fast Signal Trace) compressed waveforms directly
 * - Standard .vcd (Value Change Dump)
 * - Zero server overhead: 100% Client-side WASM parsing
 * - PostMessage IPC for dynamic waveform switching
 */
export default function SurferWaveformViewer({
  defaultWaveformUrl = "http://192.168.1.111:8000/api/download-latest",
  boardIp = "192.168.1.111",
  resultId = null,
  title = "Surfer EDA Waveform Viewer (FST / VCD)",
  height = "h-[680px]"
}) {
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const [waveformUrl, setWaveformUrl] = useState(defaultWaveformUrl);
  const [activePreset, setActivePreset] = useState('board'); // 'board' | 'result' | 'custom'
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [localFileName, setLocalFileName] = useState(null);
  const [statusMsg, setStatusMsg] = useState('Ready');

  // Compute actual load URL
  const resolvedUrl = React.useMemo(() => {
    if (activePreset === 'board') {
      return `http://${boardIp}:8000/api/download-latest`;
    }
    if (activePreset === 'result' && resultId) {
      return `/api/results/${resultId}/export?format=fst`;
    }
    return waveformUrl;
  }, [activePreset, boardIp, resultId, waveformUrl]);

  // Self-hosted Surfer WASM served by the backend at /surfer/
  // Falls back to the public hosted version if /surfer/ is unavailable.
  const surferBaseUrl = window.location.origin + "/surfer";
  const iframeSrc = `${surferBaseUrl}/?load_url=${encodeURIComponent(resolvedUrl)}`;

  // PostMessage loader
  const triggerLoadWaveform = (urlToLoad) => {
    const target = urlToLoad || resolvedUrl;
    setStatusMsg(`Loading: ${target}...`);
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { command: "LoadUrl", url: target },
        "*"
      );
      setTimeout(() => setStatusMsg('Loaded'), 1200);
    }
  };

  const handlePresetChange = (preset) => {
    setActivePreset(preset);
    let target = "";
    if (preset === 'board') {
      target = `http://${boardIp}:8000/api/download-latest`;
    } else if (preset === 'result' && resultId) {
      target = `/api/results/${resultId}/export?format=fst`;
    } else {
      target = waveformUrl;
    }
    setWaveformUrl(target);
    triggerLoadWaveform(target);
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.warn(`Fullscreen error: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(err => {
        console.warn(`Exit fullscreen error: ${err.message}`);
      });
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen change events from browser
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  return (
    <div 
      ref={containerRef}
      className={`flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : ''
      }`}
    >
      {/* ── Toolbar Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-b border-slate-800 backdrop-blur-md">
        
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-900/30">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 tracking-wide">{title}</h3>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 rounded-full flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                Rust + WASM
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 rounded-full">
                .FST Native
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Status: {statusMsg}</span>
              {localFileName && (
                <span className="text-amber-400">({localFileName})</span>
              )}
            </p>
          </div>
        </div>

        {/* Center: Source Selector Presets */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => handlePresetChange('board')}
            className={`px-3 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activePreset === 'board'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>KR260 Live FST</span>
          </button>

          {resultId && (
            <button
              onClick={() => handlePresetChange('result')}
              className={`px-3 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                activePreset === 'result'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Result #{resultId.slice(0, 8)}</span>
            </button>
          )}

          <button
            onClick={() => setActivePreset('custom')}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${
              activePreset === 'custom'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Custom URL
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Quick Reload Waveform */}
          <button
            onClick={() => triggerLoadWaveform()}
            title="Reload Waveform"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Quick Help / Tooltip */}
          <button
            onClick={() => setShowTips(!showTips)}
            title="Surfer Usage Tips"
            className={`p-1.5 rounded-lg transition-all ${
              showTips ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Open in Standalone Tab */}
          <a
            href={iframeSrc}
            target="_blank"
            rel="noreferrer"
            title="Open in Standalone Tab"
            className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-all flex items-center"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Custom URL Input Bar (Conditional) ────────────────────────── */}
      {activePreset === 'custom' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-950/60 border-b border-slate-800/80 text-xs">
          <span className="text-slate-400 font-mono">FST/VCD URL:</span>
          <input
            type="text"
            value={waveformUrl}
            onChange={(e) => setWaveformUrl(e.target.value)}
            placeholder="http://192.168.1.111:8000/api/download-latest"
            className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => triggerLoadWaveform(waveformUrl)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-all"
          >
            Load
          </button>
        </div>
      )}

      {/* ── Surfer Usage Tips Banner (Collapsible) ──────────────────────── */}
      {showTips && (
        <div className="px-4 py-3 bg-cyan-950/30 border-b border-cyan-900/40 text-xs text-slate-300 flex items-start gap-3 animate-in fade-in duration-200">
          <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full text-[11px]">
            <div>
              <strong className="text-cyan-300">🔍 ซูมและเลื่อน:</strong>
              <p className="text-slate-400">ใช้ Mouse Wheel หรือปุ่ม <kbd className="px-1 bg-slate-800 rounded">Ctrl</kbd> + Wheel เพื่อ Zoom In/Out และลากเพื่อ Pan</p>
            </div>
            <div>
              <strong className="text-cyan-300">📍 วาง Marker / Cursor:</strong>
              <p className="text-slate-400">คลิกที่ Waveform เพื่อปัก Marker หรือลากเพื่อวัดช่วงเวลา (Delta Time & Frequency)</p>
            </div>
            <div>
              <strong className="text-cyan-300">⚙️ ปรับ Radix & Bus:</strong>
              <p className="text-slate-400">คลิกขวาที่ชื่อ Signal เพื่อเปลี่ยนการแสดงผลเป็น Hex, Dec, Bin, หรือ ASCII</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Iframe Container ─────────────────────────────────────── */}
      <div className={`relative w-full ${isFullscreen ? 'flex-1' : height} bg-slate-950`}>
        {!isIframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 z-10">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-400 font-mono">Initializing Surfer WebAssembly Engine...</p>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Surfer Waveform Viewer"
          onLoad={() => {
            setIsIframeLoaded(true);
            setStatusMsg('Surfer WASM Ready');
          }}
          className="w-full h-full border-0"
          allow="fullscreen; cross-origin-isolated"
        />
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span>Engine: Surfer WASM (Rust · Self-hosted)</span>
          <span>•</span>
          <span className="text-slate-400 truncate max-w-md">Target: {resolvedUrl}</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://surfer-project.org"
            target="_blank"
            rel="noreferrer"
            className="hover:text-indigo-400 transition-colors"
          >
            surfer-project.org ↗
          </a>
        </div>
      </div>
    </div>
  );
}
