import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null, info: null }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info)
    this.setState({ info })
  }
  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || String(this.state.error || 'Unknown error')
      const stack = this.state.error?.stack || ''
      const componentStack = this.state.info?.componentStack || ''
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 720 }}>
          <h1 style={{ color: '#b91c1c', marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#64748b', marginBottom: 16 }}>
            The page could not load. Try refreshing or going back to the dashboard.
          </p>
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', marginRight: 8 }}
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => { window.location.hash = ''; window.location.reload() }}
              style={{ padding: '8px 16px', background: '#475569', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              Reset and reload
            </button>
          </div>
          <details open style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#991b1b' }}>Error details</summary>
            <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: '#7f1d1d' }}>
{message}
{stack ? `\n\nStack:\n${stack}` : ''}
{componentStack ? `\n\nComponent stack:${componentStack}` : ''}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
)
