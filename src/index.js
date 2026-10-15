import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

window.API_BASE = process.env.REACT_APP_API_BASE || `http://${window.location.hostname}:5000`;
window.getApiUrl = function(path) {
  if (!path) return window.API_BASE;
  return `${window.API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
};

const originalFetch = window.fetch;
window.fetch = function (input, init) {
  if (typeof input === 'string' && input.startsWith('http://localhost:5000')) {
    input = input.replace('http://localhost:5000', window.API_BASE);
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

  return originalFetch(input, init);
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
