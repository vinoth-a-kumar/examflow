import React, { useState, useRef } from 'react';
import { 
  Building2, 
  Armchair, 
  LayoutGrid, 
  Trash2,
  UploadCloud,
  RefreshCw,
  Database
} from 'lucide-react';

function HallManagementView({ halls, onDeleteHall, refreshData, onClear }) {
  // ── CSV Upload state ──────────────────────────────────────────────
  const [dragActive, setDragActive]     = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading]   = useState(false);
  const [csvTextMode, setCsvTextMode]   = useState(false);
  const [manualCsvText, setManualCsvText] = useState('');
  const fileInputRef = useRef(null);

  // ── Derived stats ─────────────────────────────────────────────────
  const totalHallsCount = halls.length;
  const totalCapacity   = halls.reduce((sum, h) => sum + h.capacity, 0);
  const avgBenches      = totalHallsCount > 0
    ? Math.round(halls.reduce((sum, h) => sum + h.benches, 0) / totalHallsCount)
    : 0;

  // ── Dynamic table headers (from csvData, like students) ───────────
  const csvHeaders = React.useMemo(() => {
    const hallWithData = halls.find(h => h.csvData);
    if (hallWithData) return Object.keys(hallWithData.csvData);
    return null;
  }, [halls]);

  // Computed columns always appended after csvData columns
  const computedCols = ['Benches', 'Capacity'];

  // Get a cell value for a given hall and header
  const getCellValue = (hall, header) => {
    if (hall.csvData && hall.csvData[header] !== undefined) return hall.csvData[header];
    const h = header.toLowerCase();
    if (h.includes('hall') || h.includes('name') || h.includes('room') || h.includes('block')) return hall.name;
    if (h.includes('row')) return hall.rows;
    if (h.includes('col')) return hall.columns;
    if (h.includes('bench')) return hall.benches;
    if (h.includes('capacity')) return hall.capacity;
    return hall[header] || '';
  };

  // ── CSV Upload handlers ───────────────────────────────────────────
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
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
        if (!manualCsvText.trim()) {
          alert('Please enter CSV text first.');
          setIsUploading(false);
          return;
        }
        const response = await fetch('http://localhost:5000/api/halls/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText: manualCsvText })
        });
        const data = await response.json();
        if (data.success) {
          alert(data.message);
          setManualCsvText('');
          refreshData();
        } else {
          alert('Upload failed: ' + data.message);
        }
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const response = await fetch('http://localhost:5000/api/halls/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        if (data.success) {
          alert(data.message);
          setSelectedFile(null);
          refreshData();
        } else {
          alert('Upload failed: ' + data.message);
        }
      }
    } catch (error) {
      console.error('Hall upload error:', error);
      alert('An error occurred during upload.');
    } finally {
      setIsUploading(false);
    }
  };



  // ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Page header */}
      <div className="page-intro">
        <h2>Hall Management</h2>
        <p>Configure examination halls and seating capacities.</p>
      </div>

      {/* Metrics widgets */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-card-icon"><Building2 /></div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalHallsCount}</span>
            <span className="stat-card-label">Total Halls</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><Armchair /></div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalCapacity}</span>
            <span className="stat-card-label">Total Capacity</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><LayoutGrid /></div>
          <div className="stat-card-info">
            <span className="stat-card-number">{avgBenches}</span>
            <span className="stat-card-label">Avg Benches/Hall</span>
          </div>
        </div>
      </div>

      {/* Two-column layout: Upload | Hall list */}
      <div className="sections-grid">

        {/* ── LEFT: CSV Uploader ───────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card-container">
            <div className="card-title-bar">
              <h3>Import Halls via CSV</h3>
              <button
                className="btn-secondary"
                onClick={() => setCsvTextMode(!csvTextMode)}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                {csvTextMode ? 'Switch to File Upload' : 'Switch to Paste CSV Text'}
              </button>
            </div>

            {csvTextMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-group">
                  <label>Paste CSV Contents (Format: Hall Name, Rows, Columns)</label>
                  <textarea
                    rows={6}
                    placeholder={`Hall Name,Rows,Columns\nBlock A,8,5\nBlock B,6,4\nSeminar Hall,10,6`}
                    value={manualCsvText}
                    onChange={(e) => setManualCsvText(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      resize: 'vertical'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn-primary"
                    onClick={handleUploadSubmit}
                    disabled={isUploading || !manualCsvText.trim()}
                  >
                    {isUploading ? 'Uploading...' : 'Import CSV Text'}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="uploader-box"
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={onBrowseClick}
                style={{ borderColor: dragActive ? 'var(--color-primary)' : 'rgba(59,130,246,0.4)' }}
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
                  <h4>Drag &amp; Drop Files Here</h4>
                  <p>Upload a CSV file containing hall details for automatic processing.</p>
                </div>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onBrowseClick(); }}
                >
                  Browse Files
                </button>
                <span className="uploader-file-info">
                  Supported formats: CSV, Excel (.xlsx, .xls) &nbsp;·&nbsp; Max 50 MB
                </span>

                {selectedFile && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 16px',
                    backgroundColor: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 600,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '16px' }}>✓</span>
                    <span>Selected: {selectedFile.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                      style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 'bold', padding: '0 4px' }}
                    >✕</button>
                  </div>
                )}
              </div>
            )}

            {selectedFile && !csvTextMode && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" onClick={handleUploadSubmit} disabled={isUploading}>
                  {isUploading ? 'Uploading...' : 'Confirm Upload'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Hall Database ─────────────────────────────── */}
        <div className="card-container">
          <div className="card-title-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={18} style={{ color: 'var(--text-secondary)' }} />
              <h3>Hall Records</h3>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-secondary" onClick={refreshData} title="Refresh">
                <RefreshCw size={14} />
              </button>
              <button 
                className="btn-danger" 
                onClick={onClear} 
                disabled={halls.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Trash2 size={14} />
                <span>Clear Database</span>
              </button>
            </div>
          </div>

          {halls.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '48px 24px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              gap: '12px'
            }}>
              <span style={{ fontSize: '32px' }}>🏢</span>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 500 }}>
                No halls registered yet. Upload a CSV file to get started.
              </p>
            </div>
          ) : (
            <>
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
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {halls.map((h) => (
                      <tr key={h._id}>
                        {csvHeaders ? (
                          csvHeaders.map((col, idx) => (
                            <td key={col} style={idx === 0 ? { fontWeight: 600 } : {}}>
                              {getCellValue(h, col)}
                            </td>
                          ))
                        ) : (
                          <>
                            <td style={{ fontWeight: 600 }}>{h.name}</td>
                            <td>{h.rows}</td>
                            <td>{h.columns}</td>
                            <td>{h.benches}</td>
                            <td><span className="status-pill info" style={{ fontWeight: 700 }}>{h.capacity}</span></td>
                          </>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-danger"
                            onClick={() => {
                              if (window.confirm(`Delete ${h.name}?`)) onDeleteHall(h._id);
                            }}
                            style={{ padding: '6px', borderRadius: '50%', boxShadow: 'none' }}
                            title="Delete Hall"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                {halls.length} hall{halls.length !== 1 ? 's' : ''} registered
              </div>
            </>
          )}
        </div>
      </div>


    </div>
  );
}

export default HallManagementView;
