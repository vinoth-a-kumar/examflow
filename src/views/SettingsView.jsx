import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Trash2, 
  Database, 
  ShieldAlert, 
  CheckCircle2, 
  Building2, 
  MapPin, 
  Upload, 
  Info, 
  Download, 
  Clock, 
  RefreshCw,
  Image as ImageIcon
} from 'lucide-react';

function SettingsView({ 
  dbStatus, 
  onClearAll, 
  refreshData, 
  currentTheme, 
  onChangeTheme,
  collegeDetails,
  onSaveCollegeDetails
}) {
  // Mock Data Seeding States
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');

  // General Settings States (initialized from prop)
  const [collegeName, setCollegeName] = useState(collegeDetails?.name || 'ExamFlow Engineering College');
  const [logo, setLogo] = useState(collegeDetails?.logo || '');
  const [address, setAddress] = useState(collegeDetails?.address || '123 University Campus, Tech City, 600001');
  const [academicYear, setAcademicYear] = useState(collegeDetails?.academicYear || '2026-27');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync prop changes to local form state
  useEffect(() => {
    if (collegeDetails) {
      setCollegeName(collegeDetails.name || 'ExamFlow Engineering College');
      setLogo(collegeDetails.logo || '');
      setAddress(collegeDetails.address || '123 University Campus, Tech City, 600001');
      setAcademicYear(collegeDetails.academicYear || '2026-27');
    }
  }, [collegeDetails]);

  // About & System Info States
  const [systemInfo, setSystemInfo] = useState({
    projectVersion: 'v1.2.0',
    databaseStatus: dbStatus.mode + ' Mode',
    storageUsed: 'Checking...',
    recordCounts: { students: 0, halls: 0, exams: 0, plans: 0 }
  });
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem('examflow-last-backup') || 'Never');

  const fetchSystemInfo = async () => {
    setIsLoadingInfo(true);
    try {
      const resp = await fetch('http://localhost:5000/api/settings/system-info');
      if (resp.ok) {
        const data = await resp.json();
        setSystemInfo(data);
      }
    } catch (err) {
      console.error("Failed to fetch system info:", err);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbStatus]);

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("Logo file is too large! Please upload an image under 2MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogo(reader.result); // Base64 string representation
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setLogo('');
  };

  const handleSaveGeneralSettings = () => {
    onSaveCollegeDetails({
      name: collegeName,
      logo: logo,
      address: address,
      academicYear: academicYear
    });
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
    }, 3000);
  };

  const handleDownloadBackup = async () => {
    try {
      const resp = await fetch('http://localhost:5000/api/settings/backup');
      if (resp.ok) {
        const data = await resp.json();
        
        // Trigger browser file download
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `examflow_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const nowStr = new Date().toLocaleString();
        setLastBackup(nowStr);
        localStorage.setItem('examflow-last-backup', nowStr);
        fetchSystemInfo(); // Refresh stats
      } else {
        alert("Failed to export database backup.");
      }
    } catch (err) {
      console.error(err);
      alert("Network error: Failed to backup system database.");
    }
  };

  const handleRestoreBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.confirm("WARNING: Restoring a backup will completely overwrite your current students database, halls, exams, and generated plans. Do you want to continue?")) {
      e.target.value = null; // Clear input
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        
        // Validate keys
        if (!backupData.students || !backupData.halls || !backupData.exams || !backupData.seatingPlans) {
          alert("Invalid backup file format. The file must contain students, halls, exams, and seating plans.");
          return;
        }

        const resp = await fetch('http://localhost:5000/api/settings/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData)
        });

        if (resp.ok) {
          alert("Database backup restored successfully!");
          fetchSystemInfo(); // Refresh about section stats
          refreshData(); // Refresh App.js core stats
        } else {
          const err = await resp.json();
          alert("Failed to restore backup: " + err.error);
        }
      } catch (err) {
        console.error(err);
        alert("Failed to parse backup JSON file. Make sure it is a valid backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; // Clear input
  };

  const handleGenerateTestData = async () => {
    setIsGenerating(true);
    setGenerateMsg('Generating test data...');

    try {
      // 1. Create Halls
      setGenerateMsg('Creating default halls...');
      const hallsData = [
        { name: 'Hall A', rows: 8, columns: 5 },
        { name: 'Hall B', rows: 10, columns: 5 },
        { name: 'Hall C', rows: 6, columns: 5 },
        { name: 'Main Auditorium', rows: 15, columns: 10 }
      ];

      for (let hall of hallsData) {
        await fetch('http://localhost:5000/api/halls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hall)
        });
      }

      // 2. Upload Student Data
      setGenerateMsg('Importing sample student rosters (CSE, IT, ECE)...');
      let csvLines = ["Register No,Name,Department"];
      
      // Generate 60 CSE students
      for (let i = 1; i <= 60; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Smith', 'Patel', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez'];
        const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Elizabeth', 'William', 'Linda'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024CSE${idStr},${randomName},CSE`);
      }

      // Generate 50 IT students
      for (let i = 1; i <= 50; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Chen', 'Singh', 'Wang', 'Kim', 'Ali', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia'];
        const firstNames = ['David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024IT${idStr},${randomName},IT`);
      }

      // Generate 30 ECE students
      for (let i = 1; i <= 30; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Taylor', 'Thomas', 'White', 'Harris', 'Martin', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young'];
        const firstNames = ['Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024ECE${idStr},${randomName},ECE`);
      }

      const csvText = csvLines.join('\n');
      
      const uploadResp = await fetch('http://localhost:5000/api/students/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, filename: 'sample_students_roster.csv' })
      });
      await uploadResp.json();

      // 3. Create Exams
      setGenerateMsg('Scheduling sample examinations...');
      const examsData = [
        {
          name: 'Data Structures',
          departments: ['CSE', 'IT'],
          date: '2026-06-25',
          session: 'FN',
          assignedHalls: ['Hall A', 'Hall B']
        },
        {
          name: 'Operating Systems',
          departments: ['CSE'],
          date: '2026-06-26',
          session: 'AN',
          assignedHalls: ['Hall A']
        },
        {
          name: 'Database Management',
          departments: ['IT', 'ECE'],
          date: '2026-06-28',
          session: 'FN',
          assignedHalls: ['Hall C', 'Main Auditorium']
        }
      ];

      for (let exam of examsData) {
        await fetch('http://localhost:5000/api/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(exam)
        });
      }

      setGenerateMsg('Data generated successfully!');
      alert('Default test data has been seeded successfully. You can now explore the Dashboard, Hall Management, Exam Management, and Seating Plan tabs!');
      refreshData();
      fetchSystemInfo(); // Refresh stats/size
    } catch (err) {
      console.error(err);
      setGenerateMsg('Error generating test data.');
      alert('Failed to generate test data.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Settings Panel</h2>
        <p>Manage college details, visual themes, backups, and check database status.</p>
      </div>

      <div className="sections-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px' }}>
        
        {/* LEFT COLUMN: General Settings Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="card-container" style={{ padding: '24px', position: 'relative' }}>
            <div className="card-title-bar" style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '16px', marginBottom: '20px' }}>
              <Building2 size={22} style={{ color: 'var(--color-primary)' }} />
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>General Settings</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* College Name */}
              <div className="form-group">
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>College Name</label>
                <input 
                  type="text" 
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="Enter college or university name..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '14px'
                  }}
                />
              </div>

              {/* College Logo Uploader */}
              <div className="form-group">
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>College Logo</label>
                
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '20px', 
                  padding: '16px', 
                  border: '1px dashed var(--border-color)', 
                  borderRadius: '10px',
                  backgroundColor: 'var(--bg-app)'
                }}>
                  
                  {/* Logo Preview box */}
                  <div style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0
                  }}>
                    {logo ? (
                      <img src={logo} alt="College Logo Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <ImageIcon size={32} style={{ color: 'var(--text-muted)' }} />
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'opacity 0.2s'
                      }}>
                        <Upload size={14} />
                        <span>Upload Logo</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleLogoChange}
                          style={{ display: 'none' }}
                        />
                      </label>

                      {logo && (
                        <button 
                          onClick={handleRemoveLogo}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-error)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Supports PNG, JPG, or SVG under 2MB. Fits Sidebar & Print Roster headers.
                    </span>
                  </div>

                </div>
              </div>

              {/* College Address */}
              <div className="form-group">
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>College Address</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-muted)' }} />
                  <textarea 
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter complete institution postal address..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 14px 10px 38px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: '14px',
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>

              {/* Academic Year */}
              <div className="form-group">
                <label style={{ fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-primary)' }}>Academic Year</label>
                <select 
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="2024-25">2024-25</option>
                  <option value="2025-26">2025-26</option>
                  <option value="2026-27">2026-27</option>
                  <option value="2027-28">2027-28</option>
                  <option value="2028-29">2028-29</option>
                  <option value="2029-30">2029-30</option>
                  <option value="2030-31">2030-31</option>
                  <option value="2031-32">2031-32</option>
                  <option value="2032-33">2032-33</option>
                </select>
              </div>

              {/* Save Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                <button 
                  className="btn-primary" 
                  onClick={handleSaveGeneralSettings}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '14px',
                    boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)',
                    cursor: 'pointer'
                  }}
                >
                  Save Changes
                </button>

                {saveSuccess && (
                  <span style={{ 
                    fontSize: '13px', 
                    fontWeight: 600, 
                    color: 'var(--color-success)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    animation: 'fadeIn 0.2s ease'
                  }}>
                    <CheckCircle2 size={16} /> 
                    <span>Branding settings updated!</span>
                  </span>
                )}
              </div>

            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: About, Theme, Danger Zone */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* About App Card */}
          <div className="card-container" style={{ padding: '24px' }}>
            <div className="card-title-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '16px', marginBottom: '20px' }}>
              <Info size={20} style={{ color: 'var(--color-primary)' }} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>About System</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Project Version */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Project Version</span>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, backgroundColor: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px' }}>
                  {systemInfo.projectVersion}
                </span>
              </div>

              {/* Database Status */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Database Status</span>
                <span className={`status-pill ${dbStatus.connected ? 'success' : 'warning'}`} style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>
                  {systemInfo.databaseStatus}
                </span>
              </div>

              {/* Storage Used */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Storage Used</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {systemInfo.storageUsed}
                  </span>
                  <button 
                    onClick={fetchSystemInfo}
                    disabled={isLoadingInfo}
                    title="Refresh Stats"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px',
                      borderRadius: '4px',
                      transition: 'color 0.2s'
                    }}
                  >
                    <RefreshCw size={12} className={isLoadingInfo ? 'spin-anim' : ''} />
                  </button>
                </div>
              </div>

              {/* Last Backup Time */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Last Backup Time</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={12} />
                    {lastBackup}
                  </span>
                </div>
              </div>

              {/* Create Backup Button */}
              <button 
                onClick={handleDownloadBackup}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-primary)',
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  boxSizing: 'border-box'
                }}
              >
                <Download size={14} />
                <span>Create Database Backup</span>
              </button>

              {/* Restore Backup Area */}
              <input 
                type="file" 
                accept=".json" 
                onChange={handleRestoreBackup} 
                style={{ display: 'none' }} 
                id="restore-backup-file-input" 
              />
              <label 
                htmlFor="restore-backup-file-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  boxSizing: 'border-box',
                  marginTop: '8px'
                }}
              >
                <Upload size={14} />
                <span>Restore Database Backup</span>
              </label>

            </div>
          </div>

          {/* Theme Customization card */}
          <div className="card-container" style={{ padding: '24px' }}>
            <div className="card-title-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '16px', marginBottom: '20px' }}>
              <Database size={18} style={{ color: 'var(--color-primary)' }} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Theme Customization</h3>
            </div>
            
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Choose a visual appearance for your administration control dashboard.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Light Theme */}
              <button
                onClick={() => onChangeTheme('light')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  border: currentTheme === 'light' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>Modern Slate (Light)</span>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#2563eb' }} />
              </button>

              {/* Dark Theme */}
              <button
                onClick={() => onChangeTheme('dark')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  border: currentTheme === 'dark' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: '#151f32',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8' }}>Midnight Obsidian (Dark)</span>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#38bdf8' }} />
              </button>

              {/* Sunset Theme */}
              <button
                onClick={() => onChangeTheme('sunset')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  border: currentTheme === 'sunset' ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: '#1d1826',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#d6d3d1' }}>Sunset Gold (Dark Gradient)</span>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f59e0b' }} />
              </button>
            </div>
          </div>

          {/* Danger Zone card */}
          <div className="card-container" style={{ padding: '24px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <div className="card-title-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '16px', marginBottom: '20px', borderColor: 'rgba(239, 68, 68, 0.1)' }}>
              <ShieldAlert size={20} style={{ color: 'var(--color-error)' }} />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-error)' }}>Danger Zone</h3>
            </div>
            
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Permanently delete all students database, configured halls, registered exams, and generated seating plans.
            </p>
            
            <button 
              className="btn-danger" 
              onClick={onClearAll}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '6px',
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              <Trash2 size={14} />
              <span>Reset Database</span>
            </button>
          </div>

        </div>

      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin-anim {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default SettingsView;
