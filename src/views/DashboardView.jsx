import React from 'react';
import { 
  Users, 
  Building2, 
  Armchair, 
  CalendarDays, 
  GraduationCap,
  History
} from 'lucide-react';

function DashboardView({ stats, activities, setTab }) {
  const {
    totalStudents = 0,
    totalHalls = 0,
    totalCapacity = 0,
    totalExams = 0,
    departmentsCount = 0,
    departmentDistribution = []
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
        {/* Hall Capacity Utilization */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Hall Capacity Utilization</h3>
          </div>
          
          <div className="chart-bar-container" style={{ padding: '10px 0' }}>
            {departmentDistribution.length === 0 ? (
              <div className="chart-placeholder">
                <div style={{ textAlign: 'center' }}>
                  <Building2 size={36} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
                  <p>No halls configuration available.</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Go to Hall Management to add exam halls.</p>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {departmentDistribution.map((dept, idx) => (
                  <div className="chart-bar-item" key={dept.department}>
                    <div className="chart-bar-info">
                      <span>{dept.department} Roster Size</span>
                      <span>{dept.count} Students ({dept.percentage}%)</span>
                    </div>
                    <div className="chart-bar-track">
                      <div 
                        className="chart-bar-fill" 
                        style={{ 
                          width: `${dept.percentage}%`, 
                          background: `linear-gradient(90deg, ${colors[idx % colors.length]}80 0%, ${colors[idx % colors.length]} 100%)` 
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#f1f5f9" strokeWidth="4" />
                  
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
        <div className="card-title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3>Recent Activities</h3>
          </div>
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
    </div>
  );
}

export default DashboardView;
