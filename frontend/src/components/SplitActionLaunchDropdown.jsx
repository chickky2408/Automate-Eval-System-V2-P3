import React, { useState, useRef, useEffect } from 'react';

export default function SplitActionLaunchDropdown({
  resultId,
  goldenAvailable = false,
  onLaunch, // (mode: 'actual_only' | 'dual_golden') => void
  size = 'medium', // 'small' | 'medium'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handlePrimaryClick = () => {
    // Default to dual if golden is available, otherwise actual only
    onLaunch(goldenAvailable ? 'dual_golden' : 'actual_only');
  };

  const handleSelectMode = (mode) => {
    setIsOpen(false);
    onLaunch(mode);
  };

  const isSmall = size === 'small';

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
      }}
    >
      {/* Primary Action Button */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        title="Inspect in GTKWave Web"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: isSmall ? '4px 8px' : '6px 12px',
          backgroundColor: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderTopLeftRadius: '4px',
          borderBottomLeftRadius: '4px',
          fontSize: isSmall ? '0.75rem' : '0.85rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <span>📈 GTKWave</span>
      </button>

      {/* Split Arrow Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="More Launch Options"
        style={{
          padding: isSmall ? '4px 6px' : '6px 8px',
          backgroundColor: '#1d4ed8',
          color: '#ffffff',
          border: 'none',
          borderLeft: '1px solid #1e40af',
          borderTopRightRadius: '4px',
          borderBottomRightRadius: '4px',
          fontSize: isSmall ? '0.75rem' : '0.85rem',
          cursor: 'pointer',
        }}
      >
        ▼
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
            borderRadius: '6px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            minWidth: '180px',
            overflow: 'hidden',
          }}
        >
          <div
            onClick={() => handleSelectMode('actual_only')}
            style={{
              padding: '8px 12px',
              fontSize: '0.85rem',
              color: '#f3f4f6',
              cursor: 'pointer',
              borderBottom: '1px solid #374151',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#374151')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            📊 Inspect Actual Only
          </div>

          <div
            onClick={() => {
              if (goldenAvailable) handleSelectMode('dual_golden');
            }}
            style={{
              padding: '8px 12px',
              fontSize: '0.85rem',
              color: goldenAvailable ? '#f3f4f6' : '#6b7280',
              cursor: goldenAvailable ? 'pointer' : 'not-allowed',
              opacity: goldenAvailable ? 1 : 0.6,
            }}
            onMouseEnter={(e) => {
              if (goldenAvailable) e.currentTarget.style.backgroundColor = '#374151';
            }}
            onMouseLeave={(e) => {
              if (goldenAvailable) e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={!goldenAvailable ? 'No Expected Golden VCD attached to this run' : ''}
          >
            ⚖️ Inspect Actual + Golden {!goldenAvailable && '(Unavailable)'}
          </div>
        </div>
      )}
    </div>
  );
}
