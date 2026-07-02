import React, { useState, useRef } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  Trash2, 
  Search, 
  Database,
  RefreshCw
} from 'lucide-react';

function UploadDataView({ students, uploads, onUpload, onClear, refreshData, onClearUploadHistory }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [csvTextMode, setCsvTextMode] = useState(false);
  const [manualCsvText, setManualCsvText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  
  const fileInputRef = useRef(null);

  // Get table headers dynamically based on uploaded CSV columns
  const tableHeaders = React.useMemo(() => {
    if (students.length > 0 && students[0].csvData) {
      return Object.keys(students[0].csvData);
    }
    return ['Register No', 'Name', 'Department', 'Batch'];
  }, [students]);

  // Helper to extract cell values matching dynamic headers with fallback
  const getCellValue = (student, header) => {
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
    if (headerLower.includes('dept') || headerLower.includes('depart') || headerLower.includes('branch') || headerLower.includes('course') || headerLower.includes('subject')) {
      return student.department;
    }
    if (headerLower.includes('batch') || headerLower.includes('year')) {
      return student.batch;
    }
    return student[header] || '';
  };

  // Filter students based on search and department
  const filteredStudents = students.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          s.registerNo.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = deptFilter === 'ALL' || s.department.toUpperCase() === deptFilter.toUpperCase();
    return matchesSearch && matchesDept;
  });

  // Get list of unique departments for filter dropdown
  const departments = ['ALL', ...new Set(students.map(s => s.department.toUpperCase()))];

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

    try {
      const formData = new FormData();
      if (csvTextMode) {
        if (!manualCsvText.trim()) {
          alert("Please enter CSV text first.");
          setIsUploading(false);
          return;
        }
        // Send as raw text in body
        const response = await fetch('http://localhost:5000/api/students/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ csvText: manualCsvText })
        });
        const data = await response.json();
        if (data.success) {
          alert(data.message);
          setManualCsvText('');
          refreshData();
        } else {
          alert("Upload failed: " + data.message);
        }
      } else {
        // Send as multipart file upload
        formData.append('file', selectedFile);
        const response = await fetch('http://localhost:5000/api/students/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        if (data.success) {
          alert(data.message);
          setSelectedFile(null);
          refreshData();
        } else {
          alert("Upload failed: " + data.message);
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("An error occurred during upload.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Upload Student Data</h2>
        <p>Import student rosters, enrollment details and departments securely.</p>
      </div>

      <div className="sections-grid">
        {/* Left Side: Uploader & Database Browser */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* File Upload Box */}
          <div className="card-container">
            <div className="card-title-bar">
              <h3>Import Roster</h3>
              <button 
                className="btn-secondary" 
                onClick={() => setCsvTextMode(!csvTextMode)}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                {csvTextMode ? "Switch to File Upload" : "Switch to Paste CSV Text"}
              </button>
            </div>

            {csvTextMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-group">
                  <label>Paste CSV Contents (Format: Register No, Name, Department)</label>
                  <textarea
                    rows={6}
                    placeholder="2024CSE001, John Smith, CSE&#10;2024IT045, Jane Doe, IT&#10;2024ECE012, Alex Jones, ECE"
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button 
                    className="btn-primary" 
                    onClick={handleUploadSubmit}
                    disabled={isUploading || !manualCsvText.trim()}
                  >
                    {isUploading ? "Uploading..." : "Import CSV Text"}
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
                onClick={onButtonClick}
                style={{ borderColor: dragActive ? 'var(--color-primary)' : 'rgba(59, 130, 246, 0.4)' }}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  accept=".csv,.xlsx,.xls"
                />

                <div className="uploader-icon">
                  <UploadCloud />
                </div>

                <div className="uploader-text">
                  <h4>Drag & Drop Files Here</h4>
                  <p>Upload CSV files containing student information for automatic processing.</p>
                </div>

                <button 
                  className="btn-primary" 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onButtonClick();
                  }}
                >
                  Browse Files
                </button>

                <span className="uploader-file-info">
                  Supported formats: CSV, Excel (.xlsx, .xls) &nbsp;·&nbsp; Maximum file size: 50 MB
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
                    <FileSpreadsheet size={16} />
                    <span>Selected: {selectedFile.name}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--color-error)', 
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        padding: '0 4px'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {selectedFile && !csvTextMode && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  className="btn-primary" 
                  onClick={handleUploadSubmit}
                  disabled={isUploading}
                >
                  {isUploading ? "Uploading..." : "Confirm Upload"}
                </button>
              </div>
            )}
          </div>

          {/* Student Database Browser */}
          <div className="card-container">
            <div className="card-title-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Database size={18} style={{ color: 'var(--text-secondary)' }} />
                <h3>Student Records Database</h3>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-secondary" onClick={refreshData} title="Refresh Records">
                  <RefreshCw size={14} />
                </button>
                <button 
                  className="btn-danger" 
                  onClick={onClear} 
                  disabled={students.length === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Trash2 size={14} />
                  <span>Clear Database</span>
                </button>
              </div>
            </div>

            {/* Search and Filters */}
            <div style={{ display: 'flex', gap: '16px' }}>
              <div className="header-search" style={{ flex: 1, width: 'auto' }}>
                <Search size={16} style={{ top: '50%' }} />
                <input 
                  type="text" 
                  placeholder="Search students by name or roll number..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ borderRadius: 'var(--radius-md)' }}
                />
              </div>

              <div className="form-group" style={{ width: '180px' }}>
                <select 
                  value={deptFilter} 
                  onChange={(e) => setDeptFilter(e.target.value)}
                  style={{ height: '100%' }}
                >
                  {departments.map(d => (
                    <option key={d} value={d}>Dept: {d}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Students Table */}
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {tableHeaders.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={tableHeaders.length} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                        {students.length === 0 ? "No student records uploaded yet." : "No records match search filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((s) => (
                      <tr key={s._id || s.registerNo}>
                        {tableHeaders.map((header, index) => {
                          const value = getCellValue(s, header);
                          const isFirst = index === 0;
                          const headerLower = header.toLowerCase();
                          const isDept = headerLower.includes('dept') || headerLower.includes('depart') || headerLower.includes('branch') || headerLower.includes('course') || headerLower.includes('subject');
                          const isBatch = headerLower.includes('batch') || headerLower.includes('year');

                          return (
                            <td 
                              key={header} 
                              style={isFirst ? { fontWeight: 600 } : isBatch ? { color: 'var(--text-secondary)' } : {}}
                            >
                              {isDept ? (
                                <span className="status-pill info">{value}</span>
                              ) : (
                                value
                              )}
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
              <span>Showing {filteredStudents.length} of {students.length} students</span>
            </div>
          </div>
        </div>

        {/* Right Side: Upload History Panel */}
        <div className="card-container" style={{ height: 'fit-content' }}>
          <div className="card-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Upload History</h3>
            {uploads && uploads.length > 0 && (
              <button 
                onClick={onClearUploadHistory}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-error)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = 'var(--color-error-bg)'}
                onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                Clear History
              </button>
            )}
          </div>

          <div className="activity-list">
            {uploads.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: '14px' }}>
                No history logs yet.
              </p>
            ) : (
              uploads.map((log) => (
                <div className="activity-item" key={log._id}>
                  <div 
                    className="activity-dot" 
                    style={{ backgroundColor: log.status === 'SUCCESS' ? 'var(--color-success)' : 'var(--color-error)' }} 
                  />
                  <div className="activity-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="activity-title" style={{ fontSize: '13px', wordBreak: 'break-all', maxWidth: '75%' }}>{log.filename}</span>
                      <span className={`status-pill ${log.status === 'SUCCESS' ? 'success' : 'error'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                        {log.status}
                      </span>
                    </div>
                    {log.status === 'SUCCESS' ? (
                      <span className="activity-desc" style={{ fontSize: '11px' }}>Imported {log.recordCount} Records</span>
                    ) : (
                      <span className="activity-desc" style={{ fontSize: '11px', color: 'var(--color-error)' }}>{log.errorMessage}</span>
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
    </div>
  );
}

export default UploadDataView;
