const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

const XLSX = require('xlsx');

const { Models, dbStatus } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Multer for CSV/Excel uploads (using memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max limit
});

// Helper: Convert a file buffer (CSV or Excel) to CSV text string
function bufferToCsvText(buffer, originalname) {
  // Excel magic bytes: XLSX starts with PK (0x50 0x4B), XLS starts with 0xD0 0xCF
  const isExcel = originalname && (/\.(xlsx|xls)$/i.test(originalname));
  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_csv(sheet);
  }
  return buffer.toString('utf8');
}

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
// Helper: proper RFC-4180 CSV line splitter (handles Excel double-quoted fields)
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { // escaped quote ""
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Parse header
  let headers;
  let startIdx = 1;
  const firstLine = lines[0];

  if (hasHeaders(firstLine)) {
    headers = splitCsvLine(firstLine).map(h => h.replace(/^["']|["']$/g, '').trim());
  } else {
    headers = ['Register No', 'Name', 'Department'];
    startIdx = 0;
  }

  // Find column indexes
  let regIndex  = headers.findIndex(h => /reg|roll|number|id/i.test(h));
  let nameIndex = headers.findIndex(h => /name|student/i.test(h));
  let deptIndex = headers.findIndex(h => /dept|depart|branch|course/i.test(h));
  if (deptIndex === -1) deptIndex = headers.findIndex(h => /subject/i.test(h));
  let batchIndex = headers.findIndex(h => /batch|year/i.test(h));

  // Fallbacks if not detected by regex
  if (regIndex  === -1) regIndex  = 0;
  if (nameIndex === -1) nameIndex = 1;
  if (deptIndex === -1) deptIndex = 2;

  const records = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = splitCsvLine(line);

    if (parts.length > Math.max(regIndex, nameIndex, deptIndex)) {
      const registerNo = parts[regIndex];
      const name       = parts[nameIndex];
      const department = parts[deptIndex];
      const batch      = batchIndex !== -1 ? parts[batchIndex] : '2024-25';

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

// Helper: Extract the first subject code from student csvData (used for display/single-code needs)
function getStudentSubCode(student) {
  if (!student.csvData) return null;
  const possibleKeys = Object.keys(student.csvData);
  const subCodeKey = possibleKeys.find(k => /sub.*code|subject.*code|sub_code|subcode/i.test(k));
  if (subCodeKey) return student.csvData[subCodeKey] || null;
  return null;
}

// Helper: Extract ALL subject codes from student csvData (supports sub_code_1, sub_code_2, ... columns)
function getStudentAllSubCodes(student) {
  if (!student.csvData) return [];
  const codes = [];
  const possibleKeys = Object.keys(student.csvData);
  possibleKeys.forEach(k => {
    if (/sub.*code|subject.*code|sub_code|subcode/i.test(k)) {
      const val = student.csvData[k];
      if (val && val.toString().trim()) {
        codes.push(val.toString().trim().toUpperCase());
      }
    }
  });
  return [...new Set(codes)];
}

// Helper: Check if a student has any subject code matching the given list of codes
function hasMatchingSubCode(student, examSubCodes) {
  const studentCodes = getStudentAllSubCodes(student);
  return studentCodes.some(code => examSubCodes.includes(code));
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

// 1.1 System Info (Settings About Section)
app.get('/api/settings/system-info', async (req, res) => {
  try {
    let sizeBytes = 0;
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      files.forEach(file => {
        const stats = fs.statSync(path.join(dataDir, file));
        sizeBytes += stats.size;
      });
    }

    const studentCount = (await Models.Student.find()).length;
    const hallCount = (await Models.Hall.find()).length;
    const examCount = (await Models.Exam.find()).length;
    const planCount = (await Models.SeatingPlan.find()).length;
    
    const isConnected = dbStatus().connected;
    if (isConnected) {
      sizeBytes += (studentCount + hallCount + examCount + planCount) * 256; 
    }

    const storageUsedKb = (sizeBytes / 1024).toFixed(2);

    res.json({
      projectVersion: 'v1.2.0',
      databaseStatus: isConnected ? 'Connected (MySQL)' : 'Local JSON Fallback',
      storageUsed: `${storageUsedKb} KB`,
      recordCounts: {
        students: studentCount,
        halls: hallCount,
        exams: examCount,
        plans: planCount
      }
    });
  } catch (error) {
    console.error("Error fetching system info:", error);
    res.status(500).json({ error: 'Failed to retrieve system info' });
  }
});

// 1.2 Database Backup Export Endpoint
app.get('/api/settings/backup', async (req, res) => {
  try {
    const students = await Models.Student.find();
    const halls = await Models.Hall.find();
    const exams = await Models.Exam.find();
    const seatingPlans = await Models.SeatingPlan.find();
    
    res.json({
      timestamp: new Date().toISOString(),
      students,
      halls,
      exams,
      seatingPlans
    });
  } catch (error) {
    console.error("Backup failed:", error);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// 1.3 Database Backup Restore Endpoint
app.post('/api/settings/restore', async (req, res) => {
  try {
    const { students, halls, exams, seatingPlans } = req.body;
    
    if (!Array.isArray(students) || !Array.isArray(halls) || !Array.isArray(exams) || !Array.isArray(seatingPlans)) {
      return res.status(400).json({ error: 'Invalid backup format. Must contain students, halls, exams, and seatingPlans arrays.' });
    }
    
    // Clear all existing databases
    await Models.Student.deleteMany({});
    await Models.Hall.deleteMany({});
    await Models.Exam.deleteMany({});
    await Models.SeatingPlan.deleteMany({});
    
    // Restore data if not empty
    if (students.length > 0) await Models.Student.create(students);
    if (halls.length > 0) await Models.Hall.create(halls);
    if (exams.length > 0) await Models.Exam.create(exams);
    if (seatingPlans.length > 0) await Models.SeatingPlan.create(seatingPlans);
    
    logActivity('student', 'Database Restored', `Restored ${students.length} students, ${halls.length} halls, ${exams.length} exams, and ${seatingPlans.length} seating plans from backup.`);
    
    res.json({ success: true, message: 'Database restored successfully!' });
  } catch (error) {
    console.error("Restore failed:", error);
    res.status(500).json({ error: 'Restore failed: ' + error.message });
  }
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
      csvText = bufferToCsvText(req.file.buffer, req.file.originalname);
    } else if (req.body.csvText) {
      csvText = req.body.csvText;
    } else {
      throw new Error('No file or text provided.');
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

app.post('/api/halls/clear', async (req, res) => {
  try {
    await Models.Hall.deleteMany({});
    logActivity('hall', 'Halls Database Cleared', 'All hall records have been deleted.');
    res.json({ success: true, message: 'All hall records cleared.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Hall CSV Upload
app.post('/api/halls/upload', upload.single('file'), async (req, res) => {
  const filename = req.file ? req.file.originalname : 'manual_entry.csv';
  try {
    let csvText = '';
    if (req.file) {
      csvText = bufferToCsvText(req.file.buffer, req.file.originalname);
    } else if (req.body.csvText) {
      csvText = req.body.csvText;
    } else {
      throw new Error('No file or text provided.');
    }

    // Parse CSV into hall records
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error('CSV is empty.');

    // Detect header row using proper RFC-4180 splitter
    const firstLine = lines[0];
    const firstParts = splitCsvLine(firstLine).map(p => p.replace(/^["']|["']$/g, '').trim());
    
    // Check if the second and third columns of the first line are numeric
    const isNumeric = (str) => {
      if (typeof str !== 'string') return false;
      return !isNaN(str) && !isNaN(parseFloat(str));
    };
    const isSecondPartNumeric = firstParts[1] && isNumeric(firstParts[1]);
    const isThirdPartNumeric = firstParts[2] && isNumeric(firstParts[2]);

    const hasHeader = firstParts.some(p => /hall|name|room|block|bench|seat|row|col/i.test(p)) || 
                      (firstParts.length >= 3 && (!isSecondPartNumeric || !isThirdPartNumeric));

    let headers, startIdx;
    if (hasHeader) {
      headers = firstParts;
      startIdx = 1;
    } else {
      headers = ['Hall Name', 'Rows', 'Columns'];
      startIdx = 0;
    }
    const nameIdx = headers.findIndex(h => /hall|name|room|block|h\s*no/i.test(h));
    const rowsIdx = headers.findIndex(h => /row|set/i.test(h) && !/seat|capacity/i.test(h));
    const colsIdx = headers.findIndex(h => /col/i.test(h) && !/alloc|allot/i.test(h));
    const capacityIdx = headers.findIndex(h => /seat|capacity/i.test(h));

    const nameIndex = nameIdx !== -1 ? nameIdx : 0;
    const rowsIndex = rowsIdx !== -1 ? rowsIdx : 1;
    const colsIndex = colsIdx !== -1 ? colsIdx : 2;
    const capacityIndex = capacityIdx !== -1 ? capacityIdx : -1;

    const hallRecords = [];
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = splitCsvLine(line);
      const name = parts[nameIndex];
      let rows = parseInt(parts[rowsIndex]);
      let columns = colsIdx !== -1 ? parseInt(parts[colsIndex]) : 1;
      let capacity = capacityIndex !== -1 ? parseInt(parts[capacityIndex]) : NaN;

      if (!name || name.toUpperCase() === 'T' || name.toLowerCase().includes('total')) continue;

      if (isNaN(rows) || rows <= 0) {
        if (!isNaN(capacity) && capacity > 0) {
          const benches = Math.round(capacity / 2);
          if (columns > 0) {
            rows = Math.round(benches / columns);
          } else {
            rows = benches;
            columns = 1;
          }
        } else {
          rows = 8;
          columns = 5;
        }
      }

      if (isNaN(columns) || columns <= 0) {
        columns = 1;
      }

      if (isNaN(capacity) || capacity <= 0) {
        capacity = rows * columns * 2;
      }
      // Build csvData: map every original CSV header to its value
      const csvData = {};
      headers.forEach((header, index) => {
        csvData[header] = parts[index] || '';
      });

      hallRecords.push({ name, rows, columns, csvData, capacity });
    }

    if (hallRecords.length === 0) {
      throw new Error('No valid hall records found. CSV must have columns: Hall Name, Rows, Columns.');
    }

    let insertedCount = 0;
    for (const h of hallRecords) {
      const benches = h.rows * h.columns;
      await Models.Hall.create({ name: h.name, rows: h.rows, columns: h.columns, benches, capacity: h.capacity, csvData: h.csvData });
      insertedCount++;
    }

    logActivity('hall', 'Halls Uploaded via CSV', `${filename} imported ${insertedCount} hall records.`);

    res.json({
      success: true,
      message: `Successfully imported ${insertedCount} hall record(s) from CSV.`,
      count: insertedCount
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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
      const examSubCodes = (e.subjectCodes || []).map(c => c.toUpperCase());
      const examDepts = (e.departments || []).map(d => d.toUpperCase());
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

      // Filter students by subject codes if available, fallback to departments
      let relevantStudents;
      if (examSubCodes.length > 0) {
        relevantStudents = allStudents.filter(s => hasMatchingSubCode(s, examSubCodes));
      } else {
        relevantStudents = allStudents.filter(s => examDepts.includes(s.department.toUpperCase()));
      }
      const participatingStudents = relevantStudents.filter(s => !seatedInOtherExams.has(s.registerNo));
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
    const { name, departments, subjectCodes, date, session, assignedHalls, seatsPerBench } = req.body;
    if (!name || !date || !session) {
      return res.status(400).json({ error: 'Name, date, and session are required.' });
    }
    if ((!subjectCodes || subjectCodes.length === 0) && (!departments || departments.length === 0)) {
      return res.status(400).json({ error: 'Please select at least one subject code.' });
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

    // Calculate how many students match selected subject codes (or fallback to departments)
    const students = await Models.Student.find();
    const upperSubCodes = (subjectCodes || []).map(c => c.toUpperCase());
    const upperDepts = (departments || []).map(d => d.toUpperCase());
    
    let relevantStudents;
    if (upperSubCodes.length > 0) {
      relevantStudents = students.filter(s => hasMatchingSubCode(s, upperSubCodes));
    } else {
      relevantStudents = students.filter(s => 
        upperDepts.includes(s.department.toUpperCase())
      );
    }

    const newExam = await Models.Exam.create({
      name,
      departments: upperDepts,
      subjectCodes: upperSubCodes,
      date,
      session,
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      seatsPerBench: parseInt(seatsPerBench) || 2,
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
    const { name, departments, subjectCodes, date, session, assignedHalls, seatsPerBench } = req.body;
    if (!name || !date || !session) {
      return res.status(400).json({ error: 'Name, date, and session are required.' });
    }
    if ((!subjectCodes || subjectCodes.length === 0) && (!departments || departments.length === 0)) {
      return res.status(400).json({ error: 'Please select at least one subject code.' });
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

    // Calculate how many students match selected subject codes (or fallback to departments)
    const students = await Models.Student.find();
    const upperSubCodes = (subjectCodes || []).map(c => c.toUpperCase());
    const upperDepts = (departments || []).map(d => d.toUpperCase());
    
    let relevantStudents;
    if (upperSubCodes.length > 0) {
      relevantStudents = students.filter(s => hasMatchingSubCode(s, upperSubCodes));
    } else {
      relevantStudents = students.filter(s => 
        upperDepts.includes(s.department.toUpperCase())
      );
    }

    const updated = await Models.Exam.findByIdAndUpdate(req.params.id, {
      name,
      departments: upperDepts,
      subjectCodes: upperSubCodes,
      date,
      session,
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      seatsPerBench: parseInt(seatsPerBench) || 2
    });

    if (!updated) {
      return res.status(404).json({ error: 'Exam not found.' });
    }

    // If date or session or subject codes or halls changed, delete existing seating plans for this exam so they must be regenerated
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

// Get all unique subject codes from student records
app.get('/api/students/subject-codes', async (req, res) => {
  try {
    const allStudents = await Models.Student.find();
    const subCodeSet = new Set();
    allStudents.forEach(s => {
      const codes = getStudentAllSubCodes(s);
      codes.forEach(code => subCodeSet.add(code));
    });
    res.json([...subCodeSet].sort());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get remaining (unseated) student counts per subject code for a given date/session
app.get('/api/students/remaining-by-subject', async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: 'date and session are required.' });
    }
    
    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    let examsAtSameTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );
    if (req.query.excludeExamId) {
      examsAtSameTime = examsAtSameTime.filter(e => e._id !== req.query.excludeExamId);
    }
    const examIds = examsAtSameTime.map(e => e._id);
    
    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(p.examId));
    
    const seatedStudentRegNos = new Set();
    plansAtSameTime.forEach(plan => {
      plan.attendanceRoster.forEach(student => {
        seatedStudentRegNos.add(student.registerNo);
      });
    });

    const allStudents = await Models.Student.find();
    
    // Count remaining students per subject code (supports multiple sub_code columns per student)
    const remainingCounts = {};
    allStudents.forEach(s => {
      if (!seatedStudentRegNos.has(s.registerNo)) {
        const codes = getStudentAllSubCodes(s);
        codes.forEach(code => {
          remainingCounts[code] = (remainingCounts[code] || 0) + 1;
        });
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
      const examSubCodes = (exam.subjectCodes || []).map(c => c.toUpperCase());
      const examDepts = (exam.departments || []).map(d => d.toUpperCase());
      
      const unseated = allStudents
        .filter(s => {
          // Filter by subject codes if available, else departments
          if (examSubCodes.length > 0) {
            if (!hasMatchingSubCode(s, examSubCodes)) return false;
          } else {
            if (!examDepts.includes(s.department.toUpperCase())) return false;
          }
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

// Helper to perform seating generation for a single exam and hall
async function generateSeatingPlan(examId, hallId) {
  const exam = await Models.Exam.findById(examId);
  const hall = await Models.Hall.findById(hallId);

  if (!exam || !hall) {
    throw new Error('Exam or Hall not found.');
  }

  // Get students for exam's subject codes (or departments as fallback)
  const allStudents = await Models.Student.find();
  const examSubCodes = (exam.subjectCodes || []).map(c => c.toUpperCase());
  const examDepts = (exam.departments || []).map(d => d.toUpperCase());
  
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

  // Initial student pool for this exam (by subject codes or departments, minus anyone seated in OTHER exams)
  let currentPool = allStudents.filter(s => {
    if (examSubCodes.length > 0) {
      if (!hasMatchingSubCode(s, examSubCodes)) return false;
    } else {
      if (!examDepts.includes(s.department.toUpperCase())) return false;
    }
    if (seatedStudentRegNos.has(s.registerNo)) return false;
    return true;
  }).sort((a, b) => a.registerNo.localeCompare(b.registerNo));

  let targetSeatingGrid = [];
  let targetAttendanceRoster = [];
  let targetTotalStudentsSeated = 0;
  let targetEmptySeats = 0;

  const initialPoolForUnseated = [...currentPool];

  // Group students by subject codes (preserving the selected order/click priority)
  let activePools = [];
  if (examSubCodes.length > 0) {
    // Track which students have already been assigned to a pool to avoid duplicates
    const assignedStudents = new Set();
    activePools = examSubCodes.map(code => ({
      code: code.toUpperCase(),
      students: currentPool.filter(s => {
        if (assignedStudents.has(s.registerNo)) return false;
        const studentCodes = getStudentAllSubCodes(s);
        if (studentCodes.includes(code.toUpperCase())) {
          assignedStudents.add(s.registerNo);
          return true;
        }
        return false;
      })
    })).filter(p => p.students.length > 0);
  } else {
    // Fallback to departments if no subject codes (using selection priority order of departments)
    activePools = examDepts.map(dept => ({
      code: dept.toUpperCase(),
      students: currentPool.filter(s => s.department.toUpperCase() === dept.toUpperCase())
    })).filter(p => p.students.length > 0);
  }

  // Helper to pick next student (excluding specified departments to prevent same-department adjacent seating)
  function getNextStudent(excludeDepts = []) {
    const upperExcludeDepts = excludeDepts.map(d => d.toUpperCase());
    for (const pool of activePools) {
      const idx = pool.students.findIndex(s => !upperExcludeDepts.includes(s.department.toUpperCase()));
      if (idx !== -1) {
        const student = pool.students.splice(idx, 1)[0];
        return { student, code: pool.code };
      }
    }
    return null;
  }

  // Allocate halls sequentially in their designated sequence
  for (const h of assignedHallsInOrder) {
    const rowsCount = h.rows;
    const colsCount = h.columns;
    const seatsPerBench = exam.seatsPerBench || 2;
    const totalSeats = rowsCount * colsCount * seatsPerBench;

    // Existing plans for other exams in this same hall
    const otherPlansForThisHall = plansAtSameTime.filter(p => p.examId !== examId && (p.hallId === h._id || p.hallName === h.name));
    const occupiedSeatsInThisHall = {};
    otherPlansForThisHall.forEach(p => {
      if (p.seatingGrid) {
        p.seatingGrid.forEach(g => {
          if (g.seat1) occupiedSeatsInThisHall[`${g.benchCode}_seat1`] = g.seat1;
          if (g.seat2) occupiedSeatsInThisHall[`${g.benchCode}_seat2`] = g.seat2;
          if (g.seat3) occupiedSeatsInThisHall[`${g.benchCode}_seat3`] = g.seat3;
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
          seat2: occupiedSeatsInThisHall[`${benchCode}_seat2`] || null,
          seat3: seatsPerBench === 3 ? (occupiedSeatsInThisHall[`${benchCode}_seat3`] || null) : undefined
        };
        if (!gridMap[benchCode].seat1) availableSeats++;
        if (!gridMap[benchCode].seat2) availableSeats++;
        if (seatsPerBench === 3 && !gridMap[benchCode].seat3) availableSeats++;
      }
    }

    // Construct list of benches in column-by-column order
    const benchesList = [];
    for (let c = 1; c <= colsCount; c++) {
      for (let r = 0; r < rowsCount; r++) {
        const rowLetter = String.fromCharCode(65 + r);
        const benchCode = `${rowLetter}${c}`;
        benchesList.push(gridMap[benchCode]);
      }
    }

    const localRoster = [];
    let totalSeatedInThisHall = 0;

    // Phase 1: Fill all empty seat1 (Left) seats in the hall first
    for (const bench of benchesList) {
      if (!bench.seat1) {
        const res = getNextStudent([]);
        if (res) {
          bench.seat1 = res.student;
          totalSeatedInThisHall++;
          localRoster.push({
            registerNo: res.student.registerNo,
            name: res.student.name,
            department: res.student.department,
            subjectCode: getStudentSubCode(res.student) || '',
            bench: bench.benchCode,
            seat: 'Left'
          });
        }
      }
    }

    // Phase 2: Fill all empty seat2 (Middle if 3 seats, Right if 2 seats) in the hall next
    for (const bench of benchesList) {
      let dept1 = null;
      if (bench.seat1) {
        dept1 = bench.seat1.department.toUpperCase();
      }

      if (seatsPerBench === 2) {
        if (!bench.seat2) {
          let res = getNextStudent(dept1 ? [dept1] : []);
          if (!res) {
            res = getNextStudent([]);
          }
          if (res) {
            bench.seat2 = res.student;
            totalSeatedInThisHall++;
            localRoster.push({
              registerNo: res.student.registerNo,
              name: res.student.name,
              department: res.student.department,
              subjectCode: getStudentSubCode(res.student) || '',
              bench: bench.benchCode,
              seat: 'Right'
            });
          }
        }
      } else if (seatsPerBench === 3) {
        if (!bench.seat2) {
          let res = getNextStudent(dept1 ? [dept1] : []);
          if (!res) {
            res = getNextStudent([]);
          }
          if (res) {
            bench.seat2 = res.student;
            totalSeatedInThisHall++;
            localRoster.push({
              registerNo: res.student.registerNo,
              name: res.student.name,
              department: res.student.department,
              subjectCode: getStudentSubCode(res.student) || '',
              bench: bench.benchCode,
              seat: 'Middle'
            });
          }
        }
      }
    }

    // Phase 3: Fill all empty seat3 (Right) if 3 seats
    if (seatsPerBench === 3) {
      for (const bench of benchesList) {
        if (!bench.seat3) {
          let dept2 = null;
          if (bench.seat2) {
            dept2 = bench.seat2.department.toUpperCase();
          }
          let res = getNextStudent(dept2 ? [dept2] : []);
          if (!res) {
            res = getNextStudent([]);
          }
          if (res) {
            bench.seat3 = res.student;
            totalSeatedInThisHall++;
            localRoster.push({
              registerNo: res.student.registerNo,
              name: res.student.name,
              department: res.student.department,
              subjectCode: getStudentSubCode(res.student) || '',
              bench: bench.benchCode,
              seat: 'Right'
            });
          }
        }
      }
    }

    // Reconstruct currentPool from remaining activePools students
    currentPool = [];
    activePools.forEach(p => {
      currentPool.push(...p.students);
    });

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

  // Calculate unseated students for this exam
  const seatedStudentRegNosForThisExam = new Set(targetAttendanceRoster.map(s => s.registerNo));
  // Subtract students seated in OTHER halls of this same exam
  const otherPlansForThisExam = plansAtSameTime.filter(p => p.examId === examId && p.hallId !== hallId);
  otherPlansForThisExam.forEach(p => {
    p.attendanceRoster.forEach(s => seatedStudentRegNosForThisExam.add(s.registerNo));
  });

  const unseatedStudents = initialPoolForUnseated
    .filter(s => !seatedStudentRegNosForThisExam.has(s.registerNo))
    .sort((a, b) => a.registerNo.localeCompare(b.registerNo));

  const seatingGrid = targetSeatingGrid;
  const attendanceRoster = targetAttendanceRoster;
  const totalStudentsSeated = targetTotalStudentsSeated;
  const emptySeats = targetEmptySeats;
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
      if (otherPlan.hallId === hallId) {
        otherPlan.seatingGrid = seatingGrid;
        otherPlan.emptySeats = emptySeats;
      }

      const otherExamSubCodes = (otherExam.subjectCodes || []).map(c => c.toUpperCase());
      const otherExamDepts = (otherExam.departments || []).map(d => d.toUpperCase());
      const newSeatedRegNos = new Set([...seatedStudentRegNos, ...attendanceRoster.map(r => r.registerNo)]);
      const updatedUnseated = allStudents
        .filter(s => {
          if (otherExamSubCodes.length > 0) {
            if (!hasMatchingSubCode(s, otherExamSubCodes)) return false;
          } else {
            if (!otherExamDepts.includes(s.department.toUpperCase())) return false;
          }
          return !newSeatedRegNos.has(s.registerNo);
        })
        .sort((a, b) => a.registerNo.localeCompare(b.registerNo));
      
      otherPlan.unseatedStudents = updatedUnseated;
      await Models.SeatingPlan.create(otherPlan);
    }
  }

  logActivity('exam', 'Seating Generated', `Generated seating plan for ${exam.name} in ${hall.name}. Seated ${totalStudentsSeated} students.`);
  return plan;
}

// REST Route to trigger generation
app.post('/api/seating/generate', async (req, res) => {
  try {
    const { examId, hallId } = req.body;
    if (!examId || !hallId) {
      return res.status(400).json({ error: 'examId and hallId are required.' });
    }
    const plan = await generateSeatingPlan(examId, hallId);
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET merged seating plans for a specific date, session, and hall
app.get('/api/seating/by-date-session', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    if (!date || !session || !hallId) {
      return res.status(400).json({ error: 'date, session, and hallId are required.' });
    }

    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    const examsAtTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );
    const examIds = examsAtTime.map(e => e._id);

    const allPlans = await Models.SeatingPlan.find();
    const plansForHall = allPlans.filter(p => 
      examIds.includes(p.examId) && (p.hallId === hallId || p.hallName === hallId)
    );

    if (plansForHall.length === 0) {
      return res.status(404).json({ message: 'No seating plans generated for this hall on this date/session.' });
    }

    // Merge complementary grids
    const mergedPlan = {
      date,
      session,
      hallId,
      hallName: plansForHall[0].hallName,
      totalBenches: plansForHall[0].totalBenches,
      seatingGrid: [],
      attendanceRoster: [],
      unseatedStudents: []
    };

    const grids = plansForHall.map(p => p.seatingGrid);
    if (grids.length > 0) {
      const baseGrid = JSON.parse(JSON.stringify(grids[0]));
      for (let i = 1; i < grids.length; i++) {
        const otherGrid = grids[i];
        otherGrid.forEach((bench, index) => {
          if (baseGrid[index]) {
            if (!baseGrid[index].seat1 && bench.seat1) baseGrid[index].seat1 = bench.seat1;
            if (!baseGrid[index].seat2 && bench.seat2) baseGrid[index].seat2 = bench.seat2;
            if (bench.seat3 !== undefined && !baseGrid[index].seat3 && bench.seat3) baseGrid[index].seat3 = bench.seat3;
          }
        });
      }
      mergedPlan.seatingGrid = baseGrid;
    }

    // Merge rosters
    plansForHall.forEach(p => {
      if (p.attendanceRoster) {
        mergedPlan.attendanceRoster.push(...p.attendanceRoster);
      }
    });

    // Merge unseated
    const unseatedMap = new Map();
    plansForHall.forEach(p => {
      if (p.unseatedStudents) {
        p.unseatedStudents.forEach(s => {
          unseatedMap.set(s.registerNo, s);
        });
      }
    });
    
    // Clean unseated who ended up seated in other halls of the same exam
    const allPlansForExams = allPlans.filter(p => examIds.includes(p.examId));
    allPlansForExams.forEach(p => {
      p.attendanceRoster.forEach(s => {
        unseatedMap.delete(s.registerNo);
      });
    });
    mergedPlan.unseatedStudents = Array.from(unseatedMap.values()).sort((a,b) => a.registerNo.localeCompare(b.registerNo));

    res.json(mergedPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST to generate seating plans for all exams scheduled for a specific date, session, and hall
app.post('/api/seating/generate-by-date-session', async (req, res) => {
  try {
    const { date, session, hallId } = req.body;
    if (!date || !session || !hallId) {
      return res.status(400).json({ error: 'date, session, and hallId are required.' });
    }

    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    // Find exams on that day & session that have this hall assigned
    const examsAtTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session &&
      (e.assignedHalls && e.assignedHalls.includes(hallId))
    );

    if (examsAtTime.length === 0) {
      return res.status(400).json({ error: 'No exams are scheduled for this date, session, and hall.' });
    }

    // Generate plans sequentially
    for (const exam of examsAtTime) {
      await generateSeatingPlan(exam._id, hallId);
    }

    // Fetch and return the newly generated merged plan
    // We redirect the request logic to the merge endpoint code block
    const allPlans = await Models.SeatingPlan.find();
    const examIds = examsAtTime.map(e => e._id);
    const plansForHall = allPlans.filter(p => 
      examIds.includes(p.examId) && (p.hallId === hallId || p.hallName === hallId)
    );

    const mergedPlan = {
      date,
      session,
      hallId,
      hallName: plansForHall[0].hallName,
      totalBenches: plansForHall[0].totalBenches,
      seatingGrid: [],
      attendanceRoster: [],
      unseatedStudents: []
    };

    const grids = plansForHall.map(p => p.seatingGrid);
    if (grids.length > 0) {
      const baseGrid = JSON.parse(JSON.stringify(grids[0]));
      for (let i = 1; i < grids.length; i++) {
        const otherGrid = grids[i];
        otherGrid.forEach((bench, index) => {
          if (baseGrid[index]) {
            if (!baseGrid[index].seat1 && bench.seat1) baseGrid[index].seat1 = bench.seat1;
            if (!baseGrid[index].seat2 && bench.seat2) baseGrid[index].seat2 = bench.seat2;
            if (bench.seat3 !== undefined && !baseGrid[index].seat3 && bench.seat3) baseGrid[index].seat3 = bench.seat3;
          }
        });
      }
      mergedPlan.seatingGrid = baseGrid;
    }

    plansForHall.forEach(p => {
      if (p.attendanceRoster) {
        mergedPlan.attendanceRoster.push(...p.attendanceRoster);
      }
    });

    const unseatedMap = new Map();
    plansForHall.forEach(p => {
      if (p.unseatedStudents) {
        p.unseatedStudents.forEach(s => {
          unseatedMap.set(s.registerNo, s);
        });
      }
    });
    
    const allPlansForExams = allPlans.filter(p => examIds.includes(p.examId));
    allPlansForExams.forEach(p => {
      p.attendanceRoster.forEach(s => {
        unseatedMap.delete(s.registerNo);
      });
    });
    mergedPlan.unseatedStudents = Array.from(unseatedMap.values()).sort((a,b) => a.registerNo.localeCompare(b.registerNo));

    res.json(mergedPlan);
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
