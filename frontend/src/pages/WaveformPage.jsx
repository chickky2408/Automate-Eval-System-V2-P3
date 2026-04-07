import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Eye,
  Gauge,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import API_ENDPOINTS from '../utils/apiEndpoints';

const MAX_WAVEFORM_SAMPLES = 3000;
const DISPLAY_WAVEFORM_SAMPLES = 800;
const WAVEFORM_CANVAS_HEIGHT = 320;
const STACKED_STRIP_MIN = 80;
const STACKED_LABEL_COL = 28;
const STACKED_LANE_COUNT = 4;

const WaveformPage = () => {
  const boards = useTestStore((state) => state.boards || []);
  const theme = useTestStore((state) => state.theme);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const fullscreenRootRef = useRef(null);
  const bufferRef = useRef({ CH1: [], CH2: [], CH3: [], CH4: [] });
  const rafRef = useRef(null);
  const wsRef = useRef(null);
  const connectedRef = useRef(false);
  const fsRef = useRef(4000);
  const showWaveformRef = useRef(true);
  const showPlayheadRef = useRef(true);
  const playheadFracRef = useRef(0); // remember last running position (0..1)
  const showGridRef = useRef(true);
  const visibleSignalsRef = useRef({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [connected, setConnected] = useState(false);
  const [meta, setMeta] = useState({ freq_hz: 125000, fs: 4000 });
  const [lastChunkAt, setLastChunkAt] = useState(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [runProgress, setRunProgress] = useState(0);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showPlayhead, setShowPlayhead] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [chartHeight, setChartHeight] = useState(WAVEFORM_CANVAS_HEIGHT);
  const [layoutMode, setLayoutMode] = useState('overlay');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const layoutModeRef = useRef('overlay');
  const [scaleMode, setScaleMode] = useState('manual');
  const [yMinManual, setYMinManual] = useState(-1);
  const [yMaxManual, setYMaxManual] = useState(1);
  const scaleModeRef = useRef(scaleMode);
  const yMinManualRef = useRef(yMinManual);
  const yMaxManualRef = useRef(yMaxManual);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);
  const viewButtonRef = useRef(null);
  const viewPopoverRef = useRef(null);
  const [viewPopoverPos, setViewPopoverPos] = useState({ top: 0, left: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, startX: 0, startOffset: 0 });
  const [visibleSignals, setVisibleSignals] = useState({ ch1: true, ch2: true, ch3: true, ch4: true });
  const [showCursor, setShowCursor] = useState(true);
  const [cursorFrac, setCursorFrac] = useState(0.35);
  const [cursor2Frac, setCursor2Frac] = useState(0.65);
  const [showCursor2, setShowCursor2] = useState(true);
  const [cursorChannel, setCursorChannel] = useState('ch1');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const showCursorRef = useRef(true);
  const cursorFracRef = useRef(0.35);
  const cursor2FracRef = useRef(0.65);
  const showCursor2Ref = useRef(true);
  const cursorChannelRef = useRef('ch1');
  const isDraggingCursorRef = useRef(false);
  const activeCursorRef = useRef(1);
  const [, setTick] = useState(0);
  const onlineBoards = boards.filter((b) => b.status === 'online');
  connectedRef.current = connected;
  fsRef.current = meta.fs || 4000;
  showWaveformRef.current = showWaveform;
  showPlayheadRef.current = showPlayhead;
  showGridRef.current = showGrid;
  zoomLevelRef.current = zoomLevel;
  scaleModeRef.current = scaleMode;
  yMinManualRef.current = yMinManual;
  yMaxManualRef.current = yMaxManual;
  pausedRef.current = paused;
  scrollOffsetRef.current = scrollOffset;
  visibleSignalsRef.current = visibleSignals;
  showCursorRef.current = showCursor;
  cursorFracRef.current = cursorFrac;
  cursor2FracRef.current = cursor2Frac;
  showCursor2Ref.current = showCursor2;
  cursorChannelRef.current = cursorChannel;
  layoutModeRef.current = layoutMode;

  const stackedPanelHeight = Math.min(
    960,
    48 + STACKED_STRIP_MIN * STACKED_LANE_COUNT + 36
  );

  useEffect(() => {
    if (!selectedBoardId && onlineBoards.length > 0) {
      setSelectedBoardId(onlineBoards[0].id);
    }
  }, [onlineBoards, selectedBoardId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
      const h = el.clientHeight;
      if (h >= 64) setChartHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenRootRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement === fullscreenRootRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!paused) {
      setScrollOffset(0);
      setViewPanelOpen(false);
    }
  }, [paused]);

  useEffect(() => {
    if (!viewPanelOpen) return;

    const POPOVER_W = 224;
    const MARGIN = 8;

    const position = () => {
      const btn = viewButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = Math.max(
        MARGIN,
        Math.min(window.innerWidth - POPOVER_W - MARGIN, rect.right - POPOVER_W)
      );
      const top = rect.bottom + 8;
      setViewPopoverPos({ top, left });
    };

    const onDown = (e) => {
      const pop = viewPopoverRef.current;
      const btn = viewButtonRef.current;
      if (pop?.contains(e.target) || btn?.contains(e.target)) return;
      setViewPanelOpen(false);
    };

    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [viewPanelOpen]);

  useEffect(() => {
    if (!paused) return;
    const displayCountUI = Math.max(
      2,
      Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
    );
    const maxOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
    setScrollOffset((o) => Math.max(0, Math.min(maxOffset, o)));
  }, [paused, zoomLevel, sampleCount]);

  useEffect(() => {
    const id = setInterval(() => {
      setRunProgress((p) => (p >= 100 ? 0 : p + 1));
    }, 20);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, [connected]);

  const RECONNECT_MS = 3000;

  useEffect(() => {
    const baseUrl = API_ENDPOINTS.WS_WAVEFORM || 'ws://localhost:8000/ws/waveform';
    const url = selectedBoardId
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}boardId=${encodeURIComponent(selectedBoardId)}`
      : baseUrl;
    let cancelled = false;
    let reconnectTimeoutId = null;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] };
        setSampleCount(0);
        setLastChunkAt(null);
        if (!cancelled) {
          reconnectTimeoutId = setTimeout(connect, RECONNECT_MS);
        }
      };
      ws.onerror = () => setConnected(false);

      ws.onmessage = (event) => {
        if (pausedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'waveform') {
            const buffers = bufferRef.current;
            let ch1Count = 0;

            if (Array.isArray(msg.data?.channels)) {
              msg.data.channels.forEach((ch, idx) => {
                const id = ch?.id || `CH${idx + 1}`;
                if (!Array.isArray(ch?.samples)) return;
                if (!buffers[id]) buffers[id] = [];
                const arr = buffers[id];
                ch.samples.forEach((s) => {
                  arr.push(Number(s));
                  if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
                });
              });
              ch1Count = buffers.CH1 ? buffers.CH1.length : 0;
            } else if (Array.isArray(msg.data?.samples)) {
              if (!buffers.CH1) buffers.CH1 = [];
              const arr = buffers.CH1;
              msg.data.samples.forEach((s) => {
                arr.push(Number(s));
                if (arr.length > MAX_WAVEFORM_SAMPLES) arr.shift();
              });
              ch1Count = arr.length;
            }

            if (ch1Count > 0) {
              setLastChunkAt(Date.now());
              setSampleCount(ch1Count);
            }
            if (msg.data?.freq_hz != null) {
              setMeta((m) => ({
                ...m,
                freq_hz: msg.data.freq_hz,
                fs: msg.data.fs ?? m.fs,
              }));
            }
          }
        } catch (_) {}
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, containerWidth);
    const h = Math.max(160, chartHeight);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const autoYRange = (segment) => {
      if (!segment || segment.length < 2) return { yMin: -1, yMax: 1 };
      let minV = Number(segment[0]);
      let maxV = Number(segment[0]);
      for (let i = 1; i < segment.length; i++) {
        const v = Number(segment[i]);
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      let range = maxV - minV;
      if (range < 1e-6) range = 1;
      const pad = Math.max(range * 0.05, 0.05);
      range += pad * 2;
      const midVal = (minV + maxV) / 2;
      return { yMin: midVal - range / 2, yMax: midVal + range / 2 };
    };

    const manualYRange = () => {
      let yMin = yMinManualRef.current;
      let yMax = yMaxManualRef.current;
      if (yMin > yMax) {
        const t = yMin;
        yMin = yMax;
        yMax = t;
      }
      return { yMin, yMax };
    };

    let stopped = false;
    const draw = () => {
      if (stopped) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      const buffers = bufferRef.current;
      const buf = buffers.CH1 || [];
      const cw = w;
      const ch = h;

      const isDark = theme === 'dark';
      const pal = isDark
        ? {
            plotBg: '#0f172a',
            grid: '#334155',
            axis: '#64748b',
            label: '#e2e8f0',
            labelMuted: '#94a3b8',
            cursorPrimary: 'rgba(226, 232, 240, 0.95)',
            cursorPrimaryStroke: '#cbd5e1',
            cursorLabel: '#f1f5f9',
            deltaLabel: '#f1f5f9',
            sep: 'rgba(51, 65, 85, 0.9)',
          }
        : {
            plotBg: '#f1f5f9',
            grid: '#e2e8f0',
            axis: '#94a3b8',
            label: '#64748b',
            labelMuted: '#64748b',
            cursorPrimary: 'rgba(15, 23, 42, 0.9)',
            cursorPrimaryStroke: '#0f172a',
            cursorLabel: '#0f172a',
            deltaLabel: '#0f172a',
            sep: 'rgba(148, 163, 184, 0.85)',
          };
      ctx.fillStyle = pal.plotBg;
      ctx.fillRect(0, 0, cw, ch);

      const isStacked = layoutModeRef.current === 'stacked';
      const padding = { left: 40, right: 20, top: isStacked ? 14 : 20, bottom: 30 };
      const labelCol = isStacked ? STACKED_LABEL_COL : 0;
      const plotLeft = padding.left + labelCol;
      const plotRight = cw - padding.right;
      const plotW = plotRight - plotLeft;

      const bufHasData = buf.length >= 2;
      const zoom = zoomLevelRef.current;
      const displayCount = Math.max(2, Math.min(buf.length, Math.round(DISPLAY_WAVEFORM_SAMPLES / zoom)));
      const endIndex = Math.max(0, Math.min(buf.length, buf.length - (pausedRef.current ? (scrollOffsetRef.current || 0) : 0)));
      const startIndex = Math.max(0, endIndex - displayCount);
      const toDraw = bufHasData ? buf.slice(startIndex, endIndex) : null;
      const n = toDraw ? toDraw.length : displayCount;

      const fs = fsRef.current || 4000;
      const totalSec = n / fs;
      const formatMs = (sec) => `${Math.round(sec * 1000)} ms`;
      const step = n > 1 ? plotW / (n - 1) : plotW;

      const chDefs = [
        { key: 'ch1', id: 'CH1', short: 'CH1', color: isDark ? '#38bdf8' : '#0369a1', width: 2.2 },
        { key: 'ch2', id: 'CH2', short: 'CH2', color: isDark ? '#fb923c' : '#ea580c', width: 1.6 },
        { key: 'ch3', id: 'CH3', short: 'CH3', color: isDark ? '#4ade80' : '#16a34a', width: 1.6 },
        { key: 'ch4', id: 'CH4', short: 'CH4', color: isDark ? '#a78bfa' : '#7c3aed', width: 1.6 },
      ];
      const stripChannels = chDefs;

      const xAxisY = ch - padding.bottom;
      const waveTop = padding.top;
      const waveBottom = xAxisY;

      const drawXAxis = () => {
        ctx.strokeStyle = pal.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(plotLeft, xAxisY);
        ctx.lineTo(plotRight, xAxisY);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = pal.label;
        ctx.font = '10px system-ui, sans-serif';
        const xTicks = [
          { x: plotLeft, t: 0 },
          { x: plotLeft + plotW / 2, t: totalSec / 2 },
          { x: plotRight, t: totalSec },
        ];
        xTicks.forEach(({ x, t }) => {
          ctx.beginPath();
          ctx.moveTo(x, xAxisY);
          ctx.lineTo(x, xAxisY + 4);
          ctx.strokeStyle = pal.axis;
          ctx.stroke();
          ctx.fillText(formatMs(t), x, xAxisY + 6);
        });
      };

      let cursorStripLayout = null;

      if (!isStacked) {
        const plotTop = waveTop;
        const plotBottom = waveBottom;
        const plotH = plotBottom - plotTop;
        const midY = plotTop + plotH / 2;

        let yMin = yMinManualRef.current;
        let yMax = yMaxManualRef.current;
        if (scaleModeRef.current === 'manual') {
          const m = manualYRange();
          yMin = m.yMin;
          yMax = m.yMax;
        } else if (scaleModeRef.current === 'auto' && toDraw && toDraw.length >= 2) {
          const a = autoYRange(toDraw);
          yMin = a.yMin;
          yMax = a.yMax;
        }
        const yRange = Math.max(yMax - yMin, 1e-6);
        const scaleY = plotH / yRange;
        const midVal = (yMin + yMax) / 2;

        ctx.strokeStyle = pal.axis;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(plotLeft, plotTop);
        ctx.lineTo(plotLeft, plotBottom);
        ctx.stroke();

        if (showGridRef.current) {
          ctx.strokeStyle = pal.grid;
          ctx.lineWidth = 1;
          for (let i = 0; i <= 5; i++) {
            const y = plotTop + (plotH * i) / 5;
            ctx.beginPath();
            ctx.moveTo(plotLeft, y);
            ctx.lineTo(plotRight, y);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.moveTo(plotLeft, midY);
        ctx.lineTo(plotRight, midY);
        ctx.strokeStyle = pal.axis;
        ctx.stroke();

        ctx.fillStyle = pal.label;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const yTicks = [yMax, midVal, yMin];
        const yTickPositions = [plotTop, midY, plotBottom];
        for (let i = 0; i < 3; i++) {
          const y = yTickPositions[i];
          const v = yTicks[i];
          ctx.beginPath();
          ctx.moveTo(plotLeft - 4, y);
          ctx.lineTo(plotLeft, y);
          ctx.strokeStyle = pal.axis;
          ctx.stroke();
          const label = Math.abs(v) >= 10 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2);
          ctx.fillText(label, plotLeft - 6, y);
        }

        drawXAxis();

        if (showWaveformRef.current && connectedRef.current && bufHasData && toDraw) {
          const drawChannel = (arr, color, lineW = 2) => {
            if (!arr || arr.length < 2) return;
            const seg = arr.slice(startIndex, endIndex);
            if (seg.length < 2) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = lineW;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
              const x = plotLeft + i * step;
              const v = Number(seg[i]);
              const y = midY - (v - midVal) * scaleY;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          };
          if (visibleSignalsRef.current.ch1) drawChannel(buffers.CH1, chDefs[0].color, chDefs[0].width);
          if (visibleSignalsRef.current.ch2) drawChannel(buffers.CH2, chDefs[1].color, chDefs[1].width);
          if (visibleSignalsRef.current.ch3) drawChannel(buffers.CH3, chDefs[2].color, chDefs[2].width);
          if (visibleSignalsRef.current.ch4) drawChannel(buffers.CH4, chDefs[3].color, chDefs[3].width);
        }

        if (showPlayheadRef.current) {
          const liveFrac = (Date.now() % 2000) / 2000;
          const frac = pausedRef.current ? playheadFracRef.current : liveFrac;
          if (!pausedRef.current) playheadFracRef.current = frac;
          const playheadX = plotLeft + Math.max(0, Math.min(1, frac)) * plotW;
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(playheadX, plotTop);
          ctx.lineTo(playheadX, plotBottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (showCursorRef.current && bufHasData && toDraw && n >= 2) {
          const chMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
          const arr = buffers[chMap[cursorChannelRef.current]];
          const seg = arr && arr.length >= 2 ? arr.slice(startIndex, endIndex) : null;

          const getTVAtFrac = (f) => {
            if (!seg) return { tMs: 0, v: 0 };
            const idx = f * (n - 1);
            const i0 = Math.min(Math.floor(idx), n - 2);
            const i1 = i0 + 1;
            const t = Math.max(0, Math.min(1, idx - i0));
            const v0 = Number(seg[i0]);
            const v1 = Number(seg[i1]);
            const v = v0 * (1 - t) + v1 * t;
            const tMs = ((startIndex + idx) / fs) * 1000;
            return { tMs, v };
          };

          const drawOneCursor = (frac, isSecond) => {
            const cursorX = plotLeft + frac * plotW;
            const lineColor = isSecond
              ? 'rgba(96, 165, 250, 0.95)'
              : isDark
                ? 'rgba(226, 232, 240, 0.95)'
                : 'rgba(15, 23, 42, 0.9)';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(cursorX, plotTop);
            ctx.lineTo(cursorX, plotBottom);
            ctx.stroke();
            ctx.setLineDash([]);

            if (seg) {
              const { tMs, v } = getTVAtFrac(frac);
              const y = midY - (v - midVal) * scaleY;
              ctx.fillStyle = isSecond
                ? 'rgba(59, 130, 246, 0.95)'
                : isDark
                  ? 'rgba(226, 232, 240, 0.95)'
                  : 'rgba(15, 23, 42, 0.95)';
              ctx.strokeStyle = isDark ? '#94a3b8' : '#0f172a';
              ctx.lineWidth = 1.5;
              const sq = 6;
              ctx.fillRect(cursorX - sq / 2, y - sq / 2, sq, sq);
              ctx.strokeRect(cursorX - sq / 2, y - sq / 2, sq, sq);
              const label = `T: ${tMs.toFixed(2)} ms   V: ${v.toFixed(2)} V`;
              ctx.font = '11px system-ui, sans-serif';
              ctx.fillStyle = pal.cursorLabel;
              ctx.textAlign = isSecond ? 'right' : 'left';
              ctx.textBaseline = 'middle';
              const tx = isSecond ? cursorX - 8 : cursorX + 8;
              const ty = Math.max(plotTop + 10, Math.min(plotBottom - 10, y));
              ctx.fillText(label, tx, ty);
            }
            return seg ? getTVAtFrac(frac) : null;
          };

          const data1 = drawOneCursor(Math.max(0, Math.min(1, cursorFracRef.current)), false);
          if (showCursor2Ref.current) {
            const data2 = drawOneCursor(Math.max(0, Math.min(1, cursor2FracRef.current)), true);
            if (data1 && data2) {
              const deltaT = data2.tMs - data1.tMs;
              const deltaV = data2.v - data1.v;
              ctx.font = '12px system-ui, sans-serif';
              ctx.fillStyle = pal.deltaLabel;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(`ΔT: ${deltaT.toFixed(2)} ms   ΔV: ${deltaV.toFixed(2)} V`, plotLeft + plotW / 2, plotTop + 4);
            }
          }
        }
      } else {
        const stripCount = STACKED_LANE_COUNT;
        const stripGap = 1;
        const totalGaps = (stripCount - 1) * stripGap;
        const stripRegionH = Math.max(24, waveBottom - waveTop - totalGaps);
        const stripH = stripRegionH / stripCount;

        const stripLayouts = [];

        for (let i = 0; i < stripCount; i++) {
          const plotTop = waveTop + i * (stripH + stripGap);
          const plotBottom = plotTop + stripH;
          const plotHH = plotBottom - plotTop;
          const midY = plotTop + plotHH / 2;

          const cd = stripChannels[i];
          const arr = buffers[cd.id];
          const seg = arr && arr.length >= 2 ? arr.slice(startIndex, endIndex) : null;

          let yMin;
          let yMax;
          if (scaleModeRef.current === 'manual') {
            const m = manualYRange();
            yMin = m.yMin;
            yMax = m.yMax;
          } else if (seg && seg.length >= 2) {
            const a = autoYRange(seg);
            yMin = a.yMin;
            yMax = a.yMax;
          } else {
            yMin = -1;
            yMax = 1;
          }
          const yRange = Math.max(yMax - yMin, 1e-6);
          const scaleY = plotHH / yRange;
          const midVal = (yMin + yMax) / 2;
          stripLayouts.push({ plotTop, plotBottom, midY, scaleY, midVal, cd, seg });

          if (i > 0) {
            ctx.strokeStyle = pal.sep;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padding.left, plotTop - stripGap / 2);
            ctx.lineTo(plotRight, plotTop - stripGap / 2);
            ctx.stroke();
          }

          ctx.strokeStyle = pal.axis;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(plotLeft, plotTop);
          ctx.lineTo(plotLeft, plotBottom);
          ctx.stroke();

          if (showGridRef.current) {
            ctx.strokeStyle = pal.grid;
            ctx.lineWidth = 1;
            for (let g = 0; g <= 3; g++) {
              const y = plotTop + (plotHH * g) / 3;
              ctx.beginPath();
              ctx.moveTo(plotLeft, y);
              ctx.lineTo(plotRight, y);
              ctx.stroke();
            }
          }
          ctx.beginPath();
          ctx.moveTo(plotLeft, midY);
          ctx.lineTo(plotRight, midY);
          ctx.strokeStyle = pal.axis;
          ctx.stroke();

          ctx.fillStyle = pal.label;
          ctx.font = '9px system-ui, sans-serif';
          ctx.textAlign = 'right';
          const yTicks = [yMax, midVal, yMin];
          const yGeom = [plotTop, midY, plotBottom];
          for (let k = 0; k < 3; k++) {
            const yLine = yGeom[k];
            ctx.beginPath();
            ctx.moveTo(plotLeft - 3, yLine);
            ctx.lineTo(plotLeft, yLine);
            ctx.strokeStyle = pal.axis;
            ctx.stroke();
            const v = yTicks[k];
            const label = Math.abs(v) >= 10 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : v.toFixed(2);
            const lx = plotLeft - 6;
            if (k === 0) {
              const ty = i > 0 ? plotTop + 5 : plotTop + 2;
              ctx.textBaseline = 'top';
              ctx.fillText(label, lx, ty);
            } else if (k === 2) {
              const by = i < stripCount - 1 ? plotBottom - 5 : plotBottom - 2;
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, lx, by);
            } else {
              ctx.textBaseline = 'middle';
              ctx.fillText(label, lx, midY);
            }
          }

          const chOn = visibleSignalsRef.current[cd.key];
          ctx.fillStyle = chOn ? cd.color : pal.labelMuted;
          ctx.font = 'bold 9px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(cd.short, plotLeft + 4, plotTop + 2);

          if (
            showWaveformRef.current &&
            connectedRef.current &&
            bufHasData &&
            toDraw &&
            visibleSignalsRef.current[cd.key] &&
            seg &&
            seg.length >= 2
          ) {
            ctx.strokeStyle = cd.color;
            ctx.lineWidth = cd.width;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let j = 0; j < n; j++) {
              const x = plotLeft + j * step;
              const v = Number(seg[j]);
              const y = midY - (v - midVal) * scaleY;
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }

        drawXAxis();

        const chMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
        const cursorCh = cursorChannelRef.current;
        const cursorIdx = stripChannels.findIndex((c) => c.key === cursorCh);
        if (cursorIdx >= 0) {
          const L = stripLayouts[cursorIdx];
          cursorStripLayout = { plotTop: L.plotTop, plotBottom: L.plotBottom, midY: L.midY, scaleY: L.scaleY, midVal: L.midVal };
        } else if (stripLayouts[0]) {
          const L = stripLayouts[0];
          cursorStripLayout = { plotTop: L.plotTop, plotBottom: L.plotBottom, midY: L.midY, scaleY: L.scaleY, midVal: L.midVal };
        }

        if (showPlayheadRef.current) {
          const liveFrac = (Date.now() % 2000) / 2000;
          const frac = pausedRef.current ? playheadFracRef.current : liveFrac;
          if (!pausedRef.current) playheadFracRef.current = frac;
          const playheadX = plotLeft + Math.max(0, Math.min(1, frac)) * plotW;
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(playheadX, waveTop);
          ctx.lineTo(playheadX, waveBottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (showCursorRef.current && bufHasData && toDraw && n >= 2 && cursorStripLayout) {
          const arr = buffers[chMap[cursorChannelRef.current]];
          const seg = arr && arr.length >= 2 ? arr.slice(startIndex, endIndex) : null;
          const { plotTop: cTop, plotBottom: cBot, midY: cMidY, scaleY: cScaleY, midVal: cMidVal } = cursorStripLayout;

          const getTVAtFrac = (f) => {
            if (!seg) return { tMs: 0, v: 0 };
            const idx = f * (n - 1);
            const i0 = Math.min(Math.floor(idx), n - 2);
            const i1 = i0 + 1;
            const t = Math.max(0, Math.min(1, idx - i0));
            const v0 = Number(seg[i0]);
            const v1 = Number(seg[i1]);
            const v = v0 * (1 - t) + v1 * t;
            const tMs = ((startIndex + idx) / fs) * 1000;
            return { tMs, v };
          };

          const drawOneCursor = (frac, isSecond) => {
            const cursorX = plotLeft + frac * plotW;
            const lineColor = isSecond
              ? 'rgba(96, 165, 250, 0.95)'
              : isDark
                ? 'rgba(226, 232, 240, 0.95)'
                : 'rgba(15, 23, 42, 0.9)';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(cursorX, waveTop);
            ctx.lineTo(cursorX, waveBottom);
            ctx.stroke();
            ctx.setLineDash([]);

            if (seg) {
              const { tMs, v } = getTVAtFrac(frac);
              const y = cMidY - (v - cMidVal) * cScaleY;
              ctx.fillStyle = isSecond
                ? 'rgba(59, 130, 246, 0.95)'
                : isDark
                  ? 'rgba(226, 232, 240, 0.95)'
                  : 'rgba(15, 23, 42, 0.95)';
              ctx.strokeStyle = isDark ? '#94a3b8' : '#0f172a';
              ctx.lineWidth = 1.5;
              const sq = 6;
              ctx.fillRect(cursorX - sq / 2, y - sq / 2, sq, sq);
              ctx.strokeRect(cursorX - sq / 2, y - sq / 2, sq, sq);
              const label = `T: ${tMs.toFixed(2)} ms   V: ${v.toFixed(2)} V`;
              ctx.font = '11px system-ui, sans-serif';
              ctx.fillStyle = pal.cursorLabel;
              ctx.textAlign = isSecond ? 'right' : 'left';
              ctx.textBaseline = 'middle';
              const tx = isSecond ? cursorX - 8 : cursorX + 8;
              const ty = Math.max(cTop + 8, Math.min(cBot - 8, y));
              ctx.fillText(label, tx, ty);
            }
            return seg ? getTVAtFrac(frac) : null;
          };

          const data1 = drawOneCursor(Math.max(0, Math.min(1, cursorFracRef.current)), false);
          if (showCursor2Ref.current) {
            const data2 = drawOneCursor(Math.max(0, Math.min(1, cursor2FracRef.current)), true);
            if (data1 && data2) {
              const deltaT = data2.tMs - data1.tMs;
              const deltaV = data2.v - data1.v;
              ctx.font = '12px system-ui, sans-serif';
              ctx.fillStyle = pal.deltaLabel;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(`ΔT: ${deltaT.toFixed(2)} ms   ΔV: ${deltaV.toFixed(2)} V`, plotLeft + plotW / 2, waveTop + 2);
            }
          }
        }
      }

      if (buf.length < 2 || !connectedRef.current) {
        ctx.fillStyle = pal.labelMuted;
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const msg = !connectedRef.current ? 'Lost of signal /  Backend Disconnected' : 'Waiting for samples…';
        ctx.fillText(msg, cw / 2, ch / 2);
      } else if (!showWaveformRef.current) {
        ctx.fillStyle = pal.labelMuted;
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform display paused', cw / 2, ch / 2);
      } else if (pausedRef.current) {
        ctx.fillStyle = pal.labelMuted;
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Acquisition paused', cw / 2, waveTop + 12);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [connected, showWaveform, zoomLevel, containerWidth, chartHeight, paused, theme, layoutMode, visibleSignals]);

  const isLive = connected && lastChunkAt != null && Date.now() - lastChunkAt < 500;
  const LIVE_PULSE = 'animate-pulse';
  const displayCountUI = Math.max(
    2,
    Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
  );
  const maxScrollOffset = Math.max(0, (sampleCount || 0) - displayCountUI);
  const scrollStep = Math.max(20, Math.round(displayCountUI * 0.2));
  const plotLeftPx = 40 + (layoutMode === 'stacked' ? STACKED_LABEL_COL : 0);
  const plotWUi = Math.max(1, (containerWidth || 800) - plotLeftPx - 20);
  const samplesPerPx = displayCountUI / plotWUi;

  const toggleFullscreen = async () => {
    const el = fullscreenRootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (_) {}
  };

  const measureChannelMap = { ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4' };
  const measureBuf = bufferRef.current[measureChannelMap[cursorChannel]] || [];
  const measureEndIndex = Math.max(0, Math.min(measureBuf.length, measureBuf.length - (paused ? scrollOffset : 0)));
  const measureStartIndex = Math.max(0, measureEndIndex - displayCountUI);
  const measureSegment = measureBuf.length >= 2 ? measureBuf.slice(measureStartIndex, measureEndIndex) : [];
  const fs = meta.fs || 4000;

  let vpp = null;
  let freqHz = null;
  let dutyCycle = null;
  if (measureSegment.length >= 2) {
    let minV = measureSegment[0];
    let maxV = measureSegment[0];
    for (let i = 1; i < measureSegment.length; i++) {
      const v = Number(measureSegment[i]);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    vpp = maxV - minV;
    const mid = (minV + maxV) / 2;
    let crossings = 0;
    for (let i = 0; i < measureSegment.length - 1; i++) {
      const a = Number(measureSegment[i]) - mid;
      const b = Number(measureSegment[i + 1]) - mid;
      if (a * b < 0) crossings++;
    }
    if (crossings >= 2) freqHz = (crossings / 2) * fs / measureSegment.length;
    let above = 0;
    for (let i = 0; i < measureSegment.length; i++) {
      if (Number(measureSegment[i]) > mid) above++;
    }
    dutyCycle = (above / measureSegment.length) * 100;
  }

  const fsShellClass = isFullscreen
    ? `fixed inset-0 z-[200] flex flex-col gap-3 overflow-hidden p-3 sm:p-4 ${
        theme === 'dark' ? 'bg-slate-950' : 'bg-slate-100'
      }`
    : 'w-full min-w-0 space-y-6';

  const plotContainerClass = `w-full bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden touch-none ${
    paused ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
  } ${isFullscreen ? 'flex-1 min-h-0' : ''}`;

  const plotContainerStyle =
    !isFullscreen && layoutMode === 'stacked'
      ? { height: stackedPanelHeight, minHeight: stackedPanelHeight }
      : !isFullscreen
        ? { height: WAVEFORM_CANVAS_HEIGHT, minHeight: WAVEFORM_CANVAS_HEIGHT }
        : { minHeight: 0 };

  return (
    <div className="w-full min-w-0">
      <div ref={fullscreenRootRef} className={fsShellClass}>
      <div
        className={`bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-visible ${
          isFullscreen ? 'shrink-0' : ''
        }`}
      >
        <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 sm:p-2 rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-300">
                  <Activity size={20} className="sm:hidden" strokeWidth={2} />
                  <Activity size={22} className="hidden sm:block" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-50 truncate">
                    Realtime Waveform
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    {selectedBoardId
                      ? `Streaming from ${onlineBoards.find((b) => b.id === selectedBoardId)?.name || selectedBoardId}`
                      : 'Streaming from simulated node'}
                  </div>
                </div>
              </div>
              {connected ? (
                isLive ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200 border border-emerald-300/60 dark:border-emerald-700/80 ${LIVE_PULSE}`}>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/15 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200 border border-amber-300/60 dark:border-amber-700/80">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Waiting for data…
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-300/60 dark:border-slate-600">
                  <span className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />
                  Disconnected
                </span>
              )}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Streaming from</span>
              <select
                value={selectedBoardId || ''}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              >
                <option value="">Simulated Node</option>
                {onlineBoards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto overflow-y-visible max-w-full pr-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-600 text-slate-800 dark:text-slate-100 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title={isFullscreen ? 'Exit full screen' : 'Full screen (monitor)'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Full screen'}</span>
              </button>
              <button
                type="button"
                ref={viewButtonRef}
                onClick={() => setViewPanelOpen((v) => !v)}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200/60 dark:border-cyan-700/80 text-cyan-900 dark:text-cyan-100 text-sm font-semibold hover:bg-cyan-100 dark:hover:bg-cyan-900/50 transition-colors"
                title="View & overlay options"
              >
                <Eye size={16} />
                View
              </button>
              {viewPanelOpen && (
                <div
                  ref={viewPopoverRef}
                  className="fixed w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl p-3 z-[999]"
                  style={{ top: viewPopoverPos.top, left: viewPopoverPos.left }}
                >
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-200 mb-1">Layout</div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 leading-snug">
                    
                  </p>
                  <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 mb-3">
                    <button
                      type="button"
                      onClick={() => setLayoutMode('overlay')}
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-all ${
                        layoutMode === 'overlay'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      title="All visible channels on one Y-axis (traces can overlap)"
                    >
                      Overlay
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode('stacked')}
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-all ${
                        layoutMode === 'stacked'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      title="Four stacked lanes (CH1 top … CH4 bottom), same time axis for all"
                    >
                      4 tracks
                    </button>
                  </div>
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-200 mb-2">Show on chart</div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showWaveform} onChange={(e) => setShowWaveform(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500" />
                      Trace
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showPlayhead} onChange={(e) => setShowPlayhead(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-rose-600 focus:ring-rose-500" />
                      Playhead
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-slate-600 focus:ring-slate-500" />
                      Grid
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500" />
                      Stats
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showCursor} onChange={(e) => setShowCursor(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-slate-600" />
                      Cursor (T / V)
                    </label>
                    {showCursor && (
                      <>
                        <label className="flex items-center gap-2 py-1 pl-6 text-sm text-slate-700 dark:text-slate-200 select-none">
                          <input type="checkbox" checked={showCursor2} onChange={(e) => setShowCursor2(e.target.checked)} className="w-4 h-4 rounded border-slate-300 dark:border-slate-600" />
                          Cursor 2 (ΔT / ΔV)
                        </label>
                        <div className="flex items-center gap-2 py-1 pl-6">
                          <span className="text-xs text-slate-600 dark:text-slate-300">Measure:</span>
                          <select value={cursorChannel} onChange={(e) => setCursorChannel(e.target.value)} className="text-xs border border-slate-200 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
                            <option value="ch1">CH1</option>
                            <option value="ch2">CH2</option>
                            <option value="ch3">CH3</option>
                            <option value="ch4">CH4</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <div className="text-xs font-bold text-slate-600 dark:text-slate-200 mb-1">Signals (analog)</div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                        <input type="checkbox" checked={visibleSignals.ch1} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch1: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500" />
                        CH1
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                        <input type="checkbox" checked={visibleSignals.ch2} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch2: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-orange-500 focus:ring-orange-500" />
                        CH2
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                        <input type="checkbox" checked={visibleSignals.ch3} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch3: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500" />
                        CH3
                      </label>
                      <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                        <input type="checkbox" checked={visibleSignals.ch4} onChange={(e) => setVisibleSignals((prev) => ({ ...prev, ch4: e.target.checked }))} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500" />
                        CH4
                      </label>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                    <button type="button" className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white" onClick={() => setViewPanelOpen(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-100/80 dark:bg-slate-800/90 p-0.5">
              <button
                type="button"
                onClick={() => { setPaused((p) => !p); setScrollOffset(0); }}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold rounded-lg transition-all ${paused ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-700 dark:text-slate-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:text-amber-800 dark:hover:text-amber-200'}`}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play size={16} /> : <Pause size={16} />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={() => { bufferRef.current = { CH1: [], CH2: [], CH3: [], CH4: [] }; setSampleCount(0); setLastChunkAt(null); }}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-rose-100 dark:hover:bg-rose-950/50 hover:text-rose-700 dark:hover:text-rose-300 rounded-lg transition-all"
                title="Clear buffer"
              >
                <Trash2 size={16} />
                Clear
              </button>
            </div>

            {paused && maxScrollOffset > 0 && (
              <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white/70 dark:bg-slate-800/90">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-200">Scroll</span>
                <button type="button" onClick={() => setScrollOffset((o) => Math.min(maxScrollOffset, o + scrollStep))} className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Scroll left (older)">
                  <ChevronLeft size={16} />
                </button>
                <input type="range" min={0} max={maxScrollOffset} step={1} value={scrollOffset} onChange={(e) => setScrollOffset(Number(e.target.value))} className="w-24 accent-slate-600 dark:accent-slate-400" title="Scroll offset" />
                <button type="button" onClick={() => setScrollOffset((o) => Math.max(0, o - scrollStep))} className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Scroll right (newer)">
                  <ChevronRight size={16} />
                </button>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                  {Math.round((scrollOffset / (meta.fs || 4000)) * 1000)} ms
                </span>
              </div>
            )}

            <div className="flex items-center gap-0.5 shrink-0 rounded-xl overflow-hidden border border-violet-200/80 dark:border-violet-800/80 bg-violet-50/50 dark:bg-violet-950/50 p-0.5">
              <button type="button" onClick={() => setZoomLevel((z) => Math.min(32, z * 1.5))} className="p-2 text-violet-700 dark:text-violet-300 hover:bg-violet-200/80 dark:hover:bg-violet-900/60 rounded-lg transition-colors" title="Zoom in">
                <ZoomIn size={18} />
              </button>
              <button type="button" onClick={() => setZoomLevel((z) => Math.max(0.25, z / 1.5))} className="p-2 text-violet-700 dark:text-violet-300 hover:bg-violet-200/80 dark:hover:bg-violet-900/60 rounded-lg transition-colors" title="Zoom out">
                <ZoomOut size={18} />
              </button>
              <button type="button" onClick={() => setZoomLevel(1)} className="px-2.5 py-1.5 text-xs font-bold text-violet-800 dark:text-violet-200 bg-violet-200/60 dark:bg-violet-900/70 hover:bg-violet-300/80 dark:hover:bg-violet-800/80 rounded-lg transition-colors" title="Reset zoom">
                1×
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0 px-2 py-1 sm:py-1.5 rounded-xl border border-indigo-200/80 dark:border-indigo-800/80 bg-indigo-50/50 dark:bg-indigo-950/40">
              <Gauge size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div className="flex rounded-lg overflow-hidden border border-indigo-200/60 dark:border-indigo-700/80 bg-white dark:bg-slate-900">
                <button type="button" onClick={() => setScaleMode('auto')} className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'auto' ? 'bg-indigo-600 text-white' : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/80'}`}>
                  Auto
                </button>
                <button type="button" onClick={() => setScaleMode('manual')} className={`px-2.5 py-1 text-xs font-semibold transition-all ${scaleMode === 'manual' ? 'bg-indigo-600 text-white' : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/80'}`}>
                  Manual
                </button>
              </div>
              {scaleMode === 'manual' && (
                <div className="flex items-center gap-1.5">
                  <input type="number" step="0.1" value={yMinManual} onChange={(e) => setYMinManual(parseFloat(e.target.value) || 0)} className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 dark:border-indigo-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Min" />
                  <span className="text-indigo-500 dark:text-indigo-400 font-bold">→</span>
                  <input type="number" step="0.1" value={yMaxManual} onChange={(e) => setYMaxManual(parseFloat(e.target.value) || 0)} className="w-12 sm:w-14 px-2 py-1 text-xs font-medium border border-indigo-200 dark:border-indigo-700 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" placeholder="Max" />
                </div>
              )}
            </div>

            {showStats && sampleCount > 0 && (
              <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200/80 text-slate-800 dark:bg-slate-800 dark:text-slate-100 border border-slate-300/60 dark:border-slate-600">
                {sampleCount.toLocaleString()} samples
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className={plotContainerClass}
        style={plotContainerStyle}
        onWheel={(e) => {
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const raw = e.deltaX !== 0 ? -e.deltaX : e.deltaY;
          const dir = raw > 0 ? 1 : -1;
          setScrollOffset((o) => Math.max(0, Math.min(maxScrollOffset, o + dir * scrollStep)));
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const el = containerRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const plotLeft = plotLeftPx;
          const plotW = Math.max(1, rect.width - plotLeftPx - 20);
          const localX = e.clientX - rect.left;
          const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));

          if (showCursorRef.current && localX >= plotLeft && localX <= plotLeft + plotW) {
            if (!showCursor2Ref.current) {
              activeCursorRef.current = 1;
              setCursorFrac(frac);
            } else {
              const f1 = cursorFracRef.current;
              const f2 = cursor2FracRef.current;
              const dist1 = Math.abs(frac - f1);
              const dist2 = Math.abs(frac - f2);
              if (dist1 <= dist2) {
                activeCursorRef.current = 1;
                setCursorFrac(frac);
              } else {
                activeCursorRef.current = 2;
                setCursor2Frac(frac);
              }
            }
            isDraggingCursorRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          panRef.current = { active: true, startX: e.clientX, startOffset: scrollOffsetRef.current || 0 };
          setIsPanning(true);
        }}
        onPointerMove={(e) => {
          if (isDraggingCursorRef.current) {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const plotLeft = plotLeftPx;
            const plotW = Math.max(1, rect.width - plotLeftPx - 20);
            const localX = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, (localX - plotLeft) / plotW));
            if (activeCursorRef.current === 1) setCursorFrac(frac);
            else setCursor2Frac(frac);
            return;
          }
          if (!panRef.current.active) return;
          if (!paused) return;
          if (maxScrollOffset <= 0) return;
          e.preventDefault();
          const dx = e.clientX - panRef.current.startX;
          const deltaSamples = Math.round(dx * samplesPerPx);
          const next = panRef.current.startOffset + deltaSamples;
          setScrollOffset(Math.max(0, Math.min(maxScrollOffset, next)));
        }}
        onPointerUp={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
        onPointerCancel={(e) => {
          if (isDraggingCursorRef.current) {
            isDraggingCursorRef.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            return;
          }
          if (!panRef.current.active) return;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          panRef.current.active = false;
          setIsPanning(false);
        }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full max-w-full border-0 bg-slate-200 dark:bg-slate-950"
          style={{ background: theme === 'dark' ? '#0f172a' : '#f1f5f9' }}
        />
      </div>

      <div
        className={`mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 ${
          isFullscreen ? 'shrink-0 border-slate-700' : ''
        }`}
      >
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Real-time measurements ({cursorChannel.toUpperCase()})</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 border border-slate-200/80 dark:border-slate-600">
            <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Vpp</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-50 tabular-nums">
              {vpp != null ? `${vpp.toFixed(2)} V` : '—'}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 border border-slate-200/80 dark:border-slate-600">
            <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Freq</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-50 tabular-nums">
              {freqHz != null ? (freqHz >= 1000 ? `${(freqHz / 1000).toFixed(2)} kHz` : `${freqHz.toFixed(1)} Hz`) : '—'}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 border border-slate-200/80 dark:border-slate-600">
            <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Duty cycle</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-50 tabular-nums">
              {dutyCycle != null ? `${dutyCycle.toFixed(1)} %` : '—'}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2 border border-slate-200/80 dark:border-slate-600">
            <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Sampling rate</div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-50 tabular-nums">
              {fs >= 1000000 ? `${(fs / 1000000).toFixed(1)} MHz` : fs >= 1000 ? `${(fs / 1000).toFixed(1)} kHz` : `${fs} Hz`}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default WaveformPage;

