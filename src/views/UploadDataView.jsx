import React, { useState, useRef } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  Trash2, 
  Search, 
  Database,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2
} from 'lucide-react';
import InteractiveLoadingOverlay from '../components/InteractiveLoadingOverlay';

function UploadDataView({ students, uploads, onClear, refreshData, onClearUploadHistory }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [csvTextMode, setCsvTextMode] = useState(false);
  const [manualCsvText, setManualCsvText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  
  const fileInputRef = useRef(null);

  // Get table headers dynamically based on uploaded CSV columns
  const tableHeaders = React.useMemo(() => {
    if (students.length > 0 && students[0].csvData) {
      const keys = Object.keys(students[0].csvData);
      const hasDeptCol = keys.some(k => /dept|depart|branch|course/i.test(k));
      if (!hasDeptCol) {
        const nameIdx = keys.findIndex(k => /name|student/i.test(k));
        const newKeys = [...keys];
        if (nameIdx !== -1) {
          newKeys.splice(nameIdx + 1, 0, 'Department');
        } else {
          newKeys.push('Department');
        }
        return newKeys;
      }
      return keys;
    }
    return ['Register No', 'Name', 'Department', 'Batch'];
  }, [students]);

  // Helper to extract cell values matching dynamic headers with fallback
  const getCellValue = (student, header) => {
    if (header === 'Department') {
      return student.department;
    }
    if (student.csvData && student.csvData[header] !== undefined) {
      return student.csvData[header];
    }
    const headerLower = header.toLowerCase();
    if (headerLower.includes('reg') || headerLower.includes('roll') || headerLower.includes('number') || headerLower.includes('id')) {
      return student.registerNo;
    }
    if (headerLower.includes('name') || headerLower.includes('student')) {
      return student.name;
    }
    if (headerLower.includes('dept') || headerLower.includes('depart') || headerLower.includes('branch') || headerLower.includes('course')) {
      return student.department;
    }
    if (headerLower.includes('batch') || headerLower.includes('year')) {
      return student.batch;
    }
    return student[header] || '';
  };

  // Filter students based on search and department
  const filteredStudents = (students || []).filter(s => {
    if (!s) return false;
    const nameStr = (s.name || '').toLowerCase();
    const regStr = (s.registerNo || '').toLowerCase();
    const deptStr = (s.department || '').toUpperCase();
    const matchesSearch = nameStr.includes(searchQuery.toLowerCase()) || regStr.includes(searchQuery.toLowerCase());
    const matchesDept = deptFilter === 'ALL' || deptStr === deptFilter.toUpperCase();
    return matchesSearch && matchesDept;
  });

  const ROWS_TO_SHOW = 5;
  const displayedStudents = isTableExpanded ? filteredStudents : filteredStudents.slice(0, ROWS_TO_SHOW);
  const hasMoreRows = filteredStudents.length > ROWS_TO_SHOW;

  // Get list of unique departments for filter dropdown
  const departments = ['ALL', ...new Set((students || []).map(s => {
    if (!s) return '';
    if (s.department && s.department.toUpperCase() !== 'GENERAL' && s.department.toUpperCase() !== 'UNKNOWN') {
      return s.department.toUpperCase();
    }
    const regMatch = (s.registerNo || '').match(/^([A-Z]{2,6})\d+/);
    return regMatch ? regMatch[1].toUpperCase() : (s.department ? s.department.toUpperCase() : '');
  }).filter(Boolean))];

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
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
        alert("Only CSV and Excel files (.csv, .xlsx, .xls) are supported.");
      }
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile && !manualCsvText) return;
    setIsUploading(true);
    setUploadSuccess(false);
    setUploadError(null);

    try {
      if (csvTextMode) {
        if (!manualCsvText.trim()) {
          setUploadError("Please enter CSV text first.");
          return;
        }
        const response = await fetch('http://localhost:5000/api/students/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ csvText: manualCsvText })
        });
        const data = await response.json();
        if (data.success) {
          setUploadSuccess(true);
          if (refreshData) await refreshData(true);
          setTimeout(() => {
            setManualCsvText('');
            setIsUploading(false);
            setUploadSuccess(false);
          }, 700);
        } else {
          setUploadError(data.message || "Upload failed. Please check CSV format.");
        }
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const response = await fetch('http://localhost:5000/api/students/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        if (data.success) {
          setUploadSuccess(true);
          if (refreshData) await refreshData(true);
          setTimeout(() => {
            setSelectedFile(null);
            setIsUploading(false);
            setUploadSuccess(false);
          }, 700);
        } else {
          setUploadError(data.message || "Upload failed. Please check spreadsheet format.");
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      setUploadError("An error occurred during upload. Please check server connection.");
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (refreshData) await refreshData(true);
    } finally {
      setTimeout(() => setIsRefreshing(false), 450);
    }
  };

  const handleClearWithFeedback = async () => {
    setIsClearing(true);
    try {
      if (onClear) await onClear();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <InteractiveLoadingOverlay
        isOpen={isUploading}
        title="Uploading Student Data"
        subtitle={csvTextMode ? "Importing pasted CSV student records..." : (selectedFile ? `Processing file: ${selectedFile.name}` : "Importing student records...")}
        steps={[
          "Validating student spreadsheet / CSV structure...",
          "Parsing student names, register numbers & departments...",
          "Validating records & saving to database...",
          "Rendering updated student roster table..."
        ]}
        icon={UploadCloud}
        isSuccess={uploadSuccess}
        successMessage="Student records imported successfully!"
        errorMessage={uploadError}
        onDismissError={() => {
          setUploadError(null);
          setIsUploading(false);
        }}
      />

      <div className="page-intro">
        <h2>Upload Student Data</h2>
        <p>Import student rosters, enrollment details and departments securely.</p>
      </div>

      {/* 1. File Upload Box (Top - Small & Compact) */}
      <div className="card-container">
        <div className="card-title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.1), rgba(139,92,246,0.06))',
              border: '1px solid rgba(79,70,229,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary)',
            }}>
              <UploadCloud size={15} />
            </div>
            <h3>Import Roster</h3>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="form-group">
              <label>Paste CSV Contents (Register No, Name, Department)</label>
              <textarea
                rows={3}
                placeholder="RegisterNo, Student Name, Department"
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
                {isUploading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={14} className="btn-spinner" /> Importing...
                  </span>
                ) : 'Import CSV Text'}
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
              onClick={onButtonClick}
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
                <p>Upload CSV or Excel file containing student information for automatic processing.</p>
              </div>
              <button 
                className="btn-primary" 
                type="button"
                onClick={(e) => { e.stopPropagation(); onButtonClick(); }}
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
                  fontWeight: 600, fontSize: '13px', color: 'var(--color-primary)',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <FileSpreadsheet size={16} />
                  <span style={{ flex: 1 }}>Selected: {selectedFile.name}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 'bold' }}
                  >✕</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn-primary" onClick={handleUploadSubmit} disabled={isUploading}>
                    {isUploading ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <Loader2 size={14} className="btn-spinner" /> Uploading Dataset...
                      </span>
                    ) : 'Confirm Upload'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 2. Student Records Table (comes above Upload History) */}
      <div className="card-container">
        <div className="card-title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(6,182,212,0.1), rgba(14,165,233,0.06))',
              border: '1px solid rgba(6,182,212,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0ea5e9',
            }}>
              <Database size={15} />
            </div>
            <h3>Student Records</h3>
            {students.length > 0 && (
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 9px',
                borderRadius: '9999px', background: 'rgba(6,182,212,0.08)',
                color: '#0ea5e9', border: '1px solid rgba(6,182,212,0.2)',
              }}>
                {students.length} records
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-icon" onClick={handleManualRefresh} title="Refresh Records" disabled={isRefreshing}>
              <RefreshCw size={14} className={isRefreshing ? "btn-spinner" : ""} />
            </button>
            <button 
              className="btn-danger" 
              onClick={handleClearWithFeedback} 
              disabled={students.length === 0 || isClearing}
              style={{ padding: '7px 14px', fontSize: '13px' }}
            >
              {isClearing ? <Loader2 size={13} className="btn-spinner" /> : <Trash2 size={13} />}
              {isClearing ? 'Clearing...' : 'Clear Database'}
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: '10px',
            background: 'var(--bg-app)', border: '1.5px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', padding: '9px 14px',
            transition: 'border-color 0.15s',
          }}
          onFocusCapture={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--border-focus-glow)'; }}
          onBlurCapture={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input 
              type="text" 
              placeholder="Search by name or register number…" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ border: 'none', background: 'none', outline: 'none', fontSize: '13.5px', color: 'var(--text-primary)', width: '100%', fontFamily: 'var(--font-primary)' }}
            />
          </div>
          <div className="form-group" style={{ width: '170px', margin: 0 }}>
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              {departments.map(d => <option key={d} value={d}>Dept: {d}</option>)}
            </select>
          </div>
        </div>

        {/* Students Table */}
        <div className="table-wrapper table-wrapper-scrollable">
          <table className="data-table sticky-header-table">
            <thead>
              <tr>
                <th>#</th>
                {tableHeaders.map((header) => <th key={header} style={{ whiteSpace: 'nowrap' }}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={tableHeaders.length + 1} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                    {students.length === 0 ? 'No student records uploaded yet.' : 'No records match your search filters.'}
                  </td>
                </tr>
              ) : (
                displayedStudents.map((s, rowIndex) => (
                  <tr key={`${s._id || s.registerNo || 'std'}-${rowIndex}`}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 500 }}>{rowIndex + 1}</td>
                    {tableHeaders.map((header, index) => {
                      const value = getCellValue(s, header);
                      const isFirst = index === 0;
                      const headerLower = header.toLowerCase();
                      const isDept = headerLower.includes('dept') || headerLower.includes('depart') || headerLower.includes('branch') || headerLower.includes('course') || headerLower.includes('subject');
                      const isBatch = headerLower.includes('batch') || headerLower.includes('year');
                      return (
                        <td key={header} style={{ ...(isFirst ? { fontWeight: 600 } : isBatch ? { color: 'var(--text-secondary)' } : {}), whiteSpace: 'nowrap' }}>
                          {isDept ? <span className="status-pill info">{value}</span> : value}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span>Showing {displayedStudents.length} of {filteredStudents.length} students{filteredStudents.length !== students.length ? ` (${students.length} total)` : ''}</span>
          {hasMoreRows && (
            <button
              onClick={() => setIsTableExpanded(!isTableExpanded)}
              className="btn-secondary"
              style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isTableExpanded ? (
                <><ChevronUp size={14} /> View Less</>
              ) : (
                <><ChevronDown size={14} /> View More ({filteredStudents.length - ROWS_TO_SHOW} more)</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 3. Upload History Panel (Bottom) */}
      <div className="card-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="card-title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(5,150,105,0.06))',
              border: '1px solid rgba(16,185,129,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-success)',
            }}>
              <Database size={15} />
            </div>
            <h3>Upload History</h3>
            {uploads.length > 0 && (
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 9px',
                borderRadius: '9999px', background: 'rgba(16,185,129,0.08)',
                color: 'var(--color-success)', border: '1px solid rgba(16,185,129,0.2)',
              }}>
                {uploads.length} logs
              </span>
            )}
          </div>
          {uploads && uploads.length > 0 && (
            <button 
              onClick={onClearUploadHistory}
              style={{
                background: 'none', border: '1px solid var(--border-color)',
                color: 'var(--color-error)', fontSize: '12px', fontWeight: 700,
                cursor: 'pointer', padding: '5px 12px', borderRadius: '8px',
                display: 'flex', alignItems: 'center', gap: '5px',
                transition: 'all 0.15s', fontFamily: 'var(--font-primary)',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-error-bg)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              <Trash2 size={12} />
              Clear History
            </button>
          )}
        </div>

        <div className="activity-list" style={{ flex: 1, overflowY: 'auto', maxHeight: '280px' }}>
          {uploads.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--bg-app)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UploadCloud size={20} style={{ opacity: 0.4 }} />
              </div>
              <p style={{ fontSize: '13px', margin: 0, fontWeight: 600 }}>No upload history yet</p>
              <p style={{ fontSize: '12px', margin: 0 }}>Upload a file to see logs here.</p>
            </div>
          ) : (
            uploads.map((log, index) => (
              <div className="activity-item" key={`${log._id || log.id || 'log'}-${index}`}>
                <div 
                  className="activity-dot" 
                  style={{ backgroundColor: log.status === 'SUCCESS' ? 'var(--color-success)' : 'var(--color-error)' }} 
                />
                <div className="activity-content">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="activity-title" style={{ wordBreak: 'break-all', maxWidth: '75%' }}>{log.filename}</span>
                    <span className={`status-pill ${log.status === 'SUCCESS' ? 'success' : 'error'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                      {log.status}
                    </span>
                  </div>
                  {log.status === 'SUCCESS' ? (
                    <span className="activity-desc">Imported {log.recordCount} records</span>
                  ) : (
                    <span className="activity-desc" style={{ color: 'var(--color-error)' }}>{log.errorMessage}</span>
                  )}
                  <span className="activity-time">
                    {new Date(log.uploadedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default UploadDataView;

