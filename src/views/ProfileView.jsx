import React from 'react';
import { Shield, Mail, Calendar, Key } from 'lucide-react';

function ProfileView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Administrator Profile</h2>
        <p>Manage your account credentials, security access, and notification settings.</p>
      </div>

      <div className="sections-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
        {/* Profile Card */}
        <div className="card-container" style={{ alignItems: 'center', textAlign: 'center' }}>
          <div style={{ 
            width: '96px', 
            height: '96px', 
            borderRadius: '50%', 
            backgroundColor: 'var(--color-primary)', 
            color: 'white', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontSize: '32px',
            fontWeight: 700,
            boxShadow: 'var(--shadow-md)',
            border: '4px solid white',
            outline: '1px solid var(--border-color)',
            marginBottom: '16px'
          }}>
            AD
          </div>
          
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '20px' }}>Admin Controller</h3>
          <span className="status-pill success" style={{ marginTop: '4px', fontSize: '11px' }}>System Administrator</span>
          
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <Shield size={16} />
              <span>Access Level: Superuser</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <Mail size={16} />
              <span>admin@examflow.com</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <Calendar size={16} />
              <span>Member Since: June 2026</span>
            </div>
          </div>
        </div>

        {/* Profile Security Panel */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Account Settings</h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" defaultValue="Admin Controller" disabled />
            </div>
            
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" defaultValue="admin@examflow.com" disabled />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
              <button className="btn-secondary" style={{ gap: '6px' }} onClick={() => alert("Security credentials updates are disabled in demo mode.")}>
                <Key size={14} />
                <span>Change Password</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfileView;
