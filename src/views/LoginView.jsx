import React, { useState } from 'react';
import { Mail, Lock, LogIn, AlertCircle, Sparkles } from 'lucide-react';

function LoginView({ onLoginSuccess, collegeDetails }) {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const collegeName = collegeDetails?.name || 'ExamFlow';
  const collegeLogo = collegeDetails?.logo || '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!emailOrUsername.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed. Please try again.');
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {/* Ambient background blobs */}
      <div className="auth-blob auth-blob-1" />
      <div className="auth-blob auth-blob-2" />
      <div className="auth-blob auth-blob-3" />

      <div className="auth-card">
        {/* Header */}
        <div className="auth-header">
          {collegeLogo ? (
            <img
              src={collegeLogo.startsWith('data:') ? collegeLogo : process.env.PUBLIC_URL + collegeLogo}
              alt="College Logo"
              className="auth-logo-img"
            />
          ) : (
            <div className="auth-logo-initials">
              {collegeName.charAt(0)}
            </div>
          )}
          <h1 className="auth-logo">{collegeName}</h1>
          <p className="auth-subtitle">
            Sign in to manage your exam schedules &amp; seating arrangements
          </p>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="auth-error-banner">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-input-wrapper">
            <label className="auth-label">Username or Email</label>
            <div className="auth-input-field">
              <Mail size={16} />
              <input
                type="text"
                className="auth-input"
                placeholder="admin or admin@college.edu"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
              />
            </div>
          </div>

          <div className="auth-input-wrapper">
            <label className="auth-label">Password</label>
            <div className="auth-input-field">
              <Lock size={16} />
              <input
                type="password"
                className="auth-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={isLoading}>
            {isLoading ? (
              <span style={{
                width: 18, height: 18,
                border: '2.5px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spinSlow 0.75s linear infinite',
                display: 'inline-block',
              }} />
            ) : (
              <>
                <LogIn size={18} />
                <span>Sign In</span>
              </>
            )}
          </button>
        </form>

        {/* Footer note */}
        <p style={{
          textAlign: 'center',
          fontSize: '11.5px',
          color: 'rgba(255,255,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '5px',
        }}>
          <Sparkles size={11} />
          Powered by ExamFlow · AI-assisted Seating Management
        </p>
      </div>
    </div>
  );
}

export default LoginView;
