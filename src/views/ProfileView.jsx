import React, { useState, useEffect } from 'react';
import { Shield, Key, Building2, CheckCircle2, Camera, User, MapPin } from 'lucide-react';

function ProfileView({ user, collegeDetails, onSaveCollegeDetails, onSaveUser }) {
  const [collegeName, setCollegeName]           = useState(collegeDetails?.name    || '');
  const [logo, setLogo]                         = useState(collegeDetails?.logo    || '');
  const [address, setAddress]                   = useState(collegeDetails?.address || '');
  const [collegeSaveSuccess, setCollegeSaveSuccess] = useState(false);

  const [fullName, setFullName]     = useState(user?.username || 'Admin Controller');
  const [email, setEmail]           = useState(user?.email    || 'admin@examflowai.com');
  const [userSaveSuccess, setUserSaveSuccess] = useState(false);

  useEffect(() => {
    if (collegeDetails) {
      setCollegeName(collegeDetails.name    || '');
      setLogo(collegeDetails.logo           || '');
      setAddress(collegeDetails.address     || '');
    }
  }, [collegeDetails]);

  useEffect(() => {
    if (user) {
      setFullName(user.username || '');
      setEmail(user.email       || '');
    }
  }, [user]);

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Logo file is too large! Please upload an image under 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setLogo(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSaveCollege = () => {
    onSaveCollegeDetails({ ...collegeDetails, name: collegeName, logo, address });
    setCollegeSaveSuccess(true);
    setTimeout(() => setCollegeSaveSuccess(false), 3000);
  };

  const handleSaveUser = () => {
    onSaveUser({ ...user, username: fullName, email });
    setUserSaveSuccess(true);
    setTimeout(() => setUserSaveSuccess(false), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div className="page-intro">
        <h2>Institution &amp; Profile</h2>
        <p>Manage your college identity, logo, and administrator credentials.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* ── Institution Profile Card ─────────── */}
        <div className="card-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Card Header */}
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(139,92,246,0.08))',
                  border: '1px solid rgba(79,70,229,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-primary)',
                }}>
                  <Building2 size={18} />
                </div>
                <h3>Institution Profile</h3>
              </div>
            </div>

            {/* Logo + Name preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 0 24px', textAlign: 'center', gap: '12px' }}>
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: '110px', height: '110px', borderRadius: '50%',
                  background: logo ? 'transparent' : 'linear-gradient(135deg, var(--color-primary-light), rgba(139,92,246,0.08))',
                  border: '3px solid var(--border-color)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                  boxShadow: '0 0 0 6px rgba(79,70,229,0.06), var(--shadow-md)',
                }}>
                  {logo ? (
                    <img
                      src={logo.startsWith('data:') ? logo : process.env.PUBLIC_URL + logo}
                      alt="College Logo"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <Building2 size={40} style={{ color: 'var(--color-primary)', opacity: 0.5 }} />
                  )}
                </div>
                {/* Camera badge */}
                <label
                  title="Change Logo"
                  style={{
                    position: 'absolute', bottom: '-4px', right: '-4px',
                    width: '34px', height: '34px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', boxShadow: '0 4px 12px rgba(79,70,229,0.35)',
                    border: '2px solid var(--bg-card)', transition: 'transform 0.2s',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <Camera size={14} />
                  <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
                </label>
              </div>

              <div>
                <h3 style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px',
                  margin: '0 0 4px', color: 'var(--text-primary)', letterSpacing: '-0.3px',
                }}>
                  {collegeName || 'Institution Name'}
                </h3>
                {address && (
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                    <MapPin size={12} />
                    {address}
                  </p>
                )}
              </div>
            </div>

            {/* Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label>Institution Name</label>
                <input
                  type="text"
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="Enter college/university name..."
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="City, State..."
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '20px',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-success)', opacity: collegeSaveSuccess ? 1 : 0, transition: 'opacity 0.3s', fontWeight: 600 }}>
              <CheckCircle2 size={16} />
              Saved!
            </span>
            <button className="btn-primary" onClick={handleSaveCollege}>
              Save Details
            </button>
          </div>
        </div>

        {/* ── Administrator Account Card ─────────── */}
        <div className="card-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Card Header */}
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(5,150,105,0.1), rgba(16,185,129,0.06))',
                  border: '1px solid rgba(5,150,105,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-success)',
                }}>
                  <Shield size={18} />
                </div>
                <h3>Account Credentials</h3>
              </div>
            </div>

            {/* Avatar + Role */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 0 24px', textAlign: 'center', gap: '12px' }}>
              <div style={{
                width: '110px', height: '110px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '40px', fontWeight: 900, fontFamily: 'var(--font-display)',
                boxShadow: '0 0 0 6px rgba(79,70,229,0.1), 0 8px 24px rgba(79,70,229,0.3)',
                border: '3px solid var(--bg-card)',
              }}>
                {fullName.slice(0, 2).toUpperCase()}
              </div>

              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
                  {fullName}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <span className="status-pill success" style={{ fontSize: '11px' }}>
                    <User size={10} />
                    System Superuser
                  </span>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label>Full Name / Username</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Administrator name..."
                />
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@college.edu"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '20px',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--color-success)', opacity: userSaveSuccess ? 1 : 0, transition: 'opacity 0.3s', fontWeight: 600 }}>
              <CheckCircle2 size={16} />
              Saved!
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn-secondary"
                onClick={() => alert('Security credential updates are disabled in demo mode.')}
              >
                <Key size={14} />
                Change Password
              </button>
              <button className="btn-primary" onClick={handleSaveUser}>
                Save Account
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default ProfileView;
