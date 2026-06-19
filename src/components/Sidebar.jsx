import React from 'react';
import { 
  LayoutDashboard, 
  Upload, 
  Building2, 
  CalendarDays, 
  Grid3X3, 
  Settings, 
  User, 
  LogOut 
} from 'lucide-react';

function Sidebar({ currentTab, setCurrentTab }) {
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
          <span>Admin Control Center</span>
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

      <div className="sidebar-footer">
        <button
          className={`sidebar-item ${currentTab === 'profile' ? 'active' : ''}`}
          style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
          onClick={() => setCurrentTab('profile')}
        >
          <User size={20} />
          <span>Profile</span>
        </button>
        <button
          className="sidebar-item"
          style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
          onClick={() => {
            if(window.confirm("Are you sure you want to logout?")) {
              alert("Logged out successfully.");
            }
          }}
        >
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
