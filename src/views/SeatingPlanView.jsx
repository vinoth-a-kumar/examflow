import React, { useState, useEffect } from 'react';
import { 
  Armchair, 
  Info, 
  Printer, 
  Search, 
  Sparkles
} from 'lucide-react';

function SeatingPlanView({ exams, halls }) {
  const [selectedExamId, setSelectedExamId] = useState('');
  const [selectedHallId, setSelectedHallId] = useState('');
  const [seatingPlan, setSeatingPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Selected Exam object for assigned halls
  const selectedExam = exams.find(e => e._id === selectedExamId);
  // Get halls that are assigned to the selected exam
  const examHalls = halls.filter(h => selectedExam?.assignedHalls?.includes(h.name));

  const selectedHall = halls.find(h => h._id === selectedHallId);
  const colsCount = selectedHall ? selectedHall.columns : 4;

  const fetchSeatingPlan = async () => {
    if (!selectedExamId || !selectedHallId) return;
    setLoading(true);
    setErrorMsg('');
    setSeatingPlan(null);

    try {
      const response = await fetch(`http://localhost:5000/api/seating/${selectedExamId}/${selectedHallId}`);
      if (response.ok) {
        const data = await response.json();
        setSeatingPlan(data);
      } else {
        // Not generated yet
        setErrorMsg('No seating plan found. Click the button below to generate one.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to load seating plan.');
    } finally {
      setLoading(false);
    }
  };

  // Reset hall selection if it is no longer valid for the selected exam
  useEffect(() => {
    if (examHalls.length > 0) {
      // Auto-select first hall if none selected or if selected hall is not in the list
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
  }, [selectedExamId]);

  // Automatically fetch seating plan when exam or hall selection changes
  useEffect(() => {
    if (selectedExamId && selectedHallId) {
      fetchSeatingPlan();
    } else {
      setSeatingPlan(null);
      setErrorMsg('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamId, selectedHallId]);

  const handleGenerate = async () => {
    if (!selectedExamId || !selectedHallId) {
      alert("Please select both Exam and Hall.");
      return;
    }
    setLoading(true);
    setErrorMsg('');

    try {
      const response = await fetch('http://localhost:5000/api/seating/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          examId: selectedExamId,
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
          <label htmlFor="examSelect">Select Exam</label>
          <select 
            id="examSelect"
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
          >
            <option value="">-- Choose Exam --</option>
            {exams.map(e => (
              <option key={e._id} value={e._id}>
                {e.name} ({e.date} - {e.session})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ flex: 1 }}>
          <label htmlFor="hallSelect">Select Hall</label>
          <select 
            id="hallSelect"
            value={selectedHallId}
            onChange={(e) => setSelectedHallId(e.target.value)}
            disabled={!selectedExamId || examHalls.length === 0}
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
          disabled={!selectedExamId || !selectedHallId || loading}
          style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Search size={16} />
          <span>Search Seating</span>
        </button>

        {seatingPlan && (
          <button 
            className="btn-secondary" 
            onClick={handleGenerate}
            disabled={!selectedExamId || !selectedHallId || loading}
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
          {selectedExamId && selectedHallId && (
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
          <p style={{ fontSize: '15px', fontWeight: 500 }}>Please select an Exam and an Assigned Hall to view or generate seating plans.</p>
        </div>
      )}

      {/* Seating Plan Dashboard Displays */}
      {!loading && seatingPlan && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
