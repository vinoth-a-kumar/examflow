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
  ChevronDown,
  ChevronRight
} from 'lucide-react';

function ExamManagementView({ exams, halls, students, onAddExam, onDeleteExam, onUpdateExam }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [examName, setExamName] = useState('');
  const [examDate, setExamDate] = useState('');
  const [session, setSession] = useState('FN');
  const [selectedSubjectCodes, setSelectedSubjectCodes] = useState([]);
  const [selectedHalls, setSelectedHalls] = useState([]);
  const [remainingCounts, setRemainingCounts] = useState({});
  const [hallAvailability, setHallAvailability] = useState({});
  const [availableSubjectCodes, setAvailableSubjectCodes] = useState([]);
  const [seatsPerBench, setSeatsPerBench] = useState(2);
  const [subjectCodeSearch, setSubjectCodeSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [activeYearFilter, setActiveYearFilter] = useState('ALL');

  // Edit states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  const [editExamName, setEditExamName] = useState('');
  const [editExamDate, setEditExamDate] = useState('');
  const [editSession, setEditSession] = useState('FN');
  const [editSelectedSubjectCodes, setEditSelectedSubjectCodes] = useState([]);
  const [editSelectedHalls, setEditSelectedHalls] = useState([]);
  const [editRemainingCounts, setEditRemainingCounts] = useState({});
  const [editHallAvailability, setEditHallAvailability] = useState({});
  const [editSeatsPerBench, setEditSeatsPerBench] = useState(2);
  const [editSubjectCodeSearch, setEditSubjectCodeSearch] = useState('');
  const [editExpandedGroups, setEditExpandedGroups] = useState({});
  const [editActiveYearFilter, setEditActiveYearFilter] = useState('ALL');

  const [selectedDepartments, setSelectedDepartments] = useState([]);
  const [editSelectedDepartments, setEditSelectedDepartments] = useState([]);

  // Extract all unique departments from students list
  const availableDepartments = useMemo(() => {
    if (!students || students.length === 0) return [];
    return [...new Set(students.map(s => s.department.toUpperCase()))].sort();
  }, [students]);

  // Map each department to its student's subject codes
  const deptToSubjectCodesMap = useMemo(() => {
    const map = {};
    if (!students) return map;
    students.forEach(s => {
      const dept = s.department.toUpperCase();
      if (!map[dept]) map[dept] = new Set();
      
      if (s.csvData) {
        Object.keys(s.csvData).forEach(k => {
          if (/sub.*code|subject.*code|sub_code|subcode/i.test(k)) {
            const val = s.csvData[k];
            if (val && val.toString().trim()) {
              map[dept].add(val.toString().trim().toUpperCase());
            }
          }
        });
      }
    });
    return map;
  }, [students]);

  // Filter subject codes by selected departments
  const displayedSubjectCodes = useMemo(() => {
    if (selectedDepartments.length === 0) return [];
    const allowedCodes = new Set();
    selectedDepartments.forEach(dept => {
      const codes = deptToSubjectCodesMap[dept];
      if (codes) {
        codes.forEach(c => allowedCodes.add(c));
      }
    });
    return availableSubjectCodes.filter(code => allowedCodes.has(code.toUpperCase()));
  }, [selectedDepartments, deptToSubjectCodesMap, availableSubjectCodes]);

  const editDisplayedSubjectCodes = useMemo(() => {
    if (editSelectedDepartments.length === 0) return [];
    const allowedCodes = new Set();
    editSelectedDepartments.forEach(dept => {
      const codes = deptToSubjectCodesMap[dept];
      if (codes) {
        codes.forEach(c => allowedCodes.add(c));
      }
    });
    return availableSubjectCodes.filter(code => allowedCodes.has(code.toUpperCase()));
  }, [editSelectedDepartments, deptToSubjectCodesMap, availableSubjectCodes]);

  const handleDepartmentToggle = (dept) => {
    if (selectedDepartments.includes(dept)) {
      setSelectedDepartments(selectedDepartments.filter(d => d !== dept));
      // Remove selected subject codes not in allowed set of remaining departments
      const allowed = new Set();
      selectedDepartments.filter(d => d !== dept).forEach(d => {
        const codes = deptToSubjectCodesMap[d];
        if (codes) codes.forEach(c => allowed.add(c));
      });
      setSelectedSubjectCodes(prev => prev.filter(c => allowed.has(c.toUpperCase())));
    } else {
      setSelectedDepartments([...selectedDepartments, dept]);
    }
  };

  const handleEditDepartmentToggle = (dept) => {
    if (editSelectedDepartments.includes(dept)) {
      setEditSelectedDepartments(editSelectedDepartments.filter(d => d !== dept));
      // Remove selected subject codes
      const allowed = new Set();
      editSelectedDepartments.filter(d => d !== dept).forEach(d => {
        const codes = deptToSubjectCodesMap[d];
        if (codes) codes.forEach(c => allowed.add(c));
      });
      setEditSelectedSubjectCodes(prev => prev.filter(c => allowed.has(c.toUpperCase())));
    } else {
      setEditSelectedDepartments([...editSelectedDepartments, dept]);
    }
  };

  // Helper: Group subject codes by department prefix and detect year
  const groupSubjectCodes = (codes, searchQuery, yearFilter) => {
    // Parse each code into { prefix, number, year, code }
    const parsed = codes.map(code => {
      const match = code.match(/^([A-Z]+)(\d+)$/);
      if (!match) return { prefix: 'OTHER', number: code, year: 'OTHER', code };
      const prefix = match[1];
      const num = parseInt(match[2]);
      // Detect year from first digit of numeric part
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

    // Group by prefix (split common languages from department core subjects)
    const groups = {};
    filtered.forEach(p => {
      let groupKey = p.prefix;
      if (p.prefix === 'TAM') {
        if (p.code === 'TAM111' || p.code === 'TAM211') {
          groupKey = 'TAM_COMMON';
        } else {
          groupKey = 'TAM_DEPT';
        }
      } else if (p.prefix === 'ENG') {
        if (p.code === 'ENG111' || p.code === 'ENG211') {
          groupKey = 'ENG_COMMON';
        } else {
          groupKey = 'ENG_DEPT';
        }
      }

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(p);
    });

    // Sort codes within each group numerically
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.number - b.number);
    });

    // Get available years for filter tabs
    const availableYears = [...new Set(parsed.map(p => p.year))].sort();

    // Sort group keys: common subjects (TAM_COMMON, ENG_COMMON) first, then alphabetically
    const commonPrefixes = ['TAM_COMMON', 'ENG_COMMON'];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const aCommon = commonPrefixes.includes(a);
      const bCommon = commonPrefixes.includes(b);
      if (aCommon && !bCommon) return -1;
      if (!aCommon && bCommon) return 1;
      return a.localeCompare(b);
    });

    return { groups, sortedKeys, availableYears };
  };

  // Department display name mapping
  const deptDisplayNames = {
    TAM_COMMON: 'Tamil (Common)',
    ENG_COMMON: 'English (Common)',
    TAM_DEPT: 'Tamil (Department Core)',
    ENG_DEPT: 'English (Department Core)',
    CS: 'Computer Science', CA: 'Computer Application',
    COM: 'B.Com (Commerce)', BBA: 'BBA',
    ECO: 'Economics', CHE: 'Chemistry',
    BOT: 'Botany', ZOO: 'Zoology',
    MAT: 'Mathematics', PHY: 'Physics',
    MBA: 'MBA', MCA: 'MCA',
    MSC: 'M.Sc', MCOM: 'M.Com',
    MSBOT: 'M.Sc Botany', MSCHE: 'M.Sc Chemistry',
    MSMAT: 'M.Sc Mathematics', MSPHY: 'M.Sc Physics',
    MSZOO: 'M.Sc Zoology', MAECO: 'M.A Economics',
    MAENG: 'M.A English', MATAM: 'M.A Tamil'
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
        const response = await fetch(`http://localhost:5000/api/halls/availability?date=${examDate}&session=${session}`);
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
  }, [examDate, session]);

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
        const response = await fetch(`http://localhost:5000/api/halls/availability?date=${editExamDate}&session=${editSession}&excludeExamId=${editingExam._id}`);
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
  }, [editExamDate, editSession, editingExam]);

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

    const generatedExamName = selectedDepartments.length > 0 
      ? selectedDepartments.join(', ') 
      : (selectedSubjectCodes.length > 0 ? selectedSubjectCodes.slice(0, 3).join(', ') : 'Exam');

    onAddExam({
      name: generatedExamName,
      subjectCodes: selectedSubjectCodes,
      departments: selectedDepartments,
      date: examDate,
      session: session,
      assignedHalls: selectedHalls,
      seatsPerBench: seatsPerBench
    });

    // Reset and close
    setExamName('');
    setExamDate('');
    setSession('FN');
    setSelectedSubjectCodes([]);
    setSelectedHalls([]);
    setSeatsPerBench(2);
    setSubjectCodeSearch('');
    setExpandedGroups({});
    setActiveYearFilter('ALL');
    setSelectedDepartments([]);
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

    const generatedEditExamName = editSelectedDepartments.length > 0 
      ? editSelectedDepartments.join(', ') 
      : (editSelectedSubjectCodes.length > 0 ? editSelectedSubjectCodes.slice(0, 3).join(', ') : 'Exam');

    onUpdateExam(editingExam._id, {
      name: generatedEditExamName,
      subjectCodes: editSelectedSubjectCodes,
      departments: editSelectedDepartments,
      date: editExamDate,
      session: editSession,
      assignedHalls: editSelectedHalls,
      seatsPerBench: editSeatsPerBench
    });

    // Reset and close
    setEditingExam(null);
    setEditExamName('');
    setEditExamDate('');
    setEditSession('FN');
    setEditSelectedSubjectCodes([]);
    setEditSelectedHalls([]);
    setEditSeatsPerBench(2);
    setEditSubjectCodeSearch('');
    setEditExpandedGroups({});
    setEditActiveYearFilter('ALL');
    setEditSelectedDepartments([]);
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
                <th>Session</th>
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
                        {(e.subjectCodes && e.subjectCodes.length > 0 ? e.subjectCodes : e.departments)?.map((code) => (
                          <span key={code} className="status-pill info" style={{ fontSize: '10px', padding: '2px 6px' }}>
                            {code}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{new Date(e.date).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>
                      <span className="status-pill info" style={{ fontWeight: 600 }}>
                        {e.seatsPerBench || 2} Seats
                      </span>
                    </td>
                    <td>
                      <span className="status-pill warning" style={{ fontWeight: 700 }}>
                        {e.session}
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
                          e.assignedHallsDetails.map((hall) => (
                            <span key={hall.name} style={{ 
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
                            setEditSelectedSubjectCodes(e.subjectCodes || e.departments || []);
                            setEditSelectedHalls(e.assignedHalls || []);
                            setEditSeatsPerBench(e.seatsPerBench || 2);
                            
                            // Initialize editSelectedDepartments with fallback auto-detection
                            const initialDepts = e.departments || [];
                            if (initialDepts.length === 0 && e.subjectCodes) {
                              const detected = [];
                              e.subjectCodes.forEach(code => {
                                const match = code.match(/^([A-Z]+)\d+$/);
                                if (match) {
                                  const prefix = match[1];
                                  if (prefix !== 'TAM' && prefix !== 'ENG' && availableDepartments.includes(prefix)) {
                                    detected.push(prefix);
                                  }
                                }
                              });
                              setEditSelectedDepartments([...new Set(detected)]);
                            } else {
                              setEditSelectedDepartments(initialDepts);
                            }
                            
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

                <div className="form-group">
                  <label htmlFor="seatsPerBench">Seats per Bench</label>
                  <select 
                    id="seatsPerBench" 
                    value={seatsPerBench}
                    onChange={(e) => setSeatsPerBench(parseInt(e.target.value))}
                  >
                    <option value={2}>2 Students per Bench (Left, Right)</option>
                    <option value={3}>3 Students per Bench (Left, Middle, Right)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Select Departments having this exam</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {availableDepartments.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No departments found. Please upload student rosters first.</p>
                    ) : (
                      availableDepartments.map(dept => (
                        <button
                          type="button"
                          key={dept}
                          className={`checkbox-btn ${selectedDepartments.includes(dept) ? 'selected' : ''}`}
                          onClick={() => handleDepartmentToggle(dept)}
                          style={{ fontSize: '11px', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}
                        >
                          {selectedDepartments.includes(dept) && <Check size={11} style={{ marginRight: '4px', display: 'inline' }} />}
                          {dept}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Select Subject Codes for this exam</label>
                  {selectedDepartments.length === 0 ? (
                    <p style={{ 
                      fontSize: '13px', 
                      color: 'var(--text-secondary)', 
                      fontStyle: 'italic', 
                      padding: '16px', 
                      textAlign: 'center', 
                      background: 'var(--bg-app)', 
                      borderRadius: 'var(--radius-md)', 
                      border: '1px dashed var(--border-color)',
                      margin: 0
                    }}>
                      Please select department(s) above first to display and select subject codes.
                    </p>
                  ) : displayedSubjectCodes.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600, margin: 0 }}>
                      No subject codes found for the selected department(s).
                    </p>
                  ) : (() => {
                    const { groups, sortedKeys, availableYears } = groupSubjectCodes(displayedSubjectCodes, subjectCodeSearch, activeYearFilter);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Search + Year Filter */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              placeholder="Search codes... (e.g. CS, TAM)"
                              value={subjectCodeSearch}
                              onChange={(e) => setSubjectCodeSearch(e.target.value)}
                              style={{ paddingLeft: '32px', fontSize: '12px', height: '34px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', width: '100%' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setActiveYearFilter('ALL')}
                              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                background: activeYearFilter === 'ALL' ? 'var(--color-primary)' : 'transparent',
                                color: activeYearFilter === 'ALL' ? '#fff' : 'var(--text-secondary)' }}>All</button>
                            {availableYears.map(year => (
                              <button type="button" key={year} onClick={() => setActiveYearFilter(year)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                  background: activeYearFilter === year ? 'var(--color-primary)' : 'transparent',
                                  color: activeYearFilter === year ? '#fff' : 'var(--text-secondary)' }}>{year}</button>
                            ))}
                          </div>
                        </div>

                        {selectedSubjectCodes.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '8px 12px', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-sm)', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', marginRight: '4px' }}>Selected ({selectedSubjectCodes.length}):</span>
                            {selectedSubjectCodes.map(code => (
                              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', background: 'var(--color-primary)', color: '#fff' }}>
                                {code}
                                <span onClick={() => handleSubjectCodeToggle(code)} style={{ cursor: 'pointer', opacity: 0.8, fontWeight: 'bold' }}>×</span>
                              </span>
                            ))}
                            <button type="button" onClick={() => setSelectedSubjectCodes([])} style={{ marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 600 }}>Clear All</button>
                          </div>
                        )}

                        {/* Grouped Subject Codes */}
                        <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '4px' }}>
                          {sortedKeys.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '13px' }}>No subject codes match your search.</p>
                          ) : (
                            sortedKeys.map(prefix => {
                              const codesInGroup = groups[prefix];
                              const isExpanded = expandedGroups[prefix] !== false;
                              const allSelected = codesInGroup.every(c => selectedSubjectCodes.includes(c.code));
                              const someSelected = codesInGroup.some(c => selectedSubjectCodes.includes(c.code));
                              return (
                                <div key={prefix} style={{ marginBottom: '2px' }}>
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', cursor: 'pointer', borderRadius: 'var(--radius-sm)', background: someSelected ? 'var(--color-primary-light)' : 'var(--bg-app)', transition: 'background 0.2s', userSelect: 'none' }}
                                    onClick={() => setExpandedGroups(prev => ({ ...prev, [prefix]: !isExpanded }))}
                                  >
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>{deptDisplayNames[prefix] || prefix}</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>{codesInGroup.length} codes</span>
                                    <button type="button" onClick={(e) => {
                                      e.stopPropagation();
                                      if (allSelected) {
                                        setSelectedSubjectCodes(prev => prev.filter(c => !codesInGroup.map(g => g.code).includes(c)));
                                      } else {
                                        const newCodes = codesInGroup.map(c => c.code).filter(c => !selectedSubjectCodes.includes(c));
                                        setSelectedSubjectCodes(prev => [...prev, ...newCodes]);
                                      }
                                    }} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, background: allSelected ? 'var(--color-primary)' : 'transparent', color: allSelected ? '#fff' : 'var(--text-secondary)', transition: 'all 0.2s' }}>
                                      {allSelected ? '✓ All' : 'Select All'}
                                    </button>
                                  </div>
                                  {isExpanded && (
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '6px 10px 10px 28px' }}>
                                      {codesInGroup.map(({ code }) => {
                                        const count = examDate ? (remainingCounts[code.toUpperCase()] || 0) : 1;
                                        const isDisabled = examDate && count === 0;
                                        return (
                                          <button type="button" key={code}
                                            className={`checkbox-btn ${selectedSubjectCodes.includes(code) ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            onClick={() => handleSubjectCodeToggle(code)}
                                            disabled={isDisabled}
                                            style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' } : { fontSize: '12px' }}
                                            title={isDisabled ? 'No remaining students for this code' : examDate ? `${count} students remaining` : ''}
                                          >
                                            {selectedSubjectCodes.includes(code) && <Check size={10} style={{ marginRight: '3px' }} />}
                                            {code}
                                            {examDate && count > 0 && <span style={{ fontSize: '9px', marginLeft: '3px', opacity: 0.7 }}>({count})</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
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
                      {halls.map((h) => {
                        const status = examDate ? hallAvailability[h.name] : null;
                        const isOccupied = status ? status.occupied : false;
                        const vacantText = status ? status.msg : `${h.capacity} Seats`;
                        return (
                          <button
                            type="button"
                            key={h._id}
                            className={`checkbox-btn ${selectedHalls.includes(h.name) ? 'selected' : ''} ${isOccupied ? 'disabled' : ''}`}
                            onClick={() => handleHallToggle(h.name)}
                            disabled={isOccupied}
                            style={isOccupied ? { 
                              opacity: 0.5, 
                              cursor: 'not-allowed', 
                              backgroundColor: 'var(--bg-app)', 
                              borderColor: 'var(--border-color)',
                              color: 'var(--text-muted)' 
                            } : {}}
                            title={isOccupied ? "Hall has no vacant seats left at this date/session" : ""}
                          >
                            {selectedHalls.includes(h.name) && <Check size={12} style={{ marginRight: '4px', display: 'inline' }} />}
                            {h.name} ({vacantText}){isOccupied ? ' [Occupied]' : ''}
                          </button>
                        );
                      })}
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
      {/* Edit Exam Modal */}
      {editModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '560px' }}>
            <div className="modal-header">
              <h3>Edit Exam Configuration</h3>
              <button className="modal-close" onClick={() => setEditModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="editExamDate">Exam Date</label>
                    <input 
                      type="date" 
                      id="editExamDate" 
                      value={editExamDate}
                      onChange={(e) => setEditExamDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="editSession">Session</label>
                    <select 
                      id="editSession" 
                      value={editSession}
                      onChange={(e) => setEditSession(e.target.value)}
                    >
                      <option value="FN">FN (Forenoon 10:00 AM - 01:00 PM)</option>
                      <option value="AN">AN (Afternoon 02:00 PM - 05:00 PM)</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="editSeatsPerBench">Seats per Bench</label>
                  <select 
                    id="editSeatsPerBench" 
                    value={editSeatsPerBench}
                    onChange={(e) => setEditSeatsPerBench(parseInt(e.target.value))}
                  >
                    <option value={2}>2 Students per Bench (Left, Right)</option>
                    <option value={3}>3 Students per Bench (Left, Middle, Right)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Select Departments having this exam</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {availableDepartments.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No departments found. Please upload student rosters first.</p>
                    ) : (
                      availableDepartments.map(dept => (
                        <button
                          type="button"
                          key={dept}
                          className={`checkbox-btn ${editSelectedDepartments.includes(dept) ? 'selected' : ''}`}
                          onClick={() => handleEditDepartmentToggle(dept)}
                          style={{ fontSize: '11px', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}
                        >
                          {editSelectedDepartments.includes(dept) && <Check size={11} style={{ marginRight: '4px', display: 'inline' }} />}
                          {dept}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Select Subject Codes for this exam</label>
                  {editSelectedDepartments.length === 0 ? (
                    <p style={{ 
                      fontSize: '13px', 
                      color: 'var(--text-secondary)', 
                      fontStyle: 'italic', 
                      padding: '16px', 
                      textAlign: 'center', 
                      background: 'var(--bg-app)', 
                      borderRadius: 'var(--radius-md)', 
                      border: '1px dashed var(--border-color)',
                      margin: 0
                    }}>
                      Please select department(s) above first to display and select subject codes.
                    </p>
                  ) : editDisplayedSubjectCodes.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--color-error)', fontWeight: 600, margin: 0 }}>
                      No subject codes found for the selected department(s).
                    </p>
                  ) : (() => {
                    const { groups, sortedKeys, availableYears } = groupSubjectCodes(editDisplayedSubjectCodes, editSubjectCodeSearch, editActiveYearFilter);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Search + Year Filter */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
                            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              placeholder="Search codes... (e.g. CS, TAM)"
                              value={editSubjectCodeSearch}
                              onChange={(e) => setEditSubjectCodeSearch(e.target.value)}
                              style={{ paddingLeft: '32px', fontSize: '12px', height: '34px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', width: '100%' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setEditActiveYearFilter('ALL')}
                              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                background: editActiveYearFilter === 'ALL' ? 'var(--color-primary)' : 'transparent',
                                color: editActiveYearFilter === 'ALL' ? '#fff' : 'var(--text-secondary)' }}>All</button>
                            {availableYears.map(year => (
                              <button type="button" key={year} onClick={() => setEditActiveYearFilter(year)}
                                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
                                  background: editActiveYearFilter === year ? 'var(--color-primary)' : 'transparent',
                                  color: editActiveYearFilter === year ? '#fff' : 'var(--text-secondary)' }}>{year}</button>
                            ))}
                          </div>
                        </div>

                        {editSelectedSubjectCodes.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '8px 12px', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-sm)', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', marginRight: '4px' }}>Selected ({editSelectedSubjectCodes.length}):</span>
                            {editSelectedSubjectCodes.map(code => (
                              <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', background: 'var(--color-primary)', color: '#fff' }}>
                                {code}
                                <span onClick={() => handleEditSubjectCodeToggle(code)} style={{ cursor: 'pointer', opacity: 0.8, fontWeight: 'bold' }}>×</span>
                              </span>
                            ))}
                            <button type="button" onClick={() => setEditSelectedSubjectCodes([])} style={{ marginLeft: 'auto', fontSize: '11px', background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontWeight: 600 }}>Clear All</button>
                          </div>
                        )}

                        {/* Grouped Subject Codes */}
                        <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '4px' }}>
                          {sortedKeys.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '13px' }}>No subject codes match your search.</p>
                          ) : (
                            sortedKeys.map(prefix => {
                              const codesInGroup = groups[prefix];
                              const isExpanded = editExpandedGroups[prefix] !== false;
                              const allSelected = codesInGroup.every(c => editSelectedSubjectCodes.includes(c.code));
                              const someSelected = codesInGroup.some(c => editSelectedSubjectCodes.includes(c.code));
                              return (
                                <div key={prefix} style={{ marginBottom: '2px' }}>
                                  <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', cursor: 'pointer', borderRadius: 'var(--radius-sm)', background: someSelected ? 'var(--color-primary-light)' : 'var(--bg-app)', transition: 'background 0.2s', userSelect: 'none' }}
                                    onClick={() => setEditExpandedGroups(prev => ({ ...prev, [prefix]: !isExpanded }))}
                                  >
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    <span style={{ fontWeight: 700, fontSize: '13px', flex: 1 }}>{deptDisplayNames[prefix] || prefix}</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>{codesInGroup.length} codes</span>
                                    <button type="button" onClick={(e) => {
                                      e.stopPropagation();
                                      if (allSelected) {
                                        setEditSelectedSubjectCodes(prev => prev.filter(c => !codesInGroup.map(g => g.code).includes(c)));
                                      } else {
                                        const newCodes = codesInGroup.map(c => c.code).filter(c => !editSelectedSubjectCodes.includes(c));
                                        setEditSelectedSubjectCodes(prev => [...prev, ...newCodes]);
                                      }
                                    }} style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, background: allSelected ? 'var(--color-primary)' : 'transparent', color: allSelected ? '#fff' : 'var(--text-secondary)', transition: 'all 0.2s' }}>
                                      {allSelected ? '✓ All' : 'Select All'}
                                    </button>
                                  </div>
                                  {isExpanded && (
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '6px 10px 10px 28px' }}>
                                      {codesInGroup.map(({ code }) => {
                                        const count = editExamDate ? (editRemainingCounts[code.toUpperCase()] || 0) : 1;
                                        const isDisabled = editExamDate && count === 0;
                                        return (
                                          <button type="button" key={code}
                                            className={`checkbox-btn ${editSelectedSubjectCodes.includes(code) ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            onClick={() => handleEditSubjectCodeToggle(code)}
                                            disabled={isDisabled}
                                            style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' } : { fontSize: '12px' }}
                                            title={isDisabled ? 'No remaining students for this code' : editExamDate ? `${count} students remaining` : ''}
                                          >
                                            {editSelectedSubjectCodes.includes(code) && <Check size={10} style={{ marginRight: '3px' }} />}
                                            {code}
                                            {editExamDate && count > 0 && <span style={{ fontSize: '9px', marginLeft: '3px', opacity: 0.7 }}>({count})</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
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
                      {halls.map((h) => {
                        const status = editExamDate ? editHallAvailability[h.name] : null;
                        const isOccupied = status ? status.occupied : false;
                        const vacantText = status ? status.msg : `${h.capacity} Seats`;
                        return (
                          <button
                            type="button"
                            key={h._id}
                            className={`checkbox-btn ${editSelectedHalls.includes(h.name) ? 'selected' : ''} ${isOccupied ? 'disabled' : ''}`}
                            onClick={() => handleEditHallToggle(h.name)}
                            disabled={isOccupied}
                            style={isOccupied ? { 
                              opacity: 0.5, 
                              cursor: 'not-allowed', 
                              backgroundColor: 'var(--bg-app)', 
                              borderColor: 'var(--border-color)',
                              color: 'var(--text-muted)' 
                            } : {}}
                            title={isOccupied ? "Hall has no vacant seats left at this date/session" : ""}
                          >
                            {editSelectedHalls.includes(h.name) && <Check size={12} style={{ marginRight: '4px', display: 'inline' }} />}
                            {h.name} ({vacantText}){isOccupied ? ' [Occupied]' : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => setEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={halls.length === 0}
                >
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

export default ExamManagementView;
