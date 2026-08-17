import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import DashboardView from './views/DashboardView';
import UploadDataView from './views/UploadDataView';
import HallManagementView from './views/HallManagementView';
import ExamManagementView from './views/ExamManagementView';
import SeatingPlanView from './views/SeatingPlanView';
import SettingsView from './views/SettingsView';
import ProfileView from './views/ProfileView';
import LoginView from './views/LoginView';

function App() {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Auto-close mobile sidebar when window resizes to desktop width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleTabChange = (tab) => {
    setCurrentTab(tab);
    setIsMobileSidebarOpen(false);
  };
  
  // Auth & Theme States
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('examflow-user');
    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {
        console.error(e);
      }
    }
    return null;
  });

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('examflow-theme') || 'light';
  });

  // Sync theme class on body
  useEffect(() => {
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-sunset');
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('examflow-theme', newTheme);
  };

  const [collegeDetails, setCollegeDetails] = useState(() => {
    const saved = localStorage.getItem('examflow-college-details');
    
    // Auto-calculate current academic year based on current date
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0 = Jan, 5 = June
    const autoYear = currentMonth < 5 
      ? `${currentYear - 1}-${String(currentYear).slice(-2)}` 
      : `${currentYear}-${String(currentYear + 1).slice(-2)}`;

    const defaultDetails = {
      name: "Rajapalayam Rajus' College",
      logo: '/college-logo.png', 
      address: 'Rajapalayam, Tamil Nadu, 626117',
      academicYear: autoYear
    };

    if (!saved) {
      localStorage.setItem('examflow-college-details', JSON.stringify(defaultDetails));
      return defaultDetails;
    }

    try {
      const parsed = JSON.parse(saved);
      // Auto-migrate old default college details, empty logo, or misspelled college names
      const isMispelled = !parsed.name || 
        parsed.name.includes('Rajapalym') || 
        parsed.name.includes('Rajapalaym') || 
        parsed.name === 'ExamFlow Engineering College' || 
        parsed.name === 'ExamFlow AI';

      const needsLogoFix = !parsed.logo || parsed.logo === '' || parsed.logo.includes('logo.svg') || parsed.logo.includes('logo192') || parsed.logo.includes('favicon.ico') || (typeof parsed.logo === 'string' && parsed.logo.startsWith('data:'));
      
      if (isMispelled || needsLogoFix || parsed.address === '123 University Campus, Tech City, 600001') {
        const updated = {
          ...parsed,
          name: isMispelled ? "Rajapalayam Rajus' College" : parsed.name,
          logo: needsLogoFix ? '/college-logo.png' : parsed.logo,
          address: (parsed.address === '123 University Campus, Tech City, 600001' || !parsed.address) ? 'Rajapalayam, Tamil Nadu, 626117' : parsed.address
        };
        localStorage.setItem('examflow-college-details', JSON.stringify(updated));
        return updated;
      }
      return parsed;
    } catch (e) {
      return defaultDetails;
    }
  });

  const handleSaveCollegeDetails = (details) => {
    setCollegeDetails(details);
    localStorage.setItem('examflow-college-details', JSON.stringify(details));
  };

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('examflow-user', JSON.stringify(userData));
    setCurrentTab('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('examflow-user');
  };

  // Data States
  const [stats, setStats] = useState({});
  const [activities, setActivities] = useState([]);
  const [students, setStudents] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [halls, setHalls] = useState([]);
  const [exams, setExams] = useState([]);
  const [dbConnection, setDbConnection] = useState({ connected: false, mode: 'Checking...' });
  const [globalLoading, setGlobalLoading] = useState(true);

  // Fetch all system data from the Express backend APIs
  const fetchAllData = async () => {
    try {
      // 1. Fetch DB Status
      const statusResp = await fetch('http://localhost:5000/api/status');
      if (statusResp.ok) {
        const data = await statusResp.json();
        setDbConnection(data);
      }

      // 2. Fetch Dashboard Stats
      const statsResp = await fetch('http://localhost:5000/api/dashboard/stats');
      if (statsResp.ok) {
        const data = await statsResp.json();
        setStats(data);
      }

      // 3. Fetch Dashboard Activities
      const actResp = await fetch('http://localhost:5000/api/dashboard/activities');
      if (actResp.ok) {
        const data = await actResp.json();
        setActivities(data);
      }

      // 4. Fetch Students
      const studentsResp = await fetch('http://localhost:5000/api/students');
      if (studentsResp.ok) {
        const data = await studentsResp.json();
        setStudents(data);
      }

      // 5. Fetch Uploads History
      const uploadsResp = await fetch('http://localhost:5000/api/uploads');
      if (uploadsResp.ok) {
        const data = await uploadsResp.json();
        setUploads(data);
      }

      // 6. Fetch Halls
      const hallsResp = await fetch('http://localhost:5000/api/halls');
      if (hallsResp.ok) {
        const data = await hallsResp.json();
        setHalls(data);
      }

      // 7. Fetch Exams
      const examsResp = await fetch('http://localhost:5000/api/exams');
      if (examsResp.ok) {
        const data = await examsResp.json();
        setExams(data);
      }
    } catch (error) {
      console.error("Failed to connect to backend server. Is it running on port 5000?", error);
    } finally {
      setGlobalLoading(false);
    }
  };

  useEffect(() => {
    // Migrate old settings dynamically if found
    const saved = localStorage.getItem('examflow-college-details');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if ((parsed.name && parsed.name.includes('ExamFlow')) || !parsed.logo || parsed.logo === '' || parsed.logo.includes('logo.svg') || parsed.logo.includes('logo192') || parsed.logo.includes('favicon.ico') || (typeof parsed.logo === 'string' && parsed.logo.startsWith('data:'))) {
          const today = new Date();
          const currentYear = today.getFullYear();
          const currentMonth = today.getMonth();
          const autoYear = currentMonth < 5 
            ? `${currentYear - 1}-${String(currentYear).slice(-2)}` 
            : `${currentYear}-${String(currentYear + 1).slice(-2)}`;

          const updated = {
            name: "Rajapalayam Rajus' College",
            logo: '/college-logo.png',
            address: 'Rajapalayam, Tamil Nadu, 626117',
            academicYear: parsed.academicYear || autoYear
          };
          localStorage.setItem('examflow-college-details', JSON.stringify(updated));
          setCollegeDetails(updated);
        }
      } catch (e) {
        console.error("LocalStorage migration failed: ", e);
      }
    }

    fetchAllData();
    // Auto-refresh stats/activities periodically if logged in
    let timer = null;
    if (user) {
      timer = setInterval(fetchAllData, 15000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [user]);

  // CRUD Actions
  
  // Clear Students
  const handleClearStudents = async () => {
    if (window.confirm("Are you sure you want to clear all student records? This will also clear generated seating plans.")) {
      try {
        const resp = await fetch('http://localhost:5000/api/students/clear', { method: 'POST' });
        if (resp.ok) {
          alert("Student records cleared successfully.");
          fetchAllData();
        }
      } catch (err) {
        console.error(err);
        alert("Failed to clear student records.");
      }
    }
  };

  // Clear Halls
  const handleClearHalls = async () => {
    if (window.confirm("Are you sure you want to clear all hall records? This will also clear generated seating plans.")) {
      try {
        const resp = await fetch('http://localhost:5000/api/halls/clear', { method: 'POST' });
        if (resp.ok) {
          alert("Hall records cleared successfully.");
          fetchAllData();
        }
      } catch (err) {
        console.error(err);
        alert("Failed to clear hall records.");
      }
    }
  };

  // Delete Hall
  const handleDeleteHall = async (id) => {
    try {
      const resp = await fetch(`http://localhost:5000/api/halls/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete hall.");
    }
  };

  // Add Exam
  const handleAddExam = async (examData) => {
    try {
      const resp = await fetch('http://localhost:5000/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(examData)
      });
      if (resp.ok) {
        fetchAllData();
      } else {
        const err = await resp.json();
        alert("Failed to create exam: " + err.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error creating exam.");
    }
  };

  // Delete Exam
  const handleDeleteExam = async (id) => {
    try {
      const resp = await fetch(`http://localhost:5000/api/exams/${id}`, { method: 'DELETE' });
      if (resp.ok) {
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete exam.");
    }
  };

  // Update Exam
  const handleUpdateExam = async (id, examData) => {
    try {
      const resp = await fetch(`http://localhost:5000/api/exams/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(examData)
      });
      if (resp.ok) {
        fetchAllData();
      } else {
        const err = await resp.json();
        alert("Failed to update exam: " + err.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error updating exam.");
    }
  };

  // Clear system activities history
  const handleClearActivities = async () => {
    if (!window.confirm("Are you sure you want to clear the recent activities history?")) return;
    try {
      const response = await fetch('http://localhost:5000/api/dashboard/activities', {
        method: 'DELETE'
      });
      if (response.ok) {
        setActivities([]);
      } else {
        alert("Failed to clear activities history.");
      }
    } catch (error) {
      console.error(error);
      alert("Error occurred while clearing history.");
    }
  };

  // Clear upload history logs
  const handleClearUploadHistory = async () => {
    if (!window.confirm("Are you sure you want to clear the upload history log?")) return;
    try {
      const response = await fetch('http://localhost:5000/api/uploads', {
        method: 'DELETE'
      });
      if (response.ok) {
        setUploads([]);
      } else {
        alert("Failed to clear upload history.");
      }
    } catch (error) {
      console.error(error);
      alert("Error occurred while clearing upload history.");
    }
  };

  // Render active view tab
  const renderView = () => {
    switch (currentTab) {
      case 'dashboard':
        return <DashboardView stats={stats} activities={activities} setTab={setCurrentTab} onClearActivities={handleClearActivities} />;
      case 'upload':
        return (
          <UploadDataView 
            students={students} 
            uploads={uploads} 
            onClear={handleClearStudents}
            refreshData={fetchAllData}
            onClearUploadHistory={handleClearUploadHistory}
          />
        );
      case 'halls':
        return (
        <HallManagementView 
            halls={halls} 
            onDeleteHall={handleDeleteHall}
            refreshData={fetchAllData}
            onClear={handleClearHalls}
          />
        );
      case 'exams':
        return (
          <ExamManagementView 
            exams={exams} 
            halls={halls}
            students={students}
            onAddExam={handleAddExam}
            onDeleteExam={handleDeleteExam}
            onUpdateExam={handleUpdateExam}
            refreshData={fetchAllData}
          />
        );
      case 'seating':
        return <SeatingPlanView exams={exams} halls={halls} collegeDetails={collegeDetails} refreshData={fetchAllData} />;
      case 'settings':
        return (
          <SettingsView 
            dbStatus={dbConnection} 
            refreshData={fetchAllData}
            currentTheme={theme}
            onChangeTheme={handleThemeChange}
          />
        );
      case 'profile':
        return (
          <ProfileView 
            user={user} 
            collegeDetails={collegeDetails} 
            onSaveCollegeDetails={handleSaveCollegeDetails}
            onSaveUser={(updatedUser) => {
              setUser(updatedUser);
              localStorage.setItem('examflow-user', JSON.stringify(updatedUser));
            }}
          />
        );
      default:
        return <DashboardView stats={stats} activities={activities} setTab={handleTabChange} onClearActivities={handleClearActivities} />;
    }
  };

  if (globalLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
        fontFamily: 'var(--font-primary)'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          border: '4px solid rgba(79,70,229,0.2)',
          borderTopColor: '#818cf8',
          borderRadius: '50%',
          animation: 'spinSlow 0.85s linear infinite'
        }} />
        <h3 style={{ marginTop: '24px', color: '#e0e7ff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px', letterSpacing: '-0.5px' }}>ExamFlow</h3>
        <p style={{ marginTop: '8px', color: 'rgba(148,163,184,0.7)', fontSize: '13px', fontWeight: 500 }}>Establishing connection...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoginSuccess={handleLogin} collegeDetails={collegeDetails} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={handleTabChange} 
        user={user}
        collegeDetails={collegeDetails}
        onLogout={handleLogout}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main View Area */}
      <main className="main-content">
        <Header 
          collegeDetails={collegeDetails} 
          isMobileSidebarOpen={isMobileSidebarOpen}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />
        {renderView()}
      </main>
    </div>
  );
}

export default App;
