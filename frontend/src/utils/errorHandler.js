/**
 * Error Handler Utilities
 * 
 * Centralized error handling for API calls and application errors
 */

/**
 * Handle API errors and return user-friendly messages
 */
export const handleApiError = (error) => {
  console.error('API Error:', error);
  
  // Network errors
  if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
    return {
      message: 'Network error. Please check your connection.',
      type: 'network',
      retryable: true
    };
  }
  
  // HTTP errors
  if (error.message.includes('HTTP error')) {
    const statusMatch = error.message.match(/status: (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 500;
    
    switch (status) {
      case 400:
        return { message: 'Invalid request. Please check your input.', type: 'validation', retryable: false };
      case 401:
        return { message: 'Authentication required. Please login.', type: 'auth', retryable: false };
      case 403:
        return { message: 'You do not have permission to perform this action.', type: 'permission', retryable: false };
      case 404:
        return { message: 'Resource not found.', type: 'notFound', retryable: false };
      case 409:
        return { message: 'Conflict. This resource already exists.', type: 'conflict', retryable: false };
      case 500:
        return { message: 'Server error. Please try again later.', type: 'server', retryable: true };
      case 503:
        return { message: 'Service unavailable. Please try again later.', type: 'service', retryable: true };
      default:
        return { message: `Error ${status}: ${error.message}`, type: 'unknown', retryable: status >= 500 };
    }
  }
  
  // Default error
  return {
    message: error.message || 'An unexpected error occurred.',
    type: 'unknown',
    retryable: false
  };
};

/**
 * Show error notification to user
 */
export const showError = (error, context = '') => {
  const errorInfo = handleApiError(error);
  const message = context ? `${context}: ${errorInfo.message}` : errorInfo.message;
  
  // You can integrate with your notification system here
  // For now, we'll use console and could add toast notifications
  console.error('Error:', message);
  
  // Example: If you have a toast notification system
  // toast.error(message);
  
  return errorInfo;
};

/**
 * Retry function for failed API calls
 */
export const retryApiCall = async (apiCall, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      const errorInfo = handleApiError(error);
      
      if (!errorInfo.retryable || i === maxRetries - 1) {
        throw error;
      }
      
      console.log(`Retrying... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
};

export default {
  handleApiError,
  showError,
  retryApiCall,
};
