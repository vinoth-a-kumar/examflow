import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Armchair, 
  Info, 
  Printer, 
  Search, 
  Sparkles,
  Download,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

function SeatingPlanView({ exams, halls, collegeDetails }) {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSession, setSelectedSession] = useState('FN');
  const [selectedHallId, setSelectedHallId] = useState('');
  const [showAllUnseated, setShowAllUnseated] = useState(false);
  const [showAllSeating, setShowAllSeating] = useState(false);
  const [seatingPlan, setSeatingPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewFormat, setViewFormat] = useState('university');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [rosterData, setRosterData] = useState(null);
  const [showLabelExportMenu, setShowLabelExportMenu] = useState(false);
  const [allHallsLabelSequence, setAllHallsLabelSequence] = useState([]);

  // Fetch overall all-halls student sequence for printing
  const fetchAllHallsLabelSequence = useCallback(async () => {
    if (!selectedDate || !selectedSession) return;
    try {
      const response = await fetch(`http://localhost:5000/api/seating/labels/download-csv?date=${selectedDate}&session=${selectedSession}`);
      if (response.ok) {
        const text = await response.text();
        const regNos = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
        setAllHallsLabelSequence(regNos);
      }
    } catch (err) {
      console.error('Error fetching all halls label sequence:', err);
    }
  }, [selectedDate, selectedSession]);

  useEffect(() => {
    if (selectedDate && selectedSession) {
      fetchAllHallsLabelSequence();
    }
  }, [selectedDate, selectedSession, fetchAllHallsLabelSequence]);

  // Overall Seat Label export handlers (All Halls for selected Date + Session)
  const handlePrintLabels = () => {
    window.print();
  };

  const handleDownloadLabelsPdf = () => {
    if (!selectedDate || !selectedSession) return;
    const url = `http://localhost:5000/api/seating/labels/download-pdf?date=${selectedDate}&session=${selectedSession}`;
    window.open(url, '_blank');
  };

  const handleDownloadLabelsExcel = () => {
    if (!selectedDate || !selectedSession) return;
    const url = `http://localhost:5000/api/seating/labels/download-excel?date=${selectedDate}&session=${selectedSession}`;
    window.open(url, '_blank');
  };

  const handleDownloadLabelsCsv = () => {
    if (!selectedDate || !selectedSession) return;
    const url = `http://localhost:5000/api/seating/labels/download-csv?date=${selectedDate}&session=${selectedSession}`;
    window.open(url, '_blank');
  };

  // Extract unique dates from scheduled exams
  const uniqueExamDates = React.useMemo(() => {
    const dates = (exams || []).map(e => e.date ? e.date.split('T')[0] : '');
    return [...new Set(dates.filter(Boolean))].sort();
  }, [exams]);

  // Helper to format date dropdown options with created exam time(s)
  const getDateOptionLabel = (d) => {
    const formattedDate = new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    const examsOnDate = exams ? exams.filter(e => e.date && e.date.split('T')[0] === d) : [];
    if (examsOnDate.length === 0) return formattedDate;
    
    const sessionInfos = examsOnDate.map(e => `${e.session}: ${e.time || (e.session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM')}`);
    return `${formattedDate} (${sessionInfos.join(', ')})`;
  };

  // Handle Date change in seating plan, auto-selecting available session
  const handleDateChange = (newDate) => {
    setSelectedDate(newDate);
    if (newDate && exams) {
      const examsOnDate = exams.filter(e => e.date && e.date.split('T')[0] === newDate);
      if (examsOnDate.length > 0) {
        const hasCurrentSession = examsOnDate.some(e => e.session === selectedSession);
        if (!hasCurrentSession) {
          setSelectedSession(examsOnDate[0].session);
        }
      }
    }
  };


  // Find all exams on the selected date and session
  const examsOnSelectedDate = React.useMemo(() => {
    if (!selectedDate) return [];
    return (exams || []).filter(e => e.date && e.date.split('T')[0] === selectedDate && e.session === selectedSession);
  }, [exams, selectedDate, selectedSession]);

  // Find all halls assigned to any exams on the selected date and session
  const examHalls = React.useMemo(() => {
    const hallNames = new Set();
    examsOnSelectedDate.forEach(e => {
      if (e.assignedHalls) {
        e.assignedHalls.forEach(h => hallNames.add(h));
      }
    });
    return (halls || []).filter(h => h && hallNames.has(h.name));
  }, [halls, examsOnSelectedDate]);


  // Format date as DD/MM/YYYY
  const formattedExamDate = React.useMemo(() => {
    if (!selectedDate) return '';
    try {
      const d = new Date(selectedDate);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    } catch (e) {}
    return selectedDate;
  }, [selectedDate]);

  // Format exam time details
  // Format exam time details
  const examTime = useMemo(() => {
    if (!selectedDate || !selectedSession || !exams) {
      return selectedSession === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM';
    }
    const targetDateStr = selectedDate.split('T')[0];
    const match = exams.find(e => 
      e.date.split('T')[0] === targetDateStr && 
      e.session === selectedSession && 
      e.time && 
      e.time.trim() !== ''
    );
    return match ? match.time : (selectedSession === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM');
  }, [selectedDate, selectedSession, exams]);

  // Handle download Excel action (Department-wise or All Departments)
  const handleDownloadExcel = () => {
    if (!selectedDate || !selectedSession) return;
    let url = `http://localhost:5000/api/seating/download-roster?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
    if (selectedHallId) {
      url += `&hallId=${selectedHallId}`;
    }
    window.open(url, '_blank');
  };

  // Handle download PDF action
  const handleDownloadRosterPdf = () => {
    if (!selectedDate || !selectedSession) return;
    let url = `http://localhost:5000/api/seating/roster/download-pdf?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
    if (selectedHallId) {
      url += `&hallId=${selectedHallId}`;
    }
    window.open(url, '_blank');
  };

  const fetchRosterData = useCallback(async () => {
    if (!selectedDate || !selectedSession) return;
    try {
      let url = `http://localhost:5000/api/seating/attendance-roster?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
      if (selectedHallId) url += `&hallId=${selectedHallId}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setRosterData(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [selectedDate, selectedSession, selectedDeptFilter, selectedHallId]);

  useEffect(() => {
    if (selectedDate && selectedSession) {
      fetchRosterData();
    }
  }, [selectedDate, selectedSession, fetchRosterData]);

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
        if (data.notFound) {
          setSeatingPlan(null);
          setErrorMsg(data.message || 'No seating plan found for this date, session, and hall. Click the button below to generate.');
        } else {
          setSeatingPlan(data);
        }
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
      <div className="seating-controls" style={{ flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="dateSelect">Select Date</label>
          <select 
            id="dateSelect"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
          >
            <option value="">-- Choose Date --</option>
            {uniqueExamDates.map(d => (
              <option key={d} value={d}>
                {getDateOptionLabel(d)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="sessionSelect">Select Session</label>
          <select 
            id="sessionSelect"
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
          >
            <option value="FN">FN (Forenoon)</option>
            <option value="AN">AN (Afternoon)</option>
          </select>
        </div>

        <div className="form-group" style={{ flex: 1, minWidth: '180px' }}>
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

        {/* Overall Seat Labels Action Dropdown (All Halls for Date + Session) */}
        {selectedDate && selectedSession && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button 
              className="btn-secondary" 
              onClick={() => setShowLabelExportMenu(!showLabelExportMenu)}
              style={{ height: '42px', gap: '6px', display: 'flex', alignItems: 'center', fontSize: '13px', padding: '0 14px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', fontWeight: 600 }}
            >
              <Printer size={16} />
              <span>Overall Seat Labels</span>
              <ChevronDown size={14} />
            </button>

            {showLabelExportMenu && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '6px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                zIndex: 100,
                minWidth: '210px',
                overflow: 'hidden'
              }}>
                <button 
                  onClick={() => { setShowLabelExportMenu(false); handlePrintLabels(); }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Printer size={15} />
                  <span>Print A4 Labels (All Halls)</span>
                </button>
                <button 
                  onClick={() => { setShowLabelExportMenu(false); handleDownloadLabelsPdf(); }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)' }}
                >
                  <Download size={15} />
                  <span>Download PDF (All Halls)</span>
                </button>
                <button 
                  onClick={() => { setShowLabelExportMenu(false); handleDownloadLabelsExcel(); }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)' }}
                >
                  <Download size={15} />
                  <span>Download Excel (.xlsx)</span>
                </button>
                <button 
                  onClick={() => { setShowLabelExportMenu(false); handleDownloadLabelsCsv(); }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)' }}
                >
                  <Download size={15} />
                  <span>Download CSV (.csv)</span>
                </button>
              </div>
            )}
          </div>
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
                <img src={collegeDetails.logo.startsWith('data:') ? collegeDetails.logo : process.env.PUBLIC_URL + collegeDetails.logo} alt="College Logo" style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'contain' }} />
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
                  {collegeDetails?.name?.charAt(0) || 'R'}
                </div>
              )}
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#111827', margin: 0 }}>
                  {collegeDetails?.name || "Rajapalayam Rajus' College"}
                </h2>
                <p style={{ fontSize: '11px', color: '#4b5563', margin: '4px 0 0 0', maxWidth: '350px', lineHeight: '1.4' }}>
                  {collegeDetails?.address || 'Rajapalayam, Tamil Nadu, 626117'}
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
                <span className="stat-card-number">
                  {(() => {
                    if (seatingPlan.attendanceRoster && seatingPlan.attendanceRoster.length > 0) {
                      return seatingPlan.attendanceRoster.length;
                    }
                    if (seatingPlan.seatingGrid && Array.isArray(seatingPlan.seatingGrid)) {
                      let count = 0;
                      seatingPlan.seatingGrid.forEach(b => {
                        if (b.seat1) count++;
                        if (b.seat2) count++;
                        if (b.seat3) count++;
                      });
                      if (count > 0) return count;
                    }
                    return seatingPlan.totalStudents || 0;
                  })()}
                </span>
                <span className="stat-card-label">Students Allocated</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card-info">
                <span className="stat-card-number">
                  {(() => {
                    if (seatingPlan.seatingGrid && Array.isArray(seatingPlan.seatingGrid)) {
                      let empty = 0;
                      seatingPlan.seatingGrid.forEach(b => {
                        if (!b.seat1) empty++;
                        if (!b.seat2) empty++;
                        if (b.seat3 !== undefined && !b.seat3) empty++;
                      });
                      return empty;
                    }
                    return seatingPlan.emptySeats !== undefined ? seatingPlan.emptySeats : 0;
                  })()}
                </span>
                <span className="stat-card-label">Empty Seats</span>
              </div>
            </div>
          </div>

          {/* Balance/Unseated Students Alert */}
          {seatingPlan.unseatedStudents && seatingPlan.unseatedStudents.length > 0 && (() => {
            const totalUnseated = seatingPlan.unseatedStudents.length;
            const limit = 20;
            const displayedStudents = showAllUnseated ? seatingPlan.unseatedStudents : seatingPlan.unseatedStudents.slice(0, limit);
            const hasMore = totalUnseated > limit;

            return (
              <div className="card-container" style={{ borderColor: 'var(--color-error)', backgroundColor: 'var(--color-error-bg)', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ color: 'var(--color-error)', fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <Info size={20} />
                    <span>Balance Students ({totalUnseated} Not Seated due to capacity)</span>
                  </h4>
                  {hasMore && (
                    <button
                      onClick={() => setShowAllUnseated(!showAllUnseated)}
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--color-error)',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.2s'
                      }}
                    >
                      <span>{showAllUnseated ? 'Show Less' : `Show More (${totalUnseated - limit} more)`}</span>
                      {showAllUnseated ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}
                </div>

                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                  The following students could not be allocated a seat because the hall capacity was exceeded:
                </p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {displayedStudents.map((student, idx) => (
                    <span 
                      key={`${student.registerNo || 'uns'}-${idx}`} 
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

                {hasMore && !showAllUnseated && (
                  <div style={{ textAlign: 'center', marginTop: '4px' }}>
                    <button
                      onClick={() => setShowAllUnseated(true)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-error)',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>+ Show {totalUnseated - limit} More Balance Students</span>
                      <ChevronDown size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Seating Arrangement Layout Grid */}
          {(() => {
            const totalBenches = seatingPlan.seatingGrid ? seatingPlan.seatingGrid.length : 0;
            const benchLimit = 6;
            const displayedBenches = showAllSeating ? seatingPlan.seatingGrid : seatingPlan.seatingGrid.slice(0, benchLimit);
            const hasMoreBenches = totalBenches > benchLimit;

            return (
              <div className="card-container">
                <div className="card-title-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <h3>{seatingPlan.hallName} - Seating Arrangement</h3>
                  <div className="no-print" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {hasMoreBenches && (
                      <button
                        onClick={() => setShowAllSeating(!showAllSeating)}
                        style={{
                          background: 'var(--color-primary-light)',
                          border: '1px solid var(--color-primary)',
                          color: 'var(--color-primary)',
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '6px 14px',
                          borderRadius: '9999px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <span>{showAllSeating ? 'Show Less' : `Show More (${totalBenches - benchLimit} more benches)`}</span>
                        {showAllSeating ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="seating-grid-scroll-container">
                  <div 
                    className="seating-layout-grid" 
                    style={{ gridTemplateColumns: `repeat(${colsCount}, minmax(${seatingPlan?.seatingGrid?.[0]?.seat3 !== undefined ? '250px' : '180px'}, 1fr))` }}
                  >
                  {displayedBenches.map((bench, bIdx) => (
                    <div className="bench-card" key={`${bench.benchCode || 'bench'}-${bIdx}`}>
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

                {hasMoreBenches && (
                  <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                    <button
                      onClick={() => setShowAllSeating(!showAllSeating)}
                      className="btn-secondary"
                      style={{
                        padding: '8px 20px',
                        fontSize: '13px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>{showAllSeating ? 'Show Less Benches' : `Show All ${totalBenches} Benches (${totalBenches - benchLimit} Hidden)`}</span>
                      {showAllSeating ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Roster & Printable Table */}
          <div className="card-container">
            <div className="card-title-bar" style={{ flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3>Attendance Roster</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Export as formatted Excel (.xlsx) or print university-style attendance sheets by Department and Subject Code.
                </p>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Department Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Dept:</label>
                  <select
                    value={selectedDeptFilter}
                    onChange={(e) => setSelectedDeptFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontWeight: 'bold',
                      fontSize: '13px'
                    }}
                  >
                    <option value="ALL">All Departments</option>
                    {(rosterData?.departments || []).map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <button className="btn-secondary" onClick={handleDownloadExcel} style={{ gap: '8px', display: 'flex', alignItems: 'center' }}>
                  <Download size={16} />
                  <span>Download Excel (.xlsx)</span>
                </button>
                <button className="btn-secondary" onClick={handleDownloadRosterPdf} style={{ gap: '8px', display: 'flex', alignItems: 'center' }}>
                  <Download size={16} />
                  <span>Download PDF (.pdf)</span>
                </button>
                <button className="btn-primary" onClick={handlePrint} style={{ gap: '8px', display: 'flex', alignItems: 'center' }}>
                  <Printer size={16} />
                  <span>Print Roster</span>
                </button>
              </div>
            </div>

            {/* Toggle view format */}
            <div className="uni-view-toggle no-print">
              <button 
                className={`uni-toggle-btn ${viewFormat === 'university' ? 'active' : ''}`}
                onClick={() => setViewFormat('university')}
              >
                University Sheet Format
              </button>
              <button 
                className={`uni-toggle-btn ${viewFormat === 'standard' ? 'active' : ''}`}
                onClick={() => setViewFormat('standard')}
              >
                Standard List
              </button>
            </div>

            {/* Standard Table View */}
            {viewFormat === 'standard' && (
              <div className="table-wrapper table-wrapper-scrollable no-print">
                <table className="data-table sticky-header-table">
                  <thead>
                    <tr>
                      <th>Register No</th>
                      <th>Name</th>
                      <th>Bench</th>
                      <th>Seat Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!seatingPlan || !seatingPlan.attendanceRoster || seatingPlan.attendanceRoster.length === 0) ? (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                          No student seats allocated in this hall.
                        </td>
                      </tr>
                    ) : (
                      seatingPlan.attendanceRoster.map((item, idx) => (
                        <tr key={`${item.registerNo || 'rost'}-${idx}`}>
                          <td style={{ fontWeight: 600 }}>{item.registerNo}</td>
                          <td>{item.name}</td>
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
            )}

            {/* University Sheet Format View - Department + Subject Code, EXACTLY 25 Students per Page */}
            <div className={viewFormat === 'university' ? '' : 'only-print'}>
              {(!rosterData || !rosterData.pages || rosterData.pages.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  No attendance roster records found for the selected department/date.
                </div>
              ) : (() => {
                const pages = rosterData.pages;

                return (
                  <div className="university-rosters-scroll-container">
                    <div className="university-rosters-wrapper">
                    {pages.map((page, pIdx) => {
                      const blankRowsCount = Math.max(0, 25 - (page.students ? page.students.length : 0));

                      return (
                        <div
                          key={`uni-page-${pIdx}`}
                          className="university-roster-sheet"
                          style={{
                            pageBreakAfter: pIdx < pages.length - 1 ? 'always' : 'auto',
                            breakAfter: pIdx < pages.length - 1 ? 'page' : 'auto',
                            marginBottom: '32px'
                          }}
                        >
                          {/* Official Header - Repeated on Every Page */}
                          <div className="uni-roster-header">
                            <h1 className="uni-title">MADURAI KAMARAJ UNIVERSITY EXAMINATIONS</h1>
                            <h2 className="college-title">RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM</h2>
                          </div>

                          {/* Info Meta Grid - Repeated on Every Page */}
                          <div className="uni-roster-meta">
                            <div className="meta-row">
                              <div className="meta-cell"><strong>DATE OF EXAM:</strong> {formattedExamDate}</div>
                              <div className="meta-cell text-right"><strong>TIME OF EXAM:</strong> {examTime}</div>
                            </div>
                            <div className="meta-row">
                              <div className="meta-cell">
                                <strong>SUBJECT CODE:</strong> {page.subjectCode.toUpperCase()}
                              </div>
                              <div className="meta-cell text-right">
                                <strong>DEGREE:</strong> {page.degree || page.deptName}
                              </div>
                            </div>
                          </div>

                          {/* Roster Table - EXACTLY 25 Rows (filled + padded) */}
                          <table className="uni-roster-table">
                            <thead>
                              <tr>
                                <th style={{ width: '8%' }}>SL NO</th>
                                <th style={{ width: '25%' }}>REGISTER NUMBER</th>
                                <th style={{ width: '42%' }}>NAME OF THE CANDIDATE</th>
                                <th style={{ width: '25%' }}>SIGNATURE OF THE CANDIDATE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {page.students.map((student, idx) => (
                                <tr key={`${student.registerNo || 'std'}-${idx}`}>
                                  <td className="text-center" style={{ fontWeight: 'bold' }}>{page.startIndex + idx}</td>
                                  <td style={{ fontWeight: 600 }}>{student.registerNo}</td>
                                  <td className="text-uppercase">{student.name}</td>
                                  <td className="empty-sig-cell"></td>
                                </tr>
                              ))}
                              {Array.from({ length: blankRowsCount }).map((_, bIdx) => (
                                <tr key={`blank-row-${bIdx}`}>
                                  <td className="text-center" style={{ fontWeight: 'bold' }}>{page.startIndex + page.students.length + bIdx}</td>
                                  <td></td>
                                  <td></td>
                                  <td className="empty-sig-cell"></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Official Footer Section - Repeated on Every Page */}
                          <div className="uni-roster-footer">
                            <div className="footer-row">
                              <div className="footer-cell">
                                <strong>Absentees Reg. No.:</strong>
                                <span className="bottom-line"></span>
                              </div>
                              <div className="footer-cell text-right">
                                <strong>Hall No.:</strong> {page.hallName || 'ALL'}
                              </div>
                            </div>
                            <div className="footer-row">
                              <div className="footer-cell">
                                <strong>Total No. of Absentees:</strong>
                                <span className="bottom-line" style={{ maxWidth: '80px', minWidth: '60px' }}></span>
                              </div>
                              <div className="footer-cell text-right">
                                <strong>Name of the Invigilator and College:</strong>
                                <span className="bottom-line" style={{ minWidth: '220px' }}></span>
                              </div>
                            </div>
                            <div className="footer-row sig-row">
                              <div className="footer-cell" style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                Signature of the Chief Superintendent
                              </div>
                              <div className="footer-cell text-right" style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                Signature of the Invigilator
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            </div>
          </div>
        </div>
      )}

      {/* Seat Labels Printable Area (A4 Portrait - 7 Cols x 12 Rows = 84 Labels per Page) */}
      <div id="seat-labels-print-area" className="seat-labels-print-wrapper">
        {(() => {
          let studentRegNos = allHallsLabelSequence;
          if (!studentRegNos || studentRegNos.length === 0) {
            studentRegNos = [];
            if (seatingPlan && Array.isArray(seatingPlan.seatingGrid)) {
              seatingPlan.seatingGrid.forEach(bench => {
                if (bench.seat1 && bench.seat1.registerNo) studentRegNos.push(bench.seat1.registerNo);
                if (bench.seat2 && bench.seat2.registerNo) studentRegNos.push(bench.seat2.registerNo);
                if (bench.seat3 && bench.seat3.registerNo) studentRegNos.push(bench.seat3.registerNo);
              });
            }
          }

          const labelsPerPage = 84;
          const totalPages = Math.ceil(studentRegNos.length / labelsPerPage) || 1;
          const labelPages = [];

          for (let p = 0; p < totalPages; p++) {
            const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);
            labelPages.push(pageStudents);
          }

          return labelPages.map((pageStudents, pIdx) => (
            <div key={`label-page-${pIdx}`} className="seat-labels-page">
              <div className="seat-labels-grid">
                {Array.from({ length: 84 }).map((_, lIdx) => {
                  const regNo = pageStudents[lIdx] || '';
                  return (
                    <div key={`label-${pIdx}-${lIdx}`} className="seat-label-box">
                      {regNo ? <span className="label-regno">{regNo}</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

export default SeatingPlanView;
