import React, { useState, useEffect } from 'react';
import { Mail, Lock, AlertCircle, User, ShieldCheck, Eye, EyeOff, ArrowRight } from 'lucide-react';

const EXAM_ILLUSTRATION = "data:image/webp;base64,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";

function LoginView({ onLoginSuccess, collegeDetails }) {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      {/* Abstract Curved Shapes around the outer edges */}
      <div className="auth-shape-tl-outer" />
      <div className="auth-shape-tl-inner" />
      <div className="auth-shape-tr" />
      <div className="auth-shape-br-outer" />
      <div className="auth-shape-br-inner" />
      <div className="auth-shape-bl" />

      {/* Decorative Dot Grids (Pure CSS Radial Gradients) */}
      <div className="auth-dot-pattern auth-dot-pattern-tr" />
      <div className="auth-dot-pattern auth-dot-pattern-bl" />

      <div className="auth-split-card">
        {/* Left Panel: Soft Lavender/Purple Gradient with ExamFlow & College Branding */}
        <div className="auth-split-left">
          {/* Top-Right Decorative Dots in Left Panel */}
          <div className="auth-dot-pattern" style={{ position: 'absolute', top: 28, right: 28, zIndex: 1, width: 80, height: 48 }} />

          <div>
            {/* College Branding */}
            <div className="auth-split-college">
              {collegeLogo ? (
                <img
                  src={collegeLogo.startsWith('data:') ? collegeLogo : process.env.PUBLIC_URL + collegeLogo}
                  alt="College Logo"
                  className="auth-split-college-logo"
                />
              ) : (
                <div className="auth-split-college-initial">
                  {collegeName.charAt(0)}
                </div>
              )}
              <div className="auth-split-college-meta">
                <span className="auth-split-college-name">{collegeName}</span>
                <span className="auth-split-college-sub">Rajapalayam, Tamil Nadu</span>
              </div>
            </div>

            {/* Accent Divider Bar */}
            <div className="auth-split-accent-bar" />

            {/* ExamFlow Branding */}
            <div className="auth-split-hero">
              <h1 className="auth-split-title">
                <span className="auth-split-title-dark">Exam</span>
                <span className="auth-split-title-purple">Flow</span>
              </h1>
              <h2 className="auth-split-subtitle">Examination Management System</h2>
              <p className="auth-split-desc">Plan. Organize. Manage.</p>
            </div>
          </div>

          {/* Bottom Illustration matching reference image */}
          <img
            src={EXAM_ILLUSTRATION}
            alt="Examination Planning Illustration"
            className="auth-split-illustration"
          />
        </div>

        {/* Right Panel: Clean White with Login Form */}
        <div className="auth-split-right">
          <div>
            <div className="auth-split-right-header">
              <h2 className="auth-split-heading">
                {isFirstTimeSetup ? 'Administrator Setup' : 'Welcome Back'}
              </h2>
              <p className="auth-split-subheading">
                {isFirstTimeSetup
                  ? 'Create your administrator account to get started'
                  : 'Sign in to access your examination dashboard'}
              </p>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="auth-light-error-banner">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form className="auth-form" onSubmit={handleSubmit}>
              {isFirstTimeSetup ? (
                <>
                  <div className="auth-input-wrapper">
                    <label className="auth-light-label">Administrator Username</label>
                    <div className="auth-light-input-field">
                      <User size={16} className="input-icon-left" />
                      <input
                        type="text"
                        className="auth-light-input no-right-icon"
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
                    <label className="auth-light-label">Official Email Address</label>
                    <div className="auth-light-input-field">
                      <Mail size={16} className="input-icon-left" />
                      <input
                        type="email"
                        className="auth-light-input no-right-icon"
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
                    <label className="auth-light-label">New Password</label>
                    <div className="auth-light-input-field">
                      <Lock size={16} className="input-icon-left" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="auth-light-input"
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-light-eye-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="auth-input-wrapper">
                    <label className="auth-light-label">Confirm Password</label>
                    <div className="auth-light-input-field">
                      <Lock size={16} className="input-icon-left" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        className="auth-light-input"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={isLoading}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-light-eye-toggle"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        tabIndex={-1}
                        aria-label="Toggle confirm password visibility"
                      >
                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" className="auth-light-submit-btn" disabled={isLoading}>
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
                    <label className="auth-light-label">Username or Email</label>
                    <div className="auth-light-input-field">
                      <User size={16} className="input-icon-left" />
                      <input
                        type="text"
                        className="auth-light-input no-right-icon"
                        placeholder="Enter your username or email"
                        value={emailOrUsername}
                        onChange={(e) => setEmailOrUsername(e.target.value)}
                        disabled={isLoading}
                        autoComplete="username"
                        required
                      />
                    </div>
                  </div>

                  <div className="auth-input-wrapper">
                    <label className="auth-light-label">Password</label>
                    <div className="auth-light-input-field">
                      <Lock size={16} className="input-icon-left" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="auth-light-input"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-light-eye-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        aria-label="Toggle password visibility"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button type="submit" className="auth-light-submit-btn" disabled={isLoading}>
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
                        <ArrowRight size={18} />
                        <span>Sign In</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </form>
          </div>

          {/* Developer Credit Footer matching reference image */}
          <div className="auth-light-credit">
            <span className="auth-light-credit-line" />
            <span className="auth-light-credit-text">Developed by Vinothkumar</span>
            <span className="auth-light-credit-line" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginView;
