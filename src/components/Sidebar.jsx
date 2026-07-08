import React from 'react';
import { 
  LayoutDashboard, 
  Upload, 
  Building2, 
  CalendarDays, 
  Grid3X3, 
  Settings
} from 'lucide-react';

function Sidebar({ currentTab, setCurrentTab, user, collegeDetails }) {
  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', name: 'Upload Data', icon: Upload },
    { id: 'halls', name: 'Hall Management', icon: Building2 },
    { id: 'exams', name: 'Exam Management', icon: CalendarDays },
    { id: 'seating', name: 'Seating Plan', icon: Grid3X3 },
    { id: 'settings', name: 'Settings', icon: Settings },
  ];

  const collegeName = collegeDetails?.name || 'ExamFlow';
  const collegeLogo = collegeDetails?.logo || '';

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {collegeLogo ? (
            <img src={collegeLogo} alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
          ) : (
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              backgroundColor: 'var(--color-primary-light)',
              color: 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '16px',
              flexShrink: 0
            }}>
              {collegeName.charAt(0)}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <h1 style={{ fontSize: '15px', margin: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', width: '130px' }} title={collegeName}>{collegeName}</h1>
            <span style={{ textTransform: 'none', fontSize: '10px', color: 'var(--text-secondary)' }}>
              {user ? `@${user.username}` : 'Admin Control Center'}
            </span>
          </div>
        </div>

        <nav className="sidebar-menu">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`sidebar-item ${currentTab === item.id ? 'active' : ''}`}
                style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
                onClick={() => setCurrentTab(item.id)}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export default Sidebar;
