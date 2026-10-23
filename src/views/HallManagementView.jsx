import React, { useState, useRef } from 'react';
import {
  Building2,
  Armchair,
  LayoutGrid,
  Trash2,
  UploadCloud,
  RefreshCw,
  Database,
  Plus,
  Edit2,
  X,
  Search,
  Loader2
} from 'lucide-react';
import InteractiveLoadingOverlay from '../components/InteractiveLoadingOverlay';

function HallManagementView({ halls, onDeleteHall, refreshData, onClear }) {
  const [dragActive,          setDragActive]          = useState(false);
  const [selectedFile,        setSelectedFile]        = useState(null);
  const [isUploading,         setIsUploading]         = useState(false);
  const [uploadSuccess,       setUploadSuccess]       = useState(false);
  const [uploadError,         setUploadError]         = useState(null);
  const [isRefreshing,        setIsRefreshing]        = useState(false);
  const [isClearing,          setIsClearing]          = useState(false);
  const [csvTextMode,         setCsvTextMode]         = useState(false);
  const [manualCsvText,       setManualCsvText]       = useState('');
  const [editingHall,         setEditingHall]         = useState(null);
  const [editFormData,        setEditFormData]        = useState({ name: '', block: '', rows: 0, columns: 0, benches: 0, capacity: 0, seatsPerBench: 2 });
  const [isSaving,            setIsSaving]            = useState(false);
  const [searchQuery,         setSearchQuery]         = useState('');
  const [selectedBlockFilter, setSelectedBlockFilter] = useState('ALL');
  const fileInputRef = useRef(null);

  const uniqueBlocks = React.useMemo(() => {
    const blocksInHalls = (halls || []).map(h => (h.block || '').trim()).filter(Boolean);
    return ['ALL', ...Array.from(new Set(blocksInHalls))];
  }, [halls]);

  const filteredHalls = React.useMemo(() => {
    let result = halls || [];
    if (selectedBlockFilter !== 'ALL') {
      result = result.filter(h => (h.block || '').trim().toUpperCase() === selectedBlockFilter.toUpperCase());
    }
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase().trim();
    return result.filter(h => {
      if (h.name && h.name.toLowerCase().includes(q)) return true;
      if (h.block && h.block.toLowerCase().includes(q)) return true;
      if (h.capacity && String(h.capacity).includes(q)) return true;
      if (h.benches && String(h.benches).includes(q)) return true;
      if (h.csvData && typeof h.csvData === 'object') {
        return Object.values(h.csvData).some(val => String(val).toLowerCase().includes(q));
      }
      return false;
    });
  }, [halls, selectedBlockFilter, searchQuery]);

  const handleStartEdit = (hall) => {
    setEditingHall(hall);
    const benchCount = hall.benches || (hall.rows && hall.columns ? hall.rows * hall.columns : 0);
    const spb = hall.seatsPerBench ? parseInt(hall.seatsPerBench) : 2;
    const cap = benchCount * spb;
    setEditFormData({
      name: hall.name || '',
      block: hall.block || '',
      rows: hall.rows || 0,
      columns: hall.columns || 0,
      benches: benchCount,
      capacity: cap,
      seatsPerBench: spb
    });
  };

  const handleSaveEdit = async () => {
    if (!editingHall) return;
    setIsSaving(true);
    try {
      const targetId = editingHall._id || editingHall.name;
      const spb = parseInt(editFormData.seatsPerBench) || 2;
      const benches = parseInt(editFormData.benches) || 0;
      const cap = (editFormData.capacity !== undefined && editFormData.capacity !== null && !isNaN(parseInt(editFormData.capacity)) && parseInt(editFormData.capacity) > 0)
        ? parseInt(editFormData.capacity)
        : (benches * spb);

      const cols = Math.max(1, parseInt(editFormData.columns) || 1);
      const rows = Math.max(1, parseInt(editFormData.rows) || Math.ceil(benches / cols));

      // Generate columnRows summing exactly to benches
      const baseRow = Math.floor(benches / cols);
      const remBenches = benches % cols;
      const colRows = Array(cols).fill(baseRow);
      for (let i = 0; i < remBenches; i++) colRows[i]++;

      const res = await fetch(`http://localhost:5000/api/halls/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFormData.name,
          block: editFormData.block,
          rows: Math.max(...colRows, rows, 1),
          columns: cols,
          benches: benches,
          capacity: cap,
          columnRows: colRows,
          seatsPerBench: spb
        })
      });
      const data = await res.json();
      if (res.ok) {
        setEditingHall(null);
        if (refreshData) refreshData();
      } else {
        alert('Error updating hall: ' + (data.error || data.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to update hall:', err);
      alert('Failed to update hall.');
    } finally {
      setIsSaving(false);
    }
  };



  const handleQuickToggleSeats = async (hall, newSpb) => {
    const targetId = hall._id || hall.name;
    const benches = hall.benches || (hall.rows && hall.columns ? hall.rows * hall.columns : 0);
    const newCap = benches > 0 ? (benches * newSpb) : (hall.capacity || 0);
    try {
      const res = await fetch(`http://localhost:5000/api/halls/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: hall.name,
          block: hall.block || '',
          rows: hall.rows,
          columns: hall.columns,
          benches: benches,
          capacity: newCap,
          seatsPerBench: newSpb
        })
      });
      if (res.ok) {
        if (refreshData) refreshData();
      } else {
        const err = await res.json();
        alert('Error updating seats: ' + (err.error || err.message));
      }
    } catch (e) {
      console.error('Failed to quick toggle seats:', e);
    }
  };

  const totalHallsCount = (halls || []).length;
  const totalCapacity   = (halls || []).reduce((sum, h) => sum + (h && h.capacity ? h.capacity : 0), 0);
  const avgBenches      = totalHallsCount > 0
    ? Math.round((halls || []).reduce((sum, h) => sum + (h && h.benches ? h.benches : 0), 0) / totalHallsCount)
    : 0;


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
    setUploadSuccess(false);
    setUploadError(null);
    try {
      if (csvTextMode) {
        if (!manualCsvText.trim()) { 
          setUploadError('Please enter CSV text first.'); 
          return; 
        }
        const response = await fetch('http://localhost:5000/api/halls/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvText: manualCsvText, seatsPerBench: 2 }),
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
          setUploadError(data.message || 'Hall upload failed.');
        }
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('seatsPerBench', 2);
        const response = await fetch('http://localhost:5000/api/halls/upload', { method: 'POST', body: formData });
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
          setUploadError(data.message || 'Hall upload failed.');
        }
      }
    } catch (error) {
      console.error('Hall upload error:', error);
      setUploadError('An error occurred during upload. Please check connection.');
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

  const STAT_STYLES = [
    { color: 'rgba(79,70,229,0.12)',   colorEnd: 'rgba(139,92,246,0.08)', iconColor: '#4f46e5',  shadow: 'rgba(79,70,229,0.15)'  },
    { color: 'rgba(6,182,212,0.1)',    colorEnd: 'rgba(14,165,233,0.06)', iconColor: '#0ea5e9',  shadow: 'rgba(6,182,212,0.15)'  },
    { color: 'rgba(245,158,11,0.1)',   colorEnd: 'rgba(217,119,6,0.06)',  iconColor: '#d97706',  shadow: 'rgba(245,158,11,0.15)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <InteractiveLoadingOverlay
        isOpen={isUploading}
        title="Uploading Examination Halls"
        subtitle={csvTextMode ? "Importing pasted CSV hall data..." : (selectedFile ? `Processing file: ${selectedFile.name}` : "Importing halls...")}
        steps={[
          "Validating examination hall file structure...",
          "Calculating rows, columns and bench configurations...",
          "Writing hall capacities & layouts to database...",
          "Rendering live hall inventory cards..."
        ]}
        icon={Building2}
        isSuccess={uploadSuccess}
        successMessage="Examination halls uploaded successfully!"
        errorMessage={uploadError}
        onDismissError={() => {
          setUploadError(null);
          setIsUploading(false);
        }}
      />

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
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => setCsvTextMode(!csvTextMode)}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  {csvTextMode ? '📁 File Upload' : '📋 Paste CSV'}
                </button>
              </div>
            </div>

            {csvTextMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label>Paste CSV Contents (Hall Name, Rows, Columns)</label>
                  <textarea
                    rows={6}
                    placeholder={`Hall Name,Rows,Columns`}
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
                        {isUploading ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Loader2 size={14} className="btn-spinner" /> Uploading Halls...
                          </span>
                        ) : 'Confirm Upload'}
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
{`Hall Name,Rows,Columns`}
            </pre>
          </div>
        </div>

        {/* RIGHT — Hall Records Table */}
        <div className="card-container hall-records-card">
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
                  {filteredHalls.length !== halls.length ? `${filteredHalls.length} / ${halls.length}` : halls.length} hall{halls.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-icon" onClick={handleManualRefresh} title="Refresh" disabled={isRefreshing}>
                <RefreshCw size={14} className={isRefreshing ? "btn-spinner" : ""} />
              </button>
              <button
                className="btn-danger"
                onClick={handleClearWithFeedback}
                disabled={halls.length === 0 || isClearing}
                style={{ padding: '7px 14px', fontSize: '13px' }}
              >
                {isClearing ? <Loader2 size={13} className="btn-spinner" /> : <Trash2 size={13} />}
                {isClearing ? 'Clearing...' : 'Clear All'}
              </button>
            </div>
          </div>

          {halls.length > 0 && (
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search hall name, capacity..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-control"
                style={{ paddingLeft: '34px', paddingRight: searchQuery ? '30px' : '12px', fontSize: '13px', height: '36px' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {halls.length > 0 && uniqueBlocks.length > 2 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Block:
              </span>
              {uniqueBlocks.map(block => {
                const isActive = selectedBlockFilter.toUpperCase() === block.toUpperCase();
                const count = block === 'ALL'
                  ? halls.length
                  : halls.filter(h => (h.block || '').trim().toUpperCase() === block.toUpperCase()).length;
                return (
                  <button
                    key={block}
                    type="button"
                    onClick={() => setSelectedBlockFilter(block)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      fontWeight: isActive ? 700 : 500,
                      border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                      background: isActive ? 'rgba(79,70,229,0.1)' : 'var(--bg-app)',
                      color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {block} <span style={{ opacity: 0.7, fontSize: '10px' }}>({count})</span>
                  </button>
                );
              })}
            </div>
          )}

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
                Import a CSV file or paste CSV records above to register halls
              </p>
            </div>
          ) : filteredHalls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>
              No halls match "{searchQuery}" in {selectedBlockFilter}
            </div>
          ) : (
            <div className="table-wrapper hall-records-table-wrapper">
              <table className="data-table sticky-header-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>#</th>
                    <th>Block</th>
                    <th>Hall No</th>
                    <th>Benches</th>
                    <th>Seats / Bench</th>
                    <th>Capacity</th>
                    <th>Layout</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHalls.map((h, rowIdx) => {
                    const benchCount = h.benches || (h.rows && h.columns ? h.rows * h.columns : 0);
                    const spb = h.seatsPerBench || 2;
                    const capacity = h.capacity !== undefined ? h.capacity : (benchCount * spb);
                    return (
                      <tr key={h._id || h.name}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600 }}>
                          {h.idx || (rowIdx + 1)}
                        </td>
                        <td>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: 'rgba(79,70,229,0.08)',
                            color: 'var(--color-primary)',
                            border: '1px solid rgba(79,70,229,0.15)'
                          }}>
                            {h.block || 'General'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 800, fontSize: '13px', color: 'var(--text-primary)' }}>
                          {h.name}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {benchCount}
                        </td>
                        <td>
                          <div style={{
                            display: 'inline-flex',
                            padding: '2px',
                            background: 'var(--bg-app)',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            gap: '2px'
                          }}>
                            <button
                              type="button"
                              onClick={() => handleQuickToggleSeats(h, 2)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                border: 'none',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                background: spb === 2 ? 'var(--color-primary)' : 'transparent',
                                color: spb === 2 ? '#fff' : 'var(--text-secondary)',
                                boxShadow: spb === 2 ? '0 1px 4px rgba(79,70,229,0.3)' : 'none',
                                transition: 'all 0.15s'
                              }}
                              title="Set 2 seats per bench for this hall"
                            >
                              2 Seats
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickToggleSeats(h, 3)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                border: 'none',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                background: spb === 3 ? '#8b5cf6' : 'transparent',
                                color: spb === 3 ? '#fff' : 'var(--text-secondary)',
                                boxShadow: spb === 3 ? '0 1px 4px rgba(139,92,246,0.3)' : 'none',
                                transition: 'all 0.15s'
                              }}
                              title="Set 3 seats per bench for this hall"
                            >
                              3 Seats
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="status-pill info" style={{ fontWeight: 800 }}>
                            {capacity} Seats
                          </span>
                        </td>
                        <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {h.columnRows && h.columnRows.length > 0
                            ? `${h.columns} cols (${h.columnRows.join(', ')} rows)`
                            : `${h.rows}×${h.columns} grid`}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            <button
                              className="btn-icon"
                              onClick={() => handleStartEdit(h)}
                              title={`Edit ${h.name}`}
                              style={{ color: 'var(--color-primary)', background: 'rgba(79,70,229,0.08)' }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              className="btn-icon danger"
                              onClick={() => { if (window.confirm(`Delete "${h.name}"?`)) onDeleteHall(h._id); }}
                              title={`Delete ${h.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* ── Edit Hall Modal ────────────────────────────────────────────── */}
      {editingHall && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)', display: 'flex', flexDirection: 'column', gap: '18px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit2 size={18} style={{ color: 'var(--color-primary)' }} />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Edit Hall Configuration
                </h3>
              </div>
              <button
                onClick={() => setEditingHall(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Block Name</label>
                <input
                  type="text"
                  list="block-suggestions"
                  className="form-control"
                  placeholder="e.g. Main Block, Science Wing..."
                  value={editFormData.block}
                  onChange={(e) => setEditFormData({ ...editFormData, block: e.target.value })}
                />
                <datalist id="block-suggestions">
                  {uniqueBlocks.filter(b => b !== 'ALL').map(b => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Hall Name / Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>
                  Bench Configuration
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const newSpb = 2;
                      const b = parseInt(editFormData.benches) || 0;
                      setEditFormData({
                        ...editFormData,
                        seatsPerBench: newSpb,
                        capacity: b * newSpb
                      });
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: (editFormData.seatsPerBench || 2) === 2 ? '1.5px solid var(--color-primary)' : '1px solid var(--border-color)',
                      background: (editFormData.seatsPerBench || 2) === 2 ? 'rgba(79,70,229,0.1)' : 'var(--bg-app)',
                      color: (editFormData.seatsPerBench || 2) === 2 ? 'var(--color-primary)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    👥 2 Seats / Bench
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const newSpb = 3;
                      const b = parseInt(editFormData.benches) || 0;
                      setEditFormData({
                        ...editFormData,
                        seatsPerBench: newSpb,
                        capacity: b * newSpb
                      });
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: editFormData.seatsPerBench === 3 ? '1.5px solid #8b5cf6' : '1px solid var(--border-color)',
                      background: editFormData.seatsPerBench === 3 ? 'rgba(139,92,246,0.1)' : 'var(--bg-app)',
                      color: editFormData.seatsPerBench === 3 ? '#8b5cf6' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    👥 3 Seats / Bench
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Benches</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={editFormData.benches}
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : parseInt(e.target.value);
                      const b = isNaN(val) || val === '' ? 0 : val;
                      const spb = parseInt(editFormData.seatsPerBench) || 2;
                      const c = b * spb;
                      setEditFormData({
                        ...editFormData,
                        benches: val,
                        capacity: c
                      });
                    }}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>Total Seats / Capacity</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={editFormData.capacity}
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : parseInt(e.target.value);
                      const c = isNaN(val) || val === '' ? 0 : val;
                      const spb = parseInt(editFormData.seatsPerBench) || 2;
                      const b = Math.round(c / spb);
                      setEditFormData({
                        ...editFormData,
                        capacity: val,
                        benches: b
                      });
                    }}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1.5px solid var(--color-primary)', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 700 }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Auto-calculated ({editFormData.seatsPerBench || 2} seats / bench)</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Rows</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={editFormData.rows}
                    onChange={(e) => setEditFormData({ ...editFormData, rows: parseInt(e.target.value) || 1 })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Columns</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={editFormData.columns}
                    onChange={(e) => setEditFormData({ ...editFormData, columns: parseInt(e.target.value) || 1 })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button
                className="btn-secondary"
                onClick={() => setEditingHall(null)}
                disabled={isSaving}
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveEdit}
                disabled={isSaving}
                style={{ padding: '8px 18px', fontSize: '13px' }}
              >
                {isSaving ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={14} className="btn-spinner" /> Saving Layout...
                  </span>
                ) : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default HallManagementView;
