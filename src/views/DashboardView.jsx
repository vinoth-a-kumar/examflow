import React, { useState } from 'react';
import { 
  Users, 
  Building2, 
  Armchair, 
  CalendarDays, 
  GraduationCap,
  History,
  Edit2,
  X,
  Printer
} from 'lucide-react';

function DashboardView({ stats, activities, setTab, onUpdateHall, onClearActivities }) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingHall, setEditingHall] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRows, setEditRows] = useState(8);
  const [editCols, setEditCols] = useState(5);
  const [activeDept, setActiveDept] = useState(null);

  const {
    totalStudents = 0,
    totalHalls = 0,
    totalCapacity = 0,
    totalExams = 0,
    departmentsCount = 0,
    departmentDistribution = [],
    hallsData = [],
    printoutsCount = 0
  } = stats || {};

  // Custom SVG Donut Chart Calculation
  const totalStudentsInDist = departmentDistribution.reduce((sum, d) => sum + d.count, 0);
  
  // Colors for departments
  const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

  let accumulatedPercentage = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Dashboard Overview</h2>
        <p>Here's the current status of the examination infrastructure.</p>
      </div>

      {/* Metrics Row */}
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-card-icon">
            <Users />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalStudents}</span>
            <span className="stat-card-label">Total Students</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <Building2 />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalHalls}</span>
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
            <CalendarDays />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalExams}</span>
            <span className="stat-card-label">Total Exams</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <GraduationCap />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{departmentsCount}</span>
            <span className="stat-card-label">Departments</span>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="sections-grid">

        {/* Department Distribution (Donut) */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Department Distribution</h3>
          </div>

          {departmentDistribution.length === 0 ? (
            <div className="donut-chart-container">
              <div className="donut-svg-wrapper">
                <svg width="100%" height="100%" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--border-color)" strokeWidth="4" />
                </svg>
                <div className="donut-center-text">
                  <span className="donut-center-num">0</span>
                  <span className="donut-center-lbl">Students</span>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Upload student rosters to see distribution.</p>
            </div>
          ) : (
            <div className="donut-chart-container">
              <div className="donut-svg-wrapper">
                <svg width="100%" height="100%" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="var(--border-color)" strokeWidth="4" />
                  
                  {departmentDistribution.map((dept, idx) => {
                    const percentage = (dept.count / totalStudentsInDist) * 100;
                    const strokeDasharray = `${percentage} ${100 - percentage}`;
                    const strokeDashoffset = 100 - accumulatedPercentage + 25; // start from top (12 o'clock)
                    accumulatedPercentage += percentage;

                    return (
                      <circle
                        key={dept.department}
                        cx="21"
                        cy="21"
                        r="15.915"
                        fill="transparent"
                        stroke={colors[idx % colors.length]}
                        strokeWidth="4"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                      />
                    );
                  })}
                </svg>
                <div className="donut-center-text">
                  <span className="donut-center-num">{totalStudents}</span>
                  <span className="donut-center-lbl">Students</span>
                </div>
              </div>

              {/* Legends */}
              <div className="chart-legend">
                {departmentDistribution.map((dept, idx) => (
                  <div className="legend-item" key={dept.department}>
                    <div className="legend-label">
                      <div className="legend-dot" style={{ backgroundColor: colors[idx % colors.length] }} />
                      <span>{dept.department}</span>
                    </div>
                    <span className="legend-val">{dept.count} ({dept.percentage}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activities */}
      <div className="card-container recent-activities-card">
        <div className="card-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3>Recent Activities</h3>
          </div>
          {activities && activities.length > 0 && (
            <button 
              onClick={onClearActivities}
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
          {activities.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', padding: '20px 0' }}>
              No recent activities.
            </p>
          ) : (
            activities.slice(0, 5).map((act) => {
              // Map colors based on activity type
              let dotColor = '#94a3b8'; // gray
              if (act.type === 'student') dotColor = 'var(--color-primary)';
              if (act.type === 'hall') dotColor = 'var(--color-success)';
              if (act.type === 'exam') dotColor = 'var(--color-draft)';

              return (
                <div className="activity-item" key={act.id}>
                  <div className="activity-dot" style={{ backgroundColor: dotColor }} />
                  <div className="activity-content">
                    <span className="activity-title">{act.message}</span>
                    <span className="activity-desc">{act.detail}</span>
                    <span className="activity-time">
                      {new Date(act.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button className="view-all-btn" onClick={() => setTab('upload')}>
          View All History
        </button>
      </div>

      {/* Hall Seating Allocation Status */}
      <div className="card-container" style={{ gridColumn: 'span 2' }}>
        <div className="card-title-bar">
          <h3>Hall Seating Status & Capacity</h3>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hall Name</th>
                <th>Seated Students</th>
                <th>Total Capacity</th>
                <th>Available Seats</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {hallsData.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No halls registered yet. Go to Hall Management to add.
                  </td>
                </tr>
              ) : (
                hallsData.map((hall) => (
                  <tr key={hall._id}>
                    <td style={{ fontWeight: 600 }}>{hall.name}</td>
                    <td>{hall.seatedStudents}</td>
                    <td>{hall.capacity}</td>
                    <td>
                      <span className={`status-pill ${hall.remainingSeats > 0 ? 'success' : 'draft'}`} style={{ fontWeight: 700 }}>
                        {hall.remainingSeats} Available
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        className="btn-secondary" 
                        onClick={() => {
                          setEditingHall(hall);
                          setEditName(hall.name);
                          setEditRows(hall.rows);
                          setEditCols(hall.columns);
                          setEditModalOpen(true);
                        }}
                        style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Edit2 size={12} />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Hall Modal */}
      {editModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '480px' }}>
            <div className="modal-header">
              <h3>Edit Hall Configuration</h3>
              <button className="modal-close" onClick={() => setEditModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!editName.trim()) {
                alert("Hall Name is required.");
                return;
              }
              if (editRows <= 0 || editCols <= 0) {
                alert("Rows and Columns must be greater than 0.");
                return;
              }
              await onUpdateHall(editingHall._id, {
                name: editName,
                rows: parseInt(editRows),
                columns: parseInt(editCols)
              });
              setEditModalOpen(false);
            }}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="editName">Hall Name</label>
                  <input 
                    type="text" 
                    id="editName" 
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="editRows">Rows</label>
                    <input 
                      type="number" 
                      id="editRows" 
                      min="1" 
                      max="30"
                      value={editRows}
                      onChange={(e) => setEditRows(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="editCols">Columns</label>
                    <input 
                      type="number" 
                      id="editCols" 
                      min="1" 
                      max="20"
                      value={editCols}
                      onChange={(e) => setEditCols(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Total Capacity: <strong style={{ color: 'var(--color-primary)' }}>{parseInt(editRows || 0) * parseInt(editCols || 0) * 2} Seats</strong> ({parseInt(editRows || 0) * parseInt(editCols || 0)} Benches)
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setEditModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardView;
