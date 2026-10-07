import React, { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../utils/apiEndpoints';

export default function BroadwayWaveformModal({
  isOpen,
  onClose,
  resultId,
  mode = 'actual_only', // 'actual_only' | 'dual_golden'
  goldenAvailable = false,
}) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [iframeKey, setIframeKey] = useState(1);

  useEffect(() => {
    if (!isOpen || !resultId) {
      setSession(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const initSession = async () => {
      try {
        const res = await fetch(API_ENDPOINTS.WAVEFORM_SESSIONS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            result_id: resultId,
            mode: mode,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Failed to create session (${res.status})`);
        }

        const data = await res.json();
        if (active) {
          setSession(data);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'Error launching Broadway GTKWave');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    initSession();

    return () => {
      active = false;
    };
  }, [isOpen, resultId, mode]);

  const handleClose = async () => {
    if (session?.session_id) {
      try {
        await fetch(API_ENDPOINTS.WAVEFORM_SESSION_DELETE(session.session_id), {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('Failed to delete session on close:', e);
      }
    }
    setSession(null);
    onClose();
  };

  const handleReload = () => {
    setIframeKey((prev) => prev + 1);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          backgroundColor: '#1f2937',
          color: '#f9fafb',
          borderBottom: '1px solid #374151',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
            📈 GTKWave Web (Broadway)
          </span>
          <span
            style={{
              fontSize: '0.85rem',
              backgroundColor: '#374151',
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            Result: {resultId}
          </span>
          <span
            style={{
              fontSize: '0.85rem',
              backgroundColor: mode === 'dual_golden' ? '#065f46' : '#1e40af',
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            {mode === 'dual_golden' ? 'Dual: Actual + Golden' : 'Actual Only'}
          </span>
          <span
            style={{
              fontSize: '0.8rem',
              color: loading ? '#fbbf24' : error ? '#ef4444' : '#10b981',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ● {loading ? 'Spawning Session...' : error ? 'Error' : 'Connected'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleReload}
            style={{
              padding: '6px 12px',
              backgroundColor: '#4b5563',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            🔄 Reload
          </button>
          <button
            onClick={handleClose}
            style={{
              padding: '6px 14px',
              backgroundColor: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            ✖ Close
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#111827' }}>
        {loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#9ca3af',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '1.2rem' }}>Spawning GTKWave Broadway Session...</div>
            <div style={{ fontSize: '0.9rem' }}>
              Allocating display port & generating layout template (.gtkw)
            </div>
          </div>
        )}

        {error && !loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#f87171',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Failed to start session</div>
            <div style={{ fontSize: '0.95rem' }}>{error}</div>
            <button
              onClick={handleClose}
              style={{
                marginTop: '12px',
                padding: '6px 16px',
                backgroundColor: '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Back to Dashboard
            </button>
          </div>
        )}

        {session && !loading && !error && (
          <iframe
            key={iframeKey}
            src={session.embed_url}
            title={`GTKWave-${resultId}`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
