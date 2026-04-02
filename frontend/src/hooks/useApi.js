/**
 * Custom Hook for API Calls with Loading and Error States
 * 
 * This hook provides a consistent way to handle API calls with loading states,
 * error handling, and automatic state management.
 * 
 * Usage:
 *   const { data, loading, error, execute } = useApi(apiFunction);
 *   execute(params);
 */

import { useState, useCallback } from 'react';
import { handleApiError } from '../utils/errorHandler';

export const useApi = (apiFunction) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await apiFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      const errorInfo = handleApiError(err);
      setError(errorInfo);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiFunction]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    data,
    loading,
    error,
    execute,
    reset,
  };
};

/**
 * Hook for multiple API calls
 */
export const useMultipleApi = (apiFunctions) => {
  const states = {};
  
  Object.keys(apiFunctions).forEach(key => {
    states[key] = useApi(apiFunctions[key]);
  });
  
  return states;
};

export default useApi;
