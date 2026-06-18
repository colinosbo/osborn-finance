import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('App crashed:', error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: '80px auto', padding: 32, fontFamily: 'system-ui, sans-serif', color: '#ece8f6' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
          <p style={{ color: '#a89fc4' }}>The app hit a runtime error while rendering. Details below:</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#1a1427', border: '1px solid #322a4a', padding: 16, borderRadius: 8, fontSize: 12.5 }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 12, padding: '10px 22px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// After Auth0 redirects back, restore the user to the page they were trying to visit.
const onRedirectCallback = (appState?: { returnTo?: string }) => {
  window.history.replaceState({}, document.title, appState?.returnTo || window.location.pathname);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Auth0Provider
        domain="dev-kfu16sn74pidwzdm.us.auth0.com"
        clientId="YsCcEqKFeV8F4Zqrj8ZgSlQqrRPdF21m"
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: 'https://api.covisor.app',
          scope: 'openid profile email'
        }}
        onRedirectCallback={onRedirectCallback}
      >
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </Auth0Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
