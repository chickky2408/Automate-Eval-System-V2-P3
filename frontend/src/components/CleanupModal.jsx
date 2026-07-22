import React, { useCallback, useEffect, useState } from 'react';
import {
  getDeletionCandidates,
  scanDiskOrphans,
  scanMissingFiles,
  stageUnreferenced,
  approveDeletionCandidate,
} from '../services/api';

const REASON_LABEL = {
  orphan_disk_file: 'A · disk orphan',
  missing_disk_file: 'B · missing file',
  unreferenced_file: 'C · unreferenced',
};

export default function CleanupModal({ open, onClose }) {
  const [passcode, setPasscode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState({}); // id -> true
  const [confirming, setConfirming] = useState(false);

  const reset = useCallback(() => {
    setPasscode('');
    setUnlocked(false);
    setError('');
    setBusy(false);
    setCandidates([]);
    setSelected({});
    setConfirming(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const refresh = useCallback(async (pass) => {
    const list = await getDeletionCandidates(pass);
    setCandidates(Array.isArray(list) ? list : []);
  }, []);

  const handleUnlock = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      await refresh(passcode);
      setUnlocked(true);
    } catch (e) {
      if (e.status === 403) setError('Cleanup ถูกปิด (ยังไม่ตั้ง CLEANUP_PASSCODE)');
      else if (e.status === 401) setError('passcode ไม่ถูกต้อง');
      else setError(e.message || 'error');
    } finally {
      setBusy(false);
    }
  }, [passcode, refresh]);

  const runScan = useCallback(async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn(passcode);
      await refresh(passcode);
    } catch (e) {
      setError(e.message || 'scan failed');
    } finally {
      setBusy(false);
    }
  }, [passcode, refresh]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const doDelete = useCallback(async () => {
    setBusy(true);
    setError('');
    const failures = [];
    for (const id of selectedIds) {
      try {
        await approveDeletionCandidate(id, passcode);
      } catch (e) {
        failures.push(`${id}: ${e.message}`);
      }
    }
    setConfirming(false);
    setSelected({});
    try { await refresh(passcode); } catch (e) { /* ignore */ }
    if (failures.length) setError(`บางไฟล์ลบไม่ได้:\n${failures.join('\n')}`);
    setBusy(false);
  }, [selectedIds, passcode, refresh]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative bg-white dark:bg-gray-900 w-full h-full sm:h-[90vh] sm:max-w-4xl sm:rounded-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">🧹 File Cleanup</h2>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        {!unlocked ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm text-gray-600 dark:text-gray-300">ใส่ passcode เพื่อเข้าจัดการไฟล์กำพร้า</p>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              className="border rounded px-3 py-2 w-64 dark:bg-gray-800"
              placeholder="passcode"
              autoFocus
            />
            {error && <p className="text-red-500 text-sm whitespace-pre-line">{error}</p>}
            <button
              onClick={handleUnlock}
              disabled={busy || !passcode}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            >
              {busy ? '...' : 'ปลดล็อก'}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <button onClick={() => runScan(scanDiskOrphans)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Scan A (disk orphan)</button>
              <button onClick={() => runScan(scanMissingFiles)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Scan B (missing)</button>
              <button onClick={() => runScan(stageUnreferenced)} disabled={busy} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">Stage C (unreferenced)</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={busy || selectedIds.length === 0}
                className="ml-auto px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50"
              >
                Delete selected ({selectedIds.length})
              </button>
            </div>

            {error && <p className="px-5 py-2 text-red-500 text-sm whitespace-pre-line">{error}</p>}

            <div className="flex-1 overflow-auto px-5 py-2">
              {candidates.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">ไม่มี candidate — กด Scan/Stage ด้านบน</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 w-8"></th>
                      <th className="py-2">filename</th>
                      <th className="py-2">reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2">
                          <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
                        </td>
                        <td className="py-2">{c.filename}</td>
                        <td className="py-2 text-gray-500">{REASON_LABEL[c.reason] || c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {confirming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-900 rounded-lg p-5 w-80">
              <p className="text-sm mb-4">ลบ {selectedIds.length} ไฟล์? ทำแล้วย้อนไม่ได้</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">ยกเลิก</button>
                <button onClick={doDelete} disabled={busy} className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50">ลบ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
