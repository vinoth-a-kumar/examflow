import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Armchair, 
  Info, 
  Printer, 
  Search, 
  Download, 
  ChevronDown, 
  ChevronUp,
  Sliders,
  X,
  Check,
  Plus,
  Minus,
  Layers
} from 'lucide-react';

function SeatingPlanView({ exams, halls, collegeDetails, refreshData }) {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSession, setSelectedSession] = useState('FN');
  const [selectedHallId, setSelectedHallId] = useState('');
  const [showAllUnseated, setShowAllUnseated] = useState(false);
  const [showAllSeating, setShowAllSeating] = useState(true);
  const [seatingPlan, setSeatingPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewFormat, setViewFormat] = useState('university');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
  const [selectedSubCodeFilter, setSelectedSubCodeFilter] = useState('ALL');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState('ALL');
  const [rosterHallScope, setRosterHallScope] = useState('ALL');
  const [rosterData, setRosterData] = useState(null);
  const [showLabelExportMenu, setShowLabelExportMenu] = useState(false);
  const [allHallsLabelSequence, setAllHallsLabelSequence] = useState([]);

  // Hall Grid Layout (Rows & Columns) Customization State
  const [isLayoutModalOpen, setIsLayoutModalOpen] = useState(false);
  const [customCols, setCustomCols] = useState(4);
  const [columnRows, setColumnRows] = useState([6, 6, 6, 6]);
  const [bulkRowVal, setBulkRowVal] = useState(6);
  const [customSeatsPerBench, setCustomSeatsPerBench] = useState(2);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [layoutSuccessMsg, setLayoutSuccessMsg] = useState('');

  // Fetch overall all-halls student sequence for printing
  const fetchAllHallsLabelSequence = useCallback(async () => {
    if (!selectedDate || !selectedSession) return;
    try {
      const base = window.API_BASE || 'http://localhost:5000';
      const response = await fetch(`${base}/api/seating/labels/download-csv?date=${selectedDate}&session=${selectedSession}`);
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
    const base = window.API_BASE || 'http://localhost:5000';
    const url = `${base}/api/seating/labels/download-pdf?date=${selectedDate}&session=${selectedSession}`;
    window.open(url, '_blank');
  };

  const handleDownloadLabelsExcel = () => {
    if (!selectedDate || !selectedSession) return;
    const base = window.API_BASE || 'http://localhost:5000';
    const url = `${base}/api/seating/labels/download-excel?date=${selectedDate}&session=${selectedSession}`;
    window.open(url, '_blank');
  };

  const handleDownloadLabelsCsv = () => {
    if (!selectedDate || !selectedSession) return;
    const base = window.API_BASE || 'http://localhost:5000';
    const url = `${base}/api/seating/labels/download-csv?date=${selectedDate}&session=${selectedSession}`;
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
    setSelectedDeptFilter('ALL');
    setSelectedSubCodeFilter('ALL');
    setSelectedLevelFilter('ALL');
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

  // Find all halls assigned to any exams on the selected date and session strictly in configured hall order
  const examHalls = React.useMemo(() => {
    const result = [];
    const seen = new Set();
    examsOnSelectedDate.forEach(e => {
      if (Array.isArray(e.assignedHalls)) {
        e.assignedHalls.forEach(hIdentifier => {
          const key = String(hIdentifier).trim();
          const lowerKey = key.toLowerCase();
          if (!seen.has(lowerKey)) {
            seen.add(lowerKey);
            let hallObj = null;
            if (e.hallSnapshots) {
              hallObj = e.hallSnapshots[key] ||
                        e.hallSnapshots[String(key)] ||
                        Object.values(e.hallSnapshots).find(s => s && (s.name === key || String(s._id) === key));
            }
            if (!hallObj && Array.isArray(halls)) {
              hallObj = halls.find(h => h && (h.name === key || String(h._id) === key));
            }
            if (hallObj) {
              result.push(hallObj);
            } else {
              result.push({ _id: key, name: key });
            }
          }
        });
      }
    });
    return result;
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

  // Dynamically extract all available Subject Codes for the selected Date and Session (UG first, then PG)
  const availableSubCodesForDate = useMemo(() => {
    if (!selectedDate || !selectedSession || !exams) return [];
    const targetDateStr = selectedDate.split('T')[0];
    const examsOnDate = exams.filter(e => e.date && e.date.split('T')[0] === targetDateStr && e.session === selectedSession);
    const codes = new Set();
    examsOnDate.forEach(e => {
      (e.subjectCodes || []).forEach(c => {
        if (c && c.trim()) codes.add(c.trim().toUpperCase());
      });
    });
    (rosterData?.subjectCodes || []).forEach(c => {
      if (c && c.trim()) codes.add(c.trim().toUpperCase());
    });
    const allCodes = Array.from(codes);
    if (rosterData?.subjectCodes && rosterData.subjectCodes.length > 0) {
      const backendOrder = rosterData.subjectCodes;
      return allCodes.sort((a, b) => {
        const idxA = backendOrder.indexOf(a);
        const idxB = backendOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });
    }
    return allCodes.sort();
  }, [selectedDate, selectedSession, exams, rosterData]);

  // Handle download Excel action (Department-wise or All Departments, Subject-wise or All Subjects, Level-wise or All Levels)
  const handleDownloadExcel = () => {
    if (!selectedDate || !selectedSession) return;
    const base = window.API_BASE || 'http://localhost:5000';
    let url = `${base}/api/seating/download-roster?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
    if (selectedSubCodeFilter && selectedSubCodeFilter !== 'ALL') {
      url += `&subjectCodes=${encodeURIComponent(selectedSubCodeFilter)}`;
    }
    if (selectedLevelFilter && selectedLevelFilter !== 'ALL') {
      url += `&level=${encodeURIComponent(selectedLevelFilter)}`;
    }
    if (rosterHallScope === 'CURRENT' && selectedHallId) {
      url += `&hallId=${encodeURIComponent(selectedHallId)}`;
    } else {
      url += `&hallId=ALL`;
    }
    window.open(url, '_blank');
  };

  // Handle download PDF action (Department-wise or All Departments, Subject-wise or All Subjects, Level-wise or All Levels)
  const handleDownloadRosterPdf = () => {
    if (!selectedDate || !selectedSession) return;
    const base = window.API_BASE || 'http://localhost:5000';
    let url = `${base}/api/seating/roster/download-pdf?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
    if (selectedSubCodeFilter && selectedSubCodeFilter !== 'ALL') {
      url += `&subjectCodes=${encodeURIComponent(selectedSubCodeFilter)}`;
    }
    if (selectedLevelFilter && selectedLevelFilter !== 'ALL') {
      url += `&level=${encodeURIComponent(selectedLevelFilter)}`;
    }
    if (rosterHallScope === 'CURRENT' && selectedHallId) {
      url += `&hallId=${encodeURIComponent(selectedHallId)}`;
    } else {
      url += `&hallId=ALL`;
    }
    window.open(url, '_blank');
  };

  const fetchRosterData = useCallback(async () => {
    if (!selectedDate || !selectedSession) return;
    try {
      let url = `http://localhost:5000/api/seating/attendance-roster?date=${selectedDate}&session=${selectedSession}&department=${selectedDeptFilter}`;
      if (selectedSubCodeFilter && selectedSubCodeFilter !== 'ALL') {
        url += `&subjectCodes=${encodeURIComponent(selectedSubCodeFilter)}`;
      }
      if (selectedLevelFilter && selectedLevelFilter !== 'ALL') {
        url += `&level=${encodeURIComponent(selectedLevelFilter)}`;
      }
      if (rosterHallScope === 'CURRENT' && selectedHallId) {
        url += `&hallId=${encodeURIComponent(selectedHallId)}`;
      } else {
        url += `&hallId=ALL`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setRosterData(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [selectedDate, selectedSession, selectedDeptFilter, selectedSubCodeFilter, selectedLevelFilter, rosterHallScope, selectedHallId]);

  useEffect(() => {
    if (selectedDate && selectedSession) {
      fetchRosterData();
    }
  }, [selectedDate, selectedSession, fetchRosterData]);

  const selectedHall = useMemo(() => {
    return (halls || []).find(h => h && (h._id === selectedHallId || h.name === selectedHallId));
  }, [halls, selectedHallId]);

  const colsCount = useMemo(() => {
    if (seatingPlan && seatingPlan.hallSnapshot && seatingPlan.hallSnapshot.columns) {
      return seatingPlan.hallSnapshot.columns;
    }
    if (seatingPlan && seatingPlan.columns) {
      return seatingPlan.columns;
    }
    if (seatingPlan && seatingPlan.seatingGrid && seatingPlan.seatingGrid.length > 0) {
      const maxCol = Math.max(...seatingPlan.seatingGrid.map(b => b.col || parseInt(String(b.benchCode || '').replace(/^[A-Za-z]+/, '') || 1)));
      if (maxCol && !isNaN(maxCol) && maxCol > 0) return maxCol;
    }
    return selectedHall ? (selectedHall.columns || 4) : 4;
  }, [seatingPlan, selectedHall]);

  // Helper to get alphabetic row letter (0 -> A, 25 -> Z, 26 -> AA)
  const getRowLetterHelper = (r) => {
    let s = '';
    let temp = r;
    while (temp >= 0) {
      s = String.fromCharCode(65 + (temp % 26)) + s;
      temp = Math.floor(temp / 26) - 1;
    }
    return s;
  };

  // Helper to compute hall maximum benches based on hall records
  const getHallMaxBenches = (hall, spb = 2) => {
    if (!hall) return 17;
    if (hall.benches && hall.benches > 0) return hall.benches;
    if (hall.rows && hall.columns && hall.rows > 0 && hall.columns > 0) {
      if (Array.isArray(hall.columnRows) && hall.columnRows.length > 0) {
        return hall.columnRows.reduce((a, b) => a + (parseInt(b) || 0), 0);
      }
      return hall.rows * hall.columns;
    }
    if (hall.capacity && hall.capacity > 0) {
      return Math.round(hall.capacity / (spb || 2));
    }
    return 17;
  };

  // Open Layout Modal and prefill with current Hall values (prioritizing exam's saved hallSnapshot)
  const openLayoutModal = () => {
    const activeSnapshot = seatingPlan?.hallSnapshot || null;
    if (selectedHall || activeSnapshot) {
      const examMatch = examsOnSelectedDate[0];
      const spb = activeSnapshot?.seatsPerBench || selectedHall?.seatsPerBench || examMatch?.seatsPerBench || 2;
      const maxBenches = getHallMaxBenches(selectedHall || activeSnapshot, spb);
      const cols = activeSnapshot?.columns || selectedHall?.columns || 1;

      let cRows = [];
      if (activeSnapshot && Array.isArray(activeSnapshot.columnRows) && activeSnapshot.columnRows.length >= cols) {
        cRows = activeSnapshot.columnRows.slice(0, cols).map(n => Math.max(1, parseInt(n) || 1));
      } else if (selectedHall && Array.isArray(selectedHall.columnRows) && selectedHall.columnRows.length >= cols) {
        cRows = selectedHall.columnRows.slice(0, cols).map(n => Math.max(1, parseInt(n) || 1));
      } else if (selectedHall?.csvData && Array.isArray(selectedHall.csvData.columnRows) && selectedHall.csvData.columnRows.length >= cols) {
        cRows = selectedHall.csvData.columnRows.slice(0, cols).map(n => Math.max(1, parseInt(n) || 1));
      } else {
        const baseR = Math.floor(maxBenches / cols);
        const rem = maxBenches % cols;
        cRows = Array.from({ length: cols }, (_, i) => baseR + (i >= (cols - rem) ? 1 : 0));
      }

      setCustomCols(cols);
      setColumnRows(cRows);
      setBulkRowVal(cRows[0] || Math.floor(maxBenches / cols) || 1);
      setCustomSeatsPerBench(spb);
    }
    setIsLayoutModalOpen(true);
    setLayoutSuccessMsg('');
  };

  // Change total column count (and automatically distribute hall's bench capacity across columns)
  const handleColCountChange = (newCount) => {
    const n = Math.max(1, Math.min(20, parseInt(newCount) || 1));
    const spb = customSeatsPerBench || 2;
    const maxBenches = getHallMaxBenches(selectedHall, spb);

    // Automatically distribute maxBenches evenly across n columns (e.g. 17 benches into 4 cols -> [4, 4, 4, 5])
    const baseR = Math.floor(maxBenches / n);
    const rem = maxBenches % n;
    const newRows = Array.from({ length: n }, (_, i) => {
      return baseR + (i >= (n - rem) ? 1 : 0);
    });

    setCustomCols(n);
    setColumnRows(newRows);
    setBulkRowVal(baseR || 1);
  };

  // Change rows for a specific column, strictly capped by total hall capacity
  const handleSpecificColumnRowChange = (colIdx, val) => {
    const spb = customSeatsPerBench || 2;
    const maxBenches = getHallMaxBenches(selectedHall, spb);

    setColumnRows(prev => {
      const updated = [...prev];
      if (val === '') {
        updated[colIdx] = '';
        return updated;
      }
      const num = parseInt(val) || 1;
      const otherTotal = updated.reduce((sum, r, idx) => idx === colIdx ? sum : sum + (parseInt(r) || 0), 0);
      const maxAllowed = Math.max(1, maxBenches - otherTotal);
      updated[colIdx] = Math.max(1, Math.min(num, maxAllowed));
      return updated;
    });
  };

  const handleSpecificColumnRowStep = (colIdx, delta) => {
    const spb = customSeatsPerBench || 2;
    const maxBenches = getHallMaxBenches(selectedHall, spb);

    setColumnRows(prev => {
      const updated = [...prev];
      const current = parseInt(updated[colIdx]) || 1;
      const otherTotal = updated.reduce((sum, r, idx) => idx === colIdx ? sum : sum + (parseInt(r) || 0), 0);
      
      if (delta > 0) {
        const maxAllowed = Math.max(1, maxBenches - otherTotal);
        updated[colIdx] = Math.min(current + delta, maxAllowed);
      } else {
        updated[colIdx] = Math.max(1, current + delta);
      }
      return updated;
    });
  };

  // Apply same row count to all columns at once (capped at max benches)
  const handleApplyAllRows = (targetRow) => {
    const r = Math.max(1, parseInt(targetRow) || 1);
    const n = parseInt(customCols) || 1;
    const spb = customSeatsPerBench || 2;
    const maxBenches = getHallMaxBenches(selectedHall, spb);

    if (r * n > maxBenches) {
      const baseR = Math.floor(maxBenches / n);
      const rem = maxBenches % n;
      const newRows = Array.from({ length: n }, (_, i) => baseR + (i >= (n - rem) ? 1 : 0));
      setColumnRows(newRows);
      setBulkRowVal(baseR || 1);
    } else {
      setColumnRows(Array(n).fill(r));
      setBulkRowVal(r);
    }
  };

  // Save Hall Layout (Rows & Columns) & Persist Seating Arrangement
  const handleSaveLayout = async () => {
    if (!selectedHall && !seatingPlan?.hallSnapshot) return;
    const c = parseInt(customCols) || 1;
    const cRows = columnRows.slice(0, c).map(n => Math.max(1, parseInt(n) || 1));
    const maxR = Math.max(...cRows, 1);
    const totalB = cRows.reduce((sum, r) => sum + r, 0);
    const spb = parseInt(customSeatsPerBench) || 2;
    const totalCap = totalB * spb;
    const assignedCount = (seatingPlan?.attendanceRoster && seatingPlan.attendanceRoster.length) || seatingPlan?.totalStudents || 0;

    if (assignedCount > 0 && totalCap < assignedCount) {
      alert(`Cannot update layout: New capacity (${totalCap} seats) cannot accommodate the ${assignedCount} students currently assigned to this hall.`);
      return;
    }

    setIsSavingLayout(true);
    setLayoutSuccessMsg('');

    try {
      const res = await fetch('http://localhost:5000/api/seating/update-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          session: selectedSession,
          hallId: selectedHallId || selectedHall?._id || selectedHall?.name,
          examId: seatingPlan?.examId || examsOnSelectedDate[0]?._id,
          columns: c,
          rows: maxR,
          columnRows: cRows,
          benches: totalB,
          seatsPerBench: spb
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert('Failed to update hall layout: ' + (data.error || data.message || 'Unknown error'));
        setIsSavingLayout(false);
        return;
      }

      if (data.plan) {
        setSeatingPlan(data.plan);
      }

      await fetchRosterData();
      await fetchAllHallsLabelSequence();

      const hallDisplayName = selectedHall?.name || seatingPlan?.hallName || 'Hall';
      setLayoutSuccessMsg(`Hall ${hallDisplayName} layout saved: ${c} Columns (${cRows.join(', ')} rows) · ${totalB} Benches!`);
      setTimeout(() => {
        setIsLayoutModalOpen(false);
        setLayoutSuccessMsg('');
      }, 1000);
    } catch (err) {
      console.error('Error saving hall layout:', err);
      alert('Error updating layout: ' + err.message);
    } finally {
      setIsSavingLayout(false);
    }
  };

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


  // Direct PDF Download of Colorful Seating Layout
  const handleDownloadLayoutPdf = () => {
    if (!selectedDate || !selectedSession || !selectedHallId) {
      alert('Please select Date, Session, and Hall to download PDF.');
      return;
    }
    const base = window.API_BASE || 'http://localhost:5000';
    const url = `${base}/api/seating/layout/download-pdf?date=${selectedDate}&session=${selectedSession}&hallId=${selectedHallId}`;
    window.open(url, '_blank');
  };

  // Dedicated Print Generator for Visual Full-Color Column Seating Layout
  const handlePrintSeatingGrid = async () => {
    if (!seatingPlan || !seatingPlan.seatingGrid || seatingPlan.seatingGrid.length === 0) {
      alert('No seating arrangement available to print. Please generate or select a seating plan.');
      return;
    }

    try {
      await fetch('http://localhost:5000/api/printouts/increment', { method: 'POST' });
    } catch (err) {
      console.error("Failed to increment print count", err);
    }

    const hallName = seatingPlan.hallName || (selectedHall ? selectedHall.name : 'Exam Hall');
    const examDate = selectedDate || 'N/A';
    const sessionText = selectedSession === 'FN' ? 'Forenoon (10:00 AM - 01:00 PM)' : 'Afternoon (02:00 PM - 05:00 PM)';
    const totalBenchesCount = seatingPlan.seatingGrid.filter(b => !b.isPlaceholder).length;
    const is3Seat = seatingPlan.seatingGrid.some(b => b.seat3 !== undefined);

    // Group seated students by department
    const deptStudentMap = {};
    seatingPlan.seatingGrid.forEach(b => {
      if (b.isPlaceholder) return;
      ['seat1', 'seat2', 'seat3'].forEach(seatKey => {
        const st = b[seatKey];
        if (st && st.registerNo) {
          const dept = st.department || 'General';
          if (!deptStudentMap[dept]) deptStudentMap[dept] = [];
          deptStudentMap[dept].push(st.registerNo);
        }
      });
    });

    const deptSummaryHtml = Object.entries(deptStudentMap).map(([dept, regNos]) => {
      const sorted = [...regNos].sort();
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = sorted.length === 1 ? first : `${first} - ${last}`;
      return `<div class="dept-badge"><strong>${dept}:</strong> ${span} (${sorted.length} Students)</div>`;
    }).join('');

    const gridHtml = seatingPlan.seatingGrid.map((bench) => {
      if (bench.isPlaceholder) {
        return `<div class="bench-placeholder"></div>`;
      }

      const s1 = bench.seat1 ? `<div class="bench-seat seat-left">${bench.seat1.registerNo}</div>` : `<div class="bench-seat seat-empty">Empty</div>`;
      const s2 = is3Seat 
        ? (bench.seat2 ? `<div class="bench-seat seat-middle">${bench.seat2.registerNo}</div>` : `<div class="bench-seat seat-empty">Empty</div>`)
        : (bench.seat2 ? `<div class="bench-seat seat-right">${bench.seat2.registerNo}</div>` : `<div class="bench-seat seat-empty">Empty</div>`);
      const s3 = is3Seat ? (bench.seat3 ? `<div class="bench-seat seat-right">${bench.seat3.registerNo}</div>` : `<div class="bench-seat seat-empty">Empty</div>`) : null;

      return `
        <div class="bench-box">
          <div class="bench-code-title">${bench.benchCode}</div>
          <div class="seats-container">
            ${s1}
            ${is3Seat ? s2 : ''}
            ${is3Seat ? s3 : s2}
          </div>
        </div>
      `;
    }).join('');

    const printWin = window.open('', '_blank');
    if (!printWin) {
      alert('Pop-up blocked. Please allow pop-ups to print the seating arrangement.');
      return;
    }

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${hallName} - Seating Layout</title>
        <style>
          @page {
            size: ${colsCount >= 5 ? 'landscape' : 'portrait'};
            margin: 8mm;
          }
          * { 
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 8px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            margin-bottom: 8px;
          }
          .meta-item strong { color: #0f172a; }
          .dept-summary-box {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 6px 8px;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            margin-bottom: 12px;
          }
          .dept-badge {
            background: #ffffff;
            border: 1px solid #94a3b8;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 700;
          }
          .seating-print-grid {
            display: grid;
            grid-template-columns: repeat(${colsCount}, 1fr);
            gap: 8px;
            width: 100%;
          }
          .bench-box {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            background: #ffffff;
            padding: 8px 10px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .bench-placeholder {
            visibility: hidden;
            min-height: 48px;
          }
          .bench-code-title {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-align: center;
            margin-bottom: 6px;
            letter-spacing: 0.3px;
          }
          .seats-container {
            display: grid;
            grid-template-columns: repeat(${is3Seat ? 3 : 2}, 1fr);
            gap: 6px;
          }
          .bench-seat {
            font-size: 11px;
            font-weight: 700;
            padding: 6px 4px;
            border-radius: 4px;
            text-align: center;
            display: flex;
            align-items: center;
            justifyContent: center;
            min-height: 28px;
            letter-spacing: 0.3px;
          }
          .seat-left {
            background: rgba(168, 85, 247, 0.08) !important;
            color: #7c3aed !important;
            border: 1px dashed rgba(168, 85, 247, 0.5) !important;
          }
          .seat-middle {
            background: rgba(245, 158, 11, 0.08) !important;
            color: #d97706 !important;
            border: 1px dashed rgba(245, 158, 11, 0.5) !important;
          }
          .seat-right {
            background: rgba(16, 185, 129, 0.08) !important;
            color: #059669 !important;
            border: 1px dashed rgba(16, 185, 129, 0.5) !important;
          }
          .seat-empty {
            background: #f8fafc !important;
            color: #94a3b8 !important;
            border: 1px dashed #cbd5e1 !important;
            font-style: italic !important;
          }
          .signatures {
            display: flex;
            justifyContent: space-between;
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px dashed #cbd5e1;
            font-size: 11px;
            font-weight: 700;
            page-break-inside: avoid;
          }
          .no-print-toolbar {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-bottom: 12px;
            padding: 8px;
            background: #f1f5f9;
            border-radius: 8px;
          }
          .btn-action {
            background: #4f46e5;
            color: #fff;
            border: none;
            padding: 6px 14px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 12px;
            cursor: pointer;
          }
          @media print {
            .no-print-toolbar { display: none !important; }
            body { padding: 0 !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print-toolbar">
          <button class="btn-action" onclick="window.print()">🖨️ Print Document</button>
          <a class="btn-action" href="${window.API_BASE || 'http://localhost:5000'}/api/seating/layout/download-pdf?date=${selectedDate}&session=${selectedSession}&hallId=${selectedHallId}" style="text-decoration:none; display:inline-block;" target="_blank">📥 Download PDF File</a>
        </div>

        <div class="meta-grid">
          <div class="meta-item"><strong>Hall:</strong> ${hallName}</div>
          <div class="meta-item"><strong>Date:</strong> ${examDate}</div>
          <div class="meta-item"><strong>Session:</strong> ${sessionText}</div>
          <div class="meta-item"><strong>Layout:</strong> ${colsCount} Cols · ${totalBenchesCount} Benches · ${Object.values(deptStudentMap).reduce((a, b) => a + b.length, 0)} Seated</div>
        </div>

        <div class="dept-summary-box">
          ${deptSummaryHtml || '<div style="font-size:11px; color:#64748b;">No students allocated.</div>'}
        </div>

        <div class="seating-print-grid">
          ${gridHtml}
        </div>

        <div class="signatures">
          <div>Hall Invigilator's Signature: _______________________</div>
          <div>Chief Superintendent Signature: _______________________</div>
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
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
            <button className="btn-primary" onClick={handleGenerate}>
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
                <span className="stat-card-number">
                  {(() => {
                    if (seatingPlan.seatingGrid && Array.isArray(seatingPlan.seatingGrid)) {
                      const realBenches = seatingPlan.seatingGrid.filter(b => !b.isPlaceholder).length;
                      if (realBenches > 0) return realBenches;
                    }
                    return seatingPlan.totalBenches || 0;
                  })()}
                </span>
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
                        if (!b.isPlaceholder) {
                          if (b.seat1) count++;
                          if (b.seat2) count++;
                          if (b.seat3) count++;
                        }
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
                      const realBenches = seatingPlan.seatingGrid.filter(b => !b.isPlaceholder);
                      if (realBenches.length > 0) {
                        let empty = 0;
                        realBenches.forEach(b => {
                          if (!b.seat1) empty++;
                          if (!b.seat2) empty++;
                          if (b.seat3 !== undefined && !b.seat3) empty++;
                        });
                        return Math.max(0, empty);
                      }
                    }
                    const totalBenches = seatingPlan.totalBenches || 0;
                    const seatsPerBench = seatingPlan?.hallSnapshot?.seatsPerBench || selectedHall?.seatsPerBench || seatingPlan.seatsPerBench || 2;
                    const cap = totalBenches * seatsPerBench;
                    const students = (seatingPlan.attendanceRoster && seatingPlan.attendanceRoster.length) || (seatingPlan.totalStudents || 0);
                    if (seatingPlan.emptySeats !== undefined && seatingPlan.emptySeats !== null) {
                      return Math.max(0, seatingPlan.emptySeats);
                    }
                    return Math.max(0, cap - students);
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0 }}>{seatingPlan.hallName} - Seating Arrangement</h3>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-color)',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-secondary)'
                    }}>
                      <Layers size={13} color="var(--color-primary)" />
                      <span>{selectedHall?.rows || Math.ceil((seatingPlan.seatingGrid?.length || 24) / (colsCount || 1))} Rows × {colsCount} Columns ({seatingPlan.totalBenches || ((selectedHall?.rows || 6) * colsCount)} Benches)</span>
                    </div>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(79, 70, 229, 0.08)',
                      border: '1px solid rgba(79, 70, 229, 0.25)',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--color-primary)'
                    }}>
                      <span>W-Order Serpentine</span>
                    </div>
                  </div>
                  <div className="no-print" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={handlePrintSeatingGrid}
                      className="btn-primary"
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '9999px',
                        cursor: 'pointer'
                      }}
                      title="Print the complete multi-column seating arrangement"
                    >
                      <Printer size={13} />
                      <span>Print Layout</span>
                    </button>
                    <button
                      onClick={handleDownloadLayoutPdf}
                      className="btn-secondary"
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '9999px',
                        background: 'linear-gradient(135deg, rgba(79,70,229,0.1), rgba(139,92,246,0.1))',
                        border: '1px solid rgba(79,70,229,0.3)',
                        color: 'var(--color-primary)',
                        cursor: 'pointer'
                      }}
                      title="Download colorful PDF file for this hall"
                    >
                      <Download size={13} />
                      <span>Download PDF</span>
                    </button>
                    <button
                      onClick={openLayoutModal}
                      className="btn-secondary"
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '9999px',
                        background: 'linear-gradient(135deg, rgba(79,70,229,0.08), rgba(139,92,246,0.05))',
                        border: '1px solid rgba(79,70,229,0.25)',
                        color: 'var(--color-primary)',
                        cursor: 'pointer'
                      }}
                      title="Edit number of rows and columns for this hall"
                    >
                      <Sliders size={13} />
                      <span>Edit Rows & Columns</span>
                    </button>
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
                  {displayedBenches.map((bench, bIdx) => {
                    if (bench.isPlaceholder) {
                      return (
                        <div 
                          key={`placeholder-${bIdx}`} 
                          style={{ visibility: 'hidden', minHeight: '90px', pointerEvents: 'none' }} 
                        />
                      );
                    }

                    return (
                      <div className="bench-card" key={`${bench.benchCode || 'bench'}-${bIdx}`}>
                        <span className="bench-code">{bench.benchCode}</span>
                        
                        <div className="bench-seats">
                          <div className={`bench-seat ${bench.seat1 ? 'seat-left' : 'empty'}`} title={bench.seat1 ? `${bench.seat1.name} (${bench.seat1.department}${bench.seat1.subjectCode ? ' - ' + bench.seat1.subjectCode : ''})` : 'Empty'}>
                            {bench.seat1 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                                <span>{bench.seat1.registerNo}</span>
                                <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.85 }}>{bench.seat1.department}</span>
                              </div>
                            ) : 'Empty'}
                          </div>
                          
                          <div className="bench-divider" />

                          {bench.seat3 !== undefined && (
                            <>
                              <div className={`bench-seat ${bench.seat2 ? 'seat-middle' : 'empty'}`} title={bench.seat2 ? `${bench.seat2.name} (${bench.seat2.department}${bench.seat2.subjectCode ? ' - ' + bench.seat2.subjectCode : ''})` : 'Empty'}>
                                {bench.seat2 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                                    <span>{bench.seat2.registerNo}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.85 }}>{bench.seat2.department}</span>
                                  </div>
                                ) : 'Empty'}
                              </div>
                              <div className="bench-divider" />
                            </>
                          )}
                          
                          {(() => {
                            const rightStudent = bench.seat3 !== undefined ? bench.seat3 : bench.seat2;
                            return (
                              <div className={`bench-seat ${rightStudent ? 'seat-right' : 'empty'}`} title={rightStudent ? `${rightStudent.name} (${rightStudent.department}${rightStudent.subjectCode ? ' - ' + rightStudent.subjectCode : ''})` : 'Empty'}>
                                {rightStudent ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                                    <span>{rightStudent.registerNo}</span>
                                    <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.85 }}>{rightStudent.department}</span>
                                  </div>
                                ) : 'Empty'}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
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
              <div className="no-print" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Subject Code Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Subject:</label>
                  <select
                    value={selectedSubCodeFilter}
                    onChange={(e) => setSelectedSubCodeFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    <option value="ALL">All Subjects</option>
                    {availableSubCodesForDate.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>

                {/* Scope / Hall Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Hall Scope:</label>
                  <select
                    value={rosterHallScope}
                    onChange={(e) => setRosterHallScope(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    <option value="ALL">All Halls (All Students)</option>
                    <option value="CURRENT">Current Hall ({selectedHall ? selectedHall.name : 'Selected'})</option>
                  </select>
                </div>

                {/* Department Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Dept:</label>
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
                      fontSize: '12px'
                    }}
                  >
                    <option value="ALL">All Departments</option>
                    {(rosterData?.departments || []).map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                {/* Academic Level Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Level:</label>
                  <select
                    value={selectedLevelFilter}
                    onChange={(e) => setSelectedLevelFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-app)',
                      color: 'var(--text-primary)',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                  >
                    <option value="ALL">All Levels (UG first, then PG)</option>
                    <option value="UG">UG Only</option>
                    <option value="PG">PG Only</option>
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
                      <th>Department</th>
                      <th>Bench</th>
                      <th>Seat Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!seatingPlan || !seatingPlan.attendanceRoster || seatingPlan.attendanceRoster.length === 0) ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px' }}>
                          No student seats allocated in this hall.
                        </td>
                      </tr>
                    ) : (
                      seatingPlan.attendanceRoster.map((item, idx) => (
                        <tr key={`${item.registerNo || 'rost'}-${idx}`}>
                          <td style={{ fontWeight: 600 }}>
                            {item.registerNo}
                            {item.isArrear ? (
                              <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontWeight: 800 }}>
                                ARREAR
                              </span>
                            ) : null}
                          </td>
                          <td>{item.name}</td>
                          <td>
                            <span className="status-pill info" style={{ fontSize: '11px', padding: '2px 8px', fontWeight: 'bold' }}>
                              {item.department || 'GENERAL'}
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
                    {/* Header info badge showing segregation rule */}
                    <div className="no-print" style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 16px',
                      marginBottom: '16px',
                      background: 'var(--bg-app)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '13px',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Subject: <strong style={{ color: 'var(--primary-color)' }}>{selectedSubCodeFilter === 'ALL' ? 'All Subjects' : selectedSubCodeFilter}</strong> · Level: <strong style={{ color: selectedLevelFilter === 'UG' ? '#059669' : selectedLevelFilter === 'PG' ? '#4f46e5' : 'var(--text-primary)' }}>{selectedLevelFilter === 'ALL' ? 'UG first, then PG' : selectedLevelFilter}</strong> · Total Sheets: <strong>{pages.length}</strong> · Total Candidates: <strong>{rosterData.totalStudents || pages.reduce((sum, p) => sum + (p.students?.length || 0), 0)}</strong>
                      </span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                        📋 25 candidates/sheet · UG sheets shown first, then PG · Each department strictly separated onto a fresh sheet
                      </span>
                    </div>

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
                          {/* Department Banner (Screen Only) */}
                          <div className="no-print" style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '14px',
                            padding: '6px 14px',
                            background: 'var(--bg-app)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            fontSize: '12px',
                            fontWeight: '600',
                            color: 'var(--text-secondary)'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 800,
                                background: page.academicLevel === 'UG' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                                color: page.academicLevel === 'UG' ? '#059669' : '#4f46e5',
                                border: page.academicLevel === 'UG' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(99, 102, 241, 0.3)'
                              }}>
                                {page.academicLevel || 'UG'}
                              </span>
                              <span>Subject: <strong style={{ color: 'var(--primary-color)' }}>{page.subjectCode}</strong> · Dept: <strong>{page.deptName}</strong> ({page.degree || page.deptName})</span>
                            </div>
                            <span>Sheet {page.pageNum} of {page.totalPages} • Candidates: {page.students.length} / 25</span>
                          </div>

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
                                  <td style={{ fontWeight: 600 }}>
                                    {student.registerNo}
                                  </td>
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
                              <div className="footer-cell left-col">
                                <strong>Absentees Reg. No.:</strong>
                              </div>
                              <div className="footer-cell right-col">
                                <strong>Hall No.:</strong>
                              </div>
                            </div>
                            <div className="footer-row" style={{ marginTop: '18px' }}>
                              <div className="footer-cell left-col">
                                <strong>Total No. of Absentees:</strong>
                              </div>
                              <div className="footer-cell right-col">
                                <strong>Name of the Invigilator and College:</strong>
                              </div>
                            </div>
                            <div className="footer-row sig-row" style={{ marginTop: '36px' }}>
                              <div className="footer-cell left-col" style={{ fontWeight: 'bold', fontSize: '13px' }}>
                                Signature of the Chief Superintendent
                              </div>
                              <div className="footer-cell right-col" style={{ fontWeight: 'bold', fontSize: '13px' }}>
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
              const cols = seatingPlan.columns || 4;
              const colRows = seatingPlan.columnRows || [];
              const benchMap = new Map();
              const colMaxRowMap = new Map();
              seatingPlan.seatingGrid.forEach(b => {
                if (b && b.benchCode) {
                  benchMap.set(b.benchCode, b);
                  const m = String(b.benchCode).match(/^([A-Za-z]+)(\d+)$/);
                  if (m) {
                    let rIdx = 0;
                    const clean = m[1].toUpperCase();
                    for (let i = 0; i < clean.length; i++) {
                      rIdx = rIdx * 26 + (clean.charCodeAt(i) - 64);
                    }
                    const cNum = parseInt(m[2], 10);
                    const cur = colMaxRowMap.get(cNum) || 0;
                    if (rIdx > cur) colMaxRowMap.set(cNum, rIdx);
                  }
                }
              });

              const distinctSubs = new Set();
              let hasSeat3 = false;
              benchMap.forEach(b => {
                if (b && !b.isPlaceholder) {
                  if (b.seat3) hasSeat3 = true;
                  ['seat1', 'seat2', 'seat3'].forEach(k => {
                    const st = b[k];
                    if (st) {
                      const sc = (st.subjectCode || st.code || '').trim().toUpperCase();
                      if (sc && sc !== 'GENERAL' && sc !== 'UNKNOWN') distinctSubs.add(sc);
                    }
                  });
                }
              });
              const isSingleSub = distinctSubs.size <= 1;
              const is2SeatHall = (parseInt(seatingPlan.seatsPerBench) === 2) || (!hasSeat3 && benchMap.size > 0);

              if (is2SeatHall && isSingleSub) {
                for (let c = 1; c <= cols; c++) {
                  const rCount = Math.max(colMaxRowMap.get(c) || 0, colRows[c - 1] !== undefined ? colRows[c - 1] : (seatingPlan.rows || 6));
                  const colBenchCodes = [];
                  if (c % 2 === 1) { // Odd column: top to bottom
                    for (let r = 0; r < rCount; r++) {
                      colBenchCodes.push(`${getRowLetterHelper(r)}${c}`);
                    }
                  } else { // Even column: bottom to top
                    for (let r = rCount - 1; r >= 0; r--) {
                      colBenchCodes.push(`${getRowLetterHelper(r)}${c}`);
                    }
                  }
                  // 1. First extract Left seat (seat1) along column traversal
                  colBenchCodes.forEach(code => {
                    const b = benchMap.get(code);
                    if (b && !b.isPlaceholder && b.seat1?.registerNo) {
                      studentRegNos.push(b.seat1.registerNo);
                    }
                  });
                  // 2. Next extract Right seat (seat2) along column traversal
                  colBenchCodes.forEach(code => {
                    const b = benchMap.get(code);
                    if (b && !b.isPlaceholder && b.seat2?.registerNo) {
                      studentRegNos.push(b.seat2.registerNo);
                    }
                  });
                }
              } else {
                for (let c = 1; c <= cols; c++) {
                  const rCount = Math.max(colMaxRowMap.get(c) || 0, colRows[c - 1] !== undefined ? colRows[c - 1] : (seatingPlan.rows || 6));
                  if (c % 2 === 1) { // Odd column: top to bottom
                    for (let r = 0; r < rCount; r++) {
                      const b = benchMap.get(`${getRowLetterHelper(r)}${c}`);
                      if (b && !b.isPlaceholder) {
                        if (b.seat1?.registerNo) studentRegNos.push(b.seat1.registerNo);
                        if (b.seat2?.registerNo) studentRegNos.push(b.seat2.registerNo);
                        if (b.seat3?.registerNo) studentRegNos.push(b.seat3.registerNo);
                      }
                    }
                  } else { // Even column: bottom to top
                    for (let r = rCount - 1; r >= 0; r--) {
                      const b = benchMap.get(`${getRowLetterHelper(r)}${c}`);
                      if (b && !b.isPlaceholder) {
                        if (b.seat1?.registerNo) studentRegNos.push(b.seat1.registerNo);
                        if (b.seat2?.registerNo) studentRegNos.push(b.seat2.registerNo);
                        if (b.seat3?.registerNo) studentRegNos.push(b.seat3.registerNo);
                      }
                    }
                  }
                }
              }
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

      {/* Grid Layout (Rows & Columns) Editor Modal */}
      {isLayoutModalOpen && selectedHall && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}
        onClick={() => { if (!isSavingLayout) setIsLayoutModalOpen(false); }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px',
              maxWidth: '640px',
              width: '100%',
              boxShadow: 'var(--shadow-xl)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(79,70,229,0.15), rgba(139,92,246,0.1))',
                    border: '1px solid rgba(79,70,229,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)'
                  }}>
                    <Sliders size={18} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Edit Grid Layout
                    </h3>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)' }}>
                      Hall: {selectedHall.name}
                    </span>
                  </div>
                </div>
                <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Choose the number of columns, and configure how many rows each column contains.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLayoutModalOpen(false)}
                disabled={isSavingLayout}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Total Columns Selector & Bulk Row Setter */}
            <div style={{
              background: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', display: 'block' }}>
                    Number of Columns (Vertical Lanes)
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Total vertical sections in this hall
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleColCountChange(Math.max(1, (parseInt(customCols) || 1) - 1))}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold'
                    }}
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={customCols}
                    onChange={(e) => handleColCountChange(e.target.value)}
                    style={{
                      width: '60px',
                      textAlign: 'center',
                      fontSize: '16px',
                      fontWeight: 800,
                      height: '36px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--color-primary)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleColCountChange((parseInt(customCols) || 1) + 1)}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold'
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Quick Action: Set All Columns to Same Row Count */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                borderTop: '1px dashed var(--border-color)',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Quick Apply (Same Rows for All Columns):
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={bulkRowVal}
                    onChange={(e) => setBulkRowVal(e.target.value)}
                    style={{
                      width: '54px',
                      textAlign: 'center',
                      fontSize: '13px',
                      fontWeight: 700,
                      height: '30px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleApplyAllRows(bulkRowVal)}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '11.5px', fontWeight: 600 }}
                  >
                    Set All Columns to {bulkRowVal}
                  </button>
                </div>
              </div>
            </div>

            {/* Per-Column Rows Configuration */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Configure Rows for Each Column
                </label>
                <span style={{ fontSize: '11.5px', color: 'var(--color-primary)', fontWeight: 600 }}>
                  {customCols} {customCols === 1 ? 'Column' : 'Columns'}
                </span>
              </div>

              {(() => {
                const c = parseInt(customCols) || 1;
                const spb = customSeatsPerBench || 2;
                const maxBenches = getHallMaxBenches(selectedHall, spb);
                const activeRows = columnRows.slice(0, c).map(n => Math.max(1, parseInt(n) || 1));
                const totalBenchesCount = activeRows.reduce((a, b) => a + b, 0);

                return (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                    gap: '10px',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    padding: '4px 2px'
                  }}>
                    {Array.from({ length: c }).map((_, colIdx) => {
                      const currentR = columnRows[colIdx] !== undefined ? columnRows[colIdx] : (parseInt(bulkRowVal) || 6);
                      const numR = Math.max(1, parseInt(currentR) || 1);
                      const endRowLetter = getRowLetterHelper(numR - 1);
                      const isAtMax = totalBenchesCount >= maxBenches;

                      return (
                        <div
                          key={colIdx}
                          style={{
                            background: 'var(--bg-app)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '10px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-primary)' }}>
                              Column {colIdx + 1}
                            </span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                              A{colIdx + 1}..{endRowLetter}{colIdx + 1}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleSpecificColumnRowStep(colIdx, -1)}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                padding: 0
                              }}
                            >
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              value={currentR}
                              onChange={(e) => handleSpecificColumnRowChange(colIdx, e.target.value)}
                              style={{
                                flex: 1,
                                minWidth: '36px',
                                textAlign: 'center',
                                fontSize: '14px',
                                fontWeight: 700,
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid var(--color-primary)',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                padding: 0
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSpecificColumnRowStep(colIdx, 1)}
                              disabled={isAtMax}
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: isAtMax ? 'var(--bg-app)' : 'var(--bg-card)',
                                color: isAtMax ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: isAtMax ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                padding: 0
                              }}
                            >
                              <Plus size={13} />
                            </button>
                          </div>

                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', textAlign: 'center' }}>
                            {numR} Benches
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Live Calculation Summary Card */}
            {(() => {
              const c = parseInt(customCols) || 1;
              const spb = customSeatsPerBench || 2;
              const maxBenches = getHallMaxBenches(selectedHall, spb);
              const activeRows = columnRows.slice(0, c).map(n => Math.max(1, parseInt(n) || 1));
              const totalBenchesCount = activeRows.reduce((a, b) => a + b, 0);
              const totalCapacityCount = totalBenchesCount * spb;
              const assignedCount = (seatingPlan?.attendanceRoster && seatingPlan.attendanceRoster.length) || seatingPlan?.totalStudents || 0;
              const isInsufficient = assignedCount > 0 && totalCapacityCount < assignedCount;
              const isMatched = totalBenchesCount === maxBenches;
              const isExceeded = totalBenchesCount > maxBenches;

              return (
                <div style={{
                  background: (isExceeded || isInsufficient)
                    ? 'rgba(239, 68, 68, 0.08)' 
                    : isMatched 
                      ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(79,70,229,0.05))' 
                      : 'linear-gradient(135deg, rgba(79,70,229,0.06), rgba(139,92,246,0.03))',
                  border: (isExceeded || isInsufficient)
                    ? '1.5px solid #ef4444' 
                    : isMatched 
                      ? '1.5px solid #10b981' 
                      : '1px solid rgba(79,70,229,0.18)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '12px',
                    textAlign: 'center'
                  }}>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>Total Benches</span>
                      <span style={{ fontSize: '20px', fontWeight: 800, color: isExceeded ? '#ef4444' : 'var(--color-primary)' }}>
                        {totalBenchesCount} <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>/ {maxBenches} Max</span>
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>Seating Capacity</span>
                      <span style={{ fontSize: '20px', fontWeight: 800, color: (isExceeded || isInsufficient) ? '#ef4444' : '#10b981' }}>
                        {totalCapacityCount}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>Seats ({spb} per bench){assignedCount > 0 ? ` · ${assignedCount} assigned` : ''}</span>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>Columns Breakdown</span>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: '28px' }}>
                        {c} Cols · [{activeRows.join(', ')}]
                      </span>
                    </div>
                  </div>

                  {isInsufficient && (
                    <div style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#dc2626',
                      background: 'rgba(239,68,68,0.12)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      ⚠ Cannot Accommodate Students! Hall currently has {assignedCount} assigned students, but new layout only provides {totalCapacityCount} seats.
                    </div>
                  )}

                  {!isInsufficient && isMatched && (
                    <div style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#059669',
                      background: 'rgba(16,185,129,0.12)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      ✓ Matches Exact Hall Bench Capacity ({maxBenches} Benches · {maxBenches * spb} Seats)
                    </div>
                  )}

                  {!isInsufficient && !isMatched && !isExceeded && (
                    <div style={{
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#d97706',
                      background: 'rgba(245,158,11,0.12)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      ℹ {totalBenchesCount} of {maxBenches} benches assigned ({maxBenches - totalBenchesCount} benches remaining to match full hall capacity)
                    </div>
                  )}

                  {isExceeded && (
                    <div style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: '#dc2626',
                      background: 'rgba(239,68,68,0.12)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      ⚠ Exceeds Hall Capacity! Max allowed: {maxBenches} benches.
                    </div>
                  )}
                </div>
              );
            })()}

            {layoutSuccessMsg && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.3)',
                color: '#10b981',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <Check size={16} />
                <span>{layoutSuccessMsg}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsLayoutModalOpen(false)}
                disabled={isSavingLayout}
                style={{ padding: '10px 18px', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveLayout}
                disabled={isSavingLayout || (() => {
                  const c = parseInt(customCols) || 1;
                  const spb = customSeatsPerBench || 2;
                  const maxB = getHallMaxBenches(selectedHall, spb);
                  const act = columnRows.slice(0, c).map(n => Math.max(1, parseInt(n) || 1));
                  const tot = act.reduce((a, b) => a + b, 0);
                  const assigned = (seatingPlan?.attendanceRoster && seatingPlan.attendanceRoster.length) || seatingPlan?.totalStudents || 0;
                  return tot === 0 || tot > maxB || (assigned > 0 && tot * spb < assigned);
                })()}
                style={{
                  padding: '10px 22px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {isSavingLayout ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                    <span>Saving & Applying...</span>
                  </>
                ) : (
                  <span>Save & Re-arrange Seating</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SeatingPlanView;
