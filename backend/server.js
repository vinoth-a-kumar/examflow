const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

const { Models, dbStatus } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Multer for CSV uploads (using memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max limit
});

// Helper: Check if a line is likely to be a header row
function hasHeaders(firstLine) {
  const parts = firstLine.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
  if (parts.length === 0) return false;
  // If the first cell contains any digits, it's likely a data row (register number / roll number)
  const firstCell = parts[0];
  if (/\d/.test(firstCell)) {
    return false;
  }
  // Check if any of the cells matches common header keywords
  return parts.some(p => /reg|roll|number|id|name|student|dept|depart|branch|course|subject/i.test(p));
}

// Helper: Parse CSV text into array of objects
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Parse header
  let headers;
  let startIdx = 1;
  const firstLine = lines[0];

  if (hasHeaders(firstLine)) {
    headers = firstLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  } else {
    // Fallback headers
    headers = ['Register No', 'Name', 'Department'];
    startIdx = 0;
  }
  
  // Find column indexes
  let regIndex = headers.findIndex(h => /reg|roll|number|id/i.test(h));
  let nameIndex = headers.findIndex(h => /name|student/i.test(h));
  let deptIndex = headers.findIndex(h => /dept|depart|branch|course/i.test(h));
  if (deptIndex === -1) {
    deptIndex = headers.findIndex(h => /subject/i.test(h));
  }
  let batchIndex = headers.findIndex(h => /batch|year/i.test(h));

  // Fallbacks if not detected by regex
  if (regIndex === -1) regIndex = 0;
  if (nameIndex === -1) nameIndex = 1;
  if (deptIndex === -1) deptIndex = 2;

  const records = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle comma inside quotes (simple CSV parse)
    let parts = [];
    let insideQuote = false;
    let currentPart = '';
    
    for (let char of line) {
      if (char === '"' || char === "'") {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        parts.push(currentPart.trim().replace(/^["']|["']$/g, ''));
        currentPart = '';
      } else {
        currentPart += char;
      }
    }
    parts.push(currentPart.trim().replace(/^["']|["']$/g, ''));

    if (parts.length > Math.max(regIndex, nameIndex, deptIndex)) {
      const registerNo = parts[regIndex];
      const name = parts[nameIndex];
      const department = parts[deptIndex];
      const batch = batchIndex !== -1 ? parts[batchIndex] : '2024-25';

      // Keep dynamic original headers and data mapping
      const csvData = {};
      headers.forEach((header, index) => {
        csvData[header] = parts[index] || '';
      });

      if (registerNo && name && department) {
        records.push({
          registerNo,
          name,
          department: department.toUpperCase(),
          batch,
          csvData
        });
      }
    }
  }
  return records;
}

// Helper: System logs for dashboard recent activities
// In a full app this might be in DB, we will use a JSON file or memory array that is persisted in memory/DB
let recentActivities = [
  { id: 1, type: 'student', message: 'Student Data Uploaded', detail: 'Batch 2024 roster imported successfully.', time: new Date(Date.now() - 3600000 * 2) },
  { id: 2, type: 'hall', message: 'Hall Updated', detail: 'Main Auditorium capacity changed.', time: new Date(Date.now() - 3600000 * 5) },
  { id: 3, type: 'exam', message: 'Exam Created', detail: 'Mid Semester Exam scheduled.', time: new Date(Date.now() - 3600000 * 12) }
];

const logActivity = (type, message, detail) => {
  const newActivity = {
    id: Date.now(),
    type,
    message,
    detail,
    time: new Date()
  };
  recentActivities.unshift(newActivity);
  if (recentActivities.length > 20) recentActivities.pop();
};

const getPrintoutCount = () => {
  const filePath = path.join(__dirname, 'data', 'printouts.json');
  try {
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data.count || 0;
    }
  } catch (err) {
    console.error("Error reading printout count", err);
  }
  return 0;
};

const incrementPrintoutCount = () => {
  const filePath = path.join(__dirname, 'data', 'printouts.json');
  let count = getPrintoutCount() + 1;
  try {
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({ count }), 'utf8');
  } catch (err) {
    console.error("Error writing printout count", err);
  }
  return count;
};

// API ROUTES

// 1. Connection Status
app.get('/api/status', (req, res) => {
  res.json(dbStatus());
});

// 2. Dashboard Metrics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const totalStudents = await Models.Student.countDocuments();
    const totalHalls = await Models.Hall.countDocuments();
    const allHalls = await Models.Hall.find();
    const totalCapacity = allHalls.reduce((sum, h) => sum + h.capacity, 0);
    const totalExams = await Models.Exam.countDocuments();
    
    // Departments distribution
    const students = await Models.Student.find();
    const deptMap = {};
    students.forEach(s => {
      const d = s.department || 'UNKNOWN';
      deptMap[d] = (deptMap[d] || 0) + 1;
    });

    const totalCount = students.length;
    const departmentDistribution = Object.keys(deptMap).map(dept => ({
      department: dept,
      count: deptMap[dept],
      percentage: totalCount > 0 ? Math.round((deptMap[dept] / totalCount) * 100) : 0
    })).sort((a, b) => b.count - a.count);

    // Get all seating plans to compute seat usage per hall
    const allPlans = await Models.SeatingPlan.find();

    const hallsData = allHalls.map(hall => {
      const plansForHall = allPlans.filter(p => p.hallId === hall._id || p.hallName === hall.name);
      
      let seatedStudentsCount = 0;
      plansForHall.forEach(p => {
        seatedStudentsCount += p.attendanceRoster ? p.attendanceRoster.length : 0;
      });

      const remainingSeats = Math.max(0, hall.capacity - seatedStudentsCount);

      return {
        _id: hall._id,
        name: hall.name,
        rows: hall.rows,
        columns: hall.columns,
        capacity: hall.capacity,
        seatedStudents: seatedStudentsCount,
        remainingSeats
      };
    });

    res.json({
      totalStudents,
      totalHalls,
      totalCapacity,
      totalExams,
      departmentsCount: Object.keys(deptMap).length,
      departmentDistribution,
      hallsData,
      printoutsCount: getPrintoutCount()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/activities', (req, res) => {
  res.json(recentActivities);
});

app.delete('/api/dashboard/activities', (req, res) => {
  recentActivities = [];
  res.json({ success: true, message: 'Activity history cleared.' });
});

app.post('/api/printouts/increment', (req, res) => {
  try {
    const newCount = incrementPrintoutCount();
    logActivity('exam', 'Seating Plan Printed', 'A seating plan roster was printed.');
    res.json({ success: true, count: newCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Students Management
app.get('/api/students', async (req, res) => {
  try {
    const students = await Models.Student.find();
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/students/upload', upload.single('file'), async (req, res) => {
  const filename = req.file ? req.file.originalname : 'manual_entry.csv';
  try {
    let csvText = '';
    if (req.file) {
      csvText = req.file.buffer.toString('utf8');
    } else if (req.body.csvText) {
      csvText = req.body.csvText;
    } else {
      throw new Error('No CSV file or text provided.');
    }

    const students = parseCSV(csvText);
    if (students.length === 0) {
      throw new Error('No valid student records found in CSV. Headers must contain Register No, Name, Department.');
    }

    // Insert to DB (duplicates are skipped in our model implementation)
    const inserted = await Models.Student.create(students);
    const insertedCount = Array.isArray(inserted) ? inserted.length : (inserted ? 1 : 0);

    await Models.UploadHistory.create({
      filename,
      recordCount: insertedCount,
      status: 'SUCCESS'
    });

    logActivity('student', 'Student Data Uploaded', `${filename} imported with ${insertedCount} new student records.`);

    res.json({
      success: true,
      message: `Successfully processed CSV. Imported ${insertedCount} student records.`,
      count: insertedCount
    });
  } catch (error) {
    await Models.UploadHistory.create({
      filename,
      recordCount: 0,
      status: 'FAILED',
      errorMessage: error.message
    });

    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/students/clear', async (req, res) => {
  try {
    await Models.Student.deleteMany({});
    await Models.SeatingPlan.deleteMany({});
    logActivity('student', 'Student Database Cleared', 'All student records and seating plans have been deleted.');
    res.json({ success: true, message: 'All student records cleared.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Hall Management
app.get('/api/halls', async (req, res) => {
  try {
    const halls = await Models.Hall.find();
    res.json(halls);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/halls', async (req, res) => {
  try {
    const { name, rows, columns } = req.body;
    if (!name || !rows || !columns) {
      return res.status(400).json({ error: 'Name, rows, and columns are required.' });
    }
    const benches = parseInt(rows) * parseInt(columns);
    const capacity = benches * 2; // 2 seats per bench
    
    const newHall = await Models.Hall.create({
      name,
      rows: parseInt(rows),
      columns: parseInt(columns),
      benches,
      capacity
    });

    logActivity('hall', 'Hall Created', `${name} configured with ${capacity} seats (${benches} benches).`);
    res.status(201).json(newHall);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/halls/:id', async (req, res) => {
  try {
    const deleted = await Models.Hall.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Hall not found.' });
    }
    logActivity('hall', 'Hall Deleted', `${deleted.name} was removed from the database.`);
    res.json({ success: true, message: 'Hall deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/halls/:id', async (req, res) => {
  try {
    const { name, rows, columns } = req.body;
    if (!name || !rows || !columns) {
      return res.status(400).json({ error: 'Name, rows, and columns are required.' });
    }

    const benches = parseInt(rows) * parseInt(columns);
    const capacity = benches * 2;

    const updated = await Models.Hall.findByIdAndUpdate(req.params.id, {
      name,
      rows: parseInt(rows),
      columns: parseInt(columns),
      benches,
      capacity
    });

    if (!updated) {
      return res.status(404).json({ error: 'Hall not found.' });
    }

    logActivity('hall', 'Hall Updated', `${name} configuration was updated.`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Exam Management
app.get('/api/exams', async (req, res) => {
  try {
    const exams = await Models.Exam.find();
    const plans = await Models.SeatingPlan.find();
    const allStudents = await Models.Student.find();
    const allHalls = await Models.Hall.find();

    const examsWithCounts = exams.map(e => {
      const examDepts = e.departments.map(d => d.toUpperCase());
      const dateStr = e.date.split('T')[0];

      // Other exams at the same date and session
      const examsAtTime = exams.filter(other => 
        other.date.split('T')[0] === dateStr && 
        other.session === e.session && 
        other._id !== e._id
      );
      const otherExamIds = examsAtTime.map(o => o._id);
      
      // Seated student register numbers in OTHER exams at this time
      const plansAtTimeOther = plans.filter(p => otherExamIds.includes(p.examId));
      const seatedInOtherExams = new Set();
      plansAtTimeOther.forEach(p => {
        if (p.attendanceRoster) {
          p.attendanceRoster.forEach(student => {
            seatedInOtherExams.add(student.registerNo);
          });
        }
      });

      // Total students belonging to departments who are not seated in other exams
      const deptStudents = allStudents.filter(s => examDepts.includes(s.department.toUpperCase()));
      const participatingStudents = deptStudents.filter(s => !seatedInOtherExams.has(s.registerNo));
      const studentsCount = participatingStudents.length;

      // Seated students in own plans of this exam
      const examPlans = plans.filter(p => p.examId === e._id);
      let allocatedCount = 0;
      examPlans.forEach(p => {
        if (p.attendanceRoster) {
          allocatedCount += p.attendanceRoster.length;
        }
      });

      const remainingCount = Math.max(0, studentsCount - allocatedCount);

      // Build assigned halls details with vacant seats
      const assignedHallsDetails = e.assignedHalls.map(hallName => {
        const examIdsAtTime = exams.filter(other => 
          other.date.split('T')[0] === dateStr && 
          other.session === e.session
        ).map(o => o._id);
        
        const plan = plans.find(p => examIdsAtTime.includes(p.examId) && (p.hallId === hallName || p.hallName === hallName));
        const hallObj = allHalls.find(h => h.name === hallName);
        
        return {
          name: hallName,
          vacantSeats: plan ? plan.emptySeats : (hallObj ? hallObj.capacity : 0)
        };
      });

      return {
        ...e,
        studentsCount,
        allocatedCount,
        remainingCount,
        assignedHallsDetails
      };
    });

    res.json(examsWithCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/exams', async (req, res) => {
  try {
    const { name, departments, date, session, assignedHalls } = req.body;
    if (!name || !departments || !date || !session) {
      return res.status(400).json({ error: 'Name, departments, date, and session are required.' });
    }

    // Check if any of the assigned halls are fully occupied on the same date and session
    const existingExams = await Models.Exam.find();
    const selectedDateOnly = date.split('T')[0];
    const examsAtSameTime = existingExams.filter(e => 
      e.date.split('T')[0] === selectedDateOnly && e.session === session
    );
    const examIds = examsAtSameTime.map(e => e._id);

    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));

    const fullyOccupiedHalls = [];
    plansAtSameTime.forEach(plan => {
      if (plan.emptySeats === 0) {
        fullyOccupiedHalls.push(plan.hallName);
      }
    });

    const isFullyOccupied = assignedHalls?.some(hall => fullyOccupiedHalls.includes(hall));
    if (isFullyOccupied) {
      return res.status(400).json({ error: 'One or more assigned halls are fully occupied on this date and session.' });
    }

    // Calculate how many students belong to the selected departments
    const students = await Models.Student.find();
    const relevantStudents = students.filter(s => 
      departments.map(d => d.toUpperCase()).includes(s.department.toUpperCase())
    );

    const newExam = await Models.Exam.create({
      name,
      departments: departments.map(d => d.toUpperCase()),
      date,
      session,
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      status: 'Scheduled'
    });

    logActivity('exam', 'Exam Scheduled', `${name} scheduled for ${date} (${session}). Assigned to ${assignedHalls?.length || 0} halls.`);
    res.status(201).json(newExam);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  try {
    const deleted = await Models.Exam.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Exam not found.' });
    }
    // Also delete any seating plans associated with this exam
    await Models.SeatingPlan.deleteMany({ examId: req.params.id });
    logActivity('exam', 'Exam Cancelled', `${deleted.name} was deleted.`);
    res.json({ success: true, message: 'Exam deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/exams/:id', async (req, res) => {
  try {
    const { name, departments, date, session, assignedHalls } = req.body;
    if (!name || !departments || !date || !session) {
      return res.status(400).json({ error: 'Name, departments, date, and session are required.' });
    }

    // Check if any of the assigned halls are fully occupied on the same date and session (excluding current exam)
    const existingExams = await Models.Exam.find();
    const selectedDateOnly = date.split('T')[0];
    const examsAtSameTime = existingExams.filter(e => 
      e._id !== req.params.id && e.date.split('T')[0] === selectedDateOnly && e.session === session
    );
    const examIds = examsAtSameTime.map(e => e._id);

    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));

    const fullyOccupiedHalls = [];
    plansAtSameTime.forEach(plan => {
      if (plan.emptySeats === 0) {
        fullyOccupiedHalls.push(plan.hallName);
      }
    });

    const isFullyOccupied = assignedHalls?.some(hall => fullyOccupiedHalls.includes(hall));
    if (isFullyOccupied) {
      return res.status(400).json({ error: 'One or more assigned halls are fully occupied on this date and session.' });
    }

    // Calculate how many students belong to the selected departments
    const students = await Models.Student.find();
    const relevantStudents = students.filter(s => 
      departments.map(d => d.toUpperCase()).includes(s.department.toUpperCase())
    );

    const updated = await Models.Exam.findByIdAndUpdate(req.params.id, {
      name,
      departments: departments.map(d => d.toUpperCase()),
      date,
      session,
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || []
    });

    if (!updated) {
      return res.status(404).json({ error: 'Exam not found.' });
    }

    // If date or session or departments or halls changed, delete existing seating plans for this exam so they must be regenerated
    await Models.SeatingPlan.deleteMany({ examId: req.params.id });

    logActivity('exam', 'Exam Updated', `${name} configuration was updated.`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/exams/remaining-students', async (req, res) => {
  try {
    const exams = await Models.Exam.find();
    const plans = await Models.SeatingPlan.find();
    const allStudents = await Models.Student.find();

    // Group exams by unique date and session
    const groups = {};
    exams.forEach(e => {
      const dateStr = e.date.split('T')[0];
      const key = `${dateStr}_${e.session}`;
      if (!groups[key]) {
        groups[key] = {
          date: e.date,
          session: e.session,
          departments: new Set()
        };
      }
      e.departments.forEach(d => groups[key].departments.add(d.toUpperCase()));
    });

    const result = [];

    for (const key of Object.keys(groups)) {
      const group = groups[key];
      const dateStr = group.date.split('T')[0];
      
      // Seated student register numbers on this date and session
      const examsAtTime = exams.filter(e => e.date.split('T')[0] === dateStr && e.session === group.session);
      const examIds = examsAtTime.map(e => e._id);
      const plansAtTime = plans.filter(p => examIds.includes(p.examId));
      
      const seatedRegNos = new Set();
      plansAtTime.forEach(p => {
        if (p.attendanceRoster) {
          p.attendanceRoster.forEach(s => seatedRegNos.add(s.registerNo));
        }
      });

      const deptsArray = Array.from(group.departments);
      const deptDetails = [];

      deptsArray.forEach(dept => {
        const deptStudents = allStudents.filter(s => s.department.toUpperCase() === dept);
        const unseated = deptStudents.filter(s => !seatedRegNos.has(s.registerNo))
          .sort((a, b) => a.registerNo.localeCompare(b.registerNo));

        if (unseated.length > 0) {
          deptDetails.push({
            department: dept,
            count: unseated.length,
            students: unseated.map(s => s.registerNo)
          });
        }
      });

      if (deptDetails.length > 0) {
        result.push({
          date: group.date,
          session: group.session,
          departments: deptDetails
        });
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/students/remaining', async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: 'date and session are required.' });
    }
    
    // Find all exams scheduled for the same date and session
    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    let examsAtSameTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );
    if (req.query.excludeExamId) {
      examsAtSameTime = examsAtSameTime.filter(e => e._id !== req.query.excludeExamId);
    }
    const examIds = examsAtSameTime.map(e => e._id);
    
    // Retrieve all seating plans for these exams
    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));
    
    const seatedStudentRegNos = new Set();
    plansAtSameTime.forEach(plan => {
      plan.attendanceRoster.forEach(student => {
        seatedStudentRegNos.add(student.registerNo);
      });
    });

    const allStudents = await Models.Student.find();
    
    // Count remaining students per department
    const remainingCounts = {};
    allStudents.forEach(s => {
      const dept = s.department.toUpperCase();
      if (!seatedStudentRegNos.has(s.registerNo)) {
        remainingCounts[dept] = (remainingCounts[dept] || 0) + 1;
      }
    });

    res.json(remainingCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/halls/availability', async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: 'date and session are required.' });
    }
    
    // Find all exams scheduled for this date and session
    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    let examsAtSameTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );
    if (req.query.excludeExamId) {
      examsAtSameTime = examsAtSameTime.filter(e => e._id !== req.query.excludeExamId);
    }
    const examIds = examsAtSameTime.map(e => e._id);
    
    // Get all generated seating plans for these exams
    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));
    
    // Map hall name to whether it's fully occupied or has seating plans
    const hallPlans = {};
    plansAtSameTime.forEach(p => {
      hallPlans[p.hallName] = p;
    });

    const allHalls = await Models.Hall.find();
    
    const availability = {};
    allHalls.forEach(hall => {
      const plan = hallPlans[hall.name];
      if (!plan) {
        // No seating plan generated yet.
        // Wait, is the hall assigned to any exam?
        const isAssigned = examsAtSameTime.some(e => e.assignedHalls && e.assignedHalls.includes(hall.name));
        if (isAssigned) {
          // It is assigned, but seating plan is not generated.
          // Since it's not generated, it is considered to have all seats vacant!
          availability[hall.name] = {
            occupied: false,
            vacantSeats: hall.capacity,
            assigned: true,
            msg: `${hall.capacity} Seats`
          };
        } else {
          // Not assigned to any exam
          availability[hall.name] = {
            occupied: false,
            vacantSeats: hall.capacity,
            assigned: false,
            msg: `${hall.capacity} Seats`
          };
        }
      } else {
        // Seating plan exists. Check emptySeats
        if (plan.emptySeats > 0) {
          availability[hall.name] = {
            occupied: false,
            vacantSeats: plan.emptySeats,
            assigned: true,
            msg: `${plan.emptySeats} Seats`
          };
        } else {
          availability[hall.name] = {
            occupied: true,
            vacantSeats: 0,
            assigned: true,
            msg: `Occupied`
          };
        }
      }
    });

    res.json(availability);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Seating Plan Generation and Retrieval
app.get('/api/seating/:examId/:hallId', async (req, res) => {
  try {
    const plan = await Models.SeatingPlan.findOne({ 
      examId: req.params.examId, 
      hallId: req.params.hallId 
    });
    if (!plan) {
      return res.status(404).json({ message: 'Seating plan not generated yet.' });
    }

    // Recalculate unseated students dynamically based on all plans scheduled for the same time
    const exam = await Models.Exam.findById(req.params.examId);
    if (exam) {
      const allExams = await Models.Exam.find();
      const targetDate = exam.date.split('T')[0];
      const examsAtSameTime = allExams.filter(e => 
        e.date.split('T')[0] === targetDate && e.session === exam.session
      );
      const examIds = examsAtSameTime.map(e => e._id);
      
      const allPlans = await Models.SeatingPlan.find();
      const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));
      
      const seatedStudentRegNos = new Set();
      plansAtSameTime.forEach(p => {
        p.attendanceRoster.forEach(student => {
          seatedStudentRegNos.add(student.registerNo);
        });
      });
      
      const allStudents = await Models.Student.find();
      const examDepts = exam.departments.map(d => d.toUpperCase());
      
      const unseated = allStudents
        .filter(s => {
          if (!examDepts.includes(s.department.toUpperCase())) return false;
          if (seatedStudentRegNos.has(s.registerNo)) return false;
          return true;
        })
        .sort((a, b) => a.registerNo.localeCompare(b.registerNo));
        
      plan.unseatedStudents = unseated;
    }

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/uploads', async (req, res) => {
  try {
    const history = await Models.UploadHistory.find();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/uploads', async (req, res) => {
  try {
    await Models.UploadHistory.deleteMany({});
    res.json({ success: true, message: 'Upload history cleared.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/seating/generate', async (req, res) => {
  try {
    const { examId, hallId } = req.body;
    if (!examId || !hallId) {
      return res.status(400).json({ error: 'examId and hallId are required.' });
    }

    const exam = await Models.Exam.findById(examId);
    const hall = await Models.Hall.findById(hallId);

    if (!exam || !hall) {
      return res.status(404).json({ error: 'Exam or Hall not found.' });
    }

    // Get students for exam's departments
    const allStudents = await Models.Student.find();
    const examDepts = exam.departments.map(d => d.toUpperCase());
    
    // Find all exams scheduled for the same date and session
    const allExams = await Models.Exam.find();
    const targetDate = exam.date.split('T')[0];
    const examsAtSameTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === exam.session
    );
    const examIds = examsAtSameTime.map(e => e._id);

    // Retrieve any existing seating plans generated for these exams
    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));
    
    const seatedStudentRegNos = new Set();
    const otherExamsAtSameTime = examsAtSameTime.filter(e => e._id !== examId);
    const otherExamIds = otherExamsAtSameTime.map(e => e._id);
    const plansForOtherExams = plansAtSameTime.filter(p => otherExamIds.includes(p.examId));
    
    plansForOtherExams.forEach(plan => {
      if (plan.attendanceRoster) {
        plan.attendanceRoster.forEach(student => {
          seatedStudentRegNos.add(student.registerNo);
        });
      }
    });

    const allHalls = await Models.Hall.find();
    // Sort / resolve assigned halls in their designated order (preserving selection click sequence)
    const assignedHallsInOrder = exam.assignedHalls.map(hallName => 
      allHalls.find(h => h.name === hallName || h._id === hallName)
    ).filter(Boolean);

    // Initial student pool for this exam (departments of the exam, minus anyone seated in OTHER exams)
    let currentPool = allStudents.filter(s => {
      if (!examDepts.includes(s.department.toUpperCase())) return false;
      if (seatedStudentRegNos.has(s.registerNo)) return false;
      return true;
    }).sort((a, b) => a.registerNo.localeCompare(b.registerNo));

    let targetSeatingGrid = [];
    let targetAttendanceRoster = [];
    let targetTotalStudentsSeated = 0;
    let targetEmptySeats = 0;

    const initialPoolForUnseated = [...currentPool];

    // Allocate halls sequentially in their designated sequence
    for (const h of assignedHallsInOrder) {
      const rowsCount = h.rows;
      const colsCount = h.columns;
      const totalSeats = rowsCount * colsCount * 2;

      // Existing plans for other exams in this same hall
      const otherPlansForThisHall = plansAtSameTime.filter(p => p.examId !== examId && (p.hallId === h._id || p.hallName === h.name));
      const occupiedSeatsInThisHall = {};
      otherPlansForThisHall.forEach(p => {
        if (p.seatingGrid) {
          p.seatingGrid.forEach(g => {
            if (g.seat1) occupiedSeatsInThisHall[`${g.benchCode}_seat1`] = g.seat1;
            if (g.seat2) occupiedSeatsInThisHall[`${g.benchCode}_seat2`] = g.seat2;
          });
        }
      });

      // Benches layout for this hall
      const gridMap = {};
      let availableSeats = 0;
      for (let c = 1; c <= colsCount; c++) {
        for (let r = 0; r < rowsCount; r++) {
          const rowLetter = String.fromCharCode(65 + r);
          const benchCode = `${rowLetter}${c}`;
          gridMap[benchCode] = {
            benchCode,
            row: rowLetter,
            col: c,
            seat1: occupiedSeatsInThisHall[`${benchCode}_seat1`] || null,
            seat2: occupiedSeatsInThisHall[`${benchCode}_seat2`] || null
          };
          if (!gridMap[benchCode].seat1) availableSeats++;
          if (!gridMap[benchCode].seat2) availableSeats++;
        }
      }

      // Group remaining pool by department
      const studentsByDept = {};
      examDepts.forEach(dept => {
        studentsByDept[dept] = currentPool.filter(s => s.department.toUpperCase() === dept);
      });

      // Filter active departments preserving exam selection priority
      let activeDepts = examDepts.filter(dept => studentsByDept[dept] && studentsByDept[dept].length > 0);

      const localRoster = [];
      let totalSeatedInThisHall = 0;

      if (activeDepts.length === 1) {
        // Single department: split evenly
        const dept = activeDepts[0];
        const list = studentsByDept[dept];
        let seat1Pool = [];
        let seat2Pool = [];

        list.forEach((student, index) => {
          if (index % 2 === 0) {
            seat1Pool.push(student);
          } else {
            seat2Pool.push(student);
          }
        });

        let studentIndex1 = 0;
        let studentIndex2 = 0;

        for (let c = 1; c <= colsCount; c++) {
          for (let r = 0; r < rowsCount; r++) {
            const rowLetter = String.fromCharCode(65 + r);
            const benchCode = `${rowLetter}${c}`;
            const bench = gridMap[benchCode];

            if (!bench.seat1 && studentIndex1 < seat1Pool.length) {
              const seat1Student = seat1Pool[studentIndex1++];
              bench.seat1 = seat1Student;
              totalSeatedInThisHall++;
              localRoster.push({
                registerNo: seat1Student.registerNo,
                name: seat1Student.name,
                department: seat1Student.department,
                bench: benchCode,
                seat: 'Left'
              });
            }

            if (!bench.seat2 && studentIndex2 < seat2Pool.length) {
              const seat2Student = seat2Pool[studentIndex2++];
              bench.seat2 = seat2Student;
              totalSeatedInThisHall++;
              localRoster.push({
                registerNo: seat2Student.registerNo,
                name: seat2Student.name,
                department: seat2Student.department,
                bench: benchCode,
                seat: 'Right'
              });
            }
          }
        }
      } else if (activeDepts.length > 1) {
        // Proportionally allocate seats/quotas
        const seatsToAllocate = {};
        activeDepts.forEach(d => { seatsToAllocate[d] = 0; });

        let remainingSeats = availableSeats;
        let deptsToCheck = [...activeDepts];

        while (remainingSeats > 0 && deptsToCheck.length > 0) {
          const share = Math.floor(remainingSeats / deptsToCheck.length) || 1;
          const nextDeptsToCheck = [];
          let allocatedTotalThisRound = 0;

          for (const dept of deptsToCheck) {
            if (remainingSeats <= 0) break;
            const availableStudents = studentsByDept[dept].length;
            const currentAllocated = seatsToAllocate[dept];
            const remainingStudentsForDept = availableStudents - currentAllocated;

            if (remainingStudentsForDept <= 0) continue;

            const allocatedThisRound = Math.min(share, remainingStudentsForDept, remainingSeats);
            seatsToAllocate[dept] += allocatedThisRound;
            remainingSeats -= allocatedThisRound;
            allocatedTotalThisRound += allocatedThisRound;

            if (seatsToAllocate[dept] < availableStudents) {
              nextDeptsToCheck.push(dept);
            }
          }

          if (allocatedTotalThisRound === 0) break;
          deptsToCheck = nextDeptsToCheck;
        }

        const selectedStudentsByDept = {};
        activeDepts.forEach(dept => {
          selectedStudentsByDept[dept] = studentsByDept[dept].slice(0, seatsToAllocate[dept]);
        });

        const leftSeats = [];
        const rightSeats = [];
        for (let c = 1; c <= colsCount; c++) {
          for (let r = 0; r < rowsCount; r++) {
            const rowLetter = String.fromCharCode(65 + r);
            const benchCode = `${rowLetter}${c}`;
            const bench = gridMap[benchCode];
            leftSeats.push({ bench, seatKey: 'seat1', side: 'Left' });
            rightSeats.push({ bench, seatKey: 'seat2', side: 'Right' });
          }
        }

        let currentDeptIdx = 0;
        leftSeats.forEach(({ bench, seatKey, side }) => {
          if (bench[seatKey]) return;
          while (currentDeptIdx < activeDepts.length) {
            const dept = activeDepts[currentDeptIdx];
            const pool = selectedStudentsByDept[dept];
            if (pool && pool.length > 0) {
              const student = pool.shift();
              bench[seatKey] = student;
              localRoster.push({
                registerNo: student.registerNo,
                name: student.name,
                department: student.department,
                bench: bench.benchCode,
                seat: side
              });
              totalSeatedInThisHall++;
              break;
            }
            currentDeptIdx++;
          }
        });

        rightSeats.forEach(({ bench, seatKey, side }) => {
          if (bench[seatKey]) return;
          const leftDept = bench.seat1 ? bench.seat1.department.toUpperCase() : null;

          let attempts = 0;
          let scanDeptIdx = 0;
          while (attempts < activeDepts.length) {
            const dept = activeDepts[scanDeptIdx];
            const isDifferent = !leftDept || leftDept !== dept.toUpperCase();
            const pool = selectedStudentsByDept[dept];
            if (isDifferent && pool && pool.length > 0) {
              const student = pool.shift();
              bench[seatKey] = student;
              localRoster.push({
                registerNo: student.registerNo,
                name: student.name,
                department: student.department,
                bench: bench.benchCode,
                seat: side
              });
              totalSeatedInThisHall++;
              break;
            }
            scanDeptIdx = (scanDeptIdx + 1) % activeDepts.length;
            attempts++;
          }
        });
      }

      // Filter seated students out of currentPool
      const localSeatedRegNos = new Set(localRoster.map(r => r.registerNo));
      currentPool = currentPool.filter(s => !localSeatedRegNos.has(s.registerNo));

      // Construct grid in row-major order
      const localGrid = [];
      for (let r = 0; r < rowsCount; r++) {
        const rowLetter = String.fromCharCode(65 + r);
        for (let c = 1; c <= colsCount; c++) {
          const benchCode = `${rowLetter}${c}`;
          localGrid.push(gridMap[benchCode]);
        }
      }

      const occupiedInOtherExams = otherPlansForThisHall.reduce((acc, p) => acc + (p.attendanceRoster ? p.attendanceRoster.length : 0), 0);
      const emptySeatsCount = totalSeats - occupiedInOtherExams - totalSeatedInThisHall;

      if (h._id === hallId || h.name === hallId) {
        targetSeatingGrid = localGrid;
        targetAttendanceRoster = localRoster;
        targetTotalStudentsSeated = totalSeatedInThisHall;
        targetEmptySeats = emptySeatsCount;
      }
    }

    const finalSeatedRegNos = new Set(allStudents.filter(s => !currentPool.some(p => p.registerNo === s.registerNo)).map(s => s.registerNo));
    const unseatedStudents = initialPoolForUnseated.filter(s => !finalSeatedRegNos.has(s.registerNo))
      .sort((a, b) => a.registerNo.localeCompare(b.registerNo));

    const seatingGrid = targetSeatingGrid;
    const attendanceRoster = targetAttendanceRoster;
    const totalStudentsSeated = targetTotalStudentsSeated;
    const emptySeats = targetEmptySeats;

    // Stats
    const totalBenches = hall.benches;

    // Create/update the SeatingPlan
    const plan = await Models.SeatingPlan.create({
      examId,
      examName: exam.name,
      hallId,
      hallName: hall.name,
      seatingGrid,
      attendanceRoster: attendanceRoster.sort((a, b) => a.registerNo.localeCompare(b.registerNo)),
      unseatedStudents,
      totalBenches,
      totalStudents: totalStudentsSeated,
      emptySeats
    });

    // Update other plans scheduled for the same time with the new unseated list or updated grid
    const otherPlans = plansAtSameTime.filter(p => !(p.examId === examId && p.hallId === hallId));
    for (const otherPlan of otherPlans) {
      const otherExam = examsAtSameTime.find(e => e._id === otherPlan.examId);
      if (otherExam) {
        // If it is in the same hall, sync the seatingGrid and emptySeats
        if (otherPlan.hallId === hallId) {
          otherPlan.seatingGrid = seatingGrid;
          otherPlan.emptySeats = emptySeats;
        }

        const otherExamDepts = otherExam.departments.map(d => d.toUpperCase());
        const newSeatedRegNos = new Set([...seatedStudentRegNos, ...attendanceRoster.map(r => r.registerNo)]);
        const updatedUnseated = allStudents
          .filter(s => otherExamDepts.includes(s.department.toUpperCase()) && !newSeatedRegNos.has(s.registerNo))
          .sort((a, b) => a.registerNo.localeCompare(b.registerNo));
        
        otherPlan.unseatedStudents = updatedUnseated;
        await Models.SeatingPlan.create(otherPlan);
      }
    }

    logActivity('exam', 'Seating Generated', `Generated seating plan for ${exam.name} in ${hall.name}. Seated ${totalStudentsSeated} students.`);

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HELPER: Hash Password
const hashPassword = (password) => {
  const salt = 'examflow_secret_salt_123';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
};

// 7. Authentication APIs
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    // Check if user already exists
    const existingUserByEmail = await Models.User.findOne({ email });
    if (existingUserByEmail) {
      return res.status(400).json({ error: 'User with this email already exists.' });
    }

    const existingUserByUsername = await Models.User.findOne({ username });
    if (existingUserByUsername) {
      return res.status(400).json({ error: 'User with this username already exists.' });
    }

    const hashedPassword = hashPassword(password);
    const newUser = await Models.User.create({
      username,
      email,
      password: hashedPassword
    });

    logActivity('user', 'User Registered', `New administrator profile '${username}' was created.`);

    res.status(201).json({
      success: true,
      message: 'Registration successful. You can now login.',
      user: {
        username: newUser.username,
        email: newUser.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Username/Email and password are required.' });
    }

    // Attempt to find by email first, then username
    let user = await Models.User.findOne({ email: emailOrUsername });
    if (!user) {
      user = await Models.User.findOne({ username: emailOrUsername });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const hashedPassword = hashPassword(password);
    if (user.password !== hashedPassword) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    logActivity('user', 'User Logged In', `User '${user.username}' logged in successfully.`);

    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
