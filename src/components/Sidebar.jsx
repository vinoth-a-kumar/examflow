import React from 'react';
import {
  LayoutDashboard,
  Upload,
  Building2,
  CalendarDays,
  Grid3X3,
  Settings,
  LogOut,
  X
} from 'lucide-react';

function Sidebar({ currentTab, setCurrentTab, user, collegeDetails, onLogout, isOpen, onClose }) {
  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', name: 'Upload Students Data', icon: Upload },
    { id: 'halls', name: 'Hall Upload', icon: Building2 },
    { id: 'exams', name: 'Exam Schedule', icon: CalendarDays },
    { id: 'seating', name: 'Seating Arrange', icon: Grid3X3 },
    { id: 'settings', name: 'Settings', icon: Settings },
  ];

  const collegeName = collegeDetails?.name || 'ExamFlow';
  const collegeLogo = collegeDetails?.logo || '';

  const handleNavClick = (tabId) => {
    setCurrentTab(tabId);
    if (onClose) onClose();
  };

  return (
    <>
      {/* Mobile Drawer Overlay Backdrop */}
      <div
        className={`sidebar-backdrop ${isOpen ? 'show' : ''}`}
        onClick={onClose}
      />

      <aside className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
        {/* ── Logo / Brand ─────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="sidebar-logo">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, overflow: 'hidden' }}>
              {collegeLogo ? (
                <img
                  src={collegeLogo.startsWith('data:') ? collegeLogo : process.env.PUBLIC_URL + collegeLogo}
                  alt="Logo"
                  className="sidebar-logo-img"
                />
              ) : (
                <div className="sidebar-logo-initials">
                  {collegeName.charAt(0)}
                </div>
              )}
              <div className="sidebar-logo-text">
                <h1 title={collegeName}>{collegeName}</h1>
                <span>{user ? `@${user.username}` : 'Admin Panel'}</span>
              </div>
            </div>

            {/* Mobile Close X Button */}
            <button
              className="sidebar-mobile-close-btn"
              onClick={onClose}
              title="Close Menu"
            >
              <X size={20} />
            </button>
          </div>

          {/* ── Navigation ───────────────────────── */}
          <nav className="sidebar-menu">
            <span className="sidebar-section-label">Main Menu</span>
            {menuItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`sidebar-item ${currentTab === item.id ? 'active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <Icon size={18} className="sidebar-icon" />
                  <span>{item.name}</span>
                </button>
              );
            })}

            <span className="sidebar-section-label" style={{ marginTop: '8px' }}>System</span>
            {menuItems.slice(5).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`sidebar-item ${currentTab === item.id ? 'active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <Icon size={18} className="sidebar-icon" />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Footer ───────────────────────────── */}
        <div className="sidebar-footer">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.07)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 800,
                color: 'white',
                flexShrink: 0,
              }}>
                {user ? user.username.charAt(0).toUpperCase() : 'A'}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {user ? user.username : 'Admin'}
                </div>
                <div style={{ fontSize: '10.5px', color: 'rgba(148,163,184,0.65)', fontWeight: 500 }}>
                  Administrator
                </div>
              </div>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Log Out"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  padding: '6px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  marginLeft: '6px'
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
