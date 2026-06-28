import React from 'react';
import { 
  LayoutDashboard, 
  Upload, 
  Building2, 
  CalendarDays, 
  Grid3X3, 
  Settings
} from 'lucide-react';

function Sidebar({ currentTab, setCurrentTab, user }) {
  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload', name: 'Upload Data', icon: Upload },
    { id: 'halls', name: 'Hall Management', icon: Building2 },
    { id: 'exams', name: 'Exam Management', icon: CalendarDays },
    { id: 'seating', name: 'Seating Plan', icon: Grid3X3 },
    { id: 'settings', name: 'Settings', icon: Settings },
  ];

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        <div className="sidebar-logo">
          <h1>ExamFlow AI</h1>
          <span style={{ textTransform: 'none', fontSize: '11px', color: 'var(--text-secondary)' }}>
            {user ? `@${user.username}` : 'Admin Control Center'}
          </span>
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
