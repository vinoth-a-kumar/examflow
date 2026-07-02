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
  const [searchQuery, setSearchQuery] = useState('');
  
  // Auth & Theme States
  const [user, setUser] = useState(() => {
    const isBypassNetwork = ['localhost', '127.0.0.1', '10.106.232.208'].includes(window.location.hostname);
    if (isBypassNetwork) {
      return { username: 'Admin', email: 'admin@examflow.com' };
    }
    const savedUser = localStorage.getItem('examflow-user');
    return savedUser ? JSON.parse(savedUser) : null;
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

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('examflow-user', JSON.stringify(userData));
    setCurrentTab('dashboard');
  };

  const handleLogout = () => {
    const isBypassNetwork = ['localhost', '127.0.0.1', '10.106.232.208'].includes(window.location.hostname);
    if (isBypassNetwork) {
      setUser({ username: 'Admin', email: 'admin@examflow.com' });
    } else {
      setUser(null);
    }
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
    fetchAllData();
    // Auto-refresh stats/activities periodically
    const timer = setInterval(fetchAllData, 10000);
    return () => clearInterval(timer);
  }, []);

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

  // Add Hall
  const handleAddHall = async (hallData) => {
    try {
      const resp = await fetch('http://localhost:5000/api/halls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hallData)
      });
      if (resp.ok) {
        fetchAllData();
      } else {
        const err = await resp.json();
        alert("Failed to add hall: " + err.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error adding hall.");
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

  // Update Hall
  const handleUpdateHall = async (id, hallData) => {
    try {
      const resp = await fetch(`http://localhost:5000/api/halls/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hallData)
      });
      if (resp.ok) {
        fetchAllData();
      } else {
        const err = await resp.json();
        alert("Failed to update hall: " + err.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error updating hall.");
    }
  };

  // Reset entire database (Students, Halls, Exams, Seating Plans)
  const handleClearAll = async () => {
    if (window.confirm("CRITICAL WARNING: This will permanently wipe ALL students, halls, exams, and seating plans. This cannot be undone. Are you sure?")) {
      try {
        // Clear students (also clears seating plans on backend)
        await fetch('http://localhost:5000/api/students/clear', { method: 'POST' });
        
        // Delete all halls
        for (let hall of halls) {
          await fetch(`http://localhost:5000/api/halls/${hall._id}`, { method: 'DELETE' });
        }

        // Delete all exams
        for (let exam of exams) {
          await fetch(`http://localhost:5000/api/exams/${exam._id}`, { method: 'DELETE' });
        }

        alert("System databases have been completely wiped.");
        fetchAllData();
      } catch (err) {
        console.error(err);
        alert("An error occurred during system reset.");
      }
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
        return <DashboardView stats={stats} activities={activities} setTab={setCurrentTab} onUpdateHall={handleUpdateHall} onClearActivities={handleClearActivities} />;
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
          />
        );
      case 'seating':
        return <SeatingPlanView exams={exams} halls={halls} />;
      case 'settings':
        return (
          <SettingsView 
            dbStatus={dbConnection} 
            onClearAll={handleClearAll}
            refreshData={fetchAllData}
            currentTheme={theme}
            onChangeTheme={handleThemeChange}
          />
        );
      case 'profile':
        return <ProfileView />;
      default:
        return <DashboardView stats={stats} activities={activities} setTab={setCurrentTab} onClearActivities={handleClearActivities} />;
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
        backgroundColor: 'var(--bg-app)',
        fontFamily: 'var(--font-primary)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '5px solid var(--border-color)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <h3 style={{ marginTop: '20px', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>Loading ExamFlow</h3>
        <p style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>Establishing backend controller connection...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoginSuccess={handleLogin} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        user={user}
      />

      {/* Main View Area */}
      <main className="main-content">
        <Header />
        {renderView()}
      </main>
    </div>
  );
}

export default App;
