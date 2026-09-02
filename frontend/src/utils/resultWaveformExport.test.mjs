import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterH5WaveformResults,
  resultWaveformExportUrl,
  resultWaveformPreviewUrl,
} from './resultWaveformExport.js';

test('builds result waveform CSV export URL', () => {
  assert.equal(
    resultWaveformExportUrl('result-1', 'csv'),
    'http://localhost:8000/api/results/result-1/export?format=csv'
  );
});

test('builds result waveform preview URL with max samples', () => {
  assert.equal(
    resultWaveformPreviewUrl('result-1', 500),
    'http://localhost:8000/api/results/result-1/preview?max_samples=500'
  );
});

test('filters dropdown options to H5 waveform results only', () => {
  const rows = [
    { id: 'a', waveform_available: true, waveform_filename: 'a.h5' },
    { id: 'b', waveform_available: true, waveform_filename: 'b.csv' },
    { id: 'c', waveform_available: false, waveform_filename: 'c.h5' },
    { id: 'd', waveform_available: true },
  ];

  assert.deepEqual(filterH5WaveformResults(rows).map((r) => r.id), ['a']);
});
