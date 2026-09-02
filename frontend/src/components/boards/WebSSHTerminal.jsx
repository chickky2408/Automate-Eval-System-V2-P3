import React, { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import api from '../../services/api';

const WebSSHTerminal = ({ board, onClose }) => {
  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const wsRef = useRef(null);
  
  const boardId = board?.id;
  const boardName = board?.name;
  const boardIp = board?.ip;
  
  useEffect(() => {
    if (terminalRef.current && !terminalInstanceRef.current) {
      const term = new XTerm({
        cursorBlink: true,
        theme: {
          background: '#1e293b',
          foreground: '#e2e8f0',
        },
        fontSize: 14,
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      });
      
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      
      term.writeln(`\x1b[1;36mInitializing WebSSH Terminal to ${boardName || 'Board'} (${boardIp || 'unknown IP'})...\x1b[0m`);
      
      // Get WebSocket URL
      const wsUrl = api.getBoardSSHConnection(boardId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      const sendResize = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            action: 'resize',
            cols: term.cols,
            rows: term.rows
          }));
        }
      };
      
      ws.onopen = () => {
        term.writeln('\x1b[1;32mWebSocket connection established.\x1b[0m');
        sendResize();
      };
      
      ws.onmessage = (event) => {
        term.write(event.data);
      };
      
      ws.onclose = (event) => {
        term.writeln(`\r\n\x1b[1;31mConnection closed (Code: ${event.code}).\x1b[0m`);
      };
      
      ws.onerror = (error) => {
        term.writeln('\r\n\x1b[1;31mWebSocket error occurred.\x1b[0m');
      };
      
      // Forward key data
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            action: 'data',
            data: data
          }));
        }
      });
      
      terminalInstanceRef.current = term;
      
      const handleResize = () => {
        fitAddon.fit();
        sendResize();
      };
      
      // Trigger resize after slightly waiting to let the DOM settle
      const initialResizeTimer = setTimeout(handleResize, 100);
      
      window.addEventListener('resize', handleResize);
      
      return () => {
        clearTimeout(initialResizeTimer);
        window.removeEventListener('resize', handleResize);
        if (wsRef.current) {
          wsRef.current.close();
        }
        term.dispose();
      };
    }
  }, [boardId, boardName, boardIp]);
  
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-4 bg-slate-900 rounded-2xl shadow-2xl z-50 flex flex-col">
        <div className="p-4 border-b border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Terminal size={20} className="text-slate-300" />
            <div>
              <h3 className="text-white font-bold">SSH Terminal - {board.name}</h3>
              <p className="text-xs text-slate-400">{board.ip}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 p-4 bg-slate-950 overflow-hidden">
          <div ref={terminalRef} className="w-full h-full" />
        </div>
      </div>
    </>
  );
};

export default WebSSHTerminal;
