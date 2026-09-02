import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Activity, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Play, 
  Pause, 
  Maximize2, 
  Minimize2, 
  Sliders, 
  Eye, 
  Download, 
  Layers,
  ChevronRight,
  Crosshair,
  Gauge
} from 'lucide-react';

/**
 * HighPerformanceWaveformViewer
 * 60fps Canvas-based multi-channel logic analyzer & scope viewer
 * Supports dual measurement cursors (X1, X2, delta-t, frequency), bus decoding, and smooth panning/zooming.
 */
export default function HighPerformanceWaveformViewer({
  title = "SiliconCraft High-Speed Logic Analyzer & Scope",
  sampleRateMhz = 100, // 100 MHz sample rate (10ns timescale)
  totalSamples = 50000,
  initialChannels = null,
  onExport = null
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // Viewport State (Zoom & Pan)
  const [viewStart, setViewStart] = useState(0); // in sample indices
  const [viewCount, setViewCount] = useState(2000); // number of visible samples
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);

  // Measurement Cursors (X1 and X2 in sample index)
  const [cursorX1, setCursorX1] = useState(250);
  const [cursorX2, setCursorX2] = useState(750);
  const [activeCursor, setActiveCursor] = useState(null); // 'X1' | 'X2' | null
  const [showCursors, setShowCursors] = useState(true);
  const [showBusDecoders, setShowBusDecoders] = useState(true);

  // Channels Definition
  const channels = useMemo(() => {
    if (initialChannels) return initialChannels;
    return [
      { id: 'CLK', name: 'CLK_100M', color: '#10b981', type: 'digital', height: 40 },
      { id: 'DATA', name: 'SPI_MOSI', color: '#6366f1', type: 'digital', height: 40 },
      { id: 'MISO', name: 'SPI_MISO', color: '#38bdf8', type: 'digital', height: 40 },
      { id: 'CS_N', name: 'CHIP_SELECT_N', color: '#f59e0b', type: 'digital', height: 40 },
      { id: 'CML_P', name: 'CML_TX_POS', color: '#ec4899', type: 'analog', height: 70 },
      { id: 'CML_N', name: 'CML_TX_NEG', color: '#8b5cf6', type: 'analog', height: 70 },
    ];
  }, [initialChannels]);

  // Generate Sample Waveform Data
  const sampleData = useMemo(() => {
    const data = {};
    for (const ch of channels) {
      const arr = new Float32Array(totalSamples);
      for (let i = 0; i < totalSamples; i++) {
        if (ch.id === 'CLK') {
          arr[i] = i % 2; // 0, 1 toggle
        } else if (ch.id === 'DATA') {
          arr[i] = ((i >> 3) & 1) ^ ((i >> 6) & 1);
        } else if (ch.id === 'MISO') {
          arr[i] = ((i >> 2) & 1);
        } else if (ch.id === 'CS_N') {
          arr[i] = (i % 500) < 400 ? 0 : 1; // Active low packet frame
        } else if (ch.id === 'CML_P') {
          // Analog eye pattern / high-speed signal
          const bit = ((i >> 3) & 1);
          const noise = (Math.sin(i * 0.4) * 0.1) + ((Math.random() - 0.5) * 0.05);
          arr[i] = (bit ? 1.2 : 0.2) + noise;
        } else if (ch.id === 'CML_N') {
          const bit = ((i >> 3) & 1);
          const noise = (Math.cos(i * 0.4) * 0.1) + ((Math.random() - 0.5) * 0.05);
          arr[i] = (bit ? 0.2 : 1.2) + noise;
        }
      }
      data[ch.id] = arr;
    }
    return data;
  }, [channels, totalSamples]);

  // Delta-T and Frequency Math
  const samplePeriodNs = 1000 / sampleRateMhz; // in nanoseconds
  const deltaSamples = Math.abs(cursorX2 - cursorX1);
  const deltaTimeNs = deltaSamples * samplePeriodNs;
  const frequencyMhz = deltaTimeNs > 0 ? (1000 / deltaTimeNs) : 0;

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear background
    ctx.fillStyle = '#090d16'; // Dark deep slate
    ctx.fillRect(0, 0, width, height);

    // Left label sidebar width
    const labelWidth = 140;
    const plotWidth = width - labelWidth;

    // Grid lines & Time markers
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridCols = 10;
    for (let c = 0; c <= gridCols; c++) {
      const x = labelWidth + (c * plotWidth) / gridCols;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Time label on top
      const sampleAtCol = Math.round(viewStart + (c * viewCount) / gridCols);
      const timeNs = sampleAtCol * samplePeriodNs;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText(`${(timeNs / 1000).toFixed(2)} µs`, x + 4, 14);
    }

    // Top Header separator
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(width, 20);
    ctx.stroke();

    let currentY = 28;

    // Render Each Channel
    channels.forEach((ch, idx) => {
      const chHeight = ch.height;
      const data = sampleData[ch.id];

      // Channel background alternate stripe
      if (idx % 2 === 0) {
        ctx.fillStyle = 'rgba(30, 41, 59, 0.25)';
        ctx.fillRect(0, currentY - 4, width, chHeight);
      }

      // Left Channel Label Sidebar
      ctx.fillStyle = ch.color;
      ctx.fillRect(6, currentY + 4, 4, chHeight - 16);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(ch.name, 16, currentY + 16);

      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.fillText(ch.type.toUpperCase(), 16, currentY + 28);

      // Draw Waveform Signal Line
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = ch.type === 'digital' ? 2 : 1.5;
      ctx.beginPath();

      const startIndex = Math.max(0, Math.floor(viewStart));
      const endIndex = Math.min(totalSamples, Math.ceil(viewStart + viewCount));
      const step = Math.max(1, Math.floor((endIndex - startIndex) / plotWidth));

      const midY = currentY + chHeight / 2;
      const topY = currentY + 6;
      const botY = currentY + chHeight - 10;

      let first = true;
      for (let i = startIndex; i < endIndex; i += step) {
        const x = labelWidth + ((i - viewStart) / viewCount) * plotWidth;
        const val = data[i];

        let y;
        if (ch.type === 'digital') {
          y = val > 0.5 ? topY : botY;
        } else {
          // Analog normalizer (0.0 to 1.5V)
          const normalized = Math.max(0, Math.min(1.5, val)) / 1.5;
          y = botY - normalized * (botY - topY);
        }

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          if (ch.type === 'digital') {
            const prevVal = data[i - step];
            const prevY = prevVal > 0.5 ? topY : botY;
            if (prevY !== y) {
              ctx.lineTo(x, prevY);
            }
          }
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Bus Decoding overlay if enabled
      if (showBusDecoders && ch.id === 'DATA' && viewCount < 1000) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        // Group into bytes (8 samples per bit)
        for (let s = startIndex; s < endIndex; s += 32) {
          const bx = labelWidth + ((s - viewStart) / viewCount) * plotWidth;
          const bw = (32 / viewCount) * plotWidth;
          if (bx + bw > labelWidth && bx < width) {
            ctx.strokeRect(bx, botY - 14, bw, 14);
            ctx.fillStyle = '#c7d2fe';
            ctx.font = '9px monospace';
            const hex = `0x${((s / 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`;
            ctx.fillText(hex, bx + bw / 2 - 12, botY - 3);
          }
        }
      }

      // Separator line between channels
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, currentY + chHeight);
      ctx.lineTo(width, currentY + chHeight);
      ctx.stroke();

      currentY += chHeight + 4;
    });

    // Render Measurement Cursors X1 and X2
    if (showCursors) {
      const renderCursor = (cursorSample, label, color, isActive) => {
        if (cursorSample < viewStart || cursorSample > viewStart + viewCount) return;
        const cx = labelWidth + ((cursorSample - viewStart) / viewCount) * plotWidth;

        // Vertical Line
        ctx.strokeStyle = color;
        ctx.lineWidth = isActive ? 2.5 : 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Top Badge
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(cx - 16, 2, 32, 16, 4);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillText(label, cx - 7, 14);
      };

      renderCursor(cursorX1, 'X1', '#3b82f6', activeCursor === 'X1');
      renderCursor(cursorX2, 'X2', '#f43f5e', activeCursor === 'X2');

      // Highlight Region between X1 and X2
      const cx1 = labelWidth + ((cursorX1 - viewStart) / viewCount) * plotWidth;
      const cx2 = labelWidth + ((cursorX2 - viewStart) / viewCount) * plotWidth;
      const leftX = Math.max(labelWidth, Math.min(cx1, cx2));
      const rightX = Math.min(width, Math.max(cx1, cx2));
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      ctx.fillRect(leftX, 20, rightX - leftX, height - 20);
    }
  }, [viewStart, viewCount, channels, sampleData, cursorX1, cursorX2, activeCursor, showCursors, showBusDecoders, samplePeriodNs, totalSamples]);

  // Mouse Wheel Zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.75 : 1.33;
    const newCount = Math.max(50, Math.min(totalSamples, viewCount * zoomFactor));
    
    // Zoom centered around mouse
    const rect = canvasRef.current.getBoundingClientRect();
    const labelWidth = 140;
    const mouseX = Math.max(labelWidth, e.clientX - rect.left);
    const mouseRatio = (mouseX - labelWidth) / (rect.width - labelWidth);
    
    const sampleUnderMouse = viewStart + mouseRatio * viewCount;
    const newStart = Math.max(0, Math.min(totalSamples - newCount, sampleUnderMouse - mouseRatio * newCount));
    
    setViewCount(newCount);
    setViewStart(newStart);
  }, [viewCount, viewStart, totalSamples]);

  // Drag Panning & Cursor Move
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartView, setDragStartView] = useState(0);

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const labelWidth = 140;
    if (x < labelWidth) return;

    const plotRatio = (x - labelWidth) / (rect.width - labelWidth);
    const clickedSample = viewStart + plotRatio * viewCount;

    // Check if clicked near cursor X1 or X2
    const threshold = viewCount * 0.03;
    if (Math.abs(clickedSample - cursorX1) < threshold) {
      setActiveCursor('X1');
    } else if (Math.abs(clickedSample - cursorX2) < threshold) {
      setActiveCursor('X2');
    } else {
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartView(viewStart);
    }
  };

  const handleMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const labelWidth = 140;
    const plotRatio = Math.max(0, Math.min(1, (x - labelWidth) / (rect.width - labelWidth)));
    const sampleAtMouse = Math.round(viewStart + plotRatio * viewCount);

    if (activeCursor === 'X1') {
      setCursorX1(Math.max(0, Math.min(totalSamples, sampleAtMouse)));
    } else if (activeCursor === 'X2') {
      setCursorX2(Math.max(0, Math.min(totalSamples, sampleAtMouse)));
    } else if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      const deltaSamples = (deltaX / (rect.width - labelWidth)) * viewCount;
      const newStart = Math.max(0, Math.min(totalSamples - viewCount, dragStartView - deltaSamples));
      setViewStart(newStart);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setActiveCursor(null);
  };

  return (
    <div 
      ref={containerRef}
      className={`bg-slate-950 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'w-full h-[520px]'
      }`}
    >
      {/* Top Toolbar */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Sample Rate: <span className="text-emerald-400 font-semibold">{sampleRateMhz} MHz</span> • Window: {Math.round(viewStart)} - {Math.round(viewStart + viewCount)} / {totalSamples} samples
            </p>
          </div>
        </div>

        {/* Quick Scope Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom Buttons */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button 
              onClick={() => setViewCount(prev => Math.max(50, prev * 0.7))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewCount(prev => Math.min(totalSamples, prev * 1.4))}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button 
              onClick={() => { setViewStart(0); setViewCount(2000); }}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Reset View"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Toggle Cursors & Decoders */}
          <button 
            onClick={() => setShowCursors(!showCursors)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              showCursors 
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' 
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Cursors</span>
          </button>

          <button 
            onClick={() => setShowBusDecoders(!showBusDecoders)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              showBusDecoders 
                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' 
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Bus Hex</span>
          </button>

          <button 
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Measurement Cursors Readout Bar */}
      {showCursors && (
        <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between text-xs font-mono text-slate-300">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
              <strong className="text-blue-400">X1:</strong> {((cursorX1 * samplePeriodNs) / 1000).toFixed(3)} µs ({cursorX1} pts)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              <strong className="text-rose-400">X2:</strong> {((cursorX2 * samplePeriodNs) / 1000).toFixed(3)} µs ({cursorX2} pts)
            </span>
            <span className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-amber-300">
              <strong className="text-amber-400">Δt:</strong> {deltaTimeNs >= 1000 ? `${(deltaTimeNs / 1000).toFixed(3)} µs` : `${deltaTimeNs.toFixed(1)} ns`}
            </span>
            <span className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded border border-slate-800 text-emerald-300">
              <strong className="text-emerald-400">Freq:</strong> {frequencyMhz.toFixed(2)} MHz
            </span>
          </div>

          <div className="text-[11px] text-slate-500">
            Drag mouse to Pan • Scroll wheel to Zoom • Drag vertical lines to move Cursors
          </div>
        </div>
      )}

      {/* Interactive 60fps Canvas Display */}
      <div className="flex-1 relative cursor-crosshair overflow-hidden">
        <canvas 
          ref={canvasRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="w-full h-full block"
        />
      </div>
    </div>
  );
}
