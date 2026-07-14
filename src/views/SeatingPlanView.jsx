import React, { useState, useEffect } from 'react';
import { 
  Armchair, 
  Info, 
  Printer, 
  Search, 
  Sparkles
} from 'lucide-react';

function SeatingPlanView({ exams, halls, collegeDetails }) {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSession, setSelectedSession] = useState('FN');
  const [selectedHallId, setSelectedHallId] = useState('');
  const [seatingPlan, setSeatingPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Extract unique dates from scheduled exams
  const uniqueExamDates = React.useMemo(() => {
    const dates = exams.map(e => e.date.split('T')[0]);
    return [...new Set(dates)].sort();
  }, [exams]);

  // Find all exams on the selected date and session
  const examsOnSelectedDate = React.useMemo(() => {
    if (!selectedDate) return [];
    return exams.filter(e => e.date.split('T')[0] === selectedDate && e.session === selectedSession);
  }, [exams, selectedDate, selectedSession]);

  // Find all halls assigned to any exams on the selected date and session
  const examHalls = React.useMemo(() => {
    const hallNames = new Set();
    examsOnSelectedDate.forEach(e => {
      if (e.assignedHalls) {
        e.assignedHalls.forEach(h => hallNames.add(h));
      }
    });
    return halls.filter(h => hallNames.has(h.name));
  }, [halls, examsOnSelectedDate]);

  const selectedHall = halls.find(h => h._id === selectedHallId);
  const colsCount = selectedHall ? selectedHall.columns : 4;

  const fetchSeatingPlan = async () => {
    if (!selectedDate || !selectedSession || !selectedHallId) return;
    setLoading(true);
    setErrorMsg('');
    setSeatingPlan(null);

    try {
      const response = await fetch(`http://localhost:5000/api/seating/by-date-session?date=${selectedDate}&session=${selectedSession}&hallId=${selectedHallId}`);
      if (response.ok) {
        const data = await response.json();
        setSeatingPlan(data);
      } else {
        setErrorMsg('No seating plan found for this date, session, and hall. Click the button below to generate.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to load seating plan.');
    } finally {
      setLoading(false);
    }
  };

  // Reset hall selection if it is no longer valid for the selected date/session
  useEffect(() => {
    if (examHalls.length > 0) {
      const isValid = examHalls.some(h => h._id === selectedHallId);
      if (!isValid) {
        setSelectedHallId(examHalls[0]._id);
      }
    } else {
      setSelectedHallId('');
    }
    setSeatingPlan(null);
    setErrorMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedSession]);

  // Automatically fetch seating plan when date, session or hall changes
  useEffect(() => {
    if (selectedDate && selectedSession && selectedHallId) {
      fetchSeatingPlan();
    } else {
      setSeatingPlan(null);
      setErrorMsg('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedSession, selectedHallId]);

  const handleGenerate = async () => {
    if (!selectedDate || !selectedSession || !selectedHallId) {
      alert("Please select Date, Session and Hall.");
      return;
    }
    setLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('http://localhost:5000/api/seating/generate-by-date-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          date: selectedDate,
          session: selectedSession,
          hallId: selectedHallId
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSeatingPlan(data);
      } else {
        const data = await response.json();
        setErrorMsg(data.error || 'Failed to generate seating plan.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Network error occurred during generation.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    try {
      await fetch('http://localhost:5000/api/printouts/increment', { method: 'POST' });
    } catch (err) {
      console.error("Failed to increment print count", err);
    }
    window.print();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Seating Plan</h2>
        <p>Automatically generated examination seating arrangement.</p>
      </div>

      {/* Control selectors */}
      <div className="seating-controls">
        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="dateSelect">Select Date</label>
          <select 
            id="dateSelect"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          >
            <option value="">-- Choose Date --</option>
            {uniqueExamDates.map(d => (
              <option key={d} value={d}>
                {new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="sessionSelect">Select Session</label>
          <select 
            id="sessionSelect"
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
          >
            <option value="FN">FN (Forenoon 10:00 AM - 01:00 PM)</option>
            <option value="AN">AN (Afternoon 02:00 PM - 05:00 PM)</option>
          </select>
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="hallSelect">Select Hall</label>
          <select 
            id="hallSelect"
            value={selectedHallId}
            onChange={(e) => setSelectedHallId(e.target.value)}
            disabled={!selectedDate || examHalls.length === 0}
          >
            {examHalls.length === 0 ? (
              <option value="">-- No halls assigned --</option>
            ) : (
              <>
                <option value="">-- Choose Hall --</option>
                {examHalls.map(h => (
                  <option key={h._id} value={h._id}>{h.name}</option>
                ))}
              </>
            )}
          </select>
        </div>

        <button 
          className="btn-primary" 
          onClick={fetchSeatingPlan}
          disabled={!selectedDate || !selectedHallId || loading}
          style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Search size={16} />
          <span>Search Seating</span>
        </button>

        {seatingPlan && (
          <button 
            className="btn-secondary" 
            onClick={handleGenerate}
            disabled={!selectedDate || !selectedHallId || loading}
            style={{ 
              height: '42px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              backgroundColor: 'var(--color-primary-light)',
              color: 'var(--color-primary)',
              borderColor: 'var(--color-primary)'
            }}
          >
            <Sparkles size={16} />
            <span>Regenerate Seating</span>
          </button>
        )}
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="card-container" style={{ textAlign: 'center', padding: '48px' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            border: '4px solid var(--border-color)', 
            borderTopColor: 'var(--color-primary)', 
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px auto'
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Processing seating allocation...</p>
        </div>
      )}

      {/* Error state / Prompt to generate */}
      {!loading && errorMsg && (
        <div className="card-container" style={{ textAlign: 'center', padding: '40px 24px', alignItems: 'center' }}>
          <div style={{ 
            width: '56px', 
            height: '56px', 
            borderRadius: '50%', 
            backgroundColor: 'var(--color-warning-bg)', 
            color: 'var(--color-warning)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            marginBottom: '16px'
          }}>
            <Info size={28} />
          </div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Seating Arrangement Pending</h4>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', fontSize: '14px', marginBottom: '20px' }}>
            {errorMsg}
          </p>
          {selectedDate && selectedHallId && (
            <button className="btn-primary" onClick={handleGenerate} style={{ gap: '6px' }}>
              <Sparkles size={16} />
              <span>Generate Seating Plan</span>
            </button>
          )}
        </div>
      )}

      {/* Empty select state */}
      {!loading && !seatingPlan && !errorMsg && (
        <div className="card-container" style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-muted)' }}>
          <Armchair size={48} style={{ margin: '0 auto 16px auto', strokeWidth: 1.5 }} />
          <p style={{ fontSize: '15px', fontWeight: 500 }}>Please select Date, Session and Hall to view or generate seating plans.</p>
        </div>
      )}

      {/* Seating Plan Dashboard Displays */}
      {!loading && seatingPlan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Hidden Print Header (visible only on print) */}
          <div className="print-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {collegeDetails?.logo ? (
                <img src={collegeDetails.logo} alt="College Logo" style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '8px',
                  backgroundColor: '#f3f4f6',
                  color: '#111827',
                  border: '1px solid #d1d5db',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '24px'
                }}>
                  {collegeDetails?.name?.charAt(0) || 'E'}
                </div>
              )}
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#111827', margin: 0 }}>
                  {collegeDetails?.name || 'ExamFlow Engineering College'}
                </h2>
                <p style={{ fontSize: '11px', color: '#4b5563', margin: '4px 0 0 0', maxWidth: '350px', lineHeight: '1.4' }}>
                  {collegeDetails?.address || '123 University Campus, Tech City'}
                </p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#111827', display: 'block' }}>
                Academic Year: {collegeDetails?.academicYear || '2026-27'}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#4b5563', display: 'block', marginTop: '4px' }}>
                Exam(s): {examsOnSelectedDate.map(e => e.name).join(', ')}
              </span>
              <span style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginTop: '2px' }}>
                Date: {new Date(selectedDate).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })} ({selectedSession === 'FN' ? 'Forenoon' : 'Afternoon'})
              </span>
            </div>
          </div>
          {/* Seating Stats Summary */}
          <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card">
              <div className="stat-card-info">
                <span className="stat-card-number">{seatingPlan.totalBenches}</span>
                <span className="stat-card-label">Total Benches</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-info">
                <span className="stat-card-number">{seatingPlan.totalStudents}</span>
                <span className="stat-card-label">Students Allocated</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-info">
                <span className="stat-card-number">{seatingPlan.emptySeats}</span>
                <span className="stat-card-label">Empty Seats</span>
              </div>
            </div>
          </div>

          {/* Balance/Unseated Students Alert */}
          {seatingPlan.unseatedStudents && seatingPlan.unseatedStudents.length > 0 && (
            <div className="card-container" style={{ borderColor: 'var(--color-error)', backgroundColor: 'var(--color-error-bg)', gap: '12px' }}>
              <h4 style={{ color: 'var(--color-error)', fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={20} />
                <span>Balance Students ({seatingPlan.unseatedStudents.length} Not Seated due to capacity)</span>
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                The following students could not be allocated a seat because the hall capacity was exceeded:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                {seatingPlan.unseatedStudents.map(student => (
                  <span 
                    key={student.registerNo} 
                    style={{ 
                      fontSize: '11px', 
                      backgroundColor: 'var(--bg-card)', 
                      border: '1px solid var(--border-color)', 
                      color: 'var(--text-primary)', 
                      padding: '4px 8px', 
                      borderRadius: '4px',
                      fontWeight: 600
                    }}
                    title={student.name}
                  >
                    {student.registerNo} ({student.department})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Seating Arrangement Layout Grid */}
          <div className="card-container">
            <div className="card-title-bar">
              <h3>{seatingPlan.hallName} - Seating Arrangement</h3>
            </div>
            
            <div 
              className="seating-layout-grid" 
              style={{ gridTemplateColumns: `repeat(${colsCount}, minmax(${seatingPlan?.seatingGrid?.[0]?.seat3 !== undefined ? '250px' : '180px'}, 1fr))` }}
            >
              {seatingPlan.seatingGrid.map((bench) => (
                <div className="bench-card" key={bench.benchCode}>
                  <span className="bench-code">{bench.benchCode}</span>
                  
                  <div className="bench-seats">
                    <div className={`bench-seat ${bench.seat1 ? 'seat-left' : 'empty'}`} title={bench.seat1 ? `${bench.seat1.name} (${bench.seat1.department}${bench.seat1.subjectCode ? ' - ' + bench.seat1.subjectCode : ''})` : 'Empty'}>
                      {bench.seat1 ? bench.seat1.registerNo : 'Empty'}
                    </div>
                    
                    <div className="bench-divider" />

                    {bench.seat3 !== undefined && (
                      <>
                        <div className={`bench-seat ${bench.seat2 ? 'seat-middle' : 'empty'}`} title={bench.seat2 ? `${bench.seat2.name} (${bench.seat2.department}${bench.seat2.subjectCode ? ' - ' + bench.seat2.subjectCode : ''})` : 'Empty'}>
                          {bench.seat2 ? bench.seat2.registerNo : 'Empty'}
                        </div>
                        <div className="bench-divider" />
                      </>
                    )}
                    
                    <div className={`bench-seat ${(bench.seat3 !== undefined ? bench.seat3 : bench.seat2) ? 'seat-right' : 'empty'}`} title={(bench.seat3 !== undefined ? bench.seat3 : bench.seat2) ? `${(bench.seat3 !== undefined ? bench.seat3 : bench.seat2).name} (${(bench.seat3 !== undefined ? bench.seat3 : bench.seat2).department}${(bench.seat3 !== undefined ? bench.seat3 : bench.seat2).subjectCode ? ' - ' + (bench.seat3 !== undefined ? bench.seat3 : bench.seat2).subjectCode : ''})` : 'Empty'}>
                      {(bench.seat3 !== undefined ? bench.seat3 : bench.seat2) ? (bench.seat3 !== undefined ? bench.seat3 : bench.seat2).registerNo : 'Empty'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Roster & Printable Table */}
          <div className="card-container">
            <div className="card-title-bar">
              <div>
                <h3>Attendance Roster</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Ready for PDF export. Use the download button to print or save this roster as a PDF.
                </p>
              </div>
              <button className="btn-primary" onClick={handlePrint} style={{ gap: '8px' }}>
                <Printer size={16} />
                <span>Download PDF / Print</span>
              </button>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Register No</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Subject Code</th>
                    <th>Bench</th>
                    <th>Seat Position</th>
                  </tr>
                </thead>
                <tbody>
                  {seatingPlan.attendanceRoster.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                        No student seats allocated in this hall.
                      </td>
                    </tr>
                  ) : (
                    seatingPlan.attendanceRoster.map((item) => (
                      <tr key={item.registerNo}>
                        <td style={{ fontWeight: 600 }}>{item.registerNo}</td>
                        <td>{item.name}</td>
                        <td>
                          <span className="status-pill info">{item.department}</span>
                        </td>
                        <td>
                          <span className="status-pill success" style={{ fontSize: '11px', padding: '2px 8px' }}>
                            {item.subjectCode || '-'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 'bold' }}>{item.bench}</td>
                        <td>
                          <span className={`status-pill ${item.seat === 'Left' ? 'success' : 'info'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                            {item.seat} Seat
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SeatingPlanView;
