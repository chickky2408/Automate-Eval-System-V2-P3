import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Activity, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Maximize2, 
  Minimize2, 
  Layers, 
  Crosshair, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Eye, 
  EyeOff, 
  ListFilter,
  Flame,
  ShieldCheck
} from 'lucide-react';

/**
 * HighPerformanceWaveformViewer
 * -------------------------------------------------------------
 * 60fps Canvas-based multi-channel logic analyzer & scope viewer.
 * SPEC-0002 & ADR-0002 Features:
 * - Ghost Line: Overlay expected golden trace (dashed amber/gold).
 * - Red Mismatch Bounding Boxes: Highlight localized digital discrepancies.
 * - Mismatch Stepper: Jump & zoom directly to Next/Prev diff intervals.
 * - Discrepancy Drawer: Interactive table of mismatch zones & verification scores.
 * - Dual measurement cursors (X1, X2, delta-t, frequency) & smooth panning/zooming.
 */
export default function HighPerformanceWaveformViewer({
  title = "SiliconCraft High-Speed Logic Analyzer & Scope",
  sampleRateMhz = 100, // 100 MHz sample rate (10ns timescale)
  totalSamples = 50000,
  initialChannels = null,
  resultId = null,
  diffData: initialDiffData = null,
  onExport = null
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Diff Data & Verification state
  const [diffData, setDiffData] = useState(initialDiffData);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [showGhostLine, setShowGhostLine] = useState(true);
  const [showMismatchBoxes, setShowMismatchBoxes] = useState(true);
  const [showDiscrepancyDrawer, setShowDiscrepancyDrawer] = useState(false);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState(0);

  // Viewport State (Zoom & Pan)
  const [viewStart, setViewStart] = useState(0); // in sample indices
  const [viewCount, setViewCount] = useState(2000); // number of visible samples
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Measurement Cursors (X1 and X2 in sample index)
  const [cursorX1, setCursorX1] = useState(250);
  const [cursorX2, setCursorX2] = useState(750);
  const [activeCursor, setActiveCursor] = useState(null); // 'X1' | 'X2' | null
  const [showCursors, setShowCursors] = useState(true);
  const [showBusDecoders, setShowBusDecoders] = useState(true);

  // Fetch diff data if resultId is provided and no diffData passed
  useEffect(() => {
    if (initialDiffData) {
      setDiffData(initialDiffData);
      return;
    }
    if (!resultId) return;

    let isMounted = true;
    setLoadingDiff(true);
    fetch(`/api/v1/results/${resultId}/waveform-diff`)
      .then(res => {
        if (!res.ok) throw new Error(`Diff not found: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          setDiffData(data);
          if (data.mismatch_zones && data.mismatch_zones.length > 0) {
            setShowDiscrepancyDrawer(true);
          }
        }
      })
      .catch(err => {
        console.debug("Waveform diff not available:", err);
      })
      .finally(() => {
        if (isMounted) setLoadingDiff(false);
      });

    return () => { isMounted = false; };
  }, [resultId, initialDiffData]);

  // Extract Mismatch Zones from diff data
  const mismatchZones = useMemo(() => {
    return (diffData && diffData.mismatch_zones) ? diffData.mismatch_zones : [];
  }, [diffData]);

  // Effective Total Samples
  const effectiveTotalSamples = useMemo(() => {
    if (diffData && diffData.total_samples) return diffData.total_samples;
    return totalSamples;
  }, [diffData, totalSamples]);

  // Channels Definition (using diffData channels if available)
  const channels = useMemo(() => {
    if (diffData && diffData.channels && diffData.channels.length > 0) {
      return diffData.channels.map((ch, idx) => ({
        id: ch.id || ch.name,
        name: ch.name || `CH${idx}`,
        color: ch.color || '#38bdf8',
        type: 'digital',
        height: 42,
        hasExpected: Array.isArray(ch.expected_data) && ch.expected_data.length > 0
      }));
    }

    if (initialChannels) return initialChannels;

    return [
      { id: 'CLK', name: 'CLK_100M', color: '#10b981', type: 'digital', height: 40, hasExpected: true },
      { id: 'DATA', name: 'SPI_MOSI', color: '#6366f1', type: 'digital', height: 40, hasExpected: true },
      { id: 'MISO', name: 'SPI_MISO', color: '#38bdf8', type: 'digital', height: 40, hasExpected: true },
      { id: 'CS_N', name: 'CHIP_SELECT_N', color: '#f59e0b', type: 'digital', height: 40, hasExpected: false },
      { id: 'CML_P', name: 'CML_TX_POS', color: '#ec4899', type: 'analog', height: 70, hasExpected: false },
      { id: 'CML_N', name: 'CML_TX_NEG', color: '#8b5cf6', type: 'analog', height: 70, hasExpected: false },
    ];
  }, [diffData, initialChannels]);

  // Waveform Sample Arrays (Actual and Expected)
  const { actualData, expectedData } = useMemo(() => {
    if (diffData && diffData.channels && diffData.channels.length > 0) {
      const actMap = {};
      const expMap = {};
      diffData.channels.forEach(ch => {
        const id = ch.id || ch.name;
        if (ch.actual_data) actMap[id] = Float32Array.from(ch.actual_data);
        if (ch.expected_data) expMap[id] = Float32Array.from(ch.expected_data);
      });
      return { actualData: actMap, expectedData: expMap };
    }

    // Default Synthetic Demo Signals
    const actMap = {};
    const expMap = {};
    for (const ch of channels) {
      const act = new Float32Array(effectiveTotalSamples);
      const exp = new Float32Array(effectiveTotalSamples);
      for (let i = 0; i < effectiveTotalSamples; i++) {
        if (ch.id === 'CLK') {
          exp[i] = i % 2;
          act[i] = i % 2;
        } else if (ch.id === 'DATA') {
          exp[i] = ((i >> 3) & 1) ^ ((i >> 6) & 1);
          // Insert a synthetic glitch mismatch between sample 320 and 340
          act[i] = (i >= 320 && i <= 340) ? (1 - exp[i]) : exp[i];
        } else if (ch.id === 'MISO') {
          exp[i] = ((i >> 2) & 1);
          act[i] = exp[i];
        } else if (ch.id === 'CS_N') {
          act[i] = (i % 500) < 400 ? 0 : 1;
          exp[i] = act[i];
        } else if (ch.id === 'CML_P') {
          const bit = ((i >> 3) & 1);
          const noise = (Math.sin(i * 0.4) * 0.1) + ((Math.random() - 0.5) * 0.05);
          act[i] = (bit ? 1.2 : 0.2) + noise;
        } else if (ch.id === 'CML_N') {
          const bit = ((i >> 3) & 1);
          const noise = (Math.cos(i * 0.4) * 0.1) + ((Math.random() - 0.5) * 0.05);
          act[i] = (bit ? 0.2 : 1.2) + noise;
        }
      }
      actMap[ch.id] = act;
      expMap[ch.id] = exp;
    }
    return { actualData: actMap, expectedData: expMap };
  }, [diffData, channels, effectiveTotalSamples]);

  // Jump to specific mismatch zone
  const jumpToZone = useCallback((idx) => {
    if (!mismatchZones || mismatchZones.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(mismatchZones.length - 1, idx));
    setSelectedZoneIndex(clampedIdx);
    const z = mismatchZones[clampedIdx];

    const zoneSpan = z.end_sample - z.start_sample;
    const targetSpan = Math.max(150, zoneSpan * 4);
    const center = (z.start_sample + z.end_sample) / 2;
    const newStart = Math.max(0, Math.min(effectiveTotalSamples - targetSpan, center - targetSpan / 2));

    setViewCount(targetSpan);
    setViewStart(newStart);
  }, [mismatchZones, effectiveTotalSamples]);

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
      const actArr = actualData[ch.id];
      const expArr = expectedData[ch.id];

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

      const startIndex = Math.max(0, Math.floor(viewStart));
      const endIndex = Math.min(effectiveTotalSamples, Math.ceil(viewStart + viewCount));
      const step = Math.max(1, Math.floor((endIndex - startIndex) / plotWidth));

      const topY = currentY + 6;
      const botY = currentY + chHeight - 10;

      // 1. Render Red Mismatch Bounding Boxes for this channel
      if (showMismatchBoxes && mismatchZones.length > 0) {
        mismatchZones.forEach((z, zIdx) => {
          if (z.channel_id === ch.id || z.channel_id === ch.name) {
            const zStart = z.start_sample;
            const zEnd = z.end_sample;
            if (zEnd >= startIndex && zStart <= endIndex) {
              const bx = labelWidth + ((zStart - viewStart) / viewCount) * plotWidth;
              const bw = Math.max(4, ((zEnd - zStart) / viewCount) * plotWidth);

              const isSelected = zIdx === selectedZoneIndex;

              // Semi-transparent red highlight
              ctx.fillStyle = isSelected ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.18)';
              ctx.fillRect(bx, currentY - 2, bw, chHeight - 2);

              // Red bounding border
              ctx.strokeStyle = isSelected ? '#f87171' : 'rgba(239, 68, 68, 0.75)';
              ctx.lineWidth = isSelected ? 2 : 1;
              ctx.strokeRect(bx, currentY - 2, bw, chHeight - 2);

              // Tag pill badge
              if (bw > 24) {
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(bx, currentY - 2, Math.min(bw, 44), 10);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 8px Inter, sans-serif';
                const tagText = z.discrepancy_type === 'DROPPED_PULSE' ? 'DROP' : 
                                z.discrepancy_type === 'NOISE_GLITCH' ? 'GLITCH' : 'SKEW';
                ctx.fillText(tagText, bx + 2, currentY + 6);
              }
            }
          }
        });
      }

      // 2. Render Ghost Line (Expected Waveform Overlay - Dashed Amber)
      if (showGhostLine && expArr && ch.type === 'digital') {
        ctx.save();
        ctx.strokeStyle = '#f59e0b'; // Amber / Gold Ghost Line
        ctx.lineWidth = 1.75;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();

        let first = true;
        for (let i = startIndex; i < endIndex; i += step) {
          const x = labelWidth + ((i - viewStart) / viewCount) * plotWidth;
          const val = expArr[i];
          const y = val > 0.5 ? topY : botY;

          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            const prevVal = expArr[i - step];
            const prevY = prevVal > 0.5 ? topY : botY;
            if (prevY !== y) {
              ctx.lineTo(x, prevY);
            }
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 3. Render Captured Waveform Signal Line (Solid Channel Color)
      if (actArr) {
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = ch.type === 'digital' ? 2 : 1.5;
        ctx.beginPath();

        let first = true;
        for (let i = startIndex; i < endIndex; i += step) {
          const x = labelWidth + ((i - viewStart) / viewCount) * plotWidth;
          const val = actArr[i];

          let y;
          if (ch.type === 'digital') {
            y = val > 0.5 ? topY : botY;
          } else {
            const normalized = Math.max(0, Math.min(1.5, val)) / 1.5;
            y = botY - normalized * (botY - topY);
          }

          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            if (ch.type === 'digital') {
              const prevVal = actArr[i - step];
              const prevY = prevVal > 0.5 ? topY : botY;
              if (prevY !== y) {
                ctx.lineTo(x, prevY);
              }
            }
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Bus Decoding overlay if enabled
      if (showBusDecoders && ch.id === 'DATA' && viewCount < 1000 && actArr) {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
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
  }, [
    viewStart, viewCount, channels, actualData, expectedData,
    cursorX1, cursorX2, activeCursor, showCursors, showBusDecoders,
    showGhostLine, showMismatchBoxes, mismatchZones, selectedZoneIndex,
    samplePeriodNs, effectiveTotalSamples
  ]);

  // Mouse Wheel Zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.75 : 1.33;
    const newCount = Math.max(50, Math.min(effectiveTotalSamples, viewCount * zoomFactor));
    
    const rect = canvasRef.current.getBoundingClientRect();
    const labelWidth = 140;
    const mouseX = Math.max(labelWidth, e.clientX - rect.left);
    const mouseRatio = (mouseX - labelWidth) / (rect.width - labelWidth);
    
    const sampleUnderMouse = viewStart + mouseRatio * viewCount;
    const newStart = Math.max(0, Math.min(effectiveTotalSamples - newCount, sampleUnderMouse - mouseRatio * newCount));
    
    setViewCount(newCount);
    setViewStart(newStart);
  }, [viewCount, viewStart, effectiveTotalSamples]);

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
      setCursorX1(Math.max(0, Math.min(effectiveTotalSamples, sampleAtMouse)));
    } else if (activeCursor === 'X2') {
      setCursorX2(Math.max(0, Math.min(effectiveTotalSamples, sampleAtMouse)));
    } else if (isDragging) {
      const deltaX = e.clientX - dragStartX;
      const deltaSamples = (deltaX / (rect.width - labelWidth)) * viewCount;
      const newStart = Math.max(0, Math.min(effectiveTotalSamples - viewCount, dragStartView - deltaSamples));
      setViewStart(newStart);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setActiveCursor(null);
  };

  const summary = diffData ? (diffData.summary || diffData.scores || {}) : null;
  const verificationStatus = diffData ? (diffData.verification_status || (diffData.summary && diffData.summary.status_label) || "UNKNOWN") : null;

  return (
    <div 
      ref={containerRef}
      className={`bg-slate-950 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl transition-all ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'w-full h-[560px]'
      }`}
    >
      {/* Top Toolbar */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
              {verificationStatus && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  verificationStatus === 'PASS' 
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : verificationStatus === 'PASS_WITH_JITTER'
                    ? 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                    : verificationStatus === 'MARGINAL'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}>
                  {verificationStatus}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Sample Rate: <span className="text-emerald-400 font-semibold">{sampleRateMhz} MHz</span> • Window: {Math.round(viewStart)} - {Math.round(viewStart + viewCount)} / {effectiveTotalSamples} pts
            </p>
          </div>
        </div>

        {/* Action Controls & Stepper */}
        <div className="flex items-center gap-2">
          {/* Mismatch Stepper Controls */}
          {mismatchZones.length > 0 && (
            <div className="flex items-center bg-slate-950 border border-rose-900/40 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => jumpToZone(selectedZoneIndex - 1)}
                disabled={selectedZoneIndex <= 0}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-800 rounded transition-colors"
                title="Previous Mismatch"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-mono text-[11px] text-rose-400 font-semibold">
                Diff {selectedZoneIndex + 1}/{mismatchZones.length}
              </span>
              <button
                onClick={() => jumpToZone(selectedZoneIndex + 1)}
                disabled={selectedZoneIndex >= mismatchZones.length - 1}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-slate-800 rounded transition-colors"
                title="Next Mismatch"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Toggle Ghost Expected Line */}
          <button 
            onClick={() => setShowGhostLine(!showGhostLine)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
              showGhostLine 
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
            title="Toggle Expected Golden Waveform Overlay"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Ghost Line</span>
          </button>

          {/* Toggle Discrepancy Drawer */}
          {mismatchZones.length > 0 && (
            <button 
              onClick={() => setShowDiscrepancyDrawer(!showDiscrepancyDrawer)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                showDiscrepancyDrawer 
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' 
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Diffs ({mismatchZones.length})</span>
            </button>
          )}

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
              onClick={() => setViewCount(prev => Math.min(effectiveTotalSamples, prev * 1.4))}
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

          {/* Toggle Cursors */}
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

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            {showGhostLine && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="inline-block w-3 h-0.5 border-t-2 border-dashed border-amber-400" />
                Dashed: Golden Expected Trace
              </span>
            )}
            <span>Drag mouse to Pan • Scroll wheel to Zoom</span>
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

      {/* Discrepancy Drawer (Bottom Collapsible Table) */}
      {showDiscrepancyDrawer && mismatchZones.length > 0 && (
        <div className="bg-slate-900 border-t border-slate-800 p-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-800/80">
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-300 font-bold">Verification Diagnostics:</span>
              {summary && (
                <>
                  <span className="text-emerald-400">F1: {summary.avg_f1_score ?? summary.f1_score ?? 'N/A'}%</span>
                  <span className="text-sky-400">Sample XOR: {summary.avg_sample_xor_score ?? summary.sample_xor_score ?? 'N/A'}%</span>
                  <span className="text-indigo-400">Majority Voting: {summary.avg_majority_score ?? summary.majority_score ?? 'N/A'}%</span>
                </>
              )}
            </div>
            <button 
              onClick={() => setShowDiscrepancyDrawer(false)}
              className="text-xs text-slate-500 hover:text-white"
            >
              Close ✕
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono text-slate-300">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800 text-[11px]">
                  <th className="py-1 px-2">#</th>
                  <th className="py-1 px-2">Channel</th>
                  <th className="py-1 px-2">Start (µs)</th>
                  <th className="py-1 px-2">End (µs)</th>
                  <th className="py-1 px-2">Duration (ns)</th>
                  <th className="py-1 px-2">Anomaly Type</th>
                  <th className="py-1 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {mismatchZones.map((z, idx) => (
                  <tr 
                    key={idx}
                    onClick={() => jumpToZone(idx)}
                    className={`cursor-pointer transition-colors ${
                      idx === selectedZoneIndex ? 'bg-rose-950/40 text-white' : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="py-1 px-2 font-bold text-slate-400">{idx + 1}</td>
                    <td className="py-1 px-2 font-semibold text-sky-400">{z.channel_id}</td>
                    <td className="py-1 px-2">{z.start_time_us} µs</td>
                    <td className="py-1 px-2">{z.end_time_us} µs</td>
                    <td className="py-1 px-2 text-amber-300">{z.duration_ns} ns</td>
                    <td className="py-1 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        z.discrepancy_type === 'DROPPED_PULSE' 
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : z.discrepancy_type === 'NOISE_GLITCH'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {z.discrepancy_type}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right">
                      <button 
                        onClick={(e) => { e.stopPropagation(); jumpToZone(idx); }}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                      >
                        Inspect ▶
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
