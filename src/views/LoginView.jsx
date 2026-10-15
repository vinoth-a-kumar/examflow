import React, { useState, useEffect } from 'react';
import { Mail, Lock, LogIn, AlertCircle, User, ShieldCheck } from 'lucide-react';

function LoginView({ onLoginSuccess, collegeDetails }) {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);

  const rawName = collegeDetails?.name || "Rajapalayam Rajus' College";
  const collegeName = (rawName.includes('Rajapalym') || rawName.includes('Rajapalaym') || rawName === 'ExamFlow')
    ? "Rajapalayam Rajus' College"
    : rawName;
  const collegeLogo = collegeDetails?.logo || '';

  // Check on mount if any administrator exists, or if initial setup is required
  useEffect(() => {
    let isMounted = true;
    fetch('http://localhost:5000/api/auth/setup-status')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data && data.setupRequired) {
          setIsFirstTimeSetup(true);
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isFirstTimeSetup) {
      // First-time administrator creation
      if (!username.trim() || !email.trim() || !password) {
        setError('Please fill in all administrator setup fields.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match. Please verify your password.');
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch('http://localhost:5000/api/auth/first-time-setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            email: email.trim(),
            password,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to initialize administrator account.');
        onLoginSuccess(data.user);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Standard Sign In
      if (!emailOrUsername.trim() || !password) {
        setError('Please fill in all fields.');
        return;
      }
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
            {isFirstTimeSetup
              ? 'Welcome to ExamFlow! Create your administrator account to get started.'
              : 'Sign in to manage your exam schedules & seating arrangements'}
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
          {isFirstTimeSetup ? (
            <>
              <div className="auth-input-wrapper">
                <label className="auth-label">Administrator Username</label>
                <div className="auth-input-field">
                  <User size={16} />
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="e.g. admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="auth-input-wrapper">
                <label className="auth-label">Official Email Address</label>
                <div className="auth-input-field">
                  <Mail size={16} />
                  <input
                    type="email"
                    className="auth-input"
                    placeholder="admin@college.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="auth-input-wrapper">
                <label className="auth-label">New Password</label>
                <div className="auth-input-field">
                  <Lock size={16} />
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <div className="auth-input-wrapper">
                <label className="auth-label">Confirm Password</label>
                <div className="auth-input-field">
                  <Lock size={16} />
                  <input
                    type="password"
                    className="auth-input"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="new-password"
                    required
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
                    <ShieldCheck size={18} />
                    <span>Create Administrator &amp; Sign In</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
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
                    required
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
                    required
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
            </>
          )}
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
          Powered by ExamFlow · Examination Seating Management
        </p>
      </div>
    </div>
  );
}

export default LoginView;
