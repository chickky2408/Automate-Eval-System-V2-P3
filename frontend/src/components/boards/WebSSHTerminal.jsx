import React, { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const WebSSHTerminal = ({ board, onClose }) => {
  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  
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
      
      // Welcome message
      term.writeln(`\x1b[1;32mConnected to ${board.name} (${board.ip})\x1b[0m`);
      term.writeln(`\x1b[1;33mType 'help' for available commands\x1b[0m`);
      term.writeln('');
      
      // Handle input (simulated - in real app, this would connect to WebSocket)
      let currentLine = '';
      term.onData((data) => {
        if (data === '\r' || data === '\n') {
          term.writeln('');
          if (currentLine.trim() === 'help') {
            term.writeln('Available commands:');
            term.writeln('  ls - List files');
            term.writeln('  pwd - Print working directory');
            term.writeln('  reboot - Reboot device');
            term.writeln('  exit - Close terminal');
          } else if (currentLine.trim() === 'exit') {
            onClose();
          } else {
            term.writeln(`\x1b[1;31mCommand not found: ${currentLine}\x1b[0m`);
          }
          currentLine = '';
          term.write('\r$ ');
        } else if (data === '\x7f' || data === '\b') {
          if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          currentLine += data;
          term.write(data);
        }
      });
      
      term.write('\r$ ');
      terminalInstanceRef.current = term;
      
      const handleResize = () => {
        fitAddon.fit();
      };
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
      };
    }
  }, [board, onClose]);
  
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
        <div ref={terminalRef} className="flex-1 p-4" />
      </div>
    </>
  );
};

// Test Commands Manager Modal

export default WebSSHTerminal;
