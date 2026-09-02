import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Eye,
  FileCode,
  FileSpreadsheet,
  Filter,
  Gauge,
  ImageDown,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTestStore } from '../store/useTestStore';
import API_ENDPOINTS from '../utils/apiEndpoints';
import { filterH5WaveformResults, resultWaveformExportUrl, resultWaveformPreviewUrl } from '../utils/resultWaveformExport';

const MAX_WAVEFORM_SAMPLES = 3000;
const DISPLAY_WAVEFORM_SAMPLES = 800;
const WAVEFORM_CANVAS_HEIGHT = 320;
const STACKED_STRIP_MIN = 80;
const STACKED_LABEL_COL = 28;
const STACKED_LANE_COUNT = 8;
const SNAPSHOT_MAX = 12;

const WaveformPage = () => {
  const theme = useTestStore((state) => state.theme);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const minimapContainerRef = useRef(null);
  const fullscreenRootRef = useRef(null);
  const bufferRef = useRef({ CH1: [], CH2: [], CH3: [], CH4: [], CH5: [], CH6: [], CH7: [], CH8: [] });
  const rafRef = useRef(null);
  const fsRef = useRef(4000);
  const showWaveformRef = useRef(true);
  const showPlayheadRef = useRef(false);
  const playheadFracRef = useRef(0);
  const showGridRef = useRef(true);
  const showMinimapRef = useRef(true);
  const visibleSignalsRef = useRef({
    ch1: true, ch2: true, ch3: true, ch4: true,
    ch5: true, ch6: true, ch7: true, ch8: true,
  });
  const [meta, setMeta] = useState({ freq_hz: 125000, fs: 4000 });
  const [sampleCount, setSampleCount] = useState(0);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomLevelRef = useRef(1);
  const [containerWidth, setContainerWidth] = useState(800);
  const [chartHeight, setChartHeight] = useState(WAVEFORM_CANVAS_HEIGHT);
  const [layoutMode, setLayoutMode] = useState('overlay');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const layoutModeRef = useRef('overlay');
  const [scaleMode, setScaleMode] = useState('auto');
  const [yMinManual, setYMinManual] = useState(-1);
  const [yMaxManual, setYMaxManual] = useState(1);
  const scaleModeRef = useRef(scaleMode);
  const yMinManualRef = useRef(yMinManual);
  const yMaxManualRef = useRef(yMaxManual);
  const [paused, setPaused] = useState(true);
  const pausedRef = useRef(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);
  const [viewPanelOpen, setViewPanelOpen] = useState(false);
  const viewButtonRef = useRef(null);
  const viewPopoverRef = useRef(null);
  const [viewPopoverPos, setViewPopoverPos] = useState({ top: 0, left: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, startX: 0, startOffset: 0 });
  const [visibleSignals, setVisibleSignals] = useState({
    ch1: true, ch2: true, ch3: true, ch4: true,
    ch5: true, ch6: true, ch7: true, ch8: true,
  });
  const [showCursor, setShowCursor] = useState(true);
  const [cursorFrac, setCursorFrac] = useState(0.35);
  const [cursor2Frac, setCursor2Frac] = useState(0.65);
  const [showCursor2, setShowCursor2] = useState(true);
  const [cursorChannel, setCursorChannel] = useState('ch1');
  const [waveformResults, setWaveformResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [resultLoading, setResultLoading] = useState(false);
  const [resultPreviewError, setResultPreviewError] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const snapshotsRef = useRef([]);
  const showCursorRef = useRef(true);
  const cursorFracRef = useRef(0.35);
  const cursor2FracRef = useRef(0.65);
  const showCursor2Ref = useRef(true);
  const cursorChannelRef = useRef('ch1');
  const isDraggingCursorRef = useRef(false);
  const activeCursorRef = useRef(1);

  const [channelAliases, setChannelAliases] = useState(() => {
    try {
      const saved = localStorage.getItem('waveform_channel_aliases');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      ch1: 'CH0', ch2: 'CH1', ch3: 'CH2', ch4: 'CH3',
      ch5: 'CH4', ch6: 'CH5', ch7: 'CH6', ch8: 'CH7',
    };
  });

  const [isFinderOpen, setIsFinderOpen] = useState(false);
  const [finderSearch, setFinderSearch] = useState('');
  const [finderFilter, setFinderFilter] = useState('ALL'); // 'ALL' | 'PASS' | 'FAIL' | 'KR260'
  const finderRef = useRef(null);
  const finderSearchInputRef = useRef(null);

  useEffect(() => {
    if (!isFinderOpen) return;
    const handleClickOutside = (e) => {
      if (finderRef.current && !finderRef.current.contains(e.target)) {
        setIsFinderOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsFinderOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    setTimeout(() => finderSearchInputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFinderOpen]);

  const filteredWaveforms = useMemo(() => {
    return waveformResults.filter((r) => {
      const isPass = (r.status || '').toLowerCase() === 'passed' || (r.status || '').toLowerCase() === 'success' || r.passed === true;
      const isFail = (r.status || '').toLowerCase() === 'failed' || (r.status || '').toLowerCase() === 'error' || (r.passed === false && r.status !== 'running');
      if (finderFilter === 'PASS' && !isPass) return false;
      if (finderFilter === 'FAIL' && !isFail) return false;
      if (finderFilter === 'KR260' && !((r.board_id || '').toLowerCase().includes('kr260') || (r.board_model || '').toLowerCase().includes('kr260') || (r.job_name || '').toLowerCase().includes('kr260'))) return false;

      if (!finderSearch.trim()) return true;
      const q = finderSearch.toLowerCase().trim();
      const matchTitle = (r.job_name || '').toLowerCase().includes(q);
      const matchFile = (r.vcd_filename || '').toLowerCase().includes(q);
      const matchId = String(r.id || '').toLowerCase().includes(q);
      const matchBoard = (r.board_id || r.board_model || '').toLowerCase().includes(q);
      const matchStatus = (isPass ? 'passed' : 'failed').includes(q);
      const matchTag = (r.tag || '').toLowerCase().includes(q);
      return matchTitle || matchFile || matchId || matchBoard || matchStatus || matchTag;
    });
  }, [waveformResults, finderSearch, finderFilter]);

  const selectedResult = useMemo(() => {
    return waveformResults.find((r) => String(r.id) === String(selectedResultId)) || null;
  }, [waveformResults, selectedResultId]);

  const currentIndex = useMemo(() => {
    return waveformResults.findIndex((r) => String(r.id) === String(selectedResultId));
  }, [waveformResults, selectedResultId]);

  const handlePrevWaveform = () => {
    if (currentIndex > 0) {
      setSelectedResultId(waveformResults[currentIndex - 1].id);
    }
  };

  const handleNextWaveform = () => {
    if (currentIndex >= 0 && currentIndex < waveformResults.length - 1) {
      setSelectedResultId(waveformResults[currentIndex + 1].id);
    }
  };

  const handleAliasChange = (key, val) => {
    const next = { ...channelAliases, [key]: val || '' };
    setChannelAliases(next);
    try {
      localStorage.setItem('waveform_channel_aliases', JSON.stringify(next));
    } catch {}
  };

  const waveformFocusResultId = useTestStore((state) => state.waveformFocusResultId);
  const setWaveformFocusResultId = useTestStore((state) => state.setWaveformFocusResultId);

  useEffect(() => {
    if (waveformFocusResultId) {
      setSelectedResultId(waveformFocusResultId);
      setWaveformFocusResultId(null);
    }
  }, [waveformFocusResultId, setWaveformFocusResultId]);

  fsRef.current = meta.fs || 4000;
  showWaveformRef.current = showWaveform;
  showGridRef.current = showGrid;
  showMinimapRef.current = showMinimap;
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
  snapshotsRef.current = snapshots;

  const stackedPanelHeight = Math.min(
    960,
    48 + STACKED_STRIP_MIN * STACKED_LANE_COUNT + 36
  );

  const loadWaveformResults = async () => {
    setResultLoading(true);
    setResultPreviewError('');
    try {
      const res = await fetch(`${API_ENDPOINTS.RESULTS}?limit=200`);
      if (!res.ok) throw new Error(`Load results failed (${res.status})`);
      const rows = await res.json();
      const withWaveform = filterH5WaveformResults(rows);
      setWaveformResults(withWaveform);
      if (!selectedResultId && withWaveform[0]?.id) setSelectedResultId(withWaveform[0].id);
    } catch (err) {
      setResultPreviewError(err.message || 'Load results failed');
    } finally {
      setResultLoading(false);
    }
  };

  useEffect(() => {
    loadWaveformResults();
  }, []);

  useEffect(
    () => () => {
      snapshotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    []
  );

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, containerWidth);
    const h = Math.max(160, chartHeight);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    if (minimapCanvasRef.current) {
      const mc = minimapCanvasRef.current;
      mc.width = Math.floor(w * dpr);
      mc.height = Math.floor(48 * dpr);
      mc.style.width = `${w}px`;
      mc.style.height = '48px';
    }

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
      const canDrawWaveform = bufHasData;
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
        { key: 'ch1', id: 'CH1', short: channelAliases.ch1 || 'CH0', color: isDark ? '#38bdf8' : '#0284c7', width: 2.0 },
        { key: 'ch2', id: 'CH2', short: channelAliases.ch2 || 'CH1', color: isDark ? '#fb923c' : '#ea580c', width: 1.6 },
        { key: 'ch3', id: 'CH3', short: channelAliases.ch3 || 'CH2', color: isDark ? '#4ade80' : '#16a34a', width: 1.6 },
        { key: 'ch4', id: 'CH4', short: channelAliases.ch4 || 'CH3', color: isDark ? '#a78bfa' : '#7c3aed', width: 1.6 },
        { key: 'ch5', id: 'CH5', short: channelAliases.ch5 || 'CH4', color: isDark ? '#f43f5e' : '#e11d48', width: 1.6 },
        { key: 'ch6', id: 'CH6', short: channelAliases.ch6 || 'CH5', color: isDark ? '#eab308' : '#ca8a04', width: 1.6 },
        { key: 'ch7', id: 'CH7', short: channelAliases.ch7 || 'CH6', color: isDark ? '#06b6d4' : '#0891b2', width: 1.6 },
        { key: 'ch8', id: 'CH8', short: channelAliases.ch8 || 'CH7', color: isDark ? '#ec4899' : '#db2777', width: 1.6 },
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

        if (showWaveformRef.current && canDrawWaveform && bufHasData && toDraw) {
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
          chDefs.forEach((cd) => {
            if (visibleSignalsRef.current[cd.key]) {
              drawChannel(buffers[cd.id], cd.color, cd.width);
            }
          });
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
          const chMap = {
            ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4',
            ch5: 'CH5', ch6: 'CH6', ch7: 'CH7', ch8: 'CH8',
          };
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
            canDrawWaveform &&
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

        const chMap = {
          ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4',
          ch5: 'CH5', ch6: 'CH6', ch7: 'CH7', ch8: 'CH8',
        };
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

      if (buf.length < 2 || !canDrawWaveform) {
        ctx.fillStyle = pal.labelMuted;
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Select a completed test result above to view waveform', cw / 2, ch / 2);
      } else if (!showWaveformRef.current) {
        ctx.fillStyle = pal.labelMuted;
        ctx.font = '14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waveform display hidden (check signals in View options)', cw / 2, ch / 2);
      }

      // Draw Minimap Canvas
      if (minimapCanvasRef.current && showMinimapRef.current) {
        const mc = minimapCanvasRef.current;
        const mctx = mc.getContext('2d');
        if (mctx) {
          mctx.setTransform(1, 0, 0, 1, 0, 0);
          mctx.scale(dpr, dpr);
          const mw = w;
          const mh = 48;
          mctx.clearRect(0, 0, mw, mh);
          mctx.fillStyle = isDark ? '#090d16' : '#f8fafc';
          mctx.fillRect(0, 0, mw, mh);

          const totalSamples = buf.length;
          if (totalSamples >= 2) {
            const padL = 4;
            const padR = 4;
            const trkW = Math.max(1, mw - padL - padR);
            const stepM = Math.max(1, Math.floor(totalSamples / trkW));
            const midYM = mh / 2;

            chDefs.forEach((cd) => {
              if (visibleSignalsRef.current[cd.key] === false) return;
              const arr = buffers[cd.id];
              if (!arr || arr.length < 2) return;
              mctx.strokeStyle = cd.color;
              mctx.lineWidth = 1;
              mctx.globalAlpha = 0.55;
              mctx.beginPath();
              for (let x = 0; x < trkW; x++) {
                const idx = Math.min(totalSamples - 1, x * stepM);
                const val = Number(arr[idx] || 0);
                const ym = Math.max(2, Math.min(mh - 2, midYM - val * (mh / 3.5)));
                if (x === 0) mctx.moveTo(padL + x, ym);
                else mctx.lineTo(padL + x, ym);
              }
              mctx.stroke();
            });
            mctx.globalAlpha = 1.0;

            // Viewport Lens
            const startFrac = Math.max(0, Math.min(1, startIndex / totalSamples));
            const endFrac = Math.max(0, Math.min(1, endIndex / totalSamples));
            const lensX1 = padL + startFrac * trkW;
            const lensX2 = padL + endFrac * trkW;
            const lensW = Math.max(6, lensX2 - lensX1);

            // Shading outside visible window
            mctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 23, 42, 0.35)';
            if (lensX1 > 0) mctx.fillRect(0, 0, lensX1, mh);
            if (lensX2 < mw) mctx.fillRect(lensX2, 0, mw - lensX2, mh);

            // Viewport Box
            mctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(2, 132, 199, 0.15)';
            mctx.fillRect(lensX1, 1, lensW, mh - 2);
            mctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7';
            mctx.lineWidth = 1.5;
            mctx.strokeRect(lensX1, 1, lensW, mh - 2);

            // Left & Right grip handles
            mctx.fillStyle = isDark ? '#38bdf8' : '#0284c7';
            mctx.fillRect(lensX1 - 2, mh / 2 - 8, 4, 16);
            mctx.fillRect(lensX2 - 2, mh / 2 - 8, 4, 16);

            // Global Cursor Markers on minimap
            if (showCursorRef.current && toDraw && n >= 2) {
              const c1X = padL + ((startIndex + cursorFracRef.current * (n - 1)) / totalSamples) * trkW;
              mctx.strokeStyle = '#f59e0b';
              mctx.lineWidth = 1.5;
              mctx.beginPath();
              mctx.moveTo(c1X, 0);
              mctx.lineTo(c1X, mh);
              mctx.stroke();

              if (showCursor2Ref.current) {
                const c2X = padL + ((startIndex + cursor2FracRef.current * (n - 1)) / totalSamples) * trkW;
                mctx.strokeStyle = '#60a5fa';
                mctx.lineWidth = 1.5;
                mctx.beginPath();
                mctx.moveTo(c2X, 0);
                mctx.lineTo(c2X, mh);
                mctx.stroke();
              }
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [showWaveform, zoomLevel, containerWidth, chartHeight, paused, theme, layoutMode, visibleSignals]);

  const isLive = false;
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

  const exportFilenameBase = () => {
    const d = new Date();
    const iso = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const b = (selectedBoardId || 'simulated').replace(/[^\w-]+/g, '_').slice(0, 24);
    const lay = layoutMode === 'stacked' ? '4ch' : 'overlay';
    const z = String(zoomLevel).replace('.', 'p');
    return `waveform_${iso}_${lay}_z${z}_${b}`;
  };

  const triggerDownloadBlob = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const captureCanvasPngBlob = () =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      canvas.toBlob((b) => resolve(b), 'image/png', 1);
    });

  const handleExportPng = async () => {
    const blob = await captureCanvasPngBlob();
    if (!blob) return;
    const base = exportFilenameBase();
    triggerDownloadBlob(blob, `${base}.png`);
    setSnapshots((prev) => {
      const url = URL.createObjectURL(blob);
      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        url,
        createdAt: Date.now(),
        label: base,
      };
      const next = [item, ...prev];
      if (next.length > SNAPSHOT_MAX) {
        next.slice(SNAPSHOT_MAX).forEach((x) => URL.revokeObjectURL(x.url));
      }
      return next.slice(0, SNAPSHOT_MAX);
    });
  };

  const handleExportCsv = () => {
    const buffers = bufferRef.current;
    const ch1 = buffers.CH1 || [];
    const nCh1 = ch1.length;
    if (nCh1 < 2) return;
    const displayCount = Math.max(
      2,
      Math.min(sampleCount || 0, Math.round(DISPLAY_WAVEFORM_SAMPLES / (zoomLevel || 1)))
    );
    const endIndex = Math.max(0, Math.min(nCh1, nCh1 - (paused ? scrollOffset : 0)));
    const startIndex = Math.max(0, endIndex - displayCount);
    const n = endIndex - startIndex;
    const fsVal = meta.fs || 4000;
    const chKeys = ['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'CH8'];
    const rows = [['sample_index', 'time_ms', ...chKeys]];
    for (let i = 0; i < n; i++) {
      const idx = startIndex + i;
      const tMs = (idx / fsVal) * 1000;
      const cell = (id) => {
        const arr = buffers[id];
        return arr && idx < arr.length && arr[idx] != null ? String(Number(arr[idx])) : '';
      };
      rows.push([String(i), String(tMs), ...chKeys.map((k) => cell(k))]);
    }
    const csv = rows.map((r) => r.join(',')).join('\n');
    const bom = '\uFEFF';
    triggerDownloadBlob(new Blob([bom + csv], { type: 'text/csv;charset=utf-8' }), `${exportFilenameBase()}.csv`);
  };

  const loadSelectedResultPreview = async () => {
    if (!selectedResultId) return;
    setResultLoading(true);
    setResultPreviewError('');
    try {
      const res = await fetch(resultWaveformPreviewUrl(selectedResultId, MAX_WAVEFORM_SAMPLES));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Preview failed (${res.status})`);
      }
      const preview = await res.json();
      const nextBuffers = {
        CH1: [], CH2: [], CH3: [], CH4: [],
        CH5: [], CH6: [], CH7: [], CH8: [],
      };
      (preview.channels || []).slice(0, 8).forEach((channel, index) => {
        const id = `CH${index + 1}`;
        nextBuffers[id] = Array.isArray(channel.data) ? channel.data.map(Number) : [];
      });
      bufferRef.current = nextBuffers;
      const count = nextBuffers.CH1.length || Number(preview.preview_count || preview.sample_count || 0);
      setSampleCount(count);
      setMeta((m) => ({ ...m, fs: Number(preview.sample_rate_hz || m.fs || 1) }));
      setScaleMode('auto');
      setPaused(true);
      setScrollOffset(0);
    } catch (err) {
      setResultPreviewError(err.message || 'Preview failed');
    } finally {
      setResultLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedResultId) return;
    loadSelectedResultPreview();
  }, [selectedResultId]);

  const downloadSelectedResult = (format) => {
    if (!selectedResultId) return;
    const a = document.createElement('a');
    a.href = resultWaveformExportUrl(selectedResultId, format);
    a.download = `result_${selectedResultId}.${format === 'csv' ? 'csv' : 'h5'}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const removeSnapshot = (id) => {
    setSnapshots((prev) => {
      const item = prev.find((s) => s.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((s) => s.id !== id);
    });
  };

  const clearSnapshots = () => {
    setSnapshots((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
  };

  const redownloadSnapshot = (s) => {
    const a = document.createElement('a');
    a.href = s.url;
    a.download = `${s.label}.png`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const measureChannelMap = {
    ch1: 'CH1', ch2: 'CH2', ch3: 'CH3', ch4: 'CH4',
    ch5: 'CH5', ch6: 'CH6', ch7: 'CH7', ch8: 'CH8',
  };
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
                    Waveform Viewer
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                    Preview and analyze stored HDF5 / VCD waveform results
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-500/15 text-blue-800 dark:bg-blue-900/35 dark:text-blue-200 border border-blue-300/60 dark:border-blue-700/80">
                Result Preview
              </span>
              {sampleCount > 0 && (
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  {sampleCount.toLocaleString()} samples @ {meta.fs ? (meta.fs >= 1e6 ? `${(meta.fs/1e6).toFixed(1)} MHz` : `${(meta.fs/1e3).toFixed(1)} kHz`) : '—'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={loadWaveformResults}
                disabled={resultLoading}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                title="Refresh results list"
              >
                Refresh List
              </button>
            </div>
          </div>

          {/* Enhanced Searchable Combobox / Quick Finder Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-gradient-to-r from-blue-50/80 via-indigo-50/40 to-slate-50/80 dark:from-blue-950/40 dark:via-slate-900/40 dark:to-slate-900/80 p-3 shadow-sm">
            {/* Left: Quick Finder Combobox & Stepper */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1 min-w-0">
              {/* Prev / Next Stepper */}
              <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 shadow-sm shrink-0">
                <button
                  type="button"
                  onClick={handlePrevWaveform}
                  disabled={currentIndex <= 0}
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  title="Previous Waveform (Alt+Left)"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums select-none" title="Current waveform index">
                  {waveformResults.length > 0 ? `${currentIndex + 1}/${waveformResults.length}` : '0/0'}
                </span>
                <button
                  type="button"
                  onClick={handleNextWaveform}
                  disabled={currentIndex < 0 || currentIndex >= waveformResults.length - 1}
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  title="Next Waveform (Alt+Right)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Combobox Trigger Button & Floating Finder Modal */}
              <div className="relative flex-1 min-w-[260px]" ref={finderRef}>
                <button
                  type="button"
                  onClick={() => setIsFinderOpen((o) => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-800/80 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-600 text-left shadow-sm transition-all group"
                  title="Click to search and select waveform results"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="p-1 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 shrink-0">
                      <Search size={14} />
                    </div>
                    {selectedResult ? (
                      <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">
                          {selectedResult.job_name || selectedResult.vcd_filename || `Result #${selectedResult.id}`}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 uppercase ${
                            selectedResult.passed === true || (selectedResult.status || '').toLowerCase() === 'passed'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                          }`}
                        >
                          {selectedResult.passed === true || (selectedResult.status || '').toLowerCase() === 'passed' ? 'PASSED' : 'FAILED'}
                        </span>
                        {(selectedResult.board_id || selectedResult.board_model) && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0 hidden md:inline-block">
                            {selectedResult.board_id || selectedResult.board_model}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">Search / Select Waveform Result...</span>
                    )}
                  </div>
                  <ChevronDown
                    size={15}
                    className={`text-slate-400 transition-transform duration-200 shrink-0 ${isFinderOpen ? 'rotate-180 text-blue-500' : ''}`}
                  />
                </button>

                {/* Floating Finder Popover */}
                {isFinderOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-full sm:w-[480px] max-w-[95vw] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-[999] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    {/* Search Input Bar */}
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          ref={finderSearchInputRef}
                          type="text"
                          value={finderSearch}
                          onChange={(e) => setFinderSearch(e.target.value)}
                          placeholder="Search job, file, batch #, board, status..."
                          className="w-full pl-9 pr-8 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {finderSearch && (
                          <button
                            type="button"
                            onClick={() => setFinderSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {/* Filter Chips */}
                      <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-0.5">
                        {[
                          { id: 'ALL', label: `All (${waveformResults.length})` },
                          {
                            id: 'PASS',
                            label: `Passed (${waveformResults.filter((r) => r.passed === true || (r.status || '').toLowerCase() === 'passed' || (r.status || '').toLowerCase() === 'success').length})`,
                          },
                          {
                            id: 'FAIL',
                            label: `Failed (${waveformResults.filter((r) => r.passed === false || (r.status || '').toLowerCase() === 'failed' || (r.status || '').toLowerCase() === 'error').length})`,
                          },
                          {
                            id: 'KR260',
                            label: `KR260 (${waveformResults.filter((r) => (r.board_id || '').toLowerCase().includes('kr260') || (r.board_model || '').toLowerCase().includes('kr260') || (r.job_name || '').toLowerCase().includes('kr260')).length})`,
                          },
                        ].map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => setFinderFilter(chip.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                              finderFilter === chip.id
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-slate-200/80 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                            }`}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Results List */}
                    <div className="max-h-72 overflow-y-auto p-1.5 divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredWaveforms.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-400">
                          <Activity size={24} className="mx-auto mb-2 opacity-40" />
                          No matching waveform results found
                        </div>
                      ) : (
                        filteredWaveforms.map((r) => {
                          const isSelected = String(r.id) === String(selectedResultId);
                          const isPass = r.passed === true || (r.status || '').toLowerCase() === 'passed' || (r.status || '').toLowerCase() === 'success';
                          const isFail = r.passed === false || (r.status || '').toLowerCase() === 'failed' || (r.status || '').toLowerCase() === 'error';

                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setSelectedResultId(r.id);
                                setIsFinderOpen(false);
                              }}
                              className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl text-left transition-all ${
                                isSelected
                                  ? 'bg-blue-50 dark:bg-blue-950/70 border border-blue-300 dark:border-blue-700'
                                  : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/80 border border-transparent'
                              }`}
                            >
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <div className="mt-0.5 shrink-0">
                                  {isPass ? (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                  ) : isFail ? (
                                    <XCircle size={16} className="text-rose-500" />
                                  ) : (
                                    <Activity size={16} className="text-blue-500" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                                      {r.job_name || r.vcd_filename || `Batch #${r.id}`}
                                    </span>
                                    {r.vcd_filename && r.job_name && (
                                      <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                                        ({r.vcd_filename})
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1 shrink-0">
                                      <Clock size={11} />
                                      {r.completed_at ? new Date(r.completed_at).toLocaleString() : 'Recent'}
                                    </span>
                                    {(r.board_id || r.board_model) && (
                                      <span className="flex items-center gap-1 shrink-0">
                                        <Cpu size={11} />
                                        {r.board_id || r.board_model}
                                      </span>
                                    )}
                                    {r.preview_count && (
                                      <span className="shrink-0 font-medium">
                                        {Number(r.preview_count).toLocaleString()} pts
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-600 text-white shrink-0">
                                  Viewing
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Actions (Reload, Download H5, VCD, CSV) */}
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={loadSelectedResultPreview}
                disabled={!selectedResultId || resultLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
                title="Reload preview data"
              >
                <RefreshCw size={13} className={resultLoading ? 'animate-spin' : ''} />
                <span>{resultLoading ? 'Loading…' : 'Reload'}</span>
              </button>
              <button
                type="button"
                onClick={() => downloadSelectedResult('h5')}
                disabled={!selectedResultId}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors shrink-0"
                title="Download full resolution HDF5 dataset"
              >
                H5
              </button>
              <button
                type="button"
                onClick={() => downloadSelectedResult('vcd')}
                disabled={!selectedResultId}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-100 hover:bg-purple-100 dark:hover:bg-purple-900/50 disabled:opacity-50 transition-colors shrink-0"
                title="Download VCD waveform for GTKWave / Surfer"
              >
                VCD
              </button>
              <button
                type="button"
                onClick={() => downloadSelectedResult('csv')}
                disabled={!selectedResultId}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition-colors shrink-0"
                title="Export CSV of full run"
              >
                CSV
              </button>
            </div>

            {resultPreviewError && (
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                {resultPreviewError}
              </span>
            )}
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
                      className={`flex-1 py-1 px-2 rounded-md font-semibold transition-all ${
                        layoutMode === 'stacked'
                          ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-sm'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      title="Eight stacked lanes (CH0 top … CH7 bottom), same time axis for all"
                    >
                      8 tracks
                    </button>
                  </div>
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-200 mb-2">Show on chart</div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showWaveform} onChange={(e) => setShowWaveform(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500" />
                      Trace
                    </label>
                    <label className="flex items-center gap-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 select-none">
                      <input type="checkbox" checked={showMinimap} onChange={(e) => setShowMinimap(e.target.checked)} className="w-4 h-4 shrink-0 rounded border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500" />
                      Overview Minimap
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
                            {[
                              { key: 'ch1', default: 'CH0' },
                              { key: 'ch2', default: 'CH1' },
                              { key: 'ch3', default: 'CH2' },
                              { key: 'ch4', default: 'CH3' },
                              { key: 'ch5', default: 'CH4' },
                              { key: 'ch6', default: 'CH5' },
                              { key: 'ch7', default: 'CH6' },
                              { key: 'ch8', default: 'CH7' },
                            ].map((ch) => (
                              <option key={ch.key} value={ch.key}>
                                {channelAliases[ch.key] ? `${ch.default} (${channelAliases[ch.key]})` : ch.default}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-200 mb-1.5">
                      <span>Signals & Aliases</span>
                      <span className="text-[10px] text-slate-400 font-normal">Edit pin label</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {[
                        { key: 'ch1', default: 'CH0', color: 'text-sky-500' },
                        { key: 'ch2', default: 'CH1', color: 'text-orange-500' },
                        { key: 'ch3', default: 'CH2', color: 'text-emerald-500' },
                        { key: 'ch4', default: 'CH3', color: 'text-violet-500' },
                        { key: 'ch5', default: 'CH4', color: 'text-rose-500' },
                        { key: 'ch6', default: 'CH5', color: 'text-yellow-500' },
                        { key: 'ch7', default: 'CH6', color: 'text-cyan-500' },
                        { key: 'ch8', default: 'CH7', color: 'text-pink-500' },
                      ].map((ch) => (
                        <div key={ch.key} className="flex items-center gap-1.5 py-0.5">
                          <label className="flex items-center gap-1.5 text-xs text-slate-800 dark:text-slate-100 select-none shrink-0 w-16">
                            <input
                              type="checkbox"
                              checked={visibleSignals[ch.key] !== false}
                              onChange={(e) => setVisibleSignals((prev) => ({ ...prev, [ch.key]: e.target.checked }))}
                              className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600"
                            />
                            <span className={`font-bold ${ch.color}`}>{ch.default}</span>
                          </label>
                          <input
                            type="text"
                            value={channelAliases[ch.key] ?? ''}
                            onChange={(e) => handleAliasChange(ch.key, e.target.value)}
                            placeholder={ch.default}
                            className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-sky-500"
                            title={`Custom label for ${ch.default}`}
                          />
                        </div>
                      ))}
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


            <div className="flex items-center gap-0.5 shrink-0 rounded-xl overflow-hidden border border-emerald-200/80 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-950/40 p-0.5">
              <button
                type="button"
                onClick={handleExportPng}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200/70 dark:hover:bg-emerald-900/60 rounded-lg transition-all"
                title="Download PNG of the current chart (also kept in session list below)"
              >
                <ImageDown size={16} />
                <span className="hidden sm:inline">PNG</span>
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={sampleCount < 2}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200/70 dark:hover:bg-emerald-900/60 rounded-lg transition-all disabled:opacity-40 disabled:pointer-events-none"
                title="Export visible time window as CSV (same range as the chart)"
              >
                <FileSpreadsheet size={16} />
                <span className="hidden sm:inline">CSV</span>
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

      {showMinimap && (
        <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900 shadow-inner">
          <div className="flex items-center justify-between px-3 py-1 bg-slate-200/70 dark:bg-slate-800/80 border-b border-slate-300/60 dark:border-slate-700/60 text-[11px]">
            <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block"></span>
              Timeline Minimap & Navigator
            </span>
            <span className="font-medium text-slate-500 dark:text-slate-400 tabular-nums">
              0.00 ms → {Math.round(((sampleCount || 1) / (meta.fs || 4000)) * 1000)} ms ({sampleCount.toLocaleString()} samples)
            </span>
          </div>
          <div
            ref={minimapContainerRef}
            className="relative cursor-pointer select-none touch-none h-12"
            onPointerDown={(e) => {
              const el = minimapContainerRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const padL = 4;
              const trkW = Math.max(1, rect.width - 8);
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / trkW));
              const totalSamples = sampleCount || 1;
              const zoom = zoomLevel || 1;
              const displayCount = Math.max(2, Math.min(totalSamples, Math.round(DISPLAY_WAVEFORM_SAMPLES / zoom)));
              const targetCenter = frac * totalSamples;
              const newEnd = Math.min(totalSamples, Math.max(displayCount, Math.round(targetCenter + displayCount / 2)));
              setScrollOffset(Math.max(0, totalSamples - newEnd));
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return;
              const el = minimapContainerRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const padL = 4;
              const trkW = Math.max(1, rect.width - 8);
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / trkW));
              const totalSamples = sampleCount || 1;
              const zoom = zoomLevel || 1;
              const displayCount = Math.max(2, Math.min(totalSamples, Math.round(DISPLAY_WAVEFORM_SAMPLES / zoom)));
              const targetCenter = frac * totalSamples;
              const newEnd = Math.min(totalSamples, Math.max(displayCount, Math.round(targetCenter + displayCount / 2)));
              setScrollOffset(Math.max(0, totalSamples - newEnd));
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
          >
            <canvas
              ref={minimapCanvasRef}
              className="block w-full h-12"
            />
          </div>
        </div>
      )}

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

        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Session captures (PNG)</div>
            {snapshots.length > 0 && (
              <button
                type="button"
                onClick={clearSnapshots}
                className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
              >
                Clear all
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 leading-snug">
            PNG saves the chart as it looks now (layout, zoom, pause/scroll). Kept here until you close or refresh this tab — use CSV for raw numbers in the same time window.
          </p>
          {snapshots.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No captures yet — press PNG above.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {snapshots.map((s) => (
                <div key={s.id} className="relative shrink-0 w-[7.5rem] group">
                  <button
                    type="button"
                    onClick={() => redownloadSnapshot(s)}
                    className="block w-full rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-emerald-500/50 transition-shadow"
                    title="Download this image again"
                  >
                    <img src={s.url} alt="Saved waveform capture" className="w-full h-[4.25rem] object-cover object-left-top" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSnapshot(s.id)}
                    className="absolute top-1 right-1 p-0.5 rounded-md bg-slate-900/75 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    title="Remove from list"
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                  <div
                    className="text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums"
                    title={new Date(s.createdAt).toLocaleString()}
                  >
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default WaveformPage;

