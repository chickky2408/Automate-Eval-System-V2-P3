import React, { useState } from 'react';
import { 
  Download, 
  FileCode, 
  Database, 
  FileSpreadsheet, 
  Archive, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Check, 
  ExternalLink,
  ShieldCheck,
  Zap
} from 'lucide-react';

/**
 * MultiArtifactDownloadPanel
 * Artifacts Action Center & Pass/Fail Metrics Summary Table
 * Displays VCD, HDF5, CSV, and Tar.gz bundle downloads along with validation tolerances.
 */
export default function MultiArtifactDownloadPanel({
  resultId = "res-20260826-kr260-01",
  passed = true,
  durationSeconds = 3.45,
  artifacts = null,
  metrics = null,
  onOpenWaveform = null,
  onDownload = null
}) {
  const [copiedSha, setCopiedSha] = useState(false);

  // Default Artifacts List
  const defaultArtifacts = [
    {
      id: 'vcd',
      name: 'waveform.vcd',
      type: 'WAVEFORM',
      icon: FileCode,
      sizeFormatted: '12.6 MB',
      description: 'Digital Logic & Timing Waveform (GTKWave / Scope)',
      color: 'sky',
      canPreview: true,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    },
    {
      id: 'h5',
      name: 'capture.h5',
      type: 'WAVEFORM',
      icon: Database,
      sizeFormatted: '4.28 MB',
      description: 'High-Density HDF5 Dataset for Python NumPy/Pandas',
      color: 'indigo',
      canPreview: false,
      sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a'
    },
    {
      id: 'csv',
      name: 'summary_metrics.csv',
      type: 'REPORT',
      icon: FileSpreadsheet,
      sizeFormatted: '2.82 MB',
      description: 'Tabular Summary & Pass/Fail Metrics for Excel',
      color: 'emerald',
      canPreview: false,
      sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d'
    },
    {
      id: 'bundle',
      name: `run_${resultId}_bundle.tar.gz`,
      type: 'BUNDLE',
      icon: Archive,
      sizeFormatted: '1.45 MB',
      description: 'Atomic Complete Bundle (.vcd + .h5 + .csv + manifest)',
      color: 'amber',
      canPreview: false,
      sha256: '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069'
    }
  ];

  const artifactList = artifacts || defaultArtifacts;

  // Default Metrics Table
  const defaultMetrics = [
    { name: 'V_Peak_to_Peak', measured: '1.18 V', min: '1.10 V', max: '1.30 V', status: 'PASS' },
    { name: 'Clock_Frequency', measured: '100.02 MHz', min: '99.50 MHz', max: '100.50 MHz', status: 'PASS' },
    { name: 'Rise_Time_Tr', measured: '1.42 ns', min: '0.80 ns', max: '2.00 ns', status: 'PASS' },
    { name: 'Clock_Jitter_Rms', measured: '12.4 ps', min: '0.0 ps', max: '25.0 ps', status: 'PASS' },
    { name: 'CRC_Error_Count', measured: '0', min: '0', max: '0', status: 'PASS' },
  ];

  const metricsList = metrics || defaultMetrics;

  const handleCopySha = (sha) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  return (
    <div className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6 shadow-xl">
      {/* Header & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3.5">
          <div className={`p-2.5 rounded-xl border ${
            passed 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}>
            {passed ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-wide">Test Execution Artifacts & Metrics</h3>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                passed 
                  ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80' 
                  : 'bg-rose-950/80 text-rose-400 border-rose-800/80'
              }`}>
                {passed ? 'ALL PASSED' : 'FAILED'}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Result ID: <span className="text-slate-200">{resultId}</span> • Duration: <span className="text-emerald-400 font-semibold">{durationSeconds}s</span>
            </p>
          </div>
        </div>

        {/* Quick Action Button */}
        {onOpenWaveform && (
          <button 
            onClick={onOpenWaveform}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/30 transition-all"
          >
            <Eye className="w-4 h-4" />
            <span>Open in Waveform Scope</span>
          </button>
        )}
      </div>

      {/* Artifacts Download Cards Grid */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <Archive className="w-4 h-4 text-indigo-400" />
          <span>Generated Artifact Files ({artifactList.length})</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {artifactList.map((item) => {
            const Icon = item.icon;
            return (
              <div 
                key={item.id}
                className="bg-slate-900/70 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 transition-all hover:bg-slate-900 group"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-indigo-400 group-hover:text-white transition-colors">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {item.sizeFormatted}
                    </span>
                  </div>

                  <h5 className="font-mono font-bold text-sm text-slate-200 truncate" title={item.name}>
                    {item.name}
                  </h5>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {item.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                  <a
                    href={`/api/files/${item.id}/content`}
                    download={item.name}
                    onClick={(e) => {
                      if (onDownload) {
                        e.preventDefault();
                        onDownload(item);
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-slate-950 hover:bg-slate-800 text-slate-200 text-xs font-semibold py-1.5 px-3 rounded-lg border border-slate-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Download</span>
                  </a>

                  {item.canPreview && onOpenWaveform && (
                    <button
                      onClick={onOpenWaveform}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
                      title="Inspect Waveform"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pass/Fail Metrics Comparison Table */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Silicon Measurement Tolerances & Pass/Fail Status</span>
        </h4>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="px-4 py-2.5">Parameter Name</th>
                <th className="px-4 py-2.5">Measured Value</th>
                <th className="px-4 py-2.5">Min Limit</th>
                <th className="px-4 py-2.5">Max Limit</th>
                <th className="px-4 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {metricsList.map((m, idx) => (
                <tr key={idx} className="hover:bg-slate-900/80 transition-colors">
                  <td className="px-4 py-2.5 font-bold text-slate-200">{m.name}</td>
                  <td className="px-4 py-2.5 text-emerald-400 font-semibold">{m.measured}</td>
                  <td className="px-4 py-2.5 text-slate-400">{m.min}</td>
                  <td className="px-4 py-2.5 text-slate-400">{m.max}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center gap-1 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      <Check className="w-3 h-3" /> PASS
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
