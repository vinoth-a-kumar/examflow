import React, { useState } from 'react';
import { 
  Building2, 
  Armchair, 
  LayoutGrid, 
  Plus, 
  Trash2, 
  X
} from 'lucide-react';

function HallManagementView({ halls, onAddHall, onDeleteHall }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [hallName, setHallName] = useState('');
  const [rows, setRows] = useState(8);
  const [columns, setColumns] = useState(5);

  const totalHallsCount = halls.length;
  const totalCapacity = halls.reduce((sum, h) => sum + h.capacity, 0);
  const avgBenches = totalHallsCount > 0 
    ? Math.round(halls.reduce((sum, h) => sum + h.benches, 0) / totalHallsCount) 
    : 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!hallName.trim()) {
      alert("Hall Name is required.");
      return;
    }
    if (rows <= 0 || columns <= 0) {
      alert("Rows and Columns must be greater than 0.");
      return;
    }

    onAddHall({
      name: hallName,
      rows: parseInt(rows),
      columns: parseInt(columns)
    });

    // Reset and close
    setHallName('');
    setRows(8);
    setColumns(5);
    setModalOpen(false);
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-intro">
          <h2>Hall Management</h2>
          <p>Configure examination halls and seating capacities.</p>
        </div>
        
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          <Plus size={18} />
          <span>Add New Hall</span>
        </button>
      </div>

      {/* Metrics widgets */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-card-icon">
            <Building2 />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalHallsCount}</span>
            <span className="stat-card-label">Total Halls</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <Armchair />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalCapacity}</span>
            <span className="stat-card-label">Total Capacity</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <LayoutGrid />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{avgBenches}</span>
            <span className="stat-card-label">Avg Benches/Hall</span>
          </div>
        </div>
      </div>

      {/* Halls list card */}
      <div className="card-container">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hall Name</th>
                <th>Benches</th>
                <th>Rows</th>
                <th>Columns</th>
                <th>Capacity</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {halls.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                    No halls registered yet. Click "Add New Hall" to configure.
                  </td>
                </tr>
              ) : (
                halls.map((h) => (
                  <tr key={h._id}>
                    <td style={{ fontWeight: 600 }}>{h.name}</td>
                    <td>{h.benches}</td>
                    <td>{h.rows}</td>
                    <td>{h.columns}</td>
                    <td>
                      <span className="status-pill info" style={{ fontWeight: 700 }}>
                        {h.capacity}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                          className="btn-danger" 
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete ${h.name}?`)) {
                              onDeleteHall(h._id);
                            }
                          }}
                          style={{ padding: '6px', borderRadius: '50%', boxShadow: 'none' }}
                          title="Delete Hall"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Hall Modal */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>+ Add New Hall</h3>
              <button className="modal-close" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="hallName">Hall Name / Room Number</label>
                  <input 
                    type="text" 
                    id="hallName" 
                    placeholder="e.g. Hall A, Seminar Hall, Block-II 304"
                    value={hallName}
                    onChange={(e) => setHallName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="rows">Number of Rows</label>
                    <input 
                      type="number" 
                      id="rows" 
                      min="1" 
                      max="30"
                      value={rows}
                      onChange={(e) => setRows(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="columns">Number of Columns</label>
                    <input 
                      type="number" 
                      id="columns" 
                      min="1" 
                      max="20"
                      value={columns}
                      onChange={(e) => setColumns(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ 
                  backgroundColor: 'var(--bg-app)', 
                  padding: '12px 16px', 
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Calculated Benches (Rows × Columns):</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{rows * columns}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total Seating Capacity (2 per Bench):</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>{rows * columns * 2}</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Hall
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default HallManagementView;
