import React, { useState, useRef } from 'react';
import {
  Building2,
  Armchair,
  LayoutGrid,
  Trash2,
  UploadCloud,
  RefreshCw,
  Database,
  Plus
} from 'lucide-react';

function HallManagementView({ halls, onDeleteHall, refreshData, onClear }) {
  const [dragActive,     setDragActive]     = useState(false);
  const [selectedFile,   setSelectedFile]   = useState(null);
  const [isUploading,    setIsUploading]    = useState(false);
  const [csvTextMode,    setCsvTextMode]    = useState(false);
  const [manualCsvText,  setManualCsvText]  = useState('');
  const fileInputRef = useRef(null);

  const totalHallsCount = (halls || []).length;
  const totalCapacity   = (halls || []).reduce((sum, h) => sum + (h && h.capacity ? h.capacity : 0), 0);
  const avgBenches      = totalHallsCount > 0
    ? Math.round((halls || []).reduce((sum, h) => sum + (h && h.benches ? h.benches : 0), 0) / totalHallsCount)
    : 0;

  const csvHeaders = React.useMemo(() => {
    const hallWithData = halls.find(h => h.csvData);
    if (hallWithData) return Object.keys(hallWithData.csvData);
    return null;
  }, [halls]);

  const getCellValue = (hall, header) => {
    if (hall.csvData && hall.csvData[header] !== undefined) return hall.csvData[header];
    const h = header.toLowerCase();
    if (h.includes('hall') || h.includes('name') || h.includes('room') || h.includes('block')) return hall.name;
    if (h.includes('row'))      return hall.rows;
    if (h.includes('col'))      return hall.columns;
    if (h.includes('bench'))    return hall.benches;
    if (h.includes('capacity')) return hall.capacity;
    return hall[header] || '';
  };

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        setSelectedFile(file);
      } else {
        alert('Only CSV and Excel files (.csv, .xlsx, .xls) are supported.');
      }
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
  };

  const onBrowseClick = () => fileInputRef.current.click();

  const handleUploadSubmit = async () => {
    if (!selectedFile && !manualCsvText) return;
    setIsUploading(true);
    try {
      if (csvTextMode) {
        if (!manualCsvText.trim()) { alert('Please enter CSV text first.'); setIsUploading(false); return; }
        const response = await fetch('http://localhost:5000/api/halls/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText: manualCsvText }),
        });
        const data = await response.json();
        if (data.success) { alert(data.message); setManualCsvText(''); refreshData(); }
        else alert('Upload failed: ' + data.message);
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const response = await fetch('http://localhost:5000/api/halls/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) { alert(data.message); setSelectedFile(null); refreshData(); }
        else alert('Upload failed: ' + data.message);
      }
    } catch (error) {
      console.error('Hall upload error:', error);
      alert('An error occurred during upload.');
    } finally {
      setIsUploading(false);
    }
  };

  const STAT_STYLES = [
    { color: 'rgba(79,70,229,0.12)',   colorEnd: 'rgba(139,92,246,0.08)', iconColor: '#4f46e5',  shadow: 'rgba(79,70,229,0.15)'  },
    { color: 'rgba(6,182,212,0.1)',    colorEnd: 'rgba(14,165,233,0.06)', iconColor: '#0ea5e9',  shadow: 'rgba(6,182,212,0.15)'  },
    { color: 'rgba(245,158,11,0.1)',   colorEnd: 'rgba(217,119,6,0.06)',  iconColor: '#d97706',  shadow: 'rgba(245,158,11,0.15)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* Page Header */}
      <div className="page-intro">
        <h2>Hall Management</h2>
        <p>Configure examination halls and manage their seating capacities.</p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {[
          { label: 'Total Halls',      value: totalHallsCount, icon: Building2  },
          { label: 'Total Capacity',   value: totalCapacity,   icon: Armchair   },
          { label: 'Avg Benches/Hall', value: avgBenches,      icon: LayoutGrid },
        ].map((item, idx) => {
          const s = STAT_STYLES[idx];
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="stat-card"
              style={{
                '--stat-color': s.color, '--stat-color-end': s.colorEnd,
                '--stat-icon-color': s.iconColor, '--stat-shadow': s.shadow,
              }}
            >
              <div className="stat-card-icon"><Icon style={{ width: 22, height: 22 }} /></div>
              <div className="stat-card-info">
                <span className="stat-card-number">{item.value.toLocaleString()}</span>
                <span className="stat-card-label">{item.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column Layout */}
      <div className="sections-grid">

        {/* LEFT — CSV Uploader */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                  <Plus size={16} />
                </div>
                <h3>Import Halls via CSV</h3>
              </div>
              <button
                className="btn-secondary"
                onClick={() => setCsvTextMode(!csvTextMode)}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                {csvTextMode ? '📁 File Upload' : '📋 Paste CSV'}
              </button>
            </div>

            {csvTextMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label>Paste CSV Contents (Hall Name, Rows, Columns)</label>
                  <textarea
                    rows={6}
                    placeholder={`Hall Name,Rows,Columns\nBlock A,8,5\nBlock B,6,4\nSeminar Hall,10,6`}
                    value={manualCsvText}
                    onChange={(e) => setManualCsvText(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '13px', resize: 'vertical' }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn-primary"
                    onClick={handleUploadSubmit}
                    disabled={isUploading || !manualCsvText.trim()}
                  >
                    {isUploading ? 'Importing…' : 'Import CSV Text'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="uploader-box"
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={onBrowseClick}
                  style={{
                    borderColor: dragActive ? 'var(--color-primary)' : undefined,
                    background: dragActive
                      ? 'radial-gradient(ellipse at center, var(--color-primary-alpha-20) 0%, transparent 80%)'
                      : undefined,
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    accept=".csv,.xlsx,.xls"
                  />
                  <div className="uploader-icon"><UploadCloud /></div>
                  <div className="uploader-text">
                    <h4>{dragActive ? 'Drop to Upload!' : 'Drag & Drop Files Here'}</h4>
                    <p>Upload a CSV or Excel file with hall names, rows, and column counts.</p>
                  </div>
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onBrowseClick(); }}
                  >
                    Browse Files
                  </button>
                  <span className="uploader-file-info">
                    Supported: CSV, Excel (.xlsx, .xls) · Max 50 MB
                  </span>
                </div>

                {selectedFile && (
                  <>
                    <div style={{
                      padding: '10px 16px',
                      background: 'linear-gradient(135deg, rgba(79,70,229,0.08), rgba(139,92,246,0.05))',
                      border: '1px solid rgba(79,70,229,0.2)',
                      borderRadius: '10px',
                      fontWeight: 600,
                      fontSize: '13px',
                      color: 'var(--color-primary)',
                      display: 'flex', alignItems: 'center', gap: '10px',
                    }}>
                      <span>✓</span>
                      <span style={{ flex: 1 }}>{selectedFile.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                        style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 700 }}
                      >✕</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn-primary" onClick={handleUploadSubmit} disabled={isUploading}>
                        {isUploading ? 'Uploading…' : 'Confirm Upload'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* CSV Format Guide */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(79,70,229,0.05), transparent)',
            border: '1px solid rgba(79,70,229,0.1)',
            borderRadius: '14px',
            padding: '18px 20px',
          }}>
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: '10px' }}>
              📄 Expected CSV Format
            </h4>
            <pre style={{
              fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace',
              background: 'var(--bg-app)', borderRadius: '8px', padding: '12px',
              border: '1px solid var(--border-color)', margin: 0, lineHeight: 1.7,
            }}>
{`Hall Name,Rows,Columns
Block A Hall,8,5
Seminar Hall,12,6
Lab Block,6,4`}
            </pre>
          </div>
        </div>

        {/* RIGHT — Hall Records Table */}
        <div className="card-container">
          <div className="card-title-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(6,182,212,0.1), rgba(14,165,233,0.06))',
                border: '1px solid rgba(6,182,212,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#0ea5e9', flexShrink: 0,
              }}>
                <Database size={16} />
              </div>
              <h3>Hall Records</h3>
              {halls.length > 0 && (
                <span style={{
                  fontSize: '11px', fontWeight: 700, color: '#0ea5e9',
                  background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)',
                  padding: '3px 9px', borderRadius: '9999px',
                }}>
                  {halls.length} hall{halls.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-icon" onClick={refreshData} title="Refresh">
                <RefreshCw size={14} />
              </button>
              <button
                className="btn-danger"
                onClick={onClear}
                disabled={halls.length === 0}
                style={{ padding: '7px 14px', fontSize: '13px' }}
              >
                <Trash2 size={13} />
                Clear All
              </button>
            </div>
          </div>

          {halls.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '56px 24px', color: 'var(--text-muted)', textAlign: 'center', gap: '14px',
            }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(79,70,229,0.08), rgba(139,92,246,0.05))',
                border: '1px solid rgba(79,70,229,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-primary)', opacity: 0.5,
              }}>
                <Building2 size={28} />
              </div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                No halls registered yet
              </p>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                Import a CSV file to register halls
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {csvHeaders ? (
                      csvHeaders.map(h => <th key={h}>{h}</th>)
                    ) : (
                      <>
                        <th>Hall Name</th>
                        <th>Rows</th>
                        <th>Columns</th>
                        <th>Benches</th>
                        <th>Capacity</th>
                      </>
                    )}
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {halls.map((h) => (
                    <tr key={h._id}>
                      {csvHeaders ? (
                        csvHeaders.map((col, idx) => (
                          <td key={col} style={idx === 0 ? { fontWeight: 700 } : {}}>
                            {getCellValue(h, col)}
                          </td>
                        ))
                      ) : (
                        <>
                          <td style={{ fontWeight: 700 }}>{h.name}</td>
                          <td>{h.rows}</td>
                          <td>{h.columns}</td>
                          <td>{h.benches}</td>
                          <td>
                            <span className="status-pill info" style={{ fontWeight: 700 }}>
                              {h.capacity}
                            </span>
                          </td>
                        </>
                      )}
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn-icon danger"
                          onClick={() => { if (window.confirm(`Delete "${h.name}"?`)) onDeleteHall(h._id); }}
                          title={`Delete ${h.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default HallManagementView;
