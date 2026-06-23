import React from 'react';
import { Search, Bell, HelpCircle } from 'lucide-react';

function Header({ searchQuery, setSearchQuery, academicYear = "2024-25", user }) {
  const getInitials = () => {
    if (!user || !user.username) return 'AD';
    return user.username.substring(0, 2).toUpperCase();
  };

  return (
    <header className="header">
      <div className="header-search">
        <Search size={18} />
        <input 
          type="text" 
          placeholder="Search exams, halls, students..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="header-actions">
        <span className="header-year">Academic Year {academicYear}</span>
        
        <button className="header-btn" title="Notifications">
          <Bell size={20} />
        </button>
        
        <button className="header-btn" title="Help Support">
          <HelpCircle size={20} />
        </button>
        
        <div className="header-profile-pic" title={`${user?.username || 'Administrator'} Profile`}>
          {getInitials()}
        </div>
      </div>
    </header>
  );
}

export default Header;
