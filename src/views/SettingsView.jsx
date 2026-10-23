import React, { useState, useEffect } from 'react';
import {
  Database,
  Server,
  HardDrive,
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  Activity,
  Info,
  TriangleAlert,
  ExternalLink,
  Clock,
  CheckCircle2,
  X,
  FileText
} from 'lucide-react';

function SettingsView({ dbStatus, refreshData, setTab }) {
  const [systemInfo, setSystemInfo] = useState({
    projectVersion: 'v1.2.0',
    databaseStatus: 'Checking...',
    databaseEngine: 'MySQL',
    storageUsed: 'Checking...',
    recordCounts: { students: 0, halls: 0, exams: 0, plans: 0 }
  });

  const [recentActivities, setRecentActivities] = useState([]);
  const [lastCheckTime, setLastCheckTime] = useState('Just now');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Restore Modal State
  const [restoreModalFile, setRestoreModalFile] = useState(null);
  const [restoreParsedData, setRestoreParsedData] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Last Backup Info
  const [lastBackupInfo, setLastBackupInfo] = useState(() => {
    const saved = localStorage.getItem('examflow-last-backup-meta');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return { time: 'No backup created yet', size: '0 KB', available: false };
  });

  const showToast = (text, type = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchSystemInfo = async () => {
    setIsCheckingStatus(true);
    try {
      const resp = await fetch('http://localhost:5000/api/settings/system-info');
      if (resp.ok) {
        const data = await resp.json();
        setSystemInfo(data);
      }

      const actResp = await fetch('http://localhost:5000/api/dashboard/activities');
      if (actResp.ok) {
        const activities = await actResp.json();
        setRecentActivities(activities.slice(0, 5));
      }

      const now = new Date();
      setLastCheckTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('Failed to fetch system info:', err);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
  }, [dbStatus]);

  const handleManualStatusCheck = async () => {
    await fetchSystemInfo();
    showToast('System status refreshed live.');
  };

  const handleRefreshSystemData = async () => {
    setIsRefreshingData(true);
    try {
      if (refreshData) await refreshData();
      await fetchSystemInfo();
      showToast('Application data synchronized with backend.');
    } catch (e) {
      showToast('Failed to refresh system data.', 'error');
    } finally {
      setIsRefreshingData(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const resp = await fetch('http://localhost:5000/api/settings/backup');
      if (resp.ok) {
        const data = await resp.json();
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
        const sizeKb = (blob.size / 1024).toFixed(1);
        const displaySize = blob.size >= 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const formattedBackupTime = `${dateStr} • ${timeStr}`;

        const a = document.createElement('a');
        a.href = url;
        a.download = `examflow_backup_${now.toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const newMeta = { time: formattedBackupTime, size: displaySize, available: true };
        setLastBackupInfo(newMeta);
        localStorage.setItem('examflow-last-backup-meta', JSON.stringify(newMeta));

        showToast('New system backup created and downloaded successfully!');
        fetchSystemInfo();
      } else {
        showToast('Failed to generate database backup.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error: Could not reach backup API.', 'error');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleSelectRestoreFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed.students || !parsed.halls || !parsed.exams || !parsed.seatingPlans) {
          showToast('Invalid backup file. Must contain students, halls, exams, and seatingPlans.', 'error');
          e.target.value = null;
          return;
        }
        setRestoreModalFile(file);
        setRestoreParsedData(parsed);
      } catch (err) {
        showToast('Failed to parse backup JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleConfirmRestore = async () => {
    if (!restoreParsedData) return;
    setIsRestoring(true);
    try {
      const resp = await fetch('http://localhost:5000/api/settings/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restoreParsedData),
      });

      if (resp.ok) {
        showToast('Database snapshot restored successfully!');
        setRestoreModalFile(null);
        setRestoreParsedData(null);
        if (refreshData) refreshData();
        fetchSystemInfo();
      } else {
        const err = await resp.json();
        showToast('Failed to restore backup: ' + (err.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showToast('Network error during database restore.', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const isDbConnected = dbStatus?.connected ?? true;

  return (
    <div style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          zIndex: 10000,
          background: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '10px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: 600,
          fontSize: '14px',
          animation: 'fadeIn 0.2s ease'
        }}>
          {toastMessage.type === 'error' ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* PAGE HEADER */}
      <div className="page-intro" style={{ margin: 0 }}>
        <h2>Settings</h2>
        <p>System maintenance, data protection and application controls.</p>
      </div>

      {/* 1. SYSTEM HEALTH (Full Width) */}
      <div className="card-container" style={{ padding: '20px 24px' }}>
        <div className="card-title-bar" style={{ paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(139,92,246,0.08))',
              border: '1px solid rgba(79,70,229,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary)', flexShrink: 0
            }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>System Health</h3>
            </div>
          </div>

          <button
            onClick={handleManualStatusCheck}
            disabled={isCheckingStatus}
            className="btn-secondary"
            style={{ padding: '6px 14px', fontSize: '12.5px', gap: '6px' }}
          >
            <RefreshCw size={14} style={{ animation: isCheckingStatus ? 'spinSlow 1s linear infinite' : 'none' }} />
            <span>Check System Status</span>
          </button>
        </div>

        {/* Compact Status Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '12px' }}>
          
          {/* Database Status */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-app)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Database size={18} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Database</div>
              <div style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isDbConnected ? '#10b981' : '#ef4444' }} />
                <span>{isDbConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </div>

          {/* Database Engine */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-app)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Server size={18} style={{ color: '#06b6d4', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Database Engine</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                {systemInfo.databaseEngine || 'MySQL'}
              </div>
            </div>
          </div>

          {/* Backend Server */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-app)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Activity size={18} style={{ color: '#10b981', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Backend Server</div>
              <div style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                <span>Online</span>
              </div>
            </div>
          </div>

          {/* Last System Check */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-app)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Clock size={18} style={{ color: '#8b5cf6', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Last System Check</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                {lastCheckTime}
              </div>
            </div>
          </div>

          {/* Storage Usage */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-app)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <HardDrive size={18} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Storage Usage</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                {systemInfo.storageUsed || '1.45 MB'}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 2 & 3. DATA MANAGEMENT & BACKUP CENTER (2-Column Grid) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        
        {/* 2. DATA MANAGEMENT */}
        <div className="card-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title-bar" style={{ paddingBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(6,182,212,0.12), rgba(14,165,233,0.08))',
                  border: '1px solid rgba(6,182,212,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#06b6d4', flexShrink: 0
                }}>
                  <FileText size={18} />
                </div>
                <h3>Data Management</h3>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Summary of operational records stored across system modules.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Students', count: systemInfo.recordCounts?.students ?? 0, tab: 'upload' },
                { label: 'Halls', count: systemInfo.recordCounts?.halls ?? 0, tab: 'halls' },
                { label: 'Exams', count: systemInfo.recordCounts?.exams ?? 0, tab: 'exams' },
                { label: 'Seating Plans', count: systemInfo.recordCounts?.plans ?? 0, tab: 'seating' },
              ].map((row) => (
                <div key={row.label} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: 'var(--bg-app)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div>
                    <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{row.label}</span>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '2px' }}>
                      {row.count} {row.count === 1 ? 'record' : 'records'}
                    </div>
                  </div>
                  {setTab && (
                    <button
                      onClick={() => setTab(row.tab)}
                      className="btn-secondary"
                      style={{ padding: '4px 12px', fontSize: '12px', height: '32px', gap: '4px' }}
                    >
                      <span>View</span>
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 3. BACKUP CENTER */}
        <div className="card-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title-bar" style={{ paddingBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(5,150,105,0.1), rgba(16,185,129,0.06))',
                  border: '1px solid rgba(5,150,105,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-success)', flexShrink: 0
                }}>
                  <Database size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Backup Center</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0' }}>Protect and recover examination system data.</p>
                </div>
              </div>
            </div>

            {/* Last Backup Info Box */}
            <div style={{
              padding: '14px',
              background: 'var(--bg-app)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>LAST BACKUP</span>
                <span style={{
                  fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px',
                  background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.2)'
                }}>
                  ● Available
                </span>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {lastBackupInfo.time}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Backup Size: <strong>{lastBackupInfo.size}</strong>
              </div>
            </div>

            {/* Backup & Restore Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={handleCreateBackup}
                disabled={isCreatingBackup}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
              >
                <Download size={16} />
                <span>{isCreatingBackup ? 'Creating Backup...' : 'Create New Backup'}</span>
              </button>

              <input
                type="file"
                accept=".json"
                onChange={handleSelectRestoreFile}
                style={{ display: 'none' }}
                id="settings-restore-file-input"
              />
              <label
                htmlFor="settings-restore-file-input"
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px' }}
              >
                <Upload size={16} />
                <span>Restore Backup</span>
              </label>
            </div>
          </div>
        </div>

      </div>

      {/* 4 & 5. SYSTEM ACTIVITY & APPLICATION INFORMATION (2-Column Grid) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        
        {/* 4. SYSTEM ACTIVITY */}
        <div className="card-container">
          <div className="card-title-bar" style={{ paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.08))',
                border: '1px solid rgba(245,158,11,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#d97706', flexShrink: 0
              }}>
                <Activity size={18} />
              </div>
              <h3>System Activity</h3>
            </div>
          </div>

          <div className="activity-list-scroll-container">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentActivities.length > 0 ? (
                recentActivities.map((act) => (
                  <div key={act.id} style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '10px 12px',
                    background: 'var(--bg-app)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      background: 'rgba(79,70,229,0.1)', color: 'var(--color-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, marginTop: '2px'
                    }}>
                      <Activity size={14} />
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {act.message}
                      </div>
                      {act.detail && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                          {act.detail}
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} />
                        <span>{new Date(act.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No recent administrative activity logged.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 5. APPLICATION INFORMATION */}
        <div className="card-container">
          <div className="card-title-bar" style={{ paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(167,139,250,0.08))',
                border: '1px solid rgba(139,92,246,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#8b5cf6', flexShrink: 0
              }}>
                <Info size={18} />
              </div>
              <h3>Application Information</h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { label: 'Application', value: 'ExamFlow' },
              { label: 'Developer', value: 'Vinothkumar' },
              { label: 'Version', value: systemInfo.projectVersion || 'v1.2.0' },
              { label: 'Copyright', value: '© 2026 Vinothkumar. All rights reserved.' },
            ].map((info) => (
              <div key={info.label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--bg-app)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)'
              }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>{info.label}</span>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>{info.value}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 6. MAINTENANCE */}
      <div className="card-container" style={{ padding: '20px 24px' }}>
        <div className="card-title-bar" style={{ paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(139,92,246,0.08))',
              border: '1px solid rgba(79,70,229,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary)', flexShrink: 0
            }}>
              <RefreshCw size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Maintenance</h3>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginTop: '8px' }}>
          <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0, flex: 1, minWidth: '240px' }}>
            Refetch active record collections and synchronize caching with the backend database.
          </p>
          <button
            onClick={handleRefreshSystemData}
            disabled={isRefreshingData}
            className="btn-secondary"
            style={{ padding: '8px 18px', fontSize: '13px', gap: '8px' }}
          >
            <RefreshCw size={15} style={{ animation: isRefreshingData ? 'spinSlow 1s linear infinite' : 'none' }} />
            <span>Refresh System Data</span>
          </button>
        </div>
      </div>

      {/* RESTORE CONFIRMATION MODAL */}
      {restoreModalFile && restoreParsedData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000, padding: '20px'
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: '16px', width: '100%', maxWidth: '480px', overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)', animation: 'fadeIn 0.2s ease'
          }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Confirm Database Restore</h3>
              <button onClick={() => { setRestoreModalFile(null); setRestoreParsedData(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '10px', color: '#dc2626', fontSize: '13px', lineHeight: 1.5 }}>
                <strong>Warning:</strong> Restoring this backup file will completely overwrite all existing database records.
              </div>

              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                File: <strong>{restoreModalFile.name}</strong> ({(restoreModalFile.size / 1024).toFixed(1)} KB)
              </div>

              <div style={{ background: 'var(--bg-app)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                <div>Students: <strong>{restoreParsedData.students?.length ?? 0}</strong></div>
                <div>Halls: <strong>{restoreParsedData.halls?.length ?? 0}</strong></div>
                <div>Exams: <strong>{restoreParsedData.exams?.length ?? 0}</strong></div>
                <div>Seating Plans: <strong>{restoreParsedData.seatingPlans?.length ?? 0}</strong></div>
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'var(--bg-app)' }}>
              <button
                onClick={() => { setRestoreModalFile(null); setRestoreParsedData(null); }}
                className="btn-secondary"
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '13px', background: '#10b981' }}
              >
                {isRestoring ? 'Restoring Database...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default SettingsView;
