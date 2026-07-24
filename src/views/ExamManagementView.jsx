import React, { useState, useEffect, useMemo } from 'react';
import { 
  CalendarDays, 
  Clock,
  MapPin, 
  Plus, 
  Trash2, 
  X,
  Check,
  Edit2,
  Search,
  Download,
  Users,
  BookOpen,
  Armchair
} from 'lucide-react';

function ExamManagementView({ exams, halls, students, onAddExam, onDeleteExam, onUpdateExam }) {
  const [modalOpen, setModalOpen] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [examName, setExamName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [session, setSession] = useState('FN');
  const [time, setTime] = useState('10:00 AM - 01:00 PM');
  const [selectedSubjectCodes, setSelectedSubjectCodes] = useState([]);

  const handleSessionChange = (s) => {
    setSession(s);
    if (s === 'FN') {
      setTime('10:00 AM - 01:00 PM');
    } else {
      setTime('02:00 PM - 05:00 PM');
    }
  };
  const [selectedHalls, setSelectedHalls] = useState([]);
  const [remainingCounts, setRemainingCounts] = useState({});
  const [hallAvailability, setHallAvailability] = useState({});
  const [availableSubjectCodes, setAvailableSubjectCodes] = useState([]);
  const [seatsPerBench, setSeatsPerBench] = useState(2);
  const [subjectCodeSearch, setSubjectCodeSearch] = useState('');
  const [activeYearFilter, setActiveYearFilter] = useState('ALL');

  // Exam Locations Summary states
  const [locDate, setLocDate] = useState('');
  const [locSession, setLocSession] = useState('FN');
  const [locations, setLocations] = useState(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState('');

  // Extract unique dates from scheduled exams
  const uniqueExamDates = useMemo(() => {
    if (!exams) return [];
    const dates = exams.map(e => e.date.split('T')[0]);
    return [...new Set(dates)].sort();
  }, [exams]);

  // Helper to format date dropdown options with created exam time(s)
  const getDateOptionLabel = (d) => {
    const formattedDate = new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    const examsOnDate = exams ? exams.filter(e => e.date.split('T')[0] === d) : [];
    if (examsOnDate.length === 0) return formattedDate;
    
    const sessionInfos = examsOnDate.map(e => `${e.session}: ${e.time || (e.session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM')}`);
    return `${formattedDate} (${sessionInfos.join(', ')})`;
  };

  // Handle Date change in location summary, auto-selecting available session
  const handleLocDateChange = (newDate) => {
    setLocDate(newDate);
    if (newDate && exams) {
      const examsOnDate = exams.filter(e => e.date.split('T')[0] === newDate);
      if (examsOnDate.length > 0) {
        const hasCurrentSession = examsOnDate.some(e => e.session === locSession);
        if (!hasCurrentSession) {
          setLocSession(examsOnDate[0].session);
        }
      }
    }
  };


  const fetchLocations = async () => {
    if (!locDate || !locSession) return;
    setLocLoading(true);
    setLocError('');
    setLocations(null);
    try {
      const response = await fetch(`http://localhost:5000/api/seating/locations-by-date-session?date=${locDate}&session=${locSession}`);
      if (response.ok) {
        const data = await response.json();
        setLocations(data.locations);
      } else {
        const err = await response.json();
        setLocError(err.error || 'No location records found for this date and session.');
      }
    } catch (err) {
      console.error(err);
      setLocError('Failed to fetch seating locations.');
    } finally {
      setLocLoading(false);
    }
  };

  const handleDownloadLocationsExcel = () => {
    if (!locDate || !locSession) return;
    const url = `http://localhost:5000/api/seating/download-locations?date=${locDate}&session=${locSession}`;
    window.open(url, '_blank');
  };

  // Edit states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [editExamName, setEditExamName] = useState('');
  const [editExamDate, setEditExamDate] = useState('');
  const [editSession, setEditSession] = useState('FN');
  const [editTime, setEditTime] = useState('');
  const [editSelectedSubjectCodes, setEditSelectedSubjectCodes] = useState([]);

  const handleEditSessionChange = (s) => {
    setEditSession(s);
    if (s === 'FN') {
      setEditTime('10:00 AM - 01:00 PM');
    } else {
      setEditTime('02:00 PM - 05:00 PM');
    }
  };
  const [editSelectedHalls, setEditSelectedHalls] = useState([]);
  const [editRemainingCounts, setEditRemainingCounts] = useState({});
  const [editHallAvailability, setEditHallAvailability] = useState({});
  const [editSeatsPerBench, setEditSeatsPerBench] = useState(2);
  const [editSubjectCodeSearch, setEditSubjectCodeSearch] = useState('');
  const [editActiveYearFilter, setEditActiveYearFilter] = useState('ALL');

  // Helper: Calculate hall capacity based on bench config (2 or 3 seats/bench) & uploaded hall details (2*SEATS / 3*SEATS)
  const getHallCapacityForBenchConfig = (hall, seatsPerBenchConfig) => {
    if (!hall) return 0;
    const spb = parseInt(seatsPerBenchConfig) || 2;

    if (hall.csvData) {
      const keys = Object.keys(hall.csvData);
      if (spb === 2) {
        const k2 = keys.find(k => /2\*seat|2_seat|2seat/i.test(k));
        if (k2 && hall.csvData[k2] && !isNaN(parseInt(hall.csvData[k2]))) {
          return parseInt(hall.csvData[k2]);
        }
      } else if (spb === 3) {
        const k3 = keys.find(k => /3\*seat|3_seat|3seat/i.test(k));
        if (k3 && hall.csvData[k3] && !isNaN(parseInt(hall.csvData[k3]))) {
          return parseInt(hall.csvData[k3]);
        }
      }
    }

    const benchCount = hall.benches || (hall.rows && hall.columns ? hall.rows * hall.columns : 0);
    if (benchCount > 0) {
      return benchCount * spb;
    }

    if (spb === 3 && hall.capacity) {
      return Math.round((hall.capacity / 2) * 3);
    }
    return hall.capacity || 0;
  };

  // Real-time metrics calculations for Create Exam Modal
  const totalStudentsSelected = useMemo(() => {
    if (!examDate) return selectedSubjectCodes.length > 0 ? 'Set Date' : 0;
    return selectedSubjectCodes.reduce((sum, code) => sum + (remainingCounts[code.toUpperCase()] || 0), 0);
  }, [selectedSubjectCodes, remainingCounts, examDate]);

  const totalAssignedCapacity = useMemo(() => {
    return selectedHalls.reduce((sum, hallName) => {
      const h = (halls || []).find(x => x.name === hallName);
      const avail = (examDate && hallAvailability) ? hallAvailability[hallName] : null;
      if (avail && typeof avail.vacantSeats === 'number') {
        return sum + avail.vacantSeats;
      }
      return sum + (h ? getHallCapacityForBenchConfig(h, seatsPerBench) : 0);
    }, 0);
  }, [selectedHalls, halls, seatsPerBench, examDate, hallAvailability]);

  // Real-time metrics calculations for Edit Exam Modal
  const editTotalStudentsSelected = useMemo(() => {
    if (!editExamDate) return editSelectedSubjectCodes.length > 0 ? 'Set Date' : 0;
    return editSelectedSubjectCodes.reduce((sum, code) => sum + (editRemainingCounts[code.toUpperCase()] || 0), 0);
  }, [editSelectedSubjectCodes, editRemainingCounts, editExamDate]);

  const editTotalAssignedCapacity = useMemo(() => {
    return editSelectedHalls.reduce((sum, hallName) => {
      const h = (halls || []).find(x => x.name === hallName);
      const avail = (editExamDate && editHallAvailability) ? editHallAvailability[hallName] : null;
      if (avail && typeof avail.vacantSeats === 'number') {
        return sum + avail.vacantSeats;
      }
      return sum + (h ? getHallCapacityForBenchConfig(h, editSeatsPerBench) : 0);
    }, 0);
  }, [editSelectedHalls, halls, editSeatsPerBench, editExamDate, editHallAvailability]);

  // Helper: Filter subject codes directly by search query & year (no department grouping)
  const filterSubjectCodes = (codes, searchQuery, yearFilter) => {
    // Parse each code into { prefix, number, year, code }
    const parsed = codes.map(code => {
      const match = code.match(/^([A-Z]+)(\d+)$/);
      if (!match) return { prefix: 'OTHER', number: 0, year: 'OTHER', code };
      const prefix = match[1];
      const num = parseInt(match[2]);
      let year = 'OTHER';
      const firstDigit = match[2][0];
      if (firstDigit === '1') year = '1st Year';
      else if (firstDigit === '2') year = '2nd Year';
      else if (firstDigit === '3') year = '3rd Year';
      else if (firstDigit === '5') year = 'PG 1st Year';
      else if (firstDigit === '6') year = 'PG 2nd Year';
      else if (firstDigit === '4') year = '4th Year';
      return { prefix, number: num, year, code };
    });

    // Apply search filter
    let filtered = parsed;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      filtered = parsed.filter(p => p.code.includes(q) || p.prefix.includes(q));
    }

    // Apply year filter
    if (yearFilter !== 'ALL') {
      filtered = filtered.filter(p => p.year === yearFilter);
    }

    // Sort alphabetically/numerically
    filtered.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));

    // Get available years for filter tabs
    const availableYears = [...new Set(parsed.map(p => p.year))].sort();

    return { filteredCodes: filtered, availableYears };
  };

  // Fetch available subject codes from student records
  useEffect(() => {
    const fetchSubjectCodes = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/students/subject-codes');
        if (response.ok) {
          const data = await response.json();
          setAvailableSubjectCodes(data);
        }
      } catch (err) {
        console.error("Failed to fetch subject codes", err);
      }
    };
    fetchSubjectCodes();
  }, [students]);

  useEffect(() => {
    if (!examDate) {
      setRemainingCounts({});
      setHallAvailability({});
      return;
    }
    
    const fetchRemaining = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/students/remaining-by-subject?date=${examDate}&session=${session}`);
        if (response.ok) {
          const data = await response.json();
          setRemainingCounts(data);
        }
      } catch (err) {
        console.error("Failed to fetch remaining students count", err);
      }
    };

    const fetchAvailability = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/halls/availability?date=${examDate}&session=${session}&seatsPerBench=${seatsPerBench}`);
        if (response.ok) {
          const data = await response.json();
          setHallAvailability(data);
        }
      } catch (err) {
        console.error("Failed to fetch hall availability", err);
      }
    };
    
    fetchRemaining();
    fetchAvailability();
  }, [examDate, session, seatsPerBench]);

  useEffect(() => {
    if (!editExamDate || !editingExam) {
      setEditRemainingCounts({});
      setEditHallAvailability({});
      return;
    }
    
    const fetchEditRemaining = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/students/remaining-by-subject?date=${editExamDate}&session=${editSession}&excludeExamId=${editingExam._id}`);
        if (response.ok) {
          const data = await response.json();
          setEditRemainingCounts(data);
        }
      } catch (err) {
        console.error("Failed to fetch remaining students count for edit", err);
      }
    };

    const fetchEditAvailability = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/halls/availability?date=${editExamDate}&session=${editSession}&excludeExamId=${editingExam._id}&seatsPerBench=${editSeatsPerBench}`);
        if (response.ok) {
          const data = await response.json();
          setEditHallAvailability(data);
        }
      } catch (err) {
        console.error("Failed to fetch hall availability for edit", err);
      }
    };
    
    fetchEditRemaining();
    fetchEditAvailability();
  }, [editExamDate, editSession, editingExam, editSeatsPerBench]);

  // Find all occupied halls on the selected date and session
  const occupiedHallsOnDate = React.useMemo(() => {
    if (!examDate) return [];
    const selectedDateOnly = examDate.split('T')[0];
    const matchingExams = exams.filter(e => {
      const eDateOnly = e.date.split('T')[0];
      return eDateOnly === selectedDateOnly && e.session === session;
    });

    const hallNames = [];
    matchingExams.forEach(e => {
      if (e.assignedHalls) {
        hallNames.push(...e.assignedHalls);
      }
    });
    return [...new Set(hallNames)];
  }, [exams, examDate, session]);

  // Remove any occupied halls if date/session changes
  React.useEffect(() => {
    setSelectedHalls(prev => prev.filter(hallName => !occupiedHallsOnDate.includes(hallName)));
  }, [occupiedHallsOnDate]);

  // Calculate metrics
  const totalExamsCount = exams.length;
  
  // Future exams (date >= today)
  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingExamsCount = exams.filter(e => e.date >= todayStr).length;
  
  // Halls assigned across all exams
  const totalAssignedHalls = exams.reduce((sum, e) => sum + (e.assignedHalls?.length || 0), 0);

  const handleSubjectCodeToggle = (code) => {
    if (selectedSubjectCodes.includes(code)) {
      setSelectedSubjectCodes(selectedSubjectCodes.filter(c => c !== code));
    } else {
      setSelectedSubjectCodes([...selectedSubjectCodes, code]);
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
    if (!examDate) {
      alert("Exam Date is required.");
      return;
    }
    if (selectedSubjectCodes.length === 0) {
      alert("Please select at least one subject code.");
      return;
    }
    if (selectedHalls.length === 0) {
      alert("Please assign at least one hall.");
      return;
    }

    const generatedExamName = selectedSubjectCodes.length > 0 
      ? selectedSubjectCodes.slice(0, 3).join(', ') 
      : 'Exam';

    onAddExam({
      name: generatedExamName,
      subjectCodes: selectedSubjectCodes,
      departments: [],
      date: examDate,
      session: session,
      assignedHalls: selectedHalls,
      seatsPerBench: seatsPerBench,
      time: time
    });

    // Reset and close
    setExamName('');
    setExamDate('');
    setSession('FN');
    setTime('10:00 AM - 01:00 PM');
    setSelectedSubjectCodes([]);
    setSelectedHalls([]);
    setSeatsPerBench(2);
    setSubjectCodeSearch('');
    setActiveYearFilter('ALL');
    setModalOpen(false);
  };

  const handleEditSubjectCodeToggle = (code) => {
    if (editSelectedSubjectCodes.includes(code)) {
      setEditSelectedSubjectCodes(editSelectedSubjectCodes.filter(c => c !== code));
    } else {
      setEditSelectedSubjectCodes([...editSelectedSubjectCodes, code]);
    }
  };

  const handleEditHallToggle = (hallName) => {
    if (editSelectedHalls.includes(hallName)) {
      setEditSelectedHalls(editSelectedHalls.filter(h => h !== hallName));
    } else {
      setEditSelectedHalls([...editSelectedHalls, hallName]);
    }
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editExamDate) {
      alert("Exam Date is required.");
      return;
    }
    if (editSelectedSubjectCodes.length === 0) {
      alert("Please select at least one subject code.");
      return;
    }
    if (editSelectedHalls.length === 0) {
      alert("Please assign at least one hall.");
      return;
    }

    const generatedEditExamName = editSelectedSubjectCodes.length > 0 
      ? editSelectedSubjectCodes.slice(0, 3).join(', ') 
      : 'Exam';

    onUpdateExam(editingExam._id, {
      name: generatedEditExamName,
      subjectCodes: editSelectedSubjectCodes,
      departments: [],
      date: editExamDate,
      session: editSession,
      assignedHalls: editSelectedHalls,
      seatsPerBench: editSeatsPerBench,
      time: editTime
    });

    // Reset and close
    setEditingExam(null);
    setEditExamName('');
    setEditExamDate('');
    setEditSession('FN');
    setEditTime('');
    setEditSelectedSubjectCodes([]);
    setEditSelectedHalls([]);
    setEditSeatsPerBench(2);
    setEditSubjectCodeSearch('');
    setEditActiveYearFilter('ALL');
    setEditModalOpen(false);
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
                <th>Subject Code(s)</th>
                <th>Date</th>
                <th>Session & Time</th>
                <th>Seats/Bench</th>
                <th>Students Count</th>
                <th>Assigned Halls</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exams.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                    No examinations scheduled yet. Click "Create Exam" to schedule.
                  </td>
                </tr>
              ) : (
                exams.map((e, index) => (
                  <tr key={`${e._id || e.id || 'exam'}-${index}`}>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(e.subjectCodes && e.subjectCodes.length > 0 ? e.subjectCodes : e.departments)?.map((code, codeIdx) => (
                          <span key={`${code}-${codeIdx}`} className="status-pill info" style={{ fontSize: '10px', padding: '2px 6px' }}>
                            {code}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{new Date(e.date).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>
                      <span className="status-pill warning" style={{ fontWeight: 700 }}>
                        {e.session}
                      </span>
                      {e.time && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                          {e.time}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="status-pill info" style={{ fontWeight: 600 }}>
                        {e.seatsPerBench || 2} Seats
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.studentsCount}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                        Allocated: {e.allocatedCount || 0} | Remaining: {e.remainingCount ?? e.studentsCount}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '240px' }}>
                        {e.assignedHallsDetails && e.assignedHallsDetails.length > 0 ? (
                          e.assignedHallsDetails.map((hall, hallIdx) => (
                            <span key={`${hall.name || 'hall'}-${hallIdx}`} style={{ 
                              fontSize: '11px', 
                              backgroundColor: 'var(--bg-app)', 
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              fontWeight: 500,
                              whiteSpace: 'nowrap'
                            }}>
                              {hall.name} <strong style={{ color: 'var(--color-primary)', marginLeft: '2px' }}>({hall.vacantSeats} Vacant)</strong>
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
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button 
                          className="btn-secondary" 
                          onClick={() => {
                            setEditingExam(e);
                            setEditExamName(e.name);
                            setEditExamDate(e.date.split('T')[0]);
                            setEditSession(e.session);
                            setEditTime(e.time || (e.session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM'));
                            setEditSelectedSubjectCodes(e.subjectCodes || []);
                            setEditSelectedHalls(e.assignedHalls || []);
                            setEditSeatsPerBench(e.seatsPerBench || 2);
                            setEditModalOpen(true);
                          }}
                          style={{ padding: '6px', borderRadius: '50%', boxShadow: 'none' }}
                          title="Edit Exam"
                        >
                          <Edit2 size={14} />
                        </button>
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>



      {/* Create Exam Modal */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '780px', maxWidth: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '16px' }}>
            {/* Styled Header */}
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(79,70,229,0.06), rgba(139,92,246,0.03))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', boxShadow: '0 4px 12px rgba(79,70,229,0.3)'
                }}>
                  <Plus size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
                    Schedule New Examination
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    Configure exam date, session, subject codes, and hall seating allocation.
                  </p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                
                {/* ── Live Smart Summary Bar ─────────────────────── */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(79,70,229,0.07) 0%, rgba(139,92,246,0.04) 100%)',
                  border: '1px solid rgba(79,70,229,0.18)',
                  borderRadius: '12px',
                  padding: '12px 18px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CalendarDays size={11} /> Schedule
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {examDate ? new Date(examDate).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : 'Set Date'}
                      <span className={`status-pill ${session === 'FN' ? 'info' : 'warning'}`} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px' }}>
                        {session}
                      </span>
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <BookOpen size={11} /> Subjects
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-primary)' }}>
                      {selectedSubjectCodes.length} {selectedSubjectCodes.length === 1 ? 'Code' : 'Codes'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Users size={11} /> Students
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9' }}>
                      {typeof totalStudentsSelected === 'number' ? `${totalStudentsSelected} Students` : totalStudentsSelected}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Armchair size={11} /> Capacity
                    </span>
                    <span style={{
                      fontSize: '13px', fontWeight: 800,
                      color: typeof totalStudentsSelected === 'number' && totalStudentsSelected > 0
                        ? (totalAssignedCapacity >= totalStudentsSelected ? '#10b981' : '#f59e0b')
                        : 'var(--text-primary)'
                    }}>
                      {totalAssignedCapacity} Seats
                      {typeof totalStudentsSelected === 'number' && totalStudentsSelected > 0 && (
                        <span style={{
                          fontSize: '9.5px',
                          marginLeft: '4px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: totalAssignedCapacity >= totalStudentsSelected ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: totalAssignedCapacity >= totalStudentsSelected ? '#10b981' : '#f59e0b'
                        }}>
                          {totalAssignedCapacity >= totalStudentsSelected ? '✓ OK' : '⚠️ Shortage'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* ── Section 1: Schedule Configuration ─────────────────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>📅</span>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>Schedule Configuration</h4>
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      Configure exam schedule before 📍 Assign Seats.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: '16px', alignItems: 'center', background: 'var(--bg-card)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    {/* Column 1: Exam Date */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label htmlFor="examDate" style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                        📅 Exam Date *
                      </label>
                      <input 
                        type="date" 
                        id="examDate" 
                        value={examDate}
                        onChange={(e) => setExamDate(e.target.value)}
                        required
                        style={{ height: '38px', fontSize: '13px', borderRadius: '8px', padding: '0 12px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', width: '100%', fontWeight: 600 }}
                      />
                    </div>

                    {/* Column 2: Session */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ☀️ Session *
                      </label>
                      <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-app)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)', height: '38px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleSessionChange('FN')}
                          style={{
                            flex: 1, height: '30px', borderRadius: '6px', border: 'none', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                            background: session === 'FN' ? 'var(--color-primary)' : 'transparent',
                            color: session === 'FN' ? '#fff' : 'var(--text-secondary)',
                            boxShadow: session === 'FN' ? '0 2px 6px rgba(79,70,229,0.3)' : 'none'
                          }}
                        >
                          FN
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSessionChange('AN')}
                          style={{
                            flex: 1, height: '30px', borderRadius: '6px', border: 'none', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                            background: session === 'AN' ? '#d97706' : 'transparent',
                            color: session === 'AN' ? '#fff' : 'var(--text-secondary)',
                            boxShadow: session === 'AN' ? '0 2px 6px rgba(217,119,6,0.3)' : 'none'
                          }}
                        >
                          AN
                        </button>
                      </div>
                    </div>

                    {/* Column 3: Bench Configuration */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label htmlFor="seatsPerBench" style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                        🪑 Bench Configuration *
                      </label>
                      <select 
                        id="seatsPerBench" 
                        value={seatsPerBench}
                        onChange={(e) => setSeatsPerBench(parseInt(e.target.value))}
                        style={{ height: '38px', fontSize: '12.5px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', width: '100%', fontWeight: 600 }}
                      >
                        <option value={2}>👥 2 Students / Bench</option>
                        <option value={3}>👥 3 Students / Bench</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Section 2: Direct Subject Codes Selector ─────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BookOpen size={16} style={{ color: 'var(--color-primary)' }} />
                      <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>2. Select Subject Codes *</h4>
                    </div>
                    {selectedSubjectCodes.length > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: 'rgba(79,70,229,0.1)', color: 'var(--color-primary)' }}>
                        {selectedSubjectCodes.length} selected
                      </span>
                    )}
                  </div>

                  {availableSubjectCodes.length === 0 ? (
                    <p style={{ 
                      fontSize: '13px', 
                      color: 'var(--text-secondary)', 
                      fontStyle: 'italic', 
                      padding: '20px', 
                      textAlign: 'center', 
                      background: 'var(--bg-card)', 
                      borderRadius: '10px', 
                      border: '1px dashed var(--border-color)',
                      margin: 0
                    }}>
                      No subject codes found in student records. Please upload student rosters first in Upload Data.
                    </p>
                  ) : (() => {
                    const { filteredCodes, availableYears } = filterSubjectCodes(availableSubjectCodes, subjectCodeSearch, activeYearFilter);
                    const allFilteredSelected = filteredCodes.length > 0 && filteredCodes.every(c => selectedSubjectCodes.includes(c.code));
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Search + Year Filter + Select All */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              placeholder="Search codes… (e.g. CS101, TAM111)"
                              value={subjectCodeSearch}
                              onChange={(e) => setSubjectCodeSearch(e.target.value)}
                              style={{ paddingLeft: '32px', fontSize: '12px', height: '34px', borderRadius: '8px', border: '1px solid var(--border-color)', width: '100%' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setActiveYearFilter('ALL')}
                              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                background: activeYearFilter === 'ALL' ? 'var(--color-primary)' : 'transparent',
                                color: activeYearFilter === 'ALL' ? '#fff' : 'var(--text-secondary)' }}>All Years</button>
                            {availableYears.map(year => (
                              <button type="button" key={year} onClick={() => setActiveYearFilter(year)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                  background: activeYearFilter === year ? 'var(--color-primary)' : 'transparent',
                                  color: activeYearFilter === year ? '#fff' : 'var(--text-secondary)' }}>{year}</button>
                            ))}
                          </div>
                          {filteredCodes.length > 0 && (
                            <button type="button" onClick={() => {
                              if (allFilteredSelected) {
                                setSelectedSubjectCodes(prev => prev.filter(c => !filteredCodes.map(f => f.code).includes(c)));
                              } else {
                                const toAdd = filteredCodes.map(f => f.code).filter(c => !selectedSubjectCodes.includes(c));
                                setSelectedSubjectCodes(prev => [...prev, ...toAdd]);
                              }
                            }} style={{ fontSize: '11px', padding: '4px 12px', borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 700, background: allFilteredSelected ? 'var(--color-primary)' : 'var(--bg-card)', color: allFilteredSelected ? '#fff' : 'var(--text-secondary)', transition: 'all 0.2s' }}>
                              {allFilteredSelected ? '✓ Deselect All' : 'Select All'}
                            </button>
                          )}
                        </div>

                        {/* Selected Tray */}
                        {selectedSubjectCodes.length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 12px', background: 'rgba(79,70,229,0.06)', borderRadius: '10px', border: '1px solid rgba(79,70,229,0.12)', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', marginRight: '4px' }}>Selected ({selectedSubjectCodes.length}):</span>
                            {selectedSubjectCodes.map(code => (
                              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px', fontSize: '11px', fontWeight: 700, borderRadius: '9999px', background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 4px rgba(79,70,229,0.2)' }}>
                                {code}
                                <span onClick={() => handleSubjectCodeToggle(code)} style={{ cursor: 'pointer', opacity: 0.85, fontWeight: 'bold' }}>×</span>
                              </span>
                            ))}
                            <button type="button" onClick={() => setSelectedSubjectCodes([])} style={{ marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 700 }}>Clear All</button>
                          </div>
                        )}

                        {/* Flat Subject Codes Pills Grid */}
                        <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px', background: 'var(--bg-card)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          {filteredCodes.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '13px', width: '100%', margin: 0 }}>No subject codes match your search.</p>
                          ) : (
                            filteredCodes.map(({ code }) => {
                              const count = examDate ? (remainingCounts[code.toUpperCase()] || 0) : 1;
                              const isDisabled = examDate && count === 0;
                              const isSelected = selectedSubjectCodes.includes(code);
                              return (
                                <button type="button" key={code}
                                  className={`checkbox-btn ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                  onClick={() => handleSubjectCodeToggle(code)}
                                  disabled={isDisabled}
                                  style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' } : { fontSize: '12px', padding: '7px 14px', borderRadius: '8px' }}
                                  title={isDisabled ? 'No remaining students for this code' : examDate ? `${count} students remaining` : ''}
                                >
                                  {isSelected && <Check size={11} style={{ marginRight: '4px' }} />}
                                  <span style={{ fontWeight: 700 }}>{code}</span>
                                  {examDate && count > 0 && <span style={{ fontSize: '9.5px', marginLeft: '4px', opacity: 0.8, fontWeight: 600 }}>({count})</span>}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* ── Section 3: Hall Allocation Cards ─────────────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Armchair size={16} style={{ color: 'var(--color-primary)' }} />
                      <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>3. Assign Examination Halls *</h4>
                    </div>
                    {selectedHalls.length > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                        {selectedHalls.length} halls ({totalAssignedCapacity} seats)
                      </span>
                    )}
                  </div>

                  {halls.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600, margin: 0 }}>
                      No halls available. Please add halls in Hall Management first!
                    </p>
                  ) : (
                    <div className="checkbox-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>
                      {halls.map((h) => {
                        const status = examDate ? hallAvailability[h.name] : null;
                        const isOccupied = status ? status.occupied : false;
                        const effectiveCap = getHallCapacityForBenchConfig(h, seatsPerBench);
                        const vacantText = status ? status.msg : `${effectiveCap} Seats`;
                        const isSelected = selectedHalls.includes(h.name);
                        const benchCount = h.benches || (h.rows && h.columns ? h.rows * h.columns : 0);
                        return (
                          <button
                            type="button"
                            key={h._id}
                            className={`checkbox-btn ${isSelected ? 'selected' : ''} ${isOccupied ? 'disabled' : ''}`}
                            onClick={() => handleHallToggle(h.name)}
                            disabled={isOccupied}
                            style={{
                              padding: '8px 12px',
                              borderRadius: '10px',
                              fontSize: '12px',
                              textAlign: 'left',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              border: isSelected ? '1.5px solid var(--color-primary)' : '1px solid var(--border-color)',
                              background: isSelected ? 'rgba(79,70,229,0.08)' : isOccupied ? 'var(--bg-app)' : 'var(--bg-card)',
                              opacity: isOccupied ? 0.5 : 1,
                              cursor: isOccupied ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s'
                            }}
                            title={isOccupied ? "Hall has no vacant seats left at this date/session" : ""}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontWeight: 800, fontSize: '12.5px', color: 'var(--text-primary)' }}>{h.name}</span>
                              {isSelected && <Check size={12} style={{ color: 'var(--color-primary)' }} />}
                            </div>
                            <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{benchCount > 0 ? `${benchCount} Benches` : `${h.rows}×${h.columns} Grid`} ({seatsPerBench} seats/bench)</span>
                              <span style={{ fontWeight: 700, color: isOccupied ? 'var(--color-error)' : 'var(--color-primary)' }}>{vacantText}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>

              <div className="modal-footer" style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {selectedSubjectCodes.length === 0 ? '⚠️ Select at least 1 subject code' : selectedHalls.length === 0 ? '⚠️ Assign at least 1 hall' : '✓ Ready to schedule'}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => setModalOpen(false)}
                    style={{ padding: '8px 18px', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary"
                    disabled={halls.length === 0 || selectedSubjectCodes.length === 0 || selectedHalls.length === 0}
                    style={{ padding: '8px 22px', fontSize: '13px', boxShadow: '0 4px 14px rgba(79,70,229,0.35)' }}
                  >
                    Schedule Exam
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}         {/* Edit Exam Modal */}
      {editModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '780px', maxWidth: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '16px' }}>
            {/* Styled Header */}
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(79,70,229,0.06), rgba(139,92,246,0.03))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
                }}>
                  <Edit2 size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
                    Edit Examination Details
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    Update scheduled exam date, session, subject codes, or hall assignments.
                  </p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setEditModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
                
                {/* ── Live Smart Summary Bar ─────────────────────── */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.07) 0%, rgba(5,150,105,0.04) 100%)',
                  border: '1px solid rgba(16,185,129,0.18)',
                  borderRadius: '12px',
                  padding: '12px 18px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CalendarDays size={11} /> Schedule
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {editExamDate ? new Date(editExamDate).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : 'Set Date'}
                      <span className={`status-pill ${editSession === 'FN' ? 'info' : 'warning'}`} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px' }}>
                        {editSession}
                      </span>
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <BookOpen size={11} /> Subjects
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#10b981' }}>
                      {editSelectedSubjectCodes.length} {editSelectedSubjectCodes.length === 1 ? 'Code' : 'Codes'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Users size={11} /> Students
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9' }}>
                      {typeof editTotalStudentsSelected === 'number' ? `${editTotalStudentsSelected} Students` : editTotalStudentsSelected}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Armchair size={11} /> Capacity
                    </span>
                    <span style={{
                      fontSize: '13px', fontWeight: 800,
                      color: typeof editTotalStudentsSelected === 'number' && editTotalStudentsSelected > 0
                        ? (editTotalAssignedCapacity >= editTotalStudentsSelected ? '#10b981' : '#f59e0b')
                        : 'var(--text-primary)'
                    }}>
                      {editTotalAssignedCapacity} Seats
                      {typeof editTotalStudentsSelected === 'number' && editTotalStudentsSelected > 0 && (
                        <span style={{
                          fontSize: '9.5px',
                          marginLeft: '4px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: editTotalAssignedCapacity >= editTotalStudentsSelected ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                          color: editTotalAssignedCapacity >= editTotalStudentsSelected ? '#10b981' : '#f59e0b'
                        }}>
                          {editTotalAssignedCapacity >= editTotalStudentsSelected ? '✓ OK' : '⚠️ Shortage'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                {/* ── Section 1: Schedule Configuration ─────────────────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>📅</span>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>Schedule Configuration</h4>
                    </div>
                    <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      Configure exam schedule before 📍 Assign Seats.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: '16px', alignItems: 'center', background: 'var(--bg-card)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    {/* Column 1: Exam Date */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label htmlFor="editExamDate" style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                        📅 Exam Date *
                      </label>
                      <input 
                        type="date" 
                        id="editExamDate" 
                        value={editExamDate}
                        onChange={(e) => setEditExamDate(e.target.value)}
                        required
                        style={{ height: '38px', fontSize: '13px', borderRadius: '8px', padding: '0 12px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', width: '100%', fontWeight: 600 }}
                      />
                    </div>

                    {/* Column 2: Session */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ☀️ Session *
                      </label>
                      <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-app)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)', height: '38px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleEditSessionChange('FN')}
                          style={{
                            flex: 1, height: '30px', borderRadius: '6px', border: 'none', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                            background: editSession === 'FN' ? 'var(--color-primary)' : 'transparent',
                            color: editSession === 'FN' ? '#fff' : 'var(--text-secondary)',
                            boxShadow: editSession === 'FN' ? '0 2px 6px rgba(79,70,229,0.3)' : 'none'
                          }}
                        >
                          FN
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditSessionChange('AN')}
                          style={{
                            flex: 1, height: '30px', borderRadius: '6px', border: 'none', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                            background: editSession === 'AN' ? '#d97706' : 'transparent',
                            color: editSession === 'AN' ? '#fff' : 'var(--text-secondary)',
                            boxShadow: editSession === 'AN' ? '0 2px 6px rgba(217,119,6,0.3)' : 'none'
                          }}
                        >
                          AN
                        </button>
                      </div>
                    </div>

                    {/* Column 3: Bench Configuration */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label htmlFor="editSeatsPerBench" style={{ fontWeight: 700, fontSize: '12px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                        🪑 Bench Configuration *
                      </label>
                      <select 
                        id="editSeatsPerBench" 
                        value={editSeatsPerBench}
                        onChange={(e) => setEditSeatsPerBench(parseInt(e.target.value))}
                        style={{ height: '38px', fontSize: '12.5px', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-app)', width: '100%', fontWeight: 600 }}
                      >
                        <option value={2}>👥 2 Students / Bench</option>
                        <option value={3}>👥 3 Students / Bench</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* ── Section 2: Direct Subject Codes Selector ─────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BookOpen size={16} style={{ color: 'var(--color-primary)' }} />
                      <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>2. Select Subject Codes *</h4>
                    </div>
                    {editSelectedSubjectCodes.length > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: 'rgba(79,70,229,0.1)', color: 'var(--color-primary)' }}>
                        {editSelectedSubjectCodes.length} selected
                      </span>
                    )}
                  </div>

                  {availableSubjectCodes.length === 0 ? (
                    <p style={{ 
                      fontSize: '13px', 
                      color: 'var(--text-secondary)', 
                      fontStyle: 'italic', 
                      padding: '20px', 
                      textAlign: 'center', 
                      background: 'var(--bg-card)', 
                      borderRadius: '10px', 
                      border: '1px dashed var(--border-color)',
                      margin: 0
                    }}>
                      No subject codes found in student records. Please upload student rosters first in Upload Data.
                    </p>
                  ) : (() => {
                    const { filteredCodes, availableYears } = filterSubjectCodes(availableSubjectCodes, editSubjectCodeSearch, editActiveYearFilter);
                    const allFilteredSelected = filteredCodes.length > 0 && filteredCodes.every(c => editSelectedSubjectCodes.includes(c.code));
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Search + Year Filter + Select All */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              placeholder="Search codes… (e.g. CS101, TAM111)"
                              value={editSubjectCodeSearch}
                              onChange={(e) => setEditSubjectCodeSearch(e.target.value)}
                              style={{ paddingLeft: '32px', fontSize: '12px', height: '34px', borderRadius: '8px', border: '1px solid var(--border-color)', width: '100%' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setEditActiveYearFilter('ALL')}
                              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                background: editActiveYearFilter === 'ALL' ? 'var(--color-primary)' : 'transparent',
                                color: editActiveYearFilter === 'ALL' ? '#fff' : 'var(--text-secondary)' }}>All Years</button>
                            {availableYears.map(year => (
                              <button type="button" key={year} onClick={() => setEditActiveYearFilter(year)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                  background: editActiveYearFilter === year ? 'var(--color-primary)' : 'transparent',
                                  color: editActiveYearFilter === year ? '#fff' : 'var(--text-secondary)' }}>{year}</button>
                            ))}
                          </div>
                          {filteredCodes.length > 0 && (
                            <button type="button" onClick={() => {
                              if (allFilteredSelected) {
                                setEditSelectedSubjectCodes(prev => prev.filter(c => !filteredCodes.map(f => f.code).includes(c)));
                              } else {
                                const toAdd = filteredCodes.map(f => f.code).filter(c => !editSelectedSubjectCodes.includes(c));
                                setEditSelectedSubjectCodes(prev => [...prev, ...toAdd]);
                              }
                            }} style={{ fontSize: '11px', padding: '4px 12px', borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 700, background: allFilteredSelected ? 'var(--color-primary)' : 'var(--bg-card)', color: allFilteredSelected ? '#fff' : 'var(--text-secondary)', transition: 'all 0.2s' }}>
                              {allFilteredSelected ? '✓ Deselect All' : 'Select All'}
                            </button>
                          )}
                        </div>

                        {/* Selected Tray */}
                        {editSelectedSubjectCodes.length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 12px', background: 'rgba(79,70,229,0.06)', borderRadius: '10px', border: '1px solid rgba(79,70,229,0.12)', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', marginRight: '4px' }}>Selected ({editSelectedSubjectCodes.length}):</span>
                            {editSelectedSubjectCodes.map(code => (
                              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px', fontSize: '11px', fontWeight: 700, borderRadius: '9999px', background: 'var(--color-primary)', color: '#fff', boxShadow: '0 2px 4px rgba(79,70,229,0.2)' }}>
                                {code}
                                <span onClick={() => handleEditSubjectCodeToggle(code)} style={{ cursor: 'pointer', opacity: 0.85, fontWeight: 'bold' }}>×</span>
                              </span>
                            ))}
                            <button type="button" onClick={() => setEditSelectedSubjectCodes([])} style={{ marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 700 }}>Clear All</button>
                          </div>
                        )}

                        {/* Flat Subject Codes Pills Grid */}
                        <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px', background: 'var(--bg-card)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          {filteredCodes.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '13px', width: '100%', margin: 0 }}>No subject codes match your search.</p>
                          ) : (
                            filteredCodes.map(({ code }) => {
                              const count = editExamDate ? (editRemainingCounts[code.toUpperCase()] || 0) : 1;
                              const isDisabled = editExamDate && count === 0;
                              const isSelected = editSelectedSubjectCodes.includes(code);
                              return (
                                <button type="button" key={code}
                                  className={`checkbox-btn ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                  onClick={() => handleEditSubjectCodeToggle(code)}
                                  disabled={isDisabled}
                                  style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' } : { fontSize: '12px', padding: '7px 14px', borderRadius: '8px' }}
                                  title={isDisabled ? 'No remaining students for this code' : editExamDate ? `${count} students remaining` : ''}
                                >
                                  {isSelected && <Check size={11} style={{ marginRight: '4px' }} />}
                                  <span style={{ fontWeight: 700 }}>{code}</span>
                                  {editExamDate && count > 0 && <span style={{ fontSize: '9.5px', marginLeft: '4px', opacity: 0.8, fontWeight: 600 }}>({count})</span>}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* ── Section 3: Hall Allocation Cards ─────────────── */}
                <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Armchair size={16} style={{ color: 'var(--color-primary)' }} />
                      <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>3. Assign Examination Halls *</h4>
                    </div>
                    {editSelectedHalls.length > 0 && (
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                        {editSelectedHalls.length} halls ({editTotalAssignedCapacity} seats)
                      </span>
                    )}
                  </div>

                  {halls.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600, margin: 0 }}>
                      No halls available. Please add halls in Hall Management first!
                    </p>
                  ) : (
                    <div className="checkbox-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>
                      {halls.map((h) => {
                        const status = editExamDate ? editHallAvailability[h.name] : null;
                        const isOccupied = status ? status.occupied : false;
                        const editEffectiveCap = getHallCapacityForBenchConfig(h, editSeatsPerBench);
                        const vacantText = status ? status.msg : `${editEffectiveCap} Seats`;
                        const isSelected = editSelectedHalls.includes(h.name);
                        const benchCount = h.benches || (h.rows && h.columns ? h.rows * h.columns : 0);
                        return (
                          <button
                            type="button"
                            key={h._id}
                            className={`checkbox-btn ${isSelected ? 'selected' : ''} ${isOccupied ? 'disabled' : ''}`}
                            onClick={() => handleEditHallToggle(h.name)}
                            disabled={isOccupied}
                            style={{
                              padding: '8px 12px',
                              borderRadius: '10px',
                              fontSize: '12px',
                              textAlign: 'left',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              border: isSelected ? '1.5px solid var(--color-primary)' : '1px solid var(--border-color)',
                              background: isSelected ? 'rgba(79,70,229,0.08)' : isOccupied ? 'var(--bg-app)' : 'var(--bg-card)',
                              opacity: isOccupied ? 0.5 : 1,
                              cursor: isOccupied ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s'
                            }}
                            title={isOccupied ? "Hall has no vacant seats left at this date/session" : ""}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontWeight: 800, fontSize: '12.5px', color: 'var(--text-primary)' }}>{h.name}</span>
                              {isSelected && <Check size={12} style={{ color: 'var(--color-primary)' }} />}
                            </div>
                            <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                              <span>{benchCount > 0 ? `${benchCount} Benches` : `${h.rows}×${h.columns} Grid`} ({editSeatsPerBench} seats/bench)</span>
                              <span style={{ fontWeight: 700, color: isOccupied ? 'var(--color-error)' : 'var(--color-primary)' }}>{vacantText}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

              </div>

              <div className="modal-footer" style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                  {editSelectedSubjectCodes.length === 0 ? '⚠️ Select at least 1 subject code' : editSelectedHalls.length === 0 ? '⚠️ Assign at least 1 hall' : '✓ Ready to save'}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={() => setEditModalOpen(false)}
                    style={{ padding: '8px 18px', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary"
                    disabled={halls.length === 0 || editSelectedSubjectCodes.length === 0 || editSelectedHalls.length === 0}
                    style={{ padding: '8px 22px', fontSize: '13px', boxShadow: '0 4px 14px rgba(16,185,129,0.35)', background: 'linear-gradient(135deg, #059669, #10b981)' }}
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Exam Location Summary Section */}
      <div className="card-container" style={{ marginTop: '24px' }}>
        <div className="card-title-bar">
          <div>
            <h3>Exam Location Summary</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              View and download student seating locations by Date and Session.
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="seating-controls" style={{ marginBottom: '24px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: '220px' }}>
            <label htmlFor="locDateSelect">Select Date</label>
            <select 
              id="locDateSelect"
              value={locDate}
              onChange={(e) => handleLocDateChange(e.target.value)}
            >
              <option value="">-- Choose Date --</option>
              {uniqueExamDates.map(d => (
                <option key={d} value={d}>
                  {getDateOptionLabel(d)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ flex: 1, minWidth: '220px' }}>
            <label htmlFor="locSessionSelect">Select Session</label>
            <select 
              id="locSessionSelect"
              value={locSession}
              onChange={(e) => setLocSession(e.target.value)}
            >
              <option value="FN">FN (Forenoon)</option>
              <option value="AN">AN (Afternoon)</option>
            </select>
          </div>

          <button 
            className="btn-primary" 
            onClick={fetchLocations}
            disabled={!locDate || locLoading}
            style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Search size={16} />
            <span>Search Locations</span>
          </button>

          {locations && locations.length > 0 && (
            <button 
              className="btn-secondary" 
              onClick={handleDownloadLocationsExcel}
              style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Download size={16} />
              <span>Download Location Sheet (.xlsx)</span>
            </button>
          )}
        </div>

        {/* Loading Indicator */}
        {locLoading && (
          <div style={{ textAlign: 'center', padding: '32px' }}>
            <div style={{ 
              width: '32px', 
              height: '32px', 
              border: '3px solid var(--border-color)', 
              borderTopColor: 'var(--color-primary)', 
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px auto'
            }} />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading locations data...</p>
          </div>
        )}

        {/* Error message */}
        {!locLoading && locError && (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-error)', fontWeight: 600, fontSize: '14px' }}>
            {locError}
          </div>
        )}

        {/* Seating Locations Display */}
        {!locLoading && locations && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {locations.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                No seating locations found for the selected date and session.
              </p>
            ) : (
              locations.map((loc) => {
                const depts = [...new Set(loc.classes.map(c => c.classCode.split('/')[0].trim()))].join(', ');
                return (
                  <div key={loc.hallName} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '16px', background: 'var(--bg-card)' }}>
                    
                    {/* Hall Header Line */}
                    <div style={{ 
                      fontSize: '14px', 
                      fontWeight: 'bold', 
                      marginBottom: '12px', 
                      padding: '8px 12px', 
                      background: 'var(--bg-app)', 
                      borderRadius: 'var(--radius-sm)',
                      borderLeft: '4px solid var(--color-primary)',
                      color: 'var(--text-primary)'
                    }}>
                      {depts} - HALL NO. {loc.hallName}
                    </div>

                    {/* Table */}
                    <div className="table-wrapper">
                      <table className="data-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                          <tr>
                            <th style={{ border: '1px solid var(--border-color)', padding: '8px', textAlign: 'center', width: '20%' }}>CLASS/ CODE NO</th>
                            <th style={{ border: '1px solid var(--border-color)', padding: '8px', textAlign: 'center', width: '50%' }}>REGISTER NO</th>
                            <th style={{ border: '1px solid var(--border-color)', padding: '8px', textAlign: 'center', width: '15%' }}>CANDIDATE NO</th>
                            <th style={{ border: '1px solid var(--border-color)', padding: '8px', textAlign: 'center', width: '15%' }}>TOTAL CANDIDATE NO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loc.classes.map((cls, idx) => (
                            <tr key={cls.classCode}>
                              <td style={{ border: '1px solid var(--border-color)', padding: '10px 8px', textAlign: 'center', fontWeight: 'bold' }}>
                                {cls.classCode}
                              </td>
                              <td style={{ border: '1px solid var(--border-color)', padding: '10px 8px', textAlign: 'center', fontSize: '13px' }}>
                                {cls.summarizedRange}
                              </td>
                              <td style={{ border: '1px solid var(--border-color)', padding: '10px 8px', textAlign: 'center' }}>
                                {cls.count}
                              </td>
                              {idx === 0 && (
                                <td 
                                  rowSpan={loc.classes.length} 
                                  style={{ 
                                    border: '1px solid var(--border-color)', 
                                    padding: '10px 8px', 
                                    textAlign: 'center', 
                                    fontWeight: 'bold',
                                    verticalAlign: 'middle',
                                    fontSize: '15px',
                                    color: 'var(--color-primary)',
                                    backgroundColor: 'var(--color-primary-light)'
                                  }}
                                >
                                  {loc.totalStudents}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ExamManagementView;
