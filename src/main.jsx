import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

// Error boundary for graceful crash recovery
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[Forum] Uncaught error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', gap: 16, color: '#9aa0a6', fontFamily: 'system-ui',
        }}>
          <div style={{ fontSize: 48, opacity: 0.3 }}>⚠</div>
          <h2 style={{ margin: 0, color: '#e8e4dd' }}>Something went wrong</h2>
          <p style={{ margin: 0, maxWidth: 400, textAlign: 'center', fontSize: 14 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); }}
            style={{
              marginTop: 8, padding: '8px 20px', borderRadius: 8,
              background: 'oklch(0.78 0.13 65)', color: '#29261b',
              border: 0, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
