import React from 'react';
import {
  Users,
  Building2,
  Armchair,
  CalendarDays,
  GraduationCap,
  History,
  TrendingUp,
  Trash2
} from 'lucide-react';

// Each stat card gets its own colour scheme
const STAT_STYLES = [
  {
    color: 'rgba(79,70,229,0.12)',
    colorEnd: 'rgba(139,92,246,0.08)',
    iconColor: '#4f46e5',
    shadow: 'rgba(79,70,229,0.15)',
    topGradient: '#4f46e5, #8b5cf6',
  },
  {
    color: 'rgba(16,185,129,0.1)',
    colorEnd: 'rgba(5,150,105,0.06)',
    iconColor: '#059669',
    shadow: 'rgba(16,185,129,0.15)',
    topGradient: '#10b981, #059669',
  },
  {
    color: 'rgba(6,182,212,0.1)',
    colorEnd: 'rgba(14,165,233,0.06)',
    iconColor: '#0ea5e9',
    shadow: 'rgba(6,182,212,0.15)',
    topGradient: '#06b6d4, #0ea5e9',
  },
  {
    color: 'rgba(245,158,11,0.1)',
    colorEnd: 'rgba(217,119,6,0.06)',
    iconColor: '#d97706',
    shadow: 'rgba(245,158,11,0.15)',
    topGradient: '#f59e0b, #d97706',
  },
  {
    color: 'rgba(236,72,153,0.1)',
    colorEnd: 'rgba(219,39,119,0.06)',
    iconColor: '#db2777',
    shadow: 'rgba(236,72,153,0.15)',
    topGradient: '#ec4899, #db2777',
  },
];

function DashboardView({ stats, activities, setTab, onClearActivities }) {
  const {
    totalStudents = 0,
    totalHalls = 0,
    totalCapacity = 0,
    totalCapacity3 = 0,
    totalExams = 0,
    departmentsCount = 0,
    departmentDistribution = [],
  } = stats || {};

  const cap3Val = totalCapacity3 > 0 ? totalCapacity3 : Math.round(totalCapacity * 1.5);
  const capacityFormatted = `${totalCapacity.toLocaleString()} / ${cap3Val.toLocaleString()}`;

  const totalStudentsInDist = departmentDistribution.reduce((sum, d) => sum + d.count, 0);
  const colors = ['#4f46e5', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];

  let accumulatedPercentage = 0;

  const statItems = [
    { label: 'Total Students', value: totalStudents.toLocaleString(), icon: Users },
    { label: 'Total Halls', value: totalHalls.toLocaleString(), icon: Building2 },
    { label: 'Total Capacity (2 / 3 Seats)', value: capacityFormatted, icon: Armchair },
    { label: 'Total Exams', value: totalExams.toLocaleString(), icon: CalendarDays },
    { label: 'Departments', value: departmentsCount.toLocaleString(), icon: GraduationCap },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* ── Page Header ──────────────────────────────── */}
      <div className="page-intro">
        <h2>Dashboard Overview</h2>
        <p>Live snapshot of your examination infrastructure.</p>
      </div>

      {/* ── Stat Cards ───────────────────────────────── */}
      <div className="dashboard-grid">
        {statItems.map((item, idx) => {
          const style = STAT_STYLES[idx];
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="stat-card"
              style={{
                '--stat-color': style.color,
                '--stat-color-end': style.colorEnd,
                '--stat-icon-color': style.iconColor,
                '--stat-shadow': style.shadow,
              }}
            >
              {/* Coloured top accent stripe via ::after pseudo (CSS) */}
              <div className="stat-card-icon">
                <Icon style={{ width: 22, height: 22 }} />
              </div>
              <div className="stat-card-info">
                <span className="stat-card-number">{item.value}</span>
                <span className="stat-card-label">{item.label}</span>
              </div>
              {/* Subtle trend icon */}
              <TrendingUp
                size={14}
                style={{
                  position: 'absolute',
                  bottom: 16,
                  right: 16,
                  color: style.iconColor,
                  opacity: 0.25,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* ── Charts Row ───────────────────────────────── */}
      <div className="sections-grid">

        {/* Department Distribution Donut */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Department Distribution</h3>
            <span className="badge-pill" style={{
              background: 'linear-gradient(135deg, rgba(79,70,229,0.08), rgba(139,92,246,0.05))',
              color: 'var(--color-primary)',
              border: '1px solid rgba(79,70,229,0.15)',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: '9999px',
            }}>
              {departmentDistribution.length} Dept{departmentDistribution.length !== 1 ? 's' : ''}
            </span>
          </div>

          {departmentDistribution.length === 0 ? (
            <div className="donut-chart-container">
              <div className="donut-svg-wrapper">
                <svg width="100%" height="100%" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.915" fill="transparent"
                    stroke="var(--border-color)" strokeWidth="4" />
                </svg>
                <div className="donut-center-text">
                  <span className="donut-center-num">0</span>
                  <span className="donut-center-lbl">Students</span>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Upload student rosters to see distribution.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="donut-chart-container" style={{ flex: '0 0 auto' }}>
                <div className="donut-svg-wrapper">
                  <svg width="100%" height="100%" viewBox="0 0 42 42">
                    <circle cx="21" cy="21" r="15.915" fill="transparent"
                      stroke="var(--border-color)" strokeWidth="4" />
                    {departmentDistribution.map((dept, idx) => {
                      const percentage = (dept.count / totalStudentsInDist) * 100;
                      const strokeDasharray = `${percentage} ${100 - percentage}`;
                      const strokeDashoffset = 100 - accumulatedPercentage + 25;
                      accumulatedPercentage += percentage;
                      return (
                        <circle
                          key={dept.department}
                          cx="21" cy="21" r="15.915"
                          fill="transparent"
                          stroke={colors[idx % colors.length]}
                          strokeWidth="4"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </svg>
                  <div className="donut-center-text">
                    <span className="donut-center-num">{totalStudents.toLocaleString()}</span>
                    <span className="donut-center-lbl">Students</span>
                  </div>
                </div>
              </div>

              <div className="chart-legend" style={{ flex: 1, minWidth: '180px' }}>
                {departmentDistribution.map((dept, idx) => (
                  <div className="legend-item" key={dept.department}>
                    <div className="legend-label">
                      <div className="legend-dot" style={{ backgroundColor: colors[idx % colors.length] }} />
                      <span style={{ fontWeight: 600 }}>{dept.department}</span>
                    </div>
                    <span className="legend-val">{dept.count.toLocaleString()} <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px' }}>({dept.percentage}%)</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Quick Actions</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { label: 'Upload Student Data', tab: 'upload', color: '#4f46e5', bg: 'rgba(79,70,229,0.06)', border: 'rgba(79,70,229,0.12)' },
              { label: 'Manage Halls', tab: 'halls', color: '#059669', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.12)' },
              { label: 'Schedule Exam', tab: 'exams', color: '#d97706', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.12)' },
              { label: 'Assign Seating Plan', tab: 'seating', color: '#0ea5e9', bg: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.12)' },
            ].map((action) => (
              <button
                key={action.tab}
                onClick={() => setTab(action.tab)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: action.bg,
                  border: `1px solid ${action.border}`,
                  borderRadius: '10px',
                  color: action.color,
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontFamily: 'var(--font-primary)',
                }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateX(4px)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateX(0)'; }}
              >
                <span>{action.label}</span>
                <span style={{ fontSize: '16px', opacity: 0.7 }}>→</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent Activities ─────────────────────── */}
      <div className="card-container recent-activities-card">
        <div className="card-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(79,70,229,0.1), rgba(139,92,246,0.06))',
              border: '1px solid rgba(79,70,229,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary)',
            }}>
              <History size={16} />
            </div>
            <h3>Recent Activities</h3>
          </div>
          {activities && activities.length > 0 && (
            <button
              onClick={onClearActivities}
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                color: 'var(--color-error)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '5px 12px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s',
                fontFamily: 'var(--font-primary)',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-error-bg)'; e.currentTarget.style.borderColor = 'rgba(220,38,38,0.2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
        </div>

        <div className="activity-list-scroll-container">
          <div className="activity-list">
            {activities.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0', fontWeight: 500 }}>
                No recent activities yet.
              </p>
            ) : (
              activities.map((act, index) => {
                let dotColor = '#94a3b8';
                if (act.type === 'student') dotColor = 'var(--color-primary)';
                if (act.type === 'hall') dotColor = 'var(--color-success)';
                if (act.type === 'exam') dotColor = 'var(--color-draft)';
                return (
                  <div className="activity-item" key={`${act.id || 'act'}-${index}`}>
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
        </div>

        <button className="view-all-btn" onClick={() => setTab('upload')}>
          View All History →
        </button>
      </div>
    </div>
  );
}

export default DashboardView;
