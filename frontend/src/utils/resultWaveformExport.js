import API_ENDPOINTS from './apiEndpoints.js';

export function resultWaveformExportUrl(resultId, format = 'h5') {
  return API_ENDPOINTS.RESULT_WAVEFORM_EXPORT(resultId, format);
}

export function resultWaveformPreviewUrl(resultId, maxSamples = 2000) {
  return API_ENDPOINTS.RESULT_WAVEFORM_PREVIEW(resultId, maxSamples);
}

export function filterH5WaveformResults(results) {
  return (Array.isArray(results) ? results : []).filter((result) => {
    if (!result?.waveform_available) return false;
    const filename = String(result.waveform_filename || '').trim().toLowerCase();
    return filename.endsWith('.h5') || filename.endsWith('.hdf5');
  });
}
