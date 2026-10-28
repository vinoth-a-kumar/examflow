import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const isDevReactPort = typeof window !== 'undefined' && window.location && window.location.port === '3000';
window.API_BASE = process.env.REACT_APP_API_BASE || (
  isDevReactPort
    ? `http://${window.location.hostname}:5000`
    : (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : `http://${window.location.hostname}:${window.location.port || '5001'}`)
);
window.getApiUrl = function(path) {
  if (!path) return window.API_BASE;
  return `${window.API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
};

const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  if (typeof input === 'string') {
    input = input.replace(/^http:\/\/(localhost|127\.0\.0\.1):(5000|5001|5002|5003)/, window.API_BASE);
  } else if (input && typeof input.url === 'string') {
    let newUrl = input.url.replace(/^http:\/\/(localhost|127\.0\.0\.1):(5000|5001|5002|5003)/, window.API_BASE);
    input = new Request(newUrl, input);
  }

  try {
    const savedUser = localStorage.getItem('examflow-user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      if (parsed && parsed.token) {
        init = init || {};
        const headers = new Headers(init.headers || {});
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${parsed.token}`);
        }
        init.headers = headers;
      }
    }
  } catch (e) {
    // Ignore storage parse errors
  }

  try {
    return await originalFetch(input, init);
  } catch (err) {
    const currentUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    let alternateUrl = null;
    if (currentUrl.includes(':5000')) {
      alternateUrl = currentUrl.replace(':5000', ':5001');
    } else if (currentUrl.includes(':5001')) {
      alternateUrl = currentUrl.replace(':5001', ':5003');
    } else if (currentUrl.includes(':5003')) {
      alternateUrl = currentUrl.replace(':5003', ':5001');
    }

    if (alternateUrl) {
      try {
        const retryInput = (typeof input === 'string')
          ? alternateUrl
          : new Request(alternateUrl, input);
        const retryRes = await originalFetch(retryInput, init);
        if (window.API_BASE.includes(':5000')) {
          window.API_BASE = window.API_BASE.replace(':5000', ':5001');
        } else if (window.API_BASE.includes(':5001')) {
          window.API_BASE = window.API_BASE.replace(':5001', ':5003');
        } else if (window.API_BASE.includes(':5003')) {
          window.API_BASE = window.API_BASE.replace(':5003', ':5001');
        }
        return retryRes;
      } catch (retryErr) {
        throw err;
      }
    }
    throw err;
  }
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
