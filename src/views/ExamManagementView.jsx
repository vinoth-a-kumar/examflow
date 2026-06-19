import React, { useState } from 'react';
import { 
  CalendarDays, 
  Clock, 
  MapPin, 
  Plus, 
  Trash2, 
  X,
  Check
} from 'lucide-react';

function ExamManagementView({ exams, halls, students, onAddExam, onDeleteExam }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [examName, setExamName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [session, setSession] = useState('FN');
  const [selectedDepts, setSelectedDepts] = useState([]);
  const [selectedHalls, setSelectedHalls] = useState([]);

  // Calculate metrics
  const totalExamsCount = exams.length;
  
  // Future exams (date >= today)
  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingExamsCount = exams.filter(e => e.date >= todayStr).length;
  
  // Halls assigned across all exams
  const totalAssignedHalls = exams.reduce((sum, e) => sum + (e.assignedHalls?.length || 0), 0);

  // Available departments from students database (fallback to defaults if database is empty)
  const defaultDepts = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'MBA', 'MCA'];
  const databaseDepts = [...new Set(students.map(s => s.department.toUpperCase()))];
  const availableDepts = databaseDepts.length > 0 ? databaseDepts : defaultDepts;

  const handleDeptToggle = (dept) => {
    if (selectedDepts.includes(dept)) {
      setSelectedDepts(selectedDepts.filter(d => d !== dept));
    } else {
      setSelectedDepts([...selectedDepts, dept]);
    }
  };

  const handleHallToggle = (hallName) => {
    if (selectedHalls.includes(hallName)) {
      setSelectedHalls(selectedHalls.filter(h => h !== hallName));
    } else {
      setSelectedHalls([...selectedHalls, hallName]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!examName.trim()) {
      alert("Exam Name is required.");
      return;
    }
    if (!examDate) {
      alert("Exam Date is required.");
      return;
    }
    if (selectedDepts.length === 0) {
      alert("Please select at least one department.");
      return;
    }
    if (selectedHalls.length === 0) {
      alert("Please assign at least one hall.");
      return;
    }

    onAddExam({
      name: examName,
      departments: selectedDepts,
      date: examDate,
      session: session,
      assignedHalls: selectedHalls
    });

    // Reset and close
    setExamName('');
    setExamDate('');
    setSession('FN');
    setSelectedDepts([]);
    setSelectedHalls([]);
    setModalOpen(false);
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'Active': return 'info';
      case 'Scheduled': return 'success';
      case 'Draft': return 'draft';
      default: return 'warning';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-intro">
          <h2>Exam Management</h2>
          <p>Create, manage and schedule examinations.</p>
        </div>
        
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          <Plus size={18} />
          <span>Create Exam</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-card-icon">
            <CalendarDays />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalExamsCount}</span>
            <span className="stat-card-label">Total Exams</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <Clock />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{upcomingExamsCount}</span>
            <span className="stat-card-label">Upcoming Exams</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon">
            <MapPin />
          </div>
          <div className="stat-card-info">
            <span className="stat-card-number">{totalAssignedHalls}</span>
            <span className="stat-card-label">Assigned Halls</span>
          </div>
        </div>
      </div>

      {/* Exams list card */}
      <div className="card-container">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Exam Name</th>
                <th>Department(s)</th>
                <th>Date</th>
                <th>Session</th>
                <th>Students Count</th>
                <th>Assigned Halls</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exams.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                    No examinations scheduled yet. Click "Create Exam" to schedule.
                  </td>
                </tr>
              ) : (
                exams.map((e) => (
                  <tr key={e._id}>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {e.departments?.map((d) => (
                          <span key={d} className="status-pill info" style={{ fontSize: '10px', padding: '2px 6px' }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{new Date(e.date).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>
                      <span className="status-pill warning" style={{ fontWeight: 700 }}>
                        {e.session}
                      </span>
                    </td>
                    <td>{e.studentsCount}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '200px' }}>
                        {e.assignedHalls && e.assignedHalls.length > 0 ? (
                          e.assignedHalls.map((hall) => (
                            <span key={hall} style={{ 
                              fontSize: '11px', 
                              backgroundColor: 'var(--bg-app)', 
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              fontWeight: 500
                            }}>
                              {hall}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600 }}>None</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${getStatusClass(e.status)}`}>
                        {e.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button 
                        className="btn-danger" 
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to cancel and delete ${e.name}?`)) {
                            onDeleteExam(e._id);
                          }
                        }}
                        style={{ padding: '6px', borderRadius: '50%', boxShadow: 'none' }}
                        title="Cancel Exam"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Exam Modal */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '560px' }}>
            <div className="modal-header">
              <h3>+ Create Exam</h3>
              <button className="modal-close" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="examName">Exam Name</label>
                  <input 
                    type="text" 
                    id="examName" 
                    placeholder="e.g. Data Structures, Operating Systems, End Semester Exam"
                    value={examName}
                    onChange={(e) => setExamName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="examDate">Exam Date</label>
                    <input 
                      type="date" 
                      id="examDate" 
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="session">Session</label>
                    <select 
                      id="session" 
                      value={session}
                      onChange={(e) => setSession(e.target.value)}
                    >
                      <option value="FN">FN (Forenoon 10:00 AM - 01:00 PM)</option>
                      <option value="AN">AN (Afternoon 02:00 PM - 05:00 PM)</option>
                    </select>
                  </div>
                </div>

                {/* Departments Multiselect */}
                <div className="form-group">
                  <label>Select Departments participating in this exam</label>
                  <div className="checkbox-group">
                    {availableDepts.map((dept) => (
                      <button
                        type="button"
                        key={dept}
                        className={`checkbox-btn ${selectedDepts.includes(dept) ? 'selected' : ''}`}
                        onClick={() => handleDeptToggle(dept)}
                      >
                        {selectedDepts.includes(dept) && <Check size={12} style={{ marginRight: '4px', display: 'inline' }} />}
                        {dept}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Halls Assignment Multiselect */}
                <div className="form-group">
                  <label>Assign Halls for Exam Seating</label>
                  {halls.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600 }}>
                      No halls available. Please add halls in Hall Management first!
                    </p>
                  ) : (
                    <div className="checkbox-group">
                      {halls.map((h) => (
                        <button
                          type="button"
                          key={h._id}
                          className={`checkbox-btn ${selectedHalls.includes(h.name) ? 'selected' : ''}`}
                          onClick={() => handleHallToggle(h.name)}
                        >
                          {selectedHalls.includes(h.name) && <Check size={12} style={{ marginRight: '4px', display: 'inline' }} />}
                          {h.name} ({h.capacity} Seats)
                        </button>
                      ))}
                    </div>
                  )}
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
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={halls.length === 0}
                >
                  Schedule Exam
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExamManagementView;
