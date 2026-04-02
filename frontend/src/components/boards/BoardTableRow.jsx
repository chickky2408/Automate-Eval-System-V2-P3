import React from 'react';
import { CheckCircle2, MoreVertical, Terminal, Wifi, WifiOff, XCircle } from 'lucide-react';

const BoardTableRow = ({ board, selected, onSelect, onClick, onSSHClick }) => {
  const getStatusBadge = (status) => {
    const colors = {
      online: 'bg-emerald-100 text-emerald-700',
      busy: 'bg-blue-100 text-blue-700',
      error: 'bg-red-100 text-red-700'
    };
    return (
      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${colors[status] || 'bg-slate-100 text-slate-700'}`}>
        {status}
      </span>
    );
  };
  
  return (
    <tr 
      className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${selected ? 'bg-blue-50' : ''}`}
      onClick={onClick}
    >
      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="w-4 h-4 rounded border-slate-300 text-blue-600"
        />
      </td>
      <td className="px-6 py-4">
        <div className="font-bold text-slate-700">{board.name}</div>
        {board.tag && <div className="text-[10px] font-bold text-purple-700 mt-1">Tag: {board.tag}</div>}
      </td>
      <td className="px-6 py-4">{getStatusBadge(board.status)}</td>
      <td className="px-6 py-4 text-sm font-bold text-slate-600">{board.ip}</td>
      <td className="px-6 py-4 text-sm font-mono text-slate-500">{board.mac}</td>
      <td className="px-6 py-4 text-sm font-bold text-slate-600">{board.model}</td>
      <td className="px-6 py-4 text-sm font-bold text-slate-600">{board.firmware}</td>
      <td className="px-6 py-4 text-xs">
        {(board.fpgaStatus || board.armStatus) ? (
          <span className="font-mono">
            <span className={board.fpgaStatus === 'active' ? 'text-emerald-600' : board.fpgaStatus === 'error' ? 'text-red-600' : 'text-slate-500'}>{board.fpgaStatus || '—'}</span>
            <span className="text-slate-400 mx-1">/</span>
            <span className={board.armStatus === 'online' ? 'text-emerald-600' : board.armStatus === 'busy' ? 'text-blue-600' : board.armStatus === 'error' ? 'text-red-600' : 'text-slate-500'}>{board.armStatus || '—'}</span>
          </span>
        ) : '—'}
      </td>
      <td className="px-6 py-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSSHClick();
          }}
          className="text-blue-600 hover:text-blue-800 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1"
        >
          <Terminal size={14} />
          SSH
        </button>
      </td>
    </tr>
  );
};

// Device Details Side Panel

export default BoardTableRow;
