import React, { useState, useEffect } from 'react';
import {
  Trash2,
  Database,
  ShieldAlert,
  Upload,
  Info,
  Download,
  Clock,
  RefreshCw
} from 'lucide-react';

function SettingsView({ dbStatus, onClearAll, refreshData, currentTheme, onChangeTheme }) {

  const [systemInfo, setSystemInfo] = useState({
    projectVersion: 'v1.2.0',
    databaseStatus: dbStatus.mode + ' Mode',
    storageUsed: 'Checking...',
    recordCounts: { students: 0, halls: 0, exams: 0, plans: 0 }
  });
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [lastBackup, setLastBackup] = useState(
    () => localStorage.getItem('examflow-last-backup') || 'Never'
  );

  const fetchSystemInfo = async () => {
    setIsLoadingInfo(true);
    try {
      const resp = await fetch('http://localhost:5000/api/settings/system-info');
      if (resp.ok) setSystemInfo(await resp.json());
    } catch (err) {
      console.error('Failed to fetch system info:', err);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbStatus]);

  const handleDownloadBackup = async () => {
    try {
      const resp = await fetch('http://localhost:5000/api/settings/backup');
      if (resp.ok) {
        const data = await resp.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `examflow_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const nowStr = new Date().toLocaleString();
        setLastBackup(nowStr);
        localStorage.setItem('examflow-last-backup', nowStr);
        fetchSystemInfo();
      } else {
        alert('Failed to export database backup.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error: Failed to backup system database.');
    }
  };

  const handleRestoreBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm('WARNING: Restoring a backup will completely overwrite your current database. Continue?')) {
      e.target.value = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        if (!backupData.students || !backupData.halls || !backupData.exams || !backupData.seatingPlans) {
          alert('Invalid backup file format.');
          return;
        }
        const resp = await fetch('http://localhost:5000/api/settings/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData),
        });
        if (resp.ok) {
          alert('Database backup restored successfully!');
          fetchSystemInfo();
          refreshData();
        } else {
          const err = await resp.json();
          alert('Failed to restore backup: ' + err.error);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse backup JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div className="page-intro">
        <h2>Settings Panel</h2>
        <p>Manage backups, visual themes, and database health.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '24px' }}>

        {/* LEFT — System Info & Backups */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* System Information */}
          <div className="card-container">
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(139,92,246,0.08))',
                  border: '1px solid rgba(79,70,229,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-primary)', flexShrink: 0,
                }}>
                  <Info size={16} />
                </div>
                <h3>System Information</h3>
              </div>
              <button
                onClick={fetchSystemInfo}
                disabled={isLoadingInfo}
                title="Refresh Stats"
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px',
                  borderRadius: '6px', transition: 'color 0.2s',
                }}
              >
                <RefreshCw size={14} style={{ animation: isLoadingInfo ? 'spinSlow 1s linear infinite' : 'none' }} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Project Version', value: systemInfo.projectVersion },
                { label: 'Database Mode', value: systemInfo.databaseStatus, status: dbStatus.connected ? 'success' : 'warning' },
                { label: 'Storage Used', value: systemInfo.storageUsed },
                { label: 'Last Backup', value: lastBackup, icon: true },
              ].map((row) => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: 'var(--bg-app)',
                  borderRadius: '10px', border: '1px solid var(--border-color)',
                }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>{row.label}</span>
                  {row.status ? (
                    <span className={`status-pill ${row.status}`}>{row.value}</span>
                  ) : (
                    <span style={{ fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {row.icon && <Clock size={12} style={{ color: 'var(--text-muted)' }} />}
                      {row.value}
                    </span>
                  )}
                </div>
              ))}

              {/* Record Counts */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginTop: '4px' }}>
                {[
                  { label: 'Students', val: systemInfo.recordCounts?.students || 0, color: '#4f46e5' },
                  { label: 'Halls',    val: systemInfo.recordCounts?.halls    || 0, color: '#059669' },
                  { label: 'Exams',   val: systemInfo.recordCounts?.exams    || 0, color: '#d97706' },
                  { label: 'Plans',   val: systemInfo.recordCounts?.plans    || 0, color: '#0ea5e9' },
                ].map((rc) => (
                  <div key={rc.label} style={{
                    textAlign: 'center', padding: '12px 8px',
                    background: 'var(--bg-app)', borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: rc.color, fontFamily: 'var(--font-display)', letterSpacing: '-1px' }}>
                      {rc.val}
                    </div>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>
                      {rc.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Backup & Restore */}
          <div className="card-container">
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(5,150,105,0.1), rgba(16,185,129,0.06))',
                  border: '1px solid rgba(5,150,105,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-success)', flexShrink: 0,
                }}>
                  <Database size={16} />
                </div>
                <h3>Backup &amp; Restore</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Download a full JSON snapshot of your data, or restore from a previous backup file.
              </p>
              <button
                onClick={handleDownloadBackup}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 12px rgba(5,150,105,0.25)' }}
              >
                <Download size={15} />
                Create Database Backup
              </button>
              <input type="file" accept=".json" onChange={handleRestoreBackup} style={{ display: 'none' }} id="restore-backup-file-input" />
              <label
                htmlFor="restore-backup-file-input"
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Upload size={15} />
                Restore Database Backup
              </label>
            </div>
          </div>

        </div>

        {/* RIGHT — Theme & Danger Zone */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Theme Customization */}
          <div className="card-container">
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(167,139,250,0.08))',
                  border: '1px solid rgba(139,92,246,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>🎨</span>
                </div>
                <h3>Theme</h3>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '4px' }}>
              Choose the visual appearance for your control dashboard.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { id: 'light',  label: 'Modern Slate',    sublabel: 'Clean light mode',   bg: 'linear-gradient(135deg, #f0f4ff, #e8eeff)', dot: 'linear-gradient(135deg, #4f46e5, #8b5cf6)', textColor: '#1e293b', border: '#c7d2fe' },
                { id: 'dark',   label: 'Midnight Obsidian', sublabel: 'Sleek dark mode', bg: 'linear-gradient(135deg, #0f172a, #1e293b)', dot: 'linear-gradient(135deg, #38bdf8, #818cf8)', textColor: '#94a3b8', border: '#334155' },
                { id: 'sunset', label: 'Sunset Gold',     sublabel: 'Warm dark gradient', bg: 'linear-gradient(135deg, #1c0a0a, #2d1515)', dot: 'linear-gradient(135deg, #f97316, #e879f9)', textColor: '#d6d3d1', border: '#451a03' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => onChangeTheme(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 14px', background: t.bg,
                    border: currentTheme === t.id ? '2px solid var(--color-primary)' : `1px solid ${t.border}`,
                    borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease', outline: 'none',
                    boxShadow: currentTheme === t.id ? '0 4px 12px rgba(79,70,229,0.2)' : 'none',
                  }}
                >
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: t.dot, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: t.textColor }}>{t.label}</div>
                    <div style={{ fontSize: '11px', color: t.textColor, opacity: 0.65, fontWeight: 500 }}>{t.sublabel}</div>
                  </div>
                  {currentTheme === t.id && <div style={{ marginLeft: 'auto', fontSize: '18px', color: t.textColor }}>✓</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="card-container" style={{ border: '1px solid rgba(220,38,38,0.25)', background: 'linear-gradient(135deg, rgba(220,38,38,0.03), transparent)' }}>
            <div className="card-title-bar" style={{ borderBottomColor: 'rgba(220,38,38,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px',
                  background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-error)', flexShrink: 0,
                }}>
                  <ShieldAlert size={16} />
                </div>
                <h3 style={{ color: 'var(--color-error)' }}>Danger Zone</h3>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Permanently deletes <strong>all</strong> students, halls, exams, and generated seating plans. This cannot be undone.
            </p>

            <button
              className="btn-danger"
              onClick={onClearAll}
              style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
            >
              <Trash2 size={15} />
              Reset Entire Database
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default SettingsView;
