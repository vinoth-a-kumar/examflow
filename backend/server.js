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
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max limit
});

// Helper: Convert a file buffer (CSV or Excel) to CSV text string
function bufferToCsvText(buffer, originalname) {
  // Excel magic bytes: XLSX starts with PK (0x50 0x4B), XLS starts with 0xD0 0xCF
  const isExcel = originalname && (/\.(xlsx|xls)$/i.test(originalname));
  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let bestCsv = '';
    let maxDataRows = -1;

    // Scan all sheets in the workbook and pick the sheet with the most valid data rows
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const validRowsCount = lines.filter(l => l.replace(/,/g, '').trim().length > 0).length;
      if (validRowsCount > maxDataRows) {
        maxDataRows = validRowsCount;
        bestCsv = csv;
      }
    }
    return bestCsv;
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

  // Find the header row (scanning top lines to skip title/metadata lines if any)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (hasHeaders(lines[i])) {
      headerRowIdx = i;
      break;
    }
  }

  const firstLine = lines[headerRowIdx];
  let headers;
  let startIdx = headerRowIdx + 1;

  if (hasHeaders(firstLine)) {
    headers = splitCsvLine(firstLine).map(h => h.replace(/^["']|["']$/g, '').trim());
  } else {
    const firstLineParts = splitCsvLine(firstLine);
    headers = firstLineParts.map((_, idx) => {
      if (idx === 0) return 'Register No';
      if (idx === 1) return 'Name';
      if (idx === 2) return 'Department';
      if (idx === 3) return 'Batch';
      return `Column_${idx + 1}`;
    });
    startIdx = headerRowIdx;
  }

  // Find column indexes
  let regIndex  = headers.findIndex(h => /reg|roll|number|id/i.test(h));
  let nameIndex = headers.findIndex(h => /name|student/i.test(h));
  let deptIndex = headers.findIndex(h => /dept|depart|branch|course/i.test(h));
  let batchIndex = headers.findIndex(h => /batch|year/i.test(h));

  // Fallbacks if not detected by regex
  if (regIndex  === -1) regIndex  = 0;
  if (nameIndex === -1) nameIndex = 1;

  const records = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = splitCsvLine(line);

    // Dynamically expand headers if a row contains more columns than initial headers
    while (headers.length < parts.length) {
      headers.push(`Column_${headers.length + 1}`);
    }

    if (parts.length > Math.max(regIndex, nameIndex)) {
      const registerNo = (parts[regIndex] || '').trim();
      const name       = (parts[nameIndex] || '').trim();
      let department   = deptIndex !== -1 ? (parts[deptIndex] || '').trim() : '';
      const batch      = batchIndex !== -1 ? (parts[batchIndex] || '').trim() : '2024-25';

      // Keep dynamic original headers and data mapping
      const csvData = {};
      headers.forEach((header, index) => {
        csvData[header] = parts[index] || '';
      });

      // If department is missing, GENERAL, or UNKNOWN, derive from Register No prefix
      if (!department || department.toUpperCase() === 'GENERAL' || department.toUpperCase() === 'UNKNOWN') {
        department = formatClassCode('', '', registerNo);
      }

      if (registerNo && name) {
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

// Helper: Safely extract YYYY-MM-DD from Date object or ISO string
function getDateString(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.split('T')[0];
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).split('T')[0];
}

// Helper: Check if a token looks like a valid subject code
function isValidSubjectCodeToken(token) {
  if (!token) return false;
  const trimmed = String(token).trim();
  if (trimmed.length < 2 || trimmed.length > 25) return false;
  // Alphanumeric with optional hyphens/underscores/slashes
  if (!/^[A-Za-z0-9\-_/]+$/.test(trimmed)) return false;
  // Exclude common long non-code words
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length > 12) return false;
  return true;
}

// Helper: Clean class code so that raw subject codes or GENERAL in department aren't shown, returning clean Department/Class name
function formatClassCode(department, subjectCode, registerNo = '') {
  let dept = (department || '').trim().toUpperCase();
  const sub = (subjectCode || '').trim().toUpperCase();
  const reg = (registerNo || '').trim().toUpperCase();

  const isSubjectCodePattern = (str) => {
    if (!str) return false;
    if (sub && str === sub) return true;
    if (/^[A-Z0-9\-_/]{4,15}$/i.test(str) && (/\d/.test(str) || str.length >= 6)) {
      const knownDepts = ['BBA', 'BCA', 'BCOM', 'BSC', 'BA', 'MA', 'MSC', 'MCOM', 'MATHS', 'PHYSICS', 'CHEMISTRY', 'ENGLISH', 'TAMIL', 'COMMERCE', 'COMPUTER SCIENCE', 'CS', 'IT', 'ENG', 'MAT', 'PHY', 'COM', 'CHE', 'BIO', 'BOT', 'ZOO', 'ECO', 'HIS'];
      if (!knownDepts.includes(str)) {
        return true;
      }
    }
    return false;
  };

  if (!dept || dept === 'GENERAL' || dept === 'UNKNOWN' || isSubjectCodePattern(dept)) {
    // 1. Match leading letters (e.g. CS26045 -> CS, CA26001 -> CA, CHE26001 -> CHE, COM26001 -> COM, PHY26001 -> PHY, MAT26001 -> MAT)
    const leadingLettersMatch = reg.match(/^([A-Z]{2,6})\d+/);
    if (leadingLettersMatch && leadingLettersMatch[1]) {
      return leadingLettersMatch[1];
    }

    // 2. Match digits then letters (e.g. 25BBA001 -> BBA, 24MAT001 -> MAT, 25CS001 -> CS, 26CA001 -> CA)
    const digitsLettersMatch = reg.match(/^(?:\d{2,4}|[A-Z]\d|[A-Z]{2}\d)([A-Z]{2,6})/);
    if (digitsLettersMatch && digitsLettersMatch[1]) {
      return digitsLettersMatch[1];
    }

    // 3. Fallback to any letter sequence inside regNo
    const anyLettersMatch = reg.match(/([A-Z]{2,6})/);
    if (anyLettersMatch && anyLettersMatch[1]) {
      return anyLettersMatch[1];
    }

    return 'GENERAL';
  }

  if (sub && dept.includes(sub)) {
    dept = dept.replace(sub, '').trim().replace(/[/\-_]+$/, '').trim();
  }
  if (dept.includes('/')) {
    dept = dept.split('/')[0].trim();
  }

  return dept || 'GENERAL';
}

// Helper: Resolve dynamic degree name from student record or department code
function resolveStudentDegree(student, defaultDept = '') {
  if (!student) return expandDegreeCode(defaultDept, '');

  // 1. Check direct degree field
  if (student.degree && typeof student.degree === 'string' && student.degree.trim()) {
    return student.degree.trim();
  }

  // 2. Check student's uploaded csvData for explicit Degree/Programme/Course column
  if (student.csvData && typeof student.csvData === 'object') {
    const keys = Object.keys(student.csvData);
    const degreeKey = keys.find(k => /degree|programme|prog/i.test(k));
    if (degreeKey && student.csvData[degreeKey] && String(student.csvData[degreeKey]).trim()) {
      return String(student.csvData[degreeKey]).trim();
    }
    const deptKey = keys.find(k => /dept|depart|branch|course/i.test(k));
    if (deptKey && student.csvData[deptKey] && String(student.csvData[deptKey]).trim()) {
      const val = String(student.csvData[deptKey]).trim();
      if (val !== 'GENERAL' && val !== 'UNKNOWN') {
        return expandDegreeCode(val, student.registerNo);
      }
    }
  }

  // 3. Fallback to student.department or defaultDept
  const dept = (student.department || defaultDept || '').trim();
  return expandDegreeCode(dept, student.registerNo || '');
}

function expandDegreeCode(deptOrCode, regNo = '') {
  let code = (deptOrCode || '').trim();
  if (!code || code === 'GENERAL' || code === 'UNKNOWN') {
    const match = (regNo || '').trim().match(/^([A-Z]{2,6})\d+/i);
    if (match) {
      code = match[1].toUpperCase();
    }
  }

  const u = code.toUpperCase();

  const degreeMap = {
    'CA': 'B.Sc. Computer Applications',
    'CS': 'B.Sc. Computer Science',
    'BCA': 'B.C.A.',
    'BSC CS': 'B.Sc. Computer Science',
    'BSC CA': 'B.Sc. Computer Applications',
    'COM': 'B.Com.',
    'BCOM': 'B.Com.',
    'COMMERCE': 'B.Com.',
    'MAT': 'B.Sc. Mathematics',
    'MATHS': 'B.Sc. Mathematics',
    'MATHEMATICS': 'B.Sc. Mathematics',
    'PHY': 'B.Sc. Physics',
    'PHYSICS': 'B.Sc. Physics',
    'CHE': 'B.Sc. Chemistry',
    'CHEMISTRY': 'B.Sc. Chemistry',
    'ENG': 'B.A. English',
    'ENGLISH': 'B.A. English',
    'TAM': 'B.A. Tamil',
    'TAMIL': 'B.A. Tamil',
    'BBA': 'B.B.A.',
    'IT': 'B.Sc. Information Technology',
    'HIS': 'B.A. History',
    'HISTORY': 'B.A. History',
    'ECO': 'B.A. Economics',
    'ECONOMICS': 'B.A. Economics',
    'ZOO': 'B.Sc. Zoology',
    'ZOOLOGY': 'B.Sc. Zoology',
    'BOT': 'B.Sc. Botany',
    'BOTANY': 'B.Sc. Botany'
  };

  if (degreeMap[u]) return degreeMap[u];

  // If code is already descriptive
  if (code.length > 5 || /\./.test(code) || /\s/.test(code)) {
    return code;
  }

  return code;
}


/**
 * Dynamically detect the column key in student records (csvData) that contains multiple space-separated Subject Codes.
 * Scans every column across student records without relying on fixed column names like "Subjects Appearing".
 * Finds column whose cells contain multiple values separated by spaces.
 * If multiple columns contain subject-code-like values, uses the column with highest number of valid subject codes.
 */
function detectSubjectCodeColumn(students) {
  if (!Array.isArray(students) || students.length === 0) return null;

  const columnKeys = new Set();
  students.forEach(s => {
    if (s && s.csvData && typeof s.csvData === 'object') {
      Object.keys(s.csvData).forEach(k => columnKeys.add(k));
    }
  });

  if (columnKeys.size === 0) return null;

  let bestColumn = null;
  let maxValidCodesCount = 0;
  let maxMultiValueCellCount = 0;

  columnKeys.forEach(colKey => {
    let validCodesCount = 0;
    let multiValueCellCount = 0;

    students.forEach(s => {
      if (s && s.csvData && s.csvData[colKey] !== undefined && s.csvData[colKey] !== null) {
        const rawVal = String(s.csvData[colKey]).trim();
        if (!rawVal) return;

        // Split cell by whitespace
        const tokens = rawVal.split(/\s+/).map(t => t.trim()).filter(Boolean);

        if (tokens.length >= 2) {
          multiValueCellCount++;
        }

        tokens.forEach(tok => {
          if (isValidSubjectCodeToken(tok)) {
            validCodesCount++;
          }
        });
      }
    });

    // Pick column with space-separated values, or highest valid subject codes count (Rule 10)
    if (multiValueCellCount > 0) {
      if (validCodesCount > maxValidCodesCount) {
        maxValidCodesCount = validCodesCount;
        maxMultiValueCellCount = multiValueCellCount;
        bestColumn = colKey;
      }
    } else if (maxMultiValueCellCount === 0 && validCodesCount > maxValidCodesCount) {
      maxValidCodesCount = validCodesCount;
      bestColumn = colKey;
    }
  });

  return bestColumn;
}

/**
 * Extract ALL individual subject codes for a student.
 * Reads from detected subject code column, splits cell by whitespace,
 * trims extra spaces, ignores empty values, and deduplicates per student.
 */
function getStudentAllSubCodes(student, targetColumnKey = null) {
  if (!student) return [];

  const codes = [];

  if (student.csvData && typeof student.csvData === 'object') {
    let colKey = targetColumnKey;

    if (!colKey) {
      colKey = detectSubjectCodeColumn([student]);
    }

    if (colKey && student.csvData[colKey] !== undefined && student.csvData[colKey] !== null) {
      const rawVal = String(student.csvData[colKey]).trim();
      if (rawVal) {
        const tokens = rawVal.split(/\s+/).map(t => t.trim()).filter(Boolean);
        tokens.forEach(tok => {
          if (isValidSubjectCodeToken(tok)) {
            codes.push(tok.toUpperCase());
          }
        });
      }
    }

    // Fallback: If no single space-separated column found (e.g. sub_code_1, sub_code_2 multi-column layout),
    // scan all keys in csvData for valid subject code values
    if (codes.length === 0) {
      Object.keys(student.csvData).forEach(k => {
        const val = student.csvData[k];
        if (val !== undefined && val !== null) {
          const rawVal = String(val).trim();
          if (rawVal) {
            const tokens = rawVal.split(/\s+/).map(t => t.trim()).filter(Boolean);
            tokens.forEach(tok => {
              if (isValidSubjectCodeToken(tok) && (/sub|code|paper|course/i.test(k) || tokens.length >= 2 || /^[A-Z0-9\-_]{3,12}$/i.test(tok))) {
                codes.push(tok.toUpperCase());
              }
            });
          }
        }
      });
    }
  }

  // Deduplicate and trim
  const uniqueCodes = [...new Set(codes.map(c => c.trim().toUpperCase()))].filter(Boolean);
  return uniqueCodes;
}

// Helper: Extract primary subject code for a student
function getStudentSubCode(student, targetColumnKey = null) {
  if (!student) return '';
  const codes = getStudentAllSubCodes(student, targetColumnKey);
  return codes.length > 0 ? codes[0] : (student.department || '');
}

// Helper: Check if a student has any subject code matching the given list of codes
function hasMatchingSubCode(student, examSubCodes, targetColumnKey = null) {
  const studentCodes = getStudentAllSubCodes(student, targetColumnKey);
  const upperExamSubCodes = examSubCodes.map(c => String(c).trim().toUpperCase());
  return studentCodes.some(code => upperExamSubCodes.includes(code));
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
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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
  try {
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    let count = 0;
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      count = data.count || 0;
    }
    count += 1;
    fs.writeFileSync(filePath, JSON.stringify({ count }, null, 2), 'utf8');
    return count;
  } catch (err) {
    console.error("Error updating printout count", err);
    return 1;
  }
};

// API ROUTES

// 0. Authentication
app.post('/api/auth/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    console.log(`[AUTH] Login request received for user: '${emailOrUsername || 'empty'}'`);
    console.log(`[AUTH] Storage mode: ${dbStatus().mode}`);

    if (!emailOrUsername || !password) {
      console.log(`[AUTH] Response status: 400 (Missing input)`);
      return res.status(400).json({ error: 'Username/Email and Password are required.' });
    }

    const inputLower = emailOrUsername.trim().toLowerCase();
    const isAdminUser = inputLower === 'admin' || inputLower === 'admin@rajuscollege.edu.in' || inputLower === 'admin@examflow.com';
    const isValidPassword = password === 'admin@123';

    if (!isAdminUser || !isValidPassword) {
      console.log(`[AUTH] Response status: 401 (Invalid credentials)`);
      return res.status(401).json({ error: 'Invalid username or password. Please try again.' });
    }

    const user = {
      _id: 'admin_master',
      username: 'admin',
      email: 'admin@rajuscollege.edu.in',
      role: 'Administrator'
    };

    console.log(`[AUTH] Response status: 200 OK (User authenticated as Administrator)`);
    logActivity('user', 'User Logged In', 'Administrator logged into the system.');
    res.json({ success: true, user });
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Login server error: ' + error.message });
  }
});

// 1. Connection Status
app.get('/api/status', (req, res) => {
  res.json(dbStatus());
});

// 1.1 System Info (Settings Control Center)
app.get('/api/settings/system-info', async (req, res) => {
  try {
    let sizeBytes = 0;
    const dataDir = path.join(__dirname, 'data');
    if (fs.existsSync(dataDir)) {
      const getDirSize = (dir) => {
        let size = 0;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            size += getDirSize(filePath);
          } else {
            size += stats.size;
          }
        });
        return size;
      };
      sizeBytes += getDirSize(dataDir);
    }

    const studentCount = (await Models.Student.find()).length;
    const hallCount = (await Models.Hall.find()).length;
    const examCount = (await Models.Exam.find()).length;
    const planCount = (await Models.SeatingPlan.find()).length;
    
    const isConnected = dbStatus().connected;
    if (isConnected) {
      sizeBytes += (studentCount + hallCount + examCount + planCount) * 320; 
    }

    const storageUsedMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    const storageUsedKb = (sizeBytes / 1024).toFixed(1);

    res.json({
      projectVersion: 'v1.2.0',
      databaseStatus: isConnected ? 'Connected (MySQL)' : 'Local JSON Mode',
      databaseEngine: isConnected ? 'MySQL' : 'JSON Store',
      storageUsed: sizeBytes >= 1024 * 1024 ? `${storageUsedMb} MB` : `${storageUsedKb} KB`,
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
    
    const backupPayload = {
      timestamp: new Date().toISOString(),
      version: 'v1.2.0',
      students,
      halls,
      exams,
      seatingPlans
    };

    // Save snapshot to data/backups directory for backup history tracking
    try {
      const backupsDir = path.join(__dirname, 'data', 'backups');
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      const filename = `examflow_backup_${Date.now()}.json`;
      fs.writeFileSync(path.join(backupsDir, filename), JSON.stringify(backupPayload, null, 2));
      logActivity('database', 'Database Backup Created', `System backup created (${(JSON.stringify(backupPayload).length / 1024).toFixed(1)} KB).`);
    } catch (saveErr) {
      console.error("Failed to save backup history snapshot:", saveErr);
    }

    res.json(backupPayload);
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
    
    logActivity('database', 'Database Restored', `Restored ${students.length} students, ${halls.length} halls, ${exams.length} exams, and ${seatingPlans.length} seating plans from backup.`);
    
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
    const totalCapacity = allHalls.reduce((sum, h) => {
      if (h.csvData) {
        const keys = Object.keys(h.csvData);
        const k2 = keys.find(k => /2\*seat|2_seat|2seat/i.test(k));
        if (k2 && h.csvData[k2] && !isNaN(parseInt(h.csvData[k2]))) {
          return sum + parseInt(h.csvData[k2]);
        }
      }
      const benches = h.benches || (h.rows && h.columns ? h.rows * h.columns : 0);
      return sum + (benches > 0 ? benches * 2 : (h.capacity || 0));
    }, 0);

    const totalCapacity3 = allHalls.reduce((sum, h) => {
      if (h.csvData) {
        const keys = Object.keys(h.csvData);
        const k3 = keys.find(k => /3\*seat|3_seat|3seat/i.test(k));
        if (k3 && h.csvData[k3] && !isNaN(parseInt(h.csvData[k3]))) {
          return sum + parseInt(h.csvData[k3]);
        }
      }
      const benches = h.benches || (h.rows && h.columns ? h.rows * h.columns : 0);
      if (benches > 0) return sum + benches * 3;
      return sum + Math.round(((h.capacity || 0) / 2) * 3);
    }, 0);

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
      totalCapacity3,
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
    const { name, rows, columns, benches, capacity, columnRows } = req.body;

    let existingHall = await Models.Hall.findById(req.params.id);
    if (!existingHall) {
      const allHalls = await Models.Hall.find();
      existingHall = allHalls.find(h => String(h._id) === String(req.params.id) || h.name === req.params.id);
    }
    if (!existingHall) {
      return res.status(404).json({ error: 'Hall not found.' });
    }

    const updatedName = name || existingHall.name;
    const parsedColumnRows = Array.isArray(columnRows) && columnRows.length > 0
      ? columnRows.map(n => Math.max(1, parseInt(n) || 1))
      : (existingHall.columnRows || (existingHall.csvData && existingHall.csvData.columnRows ? existingHall.csvData.columnRows : []));

    const parsedCols = parsedColumnRows.length > 0 ? parsedColumnRows.length : (parseInt(columns) || existingHall.columns || 1);
    const parsedRows = parsedColumnRows.length > 0 ? Math.max(...parsedColumnRows) : (parseInt(rows) || existingHall.rows || 1);
    const parsedBenches = benches !== undefined && benches !== null
      ? parseInt(benches)
      : (parsedColumnRows.length > 0 ? parsedColumnRows.reduce((a, b) => a + b, 0) : (existingHall.benches || (parsedRows * parsedCols)));
    const parsedCapacity = capacity !== undefined && capacity !== null ? parseInt(capacity) : (existingHall.capacity || (parsedBenches * 2));

    let updatedCsvData = existingHall.csvData ? { ...existingHall.csvData } : {};
    if (parsedColumnRows.length > 0) {
      updatedCsvData.columnRows = parsedColumnRows;
    }
    Object.keys(updatedCsvData).forEach(key => {
      if (/2\*seat|2_seat|2seat|capacity/i.test(key)) {
        updatedCsvData[key] = parsedCapacity;
      } else if (/3\*seat|3_seat|3seat/i.test(key)) {
        updatedCsvData[key] = Math.round((parsedCapacity / 2) * 3);
      } else if (/bench/i.test(key)) {
        updatedCsvData[key] = parsedBenches;
      } else if (/row/i.test(key)) {
        updatedCsvData[key] = parsedRows;
      } else if (/col/i.test(key)) {
        updatedCsvData[key] = parsedCols;
      }
    });

    const updated = await Models.Hall.findByIdAndUpdate(existingHall._id || req.params.id, {
      name: updatedName,
      rows: parsedRows,
      columns: parsedCols,
      benches: parsedBenches,
      capacity: parsedCapacity,
      columnRows: parsedColumnRows,
      csvData: updatedCsvData
    }, { new: true });

    logActivity('hall', 'Hall Updated', `${updatedName} layout updated to ${parsedCols} Cols (${parsedColumnRows.join(', ')} rows) - ${parsedCapacity} seats (${parsedBenches} benches).`);
    res.json(updated || { _id: existingHall._id || req.params.id, name: updatedName, rows: parsedRows, columns: parsedCols, benches: parsedBenches, capacity: parsedCapacity, columnRows: parsedColumnRows, csvData: updatedCsvData });
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
        const plan = plans.find(p => String(p.examId) === String(e._id) && (p.hallId === hallName || p.hallName === hallName));
        const hallObj = allHalls.find(h => h.name === hallName);
        
        let vacantSeats = 0;
        if (plan) {
          if (plan.seatingGrid && Array.isArray(plan.seatingGrid)) {
            const realBenches = plan.seatingGrid.filter(b => !b.isPlaceholder);
            if (realBenches.length > 0) {
              realBenches.forEach(b => {
                if (!b.seat1) vacantSeats++;
                if (!b.seat2) vacantSeats++;
                if (b.seat3 !== undefined && !b.seat3) vacantSeats++;
              });
            } else {
              vacantSeats = plan.emptySeats !== undefined ? plan.emptySeats : 0;
            }
          } else {
            vacantSeats = plan.emptySeats !== undefined ? plan.emptySeats : 0;
          }
        } else {
          vacantSeats = hallObj ? (getHallCapacityForSeatsPerBench(hallObj, e.seatsPerBench || 2)) : 0;
        }
        return {
          name: hallName,
          vacantSeats: Math.max(0, vacantSeats)
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
    const { name, departments, subjectCodes, date, session, assignedHalls, seatsPerBench, time } = req.body;
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
      time: time || (session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM'),
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      seatsPerBench: parseInt(seatsPerBench) || 2,
      status: 'Scheduled'
    });

    logActivity('exam', 'Exam Scheduled', `${name} scheduled for ${date} (${session}). Assigned to ${assignedHalls?.length || 0} halls.`);
    
    // Auto-generate seating plans for all assigned halls
    if (assignedHalls && assignedHalls.length > 0) {
      try {
        const allHalls = await Models.Hall.find();
        for (const hallName of assignedHalls) {
          const hallObj = allHalls.find(h => h.name === hallName || String(h._id) === String(hallName));
          if (hallObj) {
            await generateSeatingPlan(newExam._id, hallObj._id);
          }
        }
      } catch (e) {
        console.error('Auto seating generation error on create:', e);
      }
    }

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
    const { name, departments, subjectCodes, date, session, assignedHalls, seatsPerBench, time } = req.body;
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
      time: time || (session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM'),
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      seatsPerBench: parseInt(seatsPerBench) || 2
    });

    if (!updated) {
      return res.status(404).json({ error: 'Exam not found.' });
    }

    // Delete existing seating plans for this exam so they can be freshly generated
    await Models.SeatingPlan.deleteMany({ examId: req.params.id });

    // Auto-generate seating plans for all assigned halls
    if (assignedHalls && assignedHalls.length > 0) {
      try {
        const allHalls = await Models.Hall.find();
        for (const hallName of assignedHalls) {
          const hallObj = allHalls.find(h => h.name === hallName || String(h._id) === String(hallName));
          if (hallObj) {
            await generateSeatingPlan(req.params.id, hallObj._id);
          }
        }
      } catch (e) {
        console.error('Auto seating generation error on update:', e);
      }
    }

    logActivity('exam', 'Exam Updated', `${name} configuration was updated.`);
    res.json(updated);
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

// Get all unique subject codes from student records (dynamically detects subject code column)
app.get('/api/students/subject-codes', async (req, res) => {
  try {
    const allStudents = await Models.Student.find();
    const detectedColKey = detectSubjectCodeColumn(allStudents);
    const subCodeSet = new Set();
    allStudents.forEach(s => {
      const codes = getStudentAllSubCodes(s, detectedColKey);
      codes.forEach(code => {
        if (code && code.trim()) {
          subCodeSet.add(code.trim().toUpperCase());
        }
      });
    });
    const uniqueCodes = [...subCodeSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    res.json(uniqueCodes);
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
      examsAtSameTime = examsAtSameTime.filter(e => String(e._id) !== String(req.query.excludeExamId));
    }
    const examIds = examsAtSameTime.map(e => String(e._id));
    
    const allPlans = await Models.SeatingPlan.find();
    const plansAtSameTime = allPlans.filter(p => examIds.includes(String(p.examId)));
    
    const seatedStudentRegNos = new Set();
    plansAtSameTime.forEach(plan => {
      if (plan.attendanceRoster) {
        plan.attendanceRoster.forEach(student => {
          seatedStudentRegNos.add(student.registerNo);
        });
      }
    });

    const allStudents = await Models.Student.find();
    const detectedColKey = detectSubjectCodeColumn(allStudents);
    
    // Count remaining students per subject code
    const remainingCounts = {};
    allStudents.forEach(s => {
      if (!seatedStudentRegNos.has(s.registerNo)) {
        const codes = getStudentAllSubCodes(s, detectedColKey);
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

// Helper: Calculate hall capacity based on bench config (2 or 3 seats/bench) & uploaded hall details (2*SEATS / 3*SEATS)
function getHallCapacityForSeatsPerBench(hall, seatsPerBench = 2) {
  if (!hall) return 0;
  const spb = parseInt(seatsPerBench) || 2;

  const benches = hall.benches || (hall.rows && hall.columns ? hall.rows * hall.columns : 0);
  if (benches > 0) {
    return benches * spb;
  }
  
  if (hall.capacity !== undefined && hall.capacity !== null && !isNaN(parseInt(hall.capacity)) && parseInt(hall.capacity) > 0) {
    if (spb === 2) return parseInt(hall.capacity);
    if (spb === 3) return Math.round((parseInt(hall.capacity) / 2) * 3);
  }

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

  return hall.capacity || 0;
}

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
    const reqSpb = parseInt(req.query.seatsPerBench) || 2;
    
    const availability = {};
    allHalls.forEach(hall => {
      const hallCap = getHallCapacityForSeatsPerBench(hall, reqSpb);
      const plan = hallPlans[hall.name];
      if (!plan) {
        // No seating plan generated yet.
        const isAssigned = examsAtSameTime.some(e => e.assignedHalls && e.assignedHalls.includes(hall.name));
        if (isAssigned) {
          availability[hall.name] = {
            occupied: false,
            vacantSeats: hallCap,
            assigned: true,
            msg: `${hallCap} Seats`
          };
        } else {
          availability[hall.name] = {
            occupied: false,
            vacantSeats: hallCap,
            assigned: false,
            msg: `${hallCap} Seats`
          };
        }
      } else {
        // Seating plan exists. Calculate vacant seats in real configured benches
        let planVacant = 0;
        if (plan.seatingGrid && Array.isArray(plan.seatingGrid)) {
          const realBenches = plan.seatingGrid.filter(b => !b.isPlaceholder);
          if (realBenches.length > 0) {
            realBenches.forEach(b => {
              if (!b.seat1) planVacant++;
              if (!b.seat2) planVacant++;
              if (b.seat3 !== undefined && !b.seat3) planVacant++;
            });
          } else {
            planVacant = plan.emptySeats || 0;
          }
        } else {
          planVacant = plan.emptySeats || 0;
        }
        planVacant = Math.max(0, planVacant);
        if (planVacant > 0) {
          availability[hall.name] = {
            occupied: false,
            vacantSeats: planVacant,
            assigned: true,
            msg: `${planVacant} Seats`
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

// Helper to resolve a Hall object by ID or Name
async function resolveHall(hallIdOrName) {
  if (!hallIdOrName) return null;
  const allHalls = await Models.Hall.find();
  const searchKey = String(hallIdOrName).trim();
  return allHalls.find(h => 
    String(h._id) === searchKey || 
    (h.name && h.name.trim().toLowerCase() === searchKey.toLowerCase())
  ) || null;
}

// Helper to sort attendance roster cleanly by Subject Code (in exam order) -> Register Number
const sortAttendanceRoster = (roster, examSubCodes = []) => {
  if (!roster) return [];
  const upperSubCodes = (examSubCodes || []).map(c => String(c).trim().toUpperCase());

  return [...roster].sort((a, b) => {
    const subA = String(a.subjectCode || a.department || '').trim().toUpperCase();
    const subB = String(b.subjectCode || b.department || '').trim().toUpperCase();

    const idxA = upperSubCodes.indexOf(subA);
    const idxB = upperSubCodes.indexOf(subB);

    if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
      return idxA - idxB;
    }
    if (idxA !== -1 && idxB === -1) return -1;
    if (idxA === -1 && idxB !== -1) return 1;

    const subCompare = subA.localeCompare(subB);
    if (subCompare !== 0) return subCompare;

    return (a.registerNo || '').localeCompare(b.registerNo || '');
  });
};

function getMatchingSubCodeForStudent(student, examSubCodes = []) {
  if (!student) return '';
  if (student.subjectCode) return student.subjectCode;
  const studentCodes = getStudentAllSubCodes(student);
  if (examSubCodes && examSubCodes.length > 0) {
    const upperExams = examSubCodes.map(c => String(c).trim().toUpperCase());
    const matched = studentCodes.find(c => upperExams.includes(c.toUpperCase()));
    if (matched) return matched;
  }
  return studentCodes.length > 0 ? studentCodes[0] : (student.department || '');
}


function getRowLetter(r) {
  let letter = '';
  let num = r;
  while (num >= 0) {
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26) - 1;
  }
  return letter;
}

// Helper to perform seating generation for a single exam and hall
async function generateSeatingPlan(examId, hallId) {
  const exam = await Models.Exam.findById(examId);
  const hall = await resolveHall(hallId);

  if (!exam || !hall) {
    throw new Error('Exam or Hall not found.');
  }

  // Get students for exam's subject codes (or departments as fallback)
  const allStudents = await Models.Student.find();
  const examSubCodes = (exam.subjectCodes || []).map(c => c.toUpperCase());
  const examDepts = (exam.departments || []).map(d => d.toUpperCase());
  
  const examIdStr = String(examId);

  // Find all exams scheduled for the same date and session
  const allExams = await Models.Exam.find();
  const targetDate = exam.date.split('T')[0];
  const examsAtSameTime = allExams.filter(e => 
    e.date.split('T')[0] === targetDate && e.session === exam.session
  );
  const examIdsStrings = new Set(examsAtSameTime.map(e => String(e._id)));

  // Retrieve any existing seating plans generated for these exams
  const allPlans = await Models.SeatingPlan.find();
  const plansAtSameTime = allPlans.filter(p => examIdsStrings.has(String(p.examId)));
  
  const seatedStudentRegNos = new Set();
  const otherExamsAtSameTime = examsAtSameTime.filter(e => String(e._id) !== examIdStr);
  const otherExamIdsStrings = new Set(otherExamsAtSameTime.map(e => String(e._id)));
  const plansForOtherExams = plansAtSameTime.filter(p => otherExamIdsStrings.has(String(p.examId)));
  
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
    allHalls.find(h => h.name === hallName || String(h._id) === String(hallName))
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

  // Secondary pool for unseated students from OTHER exams scheduled at the same date and session
  const otherExamsDepts = new Set();
  const otherExamsSubCodes = new Set();
  otherExamsAtSameTime.forEach(e => {
    (e.departments || []).forEach(d => otherExamsDepts.add(d.toUpperCase()));
    (e.subjectCodes || []).forEach(c => otherExamsSubCodes.add(c.toUpperCase()));
  });

  let secondaryPool = allStudents.filter(s => {
    if (seatedStudentRegNos.has(s.registerNo)) return false;
    if (otherExamsSubCodes.size > 0 && hasMatchingSubCode(s, Array.from(otherExamsSubCodes))) return true;
    if (otherExamsDepts.has(s.department.toUpperCase())) return true;
    return false;
  }).sort((a, b) => a.registerNo.localeCompare(b.registerNo));

  const initialPoolForUnseated = [...currentPool];

  // Group students by subject codes (preserving the selected order/click priority)
  let activePools = [];
  if (examSubCodes.length > 0) {
    const assignedStudents = new Set();
    activePools = examSubCodes.map(code => {
      const upperCode = code.toUpperCase();
      const deptPrefix = examDepts.find(d => upperCode.startsWith(d)) || '';
      
      let targetYear = 1;
      if (upperCode.includes('211') || upperCode.includes('201') || upperCode.includes('212') || upperCode.includes('22')) targetYear = 2;
      else if (upperCode.includes('311') || upperCode.includes('301') || upperCode.includes('312') || upperCode.includes('32')) targetYear = 3;
      else if (upperCode.includes('111') || upperCode.includes('101') || upperCode.includes('112') || upperCode.includes('11')) targetYear = 1;

      const poolStudents = currentPool.filter(s => {
        if (assignedStudents.has(s.registerNo)) return false;
        
        // 1. Direct student subject code match
        const studentCodes = getStudentAllSubCodes(s);
        if (studentCodes.includes(upperCode)) {
          assignedStudents.add(s.registerNo);
          return true;
        }

        // 2. Department & Batch Year match fallback
        const sDept = (s.department || '').toUpperCase();
        const matchesDept = (deptPrefix && sDept === deptPrefix) || (examDepts.includes(sDept));
        if (matchesDept) {
          const sReg = s.registerNo || '';
          let sYear = 1;
          if (sReg.startsWith('25')) sYear = 1;
          else if (sReg.startsWith('24')) sYear = 2;
          else if (sReg.startsWith('23')) sYear = 3;

          if (sYear === targetYear) {
            assignedStudents.add(s.registerNo);
            return true;
          }
        }

        return false;
      });

      return {
        code: upperCode,
        students: poolStudents
      };
    }).filter(p => p.students.length > 0);

    // Fallback for any remaining unassigned students matching examDepts
    const unassigned = currentPool.filter(s => !assignedStudents.has(s.registerNo));
    if (unassigned.length > 0) {
      if (activePools.length > 0) {
        unassigned.forEach(s => {
          const sDept = (s.department || '').toUpperCase();
          const matchingPool = activePools.find(p => p.code.startsWith(sDept)) || activePools[0];
          matchingPool.students.push(s);
          assignedStudents.add(s.registerNo);
        });
      } else {
        activePools = [{
          code: examSubCodes[0] || (examDepts[0] || 'GENERAL'),
          students: [...unassigned]
        }];
      }
    }
  } else {
    // Fallback to departments if no subject codes (using selection priority order of departments)
    activePools = examDepts.map(dept => ({
      code: dept.toUpperCase(),
      students: currentPool.filter(s => s.department.toUpperCase() === dept.toUpperCase())
    })).filter(p => p.students.length > 0);
  }

  const createdPlansMap = {};
  const allCreatedPlansForThisExam = [];

  // Allocate halls sequentially in their designated sequence
  for (const h of assignedHallsInOrder) {
    const colsCount = parseInt(h.columns) || 1;
    let rawColRows = h.columnRows;
    if (typeof rawColRows === 'string') {
      try { rawColRows = JSON.parse(rawColRows); } catch (e) { rawColRows = null; }
    }
    if ((!rawColRows || !Array.isArray(rawColRows) || rawColRows.length < colsCount) && h.csvData) {
      let csvColRows = h.csvData.columnRows;
      if (typeof csvColRows === 'string') {
        try { csvColRows = JSON.parse(csvColRows); } catch (e) { csvColRows = null; }
      }
      if (Array.isArray(csvColRows) && csvColRows.length >= colsCount) {
        rawColRows = csvColRows;
      }
    }

    const colRowsList = (Array.isArray(rawColRows) && rawColRows.length >= colsCount)
      ? rawColRows.slice(0, colsCount).map(n => Math.max(1, parseInt(n) || 1))
      : Array(colsCount).fill(Math.max(1, parseInt(h.rows) || 1));

    const rowsCount = Math.max(...colRowsList, parseInt(h.rows) || 1);
    const totalBenchesInHall = colRowsList.reduce((sum, r) => sum + (parseInt(r) || 0), 0) || (rowsCount * colsCount);
    const seatsPerBench = exam.seatsPerBench || 2;
    const maxHallCap = getHallCapacityForSeatsPerBench(h, seatsPerBench);
    const totalSeats = maxHallCap > 0 ? maxHallCap : (totalBenchesInHall * seatsPerBench);
    const currentHallIdStr = String(h._id);
    const currentHallNameLower = (h.name || '').trim().toLowerCase();

    const secondarySeatedByExam = {};

    // Stream-based allocation (Seat 1 = Left, Seat 2 = Right / Middle, Seat 3 = Right):
    // Assigns one dedicated pool to each seat column stream so students are seated in solid continuous chunks
    // (minimum ~17+ students per department in this hall) without tiny 5-student fragmentation.
    const seatsCountOnBench = seatsPerBench || 2;
    const streamPoolPointers = [];
    for (let sIdx = 0; sIdx < seatsCountOnBench; sIdx++) {
      const usedPoolCodes = new Set(streamPoolPointers.filter(Boolean).map(p => p.code));
      const pool = activePools.find(p => p.students && p.students.length > 0 && !usedPoolCodes.has(p.code))
        || activePools.find(p => p.students && p.students.length > 0)
        || null;
      streamPoolPointers.push(pool);
    }

    function getNextStudentForStream(sIdx, excludeDepts = []) {
      const upperExcludeDepts = excludeDepts.map(d => d.toUpperCase());
      
      // 1. Try currently assigned stream pool
      let currentPool = streamPoolPointers[sIdx];
      if (!currentPool || !currentPool.students || currentPool.students.length === 0) {
        // Pool is exhausted, pick the next available pool not currently active in other streams of this hall
        const otherActiveCodes = new Set(
          streamPoolPointers
            .filter((p, idx) => idx !== sIdx && p && p.students && p.students.length > 0)
            .map(p => p.code)
        );
        currentPool = activePools.find(p => p.students && p.students.length > 0 && !otherActiveCodes.has(p.code))
          || activePools.find(p => p.students && p.students.length > 0)
          || null;
        streamPoolPointers[sIdx] = currentPool;
      }

      if (currentPool && currentPool.students && currentPool.students.length > 0) {
        const idx = currentPool.students.findIndex(s => !upperExcludeDepts.includes((s.department || '').toUpperCase()));
        const targetIdx = idx !== -1 ? idx : 0;
        const student = currentPool.students.splice(targetIdx, 1)[0];
        return { student, code: currentPool.code };
      }

      // Fallback: any pool matching non-excluded departments
      for (let p of activePools) {
        if (p.students && p.students.length > 0) {
          const idx = p.students.findIndex(s => !upperExcludeDepts.includes((s.department || '').toUpperCase()));
          if (idx !== -1) {
            const student = p.students.splice(idx, 1)[0];
            return { student, code: p.code };
          }
        }
      }

      // 2. Secondary fallback: pull unseated balance students from OTHER exams at the same date/session!
      if (secondaryPool.length > 0) {
        const idx = secondaryPool.findIndex(s => !upperExcludeDepts.includes((s.department || '').toUpperCase()));
        const targetIdx = idx !== -1 ? idx : 0;
        const student = secondaryPool.splice(targetIdx, 1)[0];
        const sCode = getMatchingSubCodeForStudent(student, Array.from(otherExamsSubCodes));

        // Find matching exam for this student
        const matchingExam = otherExamsAtSameTime.find(e => {
          const eSubs = (e.subjectCodes || []).map(c => c.toUpperCase());
          const eDepts = (e.departments || []).map(d => d.toUpperCase());
          if (eSubs.length > 0 && hasMatchingSubCode(student, eSubs)) return true;
          if (eDepts.includes((student.department || '').toUpperCase())) return true;
          return false;
        });

        if (matchingExam) {
          const eIdStr = String(matchingExam._id);
          if (!secondarySeatedByExam[eIdStr]) {
            secondarySeatedByExam[eIdStr] = { exam: matchingExam, students: [] };
          }
          secondarySeatedByExam[eIdStr].students.push({ student, code: sCode });
        }

        return { student, code: sCode, isSecondary: true };
      }

      return null;
    }

    // Existing plans for other exams in this same hall
    const otherPlansForThisHall = plansAtSameTime.filter(p => 
      String(p.examId) !== examIdStr && 
      (String(p.hallId) === currentHallIdStr || (p.hallName && p.hallName.trim().toLowerCase() === currentHallNameLower))
    );
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
    for (let c = 1; c <= colsCount; c++) {
      const rowsForThisCol = colRowsList[c - 1] !== undefined ? colRowsList[c - 1] : rowsCount;
      for (let r = 0; r < rowsForThisCol; r++) {
        const rowLetter = getRowLetter(r);
        const benchCode = `${rowLetter}${c}`;
        gridMap[benchCode] = {
          benchCode,
          row: rowLetter,
          col: c,
          seat1: occupiedSeatsInThisHall[`${benchCode}_seat1`] || null,
          seat2: occupiedSeatsInThisHall[`${benchCode}_seat2`] || null,
          seat3: seatsPerBench === 3 ? (occupiedSeatsInThisHall[`${benchCode}_seat3`] || null) : undefined
        };
      }
    }

    // Construct list of benches in column-by-column order
    const benchesList = [];
    for (let c = 1; c <= colsCount; c++) {
      const rowsForThisCol = colRowsList[c - 1] !== undefined ? colRowsList[c - 1] : rowsCount;
      for (let r = 0; r < rowsForThisCol; r++) {
        const rowLetter = getRowLetter(r);
        const benchCode = `${rowLetter}${c}`;
        if (gridMap[benchCode]) {
          benchesList.push(gridMap[benchCode]);
        }
      }
    }

    const localRoster = [];
    let totalSeatedInThisHall = 0;

    // Fill benches sequentially in order (Bench A1 -> Seat1, Seat2; Bench A2 -> Seat1, Seat2 ...)
    for (const bench of benchesList) {
      if (maxHallCap > 0 && totalSeatedInThisHall >= maxHallCap) break;

      // 1. Seat 1 (Left)
      if (!bench.seat1 && (maxHallCap <= 0 || totalSeatedInThisHall < maxHallCap)) {
        let res = getNextStudentForStream(0, []);
        if (res) {
          bench.seat1 = res.student;
          totalSeatedInThisHall++;
          localRoster.push({
            registerNo: res.student.registerNo,
            name: res.student.name,
            department: res.student.department,
            subjectCode: res.code || getStudentSubCode(res.student) || '',
            bench: bench.benchCode,
            seat: 'Left'
          });
        }
      }

      // 2. Seat 2 (Right if 2-seat, Middle if 3-seat)
      if (!bench.seat2 && (maxHallCap <= 0 || totalSeatedInThisHall < maxHallCap)) {
        let dept1 = bench.seat1 ? bench.seat1.department.toUpperCase() : null;
        let res = getNextStudentForStream(1, dept1 ? [dept1] : []);
        if (!res) {
          res = getNextStudentForStream(1, []);
        }
        if (res) {
          bench.seat2 = res.student;
          totalSeatedInThisHall++;
          localRoster.push({
            registerNo: res.student.registerNo,
            name: res.student.name,
            department: res.student.department,
            subjectCode: res.code || getStudentSubCode(res.student) || '',
            bench: bench.benchCode,
            seat: seatsPerBench === 3 ? 'Middle' : 'Right'
          });
        }
      }

      // 3. Seat 3 (Right if 3-seat)
      if (seatsPerBench === 3 && !bench.seat3 && (maxHallCap <= 0 || totalSeatedInThisHall < maxHallCap)) {
        let dept2 = bench.seat2 ? bench.seat2.department.toUpperCase() : null;
        let res = getNextStudentForStream(2, dept2 ? [dept2] : []);
        if (!res) {
          res = getNextStudentForStream(2, []);
        }
        if (res) {
          bench.seat3 = res.student;
          totalSeatedInThisHall++;
          localRoster.push({
            registerNo: res.student.registerNo,
            name: res.student.name,
            department: res.student.department,
            subjectCode: res.code || getStudentSubCode(res.student) || '',
            bench: bench.benchCode,
            seat: 'Right'
          });
        }
      }
    }

    // Reconstruct currentPool from remaining activePools students
    currentPool = [];
    for (const p of activePools) {
      currentPool.push(...p.students);
    }

    // Construct grid in row-major order (with placeholders for uneven column rows)
    const localGrid = [];
    for (let r = 0; r < rowsCount; r++) {
      const rowLetter = getRowLetter(r);
      for (let c = 1; c <= colsCount; c++) {
        const rowsForThisCol = colRowsList[c - 1] !== undefined ? colRowsList[c - 1] : rowsCount;
        const benchCode = `${rowLetter}${c}`;
        if (r < rowsForThisCol && gridMap[benchCode]) {
          localGrid.push(gridMap[benchCode]);
        } else {
          localGrid.push({
            benchCode: '',
            isPlaceholder: true,
            col: c,
            row: rowLetter
          });
        }
      }
    }

    const occupiedInOtherExams = otherPlansForThisHall.reduce((acc, p) => acc + (p.attendanceRoster ? p.attendanceRoster.length : 0), 0);
    const emptySeatsCount = totalSeats - occupiedInOtherExams - totalSeatedInThisHall;

    // Calculate unseated students for this exam so far
    const seatedSoFarForExam = new Set();
    allCreatedPlansForThisExam.forEach(p => {
      if (p.attendanceRoster) {
        p.attendanceRoster.forEach(s => seatedSoFarForExam.add(s.registerNo));
      }
    });
    localRoster.forEach(s => seatedSoFarForExam.add(s.registerNo));

    const unseatedForThisExam = initialPoolForUnseated
      .filter(s => !seatedSoFarForExam.has(s.registerNo))
      .sort((a, b) => a.registerNo.localeCompare(b.registerNo));

    // Delete any existing SeatingPlan for this exam and hall before saving
    await Models.SeatingPlan.deleteMany({ examId, hallId: h._id });

    // Create/update the SeatingPlan for this hall
    const plan = await Models.SeatingPlan.create({
      examId,
      examName: exam.name,
      hallId: h._id,
      hallName: h.name,
      seatingGrid: localGrid,
      attendanceRoster: sortAttendanceRoster(localRoster),
      unseatedStudents: unseatedForThisExam,
      totalBenches: (localGrid && localGrid.filter(b => !b.isPlaceholder).length) || h.benches || totalBenchesInHall,
      totalStudents: totalSeatedInThisHall,
      emptySeats: Math.max(0, emptySeatsCount)
    });

    allCreatedPlansForThisExam.push(plan);
    createdPlansMap[String(h._id)] = plan;
    createdPlansMap[h.name] = plan;

    // Create/update SeatingPlan for secondary exams whose balance students were seated in this hall
    for (const secKey of Object.keys(secondarySeatedByExam)) {
      const secData = secondarySeatedByExam[secKey];
      const secExam = secData.exam;
      const secRoster = secData.students.map(st => {
        // Find bench code for this student in localGrid
        let bCode = '';
        let seatPos = '';
        localGrid.forEach(g => {
          if (g.seat1 && g.seat1.registerNo === st.student.registerNo) { bCode = g.benchCode; seatPos = 'Left'; }
          if (g.seat2 && g.seat2.registerNo === st.student.registerNo) { bCode = g.benchCode; seatPos = seatsPerBench === 3 ? 'Middle' : 'Right'; }
          if (g.seat3 && g.seat3.registerNo === st.student.registerNo) { bCode = g.benchCode; seatPos = 'Right'; }
        });
        return {
          registerNo: st.student.registerNo,
          name: st.student.name,
          department: st.student.department,
          subjectCode: st.code || getStudentSubCode(st.student) || '',
          bench: bCode,
          seat: seatPos
        };
      });

      // Update secExam's assignedHalls if missing
      if (secExam.assignedHalls && !secExam.assignedHalls.includes(h.name)) {
        secExam.assignedHalls.push(h.name);
        await Models.Exam.findByIdAndUpdate(secExam._id, { assignedHalls: secExam.assignedHalls });
      }

      await Models.SeatingPlan.create({
        examId: secExam._id,
        examName: secExam.name,
        hallId: h._id,
        hallName: h.name,
        seatingGrid: localGrid,
        attendanceRoster: sortAttendanceRoster(secRoster),
        unseatedStudents: [],
        totalBenches: (localGrid && localGrid.filter(b => !b.isPlaceholder).length) || h.benches || totalBenchesInHall,
        totalStudents: secRoster.length,
        emptySeats: Math.max(0, emptySeatsCount)
      });
    }
  }

  const resultPlan = createdPlansMap[String(hallId)] || createdPlansMap[hallId] || allCreatedPlansForThisExam[0];
  logActivity('exam', 'Seating Generated', `Generated seating plan for ${exam.name}. Seated ${allCreatedPlansForThisExam.reduce((sum, p) => sum + p.totalStudents, 0)} students across ${allCreatedPlansForThisExam.length} halls.`);
  return resultPlan;
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

    const hall = await resolveHall(hallId);
    const hallIdMatches = new Set();
    if (hallId) hallIdMatches.add(String(hallId));
    if (hall) {
      hallIdMatches.add(String(hall._id));
      if (hall.name) hallIdMatches.add(hall.name);
    }

    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    const examsAtTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );

    if (examsAtTime.length === 0) {
      return res.json({ notFound: true, message: 'No exams scheduled for this date/session.' });
    }

    // Auto-regenerate plans for these exams to guarantee fresh allocation
    const generatedPlans = [];
    for (const exam of examsAtTime) {
      if (exam.assignedHalls && exam.assignedHalls.length > 0) {
        try {
          const targetHall = hall || (await resolveHall(exam.assignedHalls[0]));
          if (targetHall) {
            const plan = await generateSeatingPlan(exam._id, targetHall._id || targetHall.name);
            if (plan && (hallIdMatches.has(String(plan.hallId)) || hallIdMatches.has(plan.hallName))) {
              generatedPlans.push(plan);
            }
          }
        } catch (e) {
          console.error('Error auto-generating plan on GET:', e);
        }
      }
    }

    const allPlans = await Models.SeatingPlan.find();
    const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
    const matchedFromDb = allPlans.filter(p => 
      examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
    );
    const plansForHall = generatedPlans.length > 0 ? generatedPlans : matchedFromDb;

    if (plansForHall.length === 0) {
      return res.json({ notFound: true, message: 'No seating plans generated for this hall on this date/session.' });
    }

    const allExamSubCodes = [];
    examsAtTime.forEach(e => {
      if (e.subjectCodes) {
        e.subjectCodes.forEach(sc => {
          if (!allExamSubCodes.includes(sc)) allExamSubCodes.push(sc);
        });
      }
    });

    // Merge complementary grids
    const mergedPlan = {
      date,
      session,
      hallId,
      hallName: plansForHall[0].hallName,
      totalBenches: plansForHall[0].totalBenches,
      subjectCodes: allExamSubCodes,
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

    // Reconstruct attendanceRoster, totalStudents and emptySeats directly from merged seatingGrid
    const rosterFromGrid = [];
    let emptyCount = 0;
    if (mergedPlan.seatingGrid) {
      mergedPlan.seatingGrid.forEach(bench => {
        if (bench.isPlaceholder) return;
        if (bench.seat1) {
          rosterFromGrid.push({
            registerNo: bench.seat1.registerNo,
            name: bench.seat1.name || '',
            department: bench.seat1.department || '',
            subjectCode: getMatchingSubCodeForStudent(bench.seat1, allExamSubCodes),
            bench: bench.benchCode,
            seat: 'Left'
          });
        } else {
          emptyCount++;
        }

        if (bench.seat2) {
          rosterFromGrid.push({
            registerNo: bench.seat2.registerNo,
            name: bench.seat2.name || '',
            department: bench.seat2.department || '',
            subjectCode: getMatchingSubCodeForStudent(bench.seat2, allExamSubCodes),
            bench: bench.benchCode,
            seat: bench.seat3 !== undefined ? 'Middle' : 'Right'
          });
        } else {
          emptyCount++;
        }

        if (bench.seat3 !== undefined) {
          if (bench.seat3) {
            rosterFromGrid.push({
              registerNo: bench.seat3.registerNo,
              name: bench.seat3.name || '',
              department: bench.seat3.department || '',
              subjectCode: getMatchingSubCodeForStudent(bench.seat3, allExamSubCodes),
              bench: bench.benchCode,
              seat: 'Right'
            });
          } else {
            emptyCount++;
          }
        }
      });
    }

    mergedPlan.attendanceRoster = sortAttendanceRoster(rosterFromGrid, allExamSubCodes);
    mergedPlan.totalStudents = mergedPlan.attendanceRoster.length;
    mergedPlan.emptySeats = Math.max(0, emptyCount);
    mergedPlan.totalBenches = mergedPlan.seatingGrid ? mergedPlan.seatingGrid.filter(b => !b.isPlaceholder).length : plansForHall[0].totalBenches;

    // Persist corrected totalBenches and emptySeats on plans in DB if different
    for (const p of plansForHall) {
      if (p._id && (p.emptySeats !== mergedPlan.emptySeats || p.totalBenches !== mergedPlan.totalBenches)) {
        try {
          await Models.SeatingPlan.findByIdAndUpdate(p._id, {
            emptySeats: mergedPlan.emptySeats,
            totalBenches: mergedPlan.totalBenches
          });
        } catch (_) {}
      }
    }

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
    const allPlansForExams = allPlans.filter(p => examIdsSet.has(String(p.examId)));
    allPlansForExams.forEach(p => {
      if (p.attendanceRoster) {
        p.attendanceRoster.forEach(s => {
          unseatedMap.delete(s.registerNo);
        });
      }
    });
    mergedPlan.unseatedStudents = Array.from(unseatedMap.values()).sort((a,b) => a.registerNo.localeCompare(b.registerNo));

    res.json(mergedPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to ensure all merged cells exist in worksheet XML and set correct !ref to prevent Excel file corruption warning
function finalizeWorksheet(XLSXLib, ws, merges = []) {
  if (merges && merges.length > 0) {
    ws['!merges'] = merges;
    merges.forEach(m => {
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          const cellRef = XLSXLib.utils.encode_cell({ r, c });
          if (!ws[cellRef]) {
            ws[cellRef] = { v: '', t: 's' };
          }
        }
      }
    });
  }

  let maxR = 0, maxC = 3;
  let hasCells = false;
  Object.keys(ws).forEach(key => {
    if (key.startsWith('!')) return;
    hasCells = true;
    const decoded = XLSXLib.utils.decode_cell(key);
    if (decoded.r > maxR) maxR = decoded.r;
    if (decoded.c > maxC) maxC = decoded.c;
  });

  if (hasCells) {
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        const cellRef = XLSXLib.utils.encode_cell({ r, c });
        if (!ws[cellRef]) {
          ws[cellRef] = { v: '', t: 's' };
        }
      }
    }
    ws['!ref'] = XLSXLib.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  } else {
    ws['!ref'] = 'A1:D1';
  }
}

// Helper to build Department + Subject Code Attendance Roster pages (independent of hall seating)
async function buildAttendanceRosterPages({ date, session, subjectCodesInput = [], departmentFilter = 'ALL', hallId = null }) {
  const allExams = await Models.Exam.find();
  const targetDate = date ? date.split('T')[0] : '';

  // 1. Determine target subject codes
  let targetSubCodes = [];
  if (Array.isArray(subjectCodesInput) && subjectCodesInput.length > 0) {
    targetSubCodes = subjectCodesInput.map(c => String(c).trim().toUpperCase()).filter(Boolean);
  } else if (typeof subjectCodesInput === 'string' && subjectCodesInput.trim().length > 0) {
    targetSubCodes = subjectCodesInput.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  }

  // Find exams at target date & session if provided
  let examsAtTime = [];
  if (targetDate && session) {
    examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);
  } else if (targetSubCodes.length > 0) {
    examsAtTime = allExams.filter(e => (e.subjectCodes || []).some(sc => targetSubCodes.includes(sc.toUpperCase())));
  }

  if (targetSubCodes.length === 0) {
    examsAtTime.forEach(e => {
      (e.subjectCodes || []).forEach(sc => {
        const u = sc.trim().toUpperCase();
        if (u && !targetSubCodes.includes(u)) {
          targetSubCodes.push(u);
        }
      });
    });
  }

  // 2. Fetch all student records
  const allStudents = await Models.Student.find();
  const detectedColKey = detectSubjectCodeColumn(allStudents);

  // If hallId is specified, option to resolve hallName for header
  let hallName = 'ALL';
  if (hallId) {
    const hallObj = await resolveHall(hallId);
    if (hallObj && hallObj.name) hallName = hallObj.name;
  }

  // 3. For each Subject Code, collect matching students & group by Department
  const allPages = [];
  const allDepartmentsSet = new Set();

  targetSubCodes.forEach(subCode => {
    // Filter students for this subject code
    const matchingStudents = allStudents.filter(s => {
      const studentCodes = getStudentAllSubCodes(s, detectedColKey);
      if (studentCodes.length > 0) {
        if (studentCodes.includes(subCode)) return true;
      } else {
        const sSub = (s.subjectCode || '').trim().toUpperCase();
        if (sSub && sSub === subCode) return true;
        const matchingExam = examsAtTime.find(e => (e.subjectCodes || []).map(c => c.toUpperCase()).includes(subCode));
        if (matchingExam) {
          const eDepts = (matchingExam.departments || []).map(d => d.toUpperCase());
          if (eDepts.includes((s.department || '').toUpperCase())) return true;
        }
      }
      return false;
    });

    // Group students by clean Department name
    const deptGroups = {};
    matchingStudents.forEach(s => {
      const cleanDept = formatClassCode(s.department, subCode, s.registerNo);
      allDepartmentsSet.add(cleanDept);

      // Apply department filter if not 'ALL'
      if (departmentFilter && departmentFilter !== 'ALL' && departmentFilter.toUpperCase() !== cleanDept.toUpperCase()) {
        return;
      }

      if (!deptGroups[cleanDept]) {
        deptGroups[cleanDept] = [];
      }
      deptGroups[cleanDept].push({
        registerNo: s.registerNo,
        name: s.name || '',
        department: cleanDept,
        degree: resolveStudentDegree(s, cleanDept),
        csvData: s.csvData,
        subjectCode: subCode
      });
    });

    // Sort departments alphabetically
    const sortedDepts = Object.keys(deptGroups).sort((a, b) => a.localeCompare(b));

    sortedDepts.forEach(deptName => {
      const deptStudents = deptGroups[deptName];
      if (!deptStudents || deptStudents.length === 0) return;

      // Sort students strictly by Register Number
      deptStudents.sort((a, b) => (a.registerNo || '').localeCompare(b.registerNo || ''));

      // Chunk into maximum 25 students per page
      const chunkSize = 25;
      const totalPages = Math.ceil(deptStudents.length / chunkSize);

      for (let i = 0; i < deptStudents.length; i += chunkSize) {
        const chunk = deptStudents.slice(i, i + chunkSize);
        const pageNum = Math.floor(i / chunkSize) + 1;
        const startIndex = i + 1;

        const sampleStudent = chunk[0] || deptStudents[0];
        const pageDegree = (sampleStudent && sampleStudent.degree) || resolveStudentDegree(sampleStudent, deptName);

        allPages.push({
          subjectCode: subCode,
          deptName: deptName,
          degree: pageDegree,
          students: chunk,
          totalDeptStudents: deptStudents.length,
          pageNum: pageNum,
          totalPages: totalPages,
          startIndex: startIndex,
          hallName: hallName
        });
      }
    });
  });

  return {
    date: targetDate,
    session: session || '',
    departments: Array.from(allDepartmentsSet).sort(),
    pages: allPages
  };
}

// GET attendance roster JSON data grouped by Department + Subject Code (max 25/page)
app.get('/api/seating/attendance-roster', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId } = req.query;
    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId
    });
    res.json(rosterData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export attendance roster as formatted Excel file (.xlsx)
app.get('/api/seating/download-roster', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId } = req.query;

    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId
    });

    if (!rosterData.pages || rosterData.pages.length === 0) {
      return res.status(404).json({ error: 'No matching attendance records found for the selected criteria.' });
    }

    const allExams = await Models.Exam.find();
    const targetDate = date ? date.split('T')[0] : rosterData.date;
    const examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);

    // Format the date
    let formattedDate = targetDate;
    try {
      const d = new Date(targetDate);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        formattedDate = `${dd}/${mm}/${yyyy}`;
      }
    } catch (err) {}

    // Format session time
    let timeOfExam = session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM';
    const firstExamWithTime = examsAtTime.find(e => e.time && e.time.trim() !== '');
    if (firstExamWithTime) {
      timeOfExam = firstExamWithTime.time;
    }

    let XLSXLib;
    try {
      XLSXLib = require('xlsx-js-style');
    } catch (e) {
      XLSXLib = require('xlsx');
    }

    const wb = XLSXLib.utils.book_new();
    const usedSheetNames = new Set();

    rosterData.pages.forEach(page => {
      const { deptName, degree, subjectCode, students, pageNum, startIndex, hallName } = page;
      const pageDegree = degree || resolveStudentDegree((students && students[0]), deptName);
      const ws = {};

      const borderStyle = {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      };

      const writeCell = (r, c, val, bold = false, align = 'left', fontSize = 11, border = false, isHeader = false, underline = false) => {
        const cellRef = XLSXLib.utils.encode_cell({ r, c });
        ws[cellRef] = {
          v: val,
          t: typeof val === 'number' ? 'n' : 's',
          s: {
            font: { name: 'Times New Roman', size: fontSize, bold: bold, underline: underline },
            alignment: { horizontal: align, vertical: 'center', wrapText: true }
          }
        };
        if (border) ws[cellRef].s.border = borderStyle;
        if (isHeader) {
          ws[cellRef].s.fill = { patternType: 'solid', fgColor: { rgb: 'EAEAEA' } };
        }
      };

      // Always write Full Official University Header & Footer on every page
      writeCell(0, 0, 'MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', true, 'center', 14, false, false, true);
      writeCell(1, 0, 'RAJAPALAYAM RAJUS\' COLLEGE, RAJAPALAYAM', true, 'center', 12, false, false, true);

      writeCell(2, 0, `DATE OF EXAM: ${formattedDate}`, true, 'left', 10);
      writeCell(2, 3, `TIME OF EXAM : ${timeOfExam}`, true, 'right', 10);
      writeCell(3, 0, `SUBJECT CODE: ${subjectCode.toUpperCase()}`, true, 'left', 10);
      writeCell(3, 3, `DEGREE: ${pageDegree}`, true, 'right', 10);

      // Row 5: Table Header
      writeCell(5, 0, 'SL NO', true, 'center', 10, true, true);
      writeCell(5, 1, 'REGISTER NUMBER', true, 'center', 10, true, true);
      writeCell(5, 2, 'NAME OF THE CANDIDATE', true, 'center', 10, true, true);
      writeCell(5, 3, 'SIGNATURE OF THE CANDIDATE', true, 'center', 10, true, true);

      // Student rows: ALWAYS EXACTLY 25 ROWS (filled + blank rows padded with continuous SL NO)
      for (let idx = 0; idx < 25; idx++) {
        const row = 6 + idx;
        const currentSlNo = startIndex + idx;
        writeCell(row, 0, currentSlNo, false, 'center', 10, true);
        if (idx < students.length) {
          const s = students[idx];
          writeCell(row, 1, s.registerNo || '', true, 'center', 10, true);
          writeCell(row, 2, (s.name || '').toUpperCase(), false, 'left', 10, true);
          writeCell(row, 3, '', false, 'left', 10, true);
        } else {
          // Padded blank row with continuous SL NO, empty regNo, name, sig
          writeCell(row, 1, '', false, 'center', 10, true);
          writeCell(row, 2, '', false, 'left', 10, true);
          writeCell(row, 3, '', false, 'left', 10, true);
        }
      }

      const fStart = 32; // Footer starts at row 32 after 25 student rows (rows 6..30) and 1 blank spacer row 31

      // Footer rows
      writeCell(fStart, 0, 'Absentees Reg. No.:', true, 'left', 10);
      writeCell(fStart, 3, `Hall No.: ${hallName || 'ALL'}`, true, 'right', 10);

      writeCell(fStart + 1, 0, 'Total No. of Absentees:', true, 'left', 10);
      writeCell(fStart + 1, 3, 'Name of the Invigilator and College:', true, 'right', 10);

      writeCell(fStart + 3, 0, 'Signature of the Chief Superintendent', true, 'left', 10);
      writeCell(fStart + 3, 3, 'Signature of the Invigilator', true, 'right', 10);

      const pageMerges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },
        { s: { r: fStart, c: 0 }, e: { r: fStart, c: 2 } },
        { s: { r: fStart + 1, c: 0 }, e: { r: fStart + 1, c: 2 } },
        { s: { r: fStart + 3, c: 0 }, e: { r: fStart + 3, c: 1 } }
      ];

      ws['!rows'] = [];
      ws['!rows'][0] = { hpt: 25 };
      ws['!rows'][1] = { hpt: 22 };
      ws['!rows'][2] = { hpt: 20 };
      ws['!rows'][3] = { hpt: 20 };
      ws['!rows'][5] = { hpt: 22 };
      for (let i = 0; i < 25; i++) {
        ws['!rows'][6 + i] = { hpt: 24 };
      }

      finalizeWorksheet(XLSXLib, ws, pageMerges);
      ws['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 1 };

      // Column widths
      ws['!cols'] = [
        { wch: 8 },  // SL NO
        { wch: 22 }, // REGISTER NUMBER
        { wch: 38 }, // NAME OF THE CANDIDATE
        { wch: 35 }  // SIGNATURE OF THE CANDIDATE
      ];

      const cleanDept = deptName.replace(/[^A-Z0-9]/gi, '').substring(0, 8);
      const cleanSub = subjectCode.replace(/[^A-Z0-9]/gi, '').substring(0, 8);
      let baseSheetName = `${cleanDept}_${cleanSub}_P${pageNum}`.substring(0, 30);
      let sheetName = baseSheetName;
      let counter = 1;
      while (usedSheetNames.has(sheetName)) {
        sheetName = `${baseSheetName.substring(0, 25)}_${counter}`;
        counter++;
      }
      usedSheetNames.add(sheetName);
      XLSXLib.utils.book_append_sheet(wb, ws, sheetName);
    });

    const buffer = XLSXLib.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `Attendance_Roster_${(department || 'ALL').replace(/[^A-Z0-9]/gi, '_')}_${targetDate || 'Exam'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export attendance roster as printable A4 PDF file (.pdf)
app.get('/api/seating/roster/download-pdf', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId } = req.query;

    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId
    });

    if (!rosterData.pages || rosterData.pages.length === 0) {
      return res.status(404).json({ error: 'No matching attendance records found for the selected criteria.' });
    }

    const allExams = await Models.Exam.find();
    const targetDate = date ? date.split('T')[0] : rosterData.date;
    const examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);

    let formattedDate = targetDate;
    try {
      const d = new Date(targetDate);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        formattedDate = `${dd}/${mm}/${yyyy}`;
      }
    } catch (err) {}

    let timeOfExam = session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM';
    const firstExamWithTime = examsAtTime.find(e => e.time && e.time.trim() !== '');
    if (firstExamWithTime) {
      timeOfExam = firstExamWithTime.time;
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      margin: 25
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      const filename = `Attendance_Roster_${(department || 'ALL').replace(/[^A-Z0-9]/gi, '_')}_${targetDate}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfData);
    });

    const pageW = 595.28;
    const margin = 25;
    const printableW = pageW - (2 * margin);

    rosterData.pages.forEach((page, pIdx) => {
      if (pIdx > 0) doc.addPage();

      let y = margin;

      // Header
      doc.font('Helvetica-Bold').fontSize(14).text('MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', margin, y, { align: 'center', width: printableW, underline: true });
      y += 18;
      doc.font('Helvetica-Bold').fontSize(12).text("RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM", margin, y, { align: 'center', width: printableW, underline: true });
      y += 24;

      // Meta info
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(`DATE OF EXAM: ${formattedDate}`, margin, y);
      doc.text(`TIME OF EXAM: ${timeOfExam}`, margin + 300, y, { align: 'right', width: printableW - 300 });
      y += 14;

      const pageDegree = page.degree || resolveStudentDegree((page.students && page.students[0]), page.deptName);
      doc.text(`SUBJECT CODE: ${page.subjectCode.toUpperCase()}`, margin, y);
      doc.text(`DEGREE: ${pageDegree}`, margin + 300, y, { align: 'right', width: printableW - 300 });
      y += 18;

      // Table Header
      const colWidths = [40, 115, 230, 160];
      const colX = [
        margin,
        margin + colWidths[0],
        margin + colWidths[0] + colWidths[1],
        margin + colWidths[0] + colWidths[1] + colWidths[2]
      ];

      const headerH = 20;
      doc.rect(margin, y, printableW, headerH).fillAndStroke('#EAEAEA', '#000000');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);

      doc.text('SL NO', colX[0], y + 6, { width: colWidths[0], align: 'center' });
      doc.text('REGISTER NUMBER', colX[1], y + 6, { width: colWidths[1], align: 'center' });
      doc.text('NAME OF THE CANDIDATE', colX[2] + 5, y + 6, { width: colWidths[2] - 5, align: 'left' });
      doc.text('SIGNATURE OF THE CANDIDATE', colX[3], y + 6, { width: colWidths[3], align: 'center' });
      y += headerH;

      // 25 Student Rows (filled + blank rows padded with continuous SL NO)
      const rowH = 19;
      for (let r = 0; r < 25; r++) {
        doc.rect(margin, y, printableW, rowH).stroke('#000000');
        // vertical grid lines
        doc.moveTo(colX[1], y).lineTo(colX[1], y + rowH).stroke('#000000');
        doc.moveTo(colX[2], y).lineTo(colX[2], y + rowH).stroke('#000000');
        doc.moveTo(colX[3], y).lineTo(colX[3], y + rowH).stroke('#000000');

        const currentSlNo = page.startIndex + r;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
        doc.text(`${currentSlNo}`, colX[0], y + 5, { width: colWidths[0], align: 'center' });

        if (r < page.students.length) {
          const st = page.students[r];
          doc.text(st.registerNo || '', colX[1], y + 5, { width: colWidths[1], align: 'center' });
          doc.font('Helvetica').fontSize(8);
          doc.text((st.name || '').toUpperCase(), colX[2] + 5, y + 5, { width: colWidths[2] - 10, align: 'left' });
        }
        y += rowH;
      }

      // Footer section
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      doc.text('Absentees Reg. No.: _____________________________________________', margin, y);
      doc.text(`Hall No.: ${page.hallName || 'ALL'}`, margin + 350, y, { align: 'right', width: printableW - 350 });
      y += 18;

      doc.text('Total No. of Absentees: ______________', margin, y);
      doc.text('Name of the Invigilator and College: _______________________', margin + 200, y, { align: 'right', width: printableW - 200 });
      y += 32;

      doc.text('Signature of the Chief Superintendent', margin, y);
      doc.text('Signature of the Invigilator', margin + 300, y, { align: 'right', width: printableW - 300 });
    });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to extract complete seating arrangement student sequence across ALL halls for a selected Date and Session, ordered strictly by Department -> Register Number (Ascending)
async function getAllHallsSeatingStudentSequence(date, session) {
  if (!date || !session) return { studentRegNos: [], totalStudents: 0, departmentCounts: {}, hallsProcessed: 0 };

  const targetDate = date.split('T')[0];
  const allExams = await Models.Exam.find();
  const examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);
  if (examsAtTime.length === 0) {
    return { studentRegNos: [], totalStudents: 0, departmentCounts: {}, hallsProcessed: 0 };
  }

  // Auto-generate plans for all assigned halls of these exams if not yet generated
  for (const exam of examsAtTime) {
    if (exam.assignedHalls && exam.assignedHalls.length > 0) {
      for (const hId of exam.assignedHalls) {
        try {
          const hall = await resolveHall(hId);
          if (hall) {
            await generateSeatingPlan(exam._id, hall._id || hId);
          }
        } catch (e) {
          console.error('Error auto-generating plan in getAllHallsSeatingStudentSequence:', e);
        }
      }
    }
  }

  const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
  const allPlans = await Models.SeatingPlan.find();
  const plansForTime = allPlans.filter(p => {
    const matchesExamId = examIdsSet.has(String(p.examId));
    const matchesDateSession = p.date && p.date.split('T')[0] === targetDate && p.session === session;
    return matchesExamId || matchesDateSession;
  });
  const hallsProcessedSet = new Set();

  // Fetch all students to resolve true department if missing in roster/grid
  const allStudents = await Models.Student.find();
  const studentMapByReg = new Map();
  allStudents.forEach(s => {
    if (s.registerNo) studentMapByReg.set(s.registerNo.trim().toUpperCase(), s);
  });

  const studentObjList = [];
  const seenRegNos = new Set();

  plansForTime.forEach(p => {
    if (p.hallName) hallsProcessedSet.add(p.hallName);
    if (p.hallId) hallsProcessedSet.add(String(p.hallId));

    const processStudentRecord = (stdObj) => {
      if (!stdObj || !stdObj.registerNo) return;
      const cleanReg = stdObj.registerNo.trim().toUpperCase();
      if (seenRegNos.has(cleanReg)) return;
      seenRegNos.add(cleanReg);

      const dbStudent = studentMapByReg.get(cleanReg);
      const rawDept = (stdObj.department || (dbStudent ? dbStudent.department : '') || '').trim();
      const cleanDept = formatClassCode(rawDept, stdObj.subjectCode || (dbStudent ? dbStudent.subjectCode : ''), cleanReg);

      studentObjList.push({
        registerNo: cleanReg,
        name: stdObj.name || (dbStudent ? dbStudent.name : ''),
        department: cleanDept
      });
    };

    if (Array.isArray(p.seatingGrid) && p.seatingGrid.length > 0) {
      p.seatingGrid.forEach(bench => {
        if (bench.seat1) processStudentRecord(bench.seat1);
        if (bench.seat2) processStudentRecord(bench.seat2);
        if (bench.seat3) processStudentRecord(bench.seat3);
      });
    } else if (Array.isArray(p.attendanceRoster)) {
      p.attendanceRoster.forEach(s => {
        processStudentRecord(s);
      });
    }
  });

  // Group by Department
  const deptGroups = {};
  studentObjList.forEach(s => {
    const deptKey = s.department || 'GENERAL';
    if (!deptGroups[deptKey]) {
      deptGroups[deptKey] = [];
    }
    deptGroups[deptKey].push(s);
  });

  // Sort Departments alphabetically
  const sortedDepts = Object.keys(deptGroups).sort((a, b) => a.localeCompare(b));

  const finalRegNos = [];
  const departmentCounts = {};

  sortedDepts.forEach(deptName => {
    const group = deptGroups[deptName];
    // Sort students within department strictly by Register Number ascending
    group.sort((a, b) => a.registerNo.localeCompare(b.registerNo));
    departmentCounts[deptName] = group.length;

    group.forEach(s => {
      finalRegNos.push(s.registerNo);
    });
  });

  return {
    studentRegNos: finalRegNos,
    totalStudents: finalRegNos.length,
    departmentCounts,
    hallsProcessed: hallsProcessedSet.size
  };
}

// Helper to extract exact seating arrangement student sequence for a selected Hall, Date, and Session
async function getHallSeatingStudentSequence(date, session, hallId) {
  if (!date || !session || !hallId) return { hallName: 'HALL', studentRegNos: [] };

  const hall = await resolveHall(hallId);
  const hallIdMatches = new Set();
  if (hallId) hallIdMatches.add(String(hallId));
  if (hall) {
    hallIdMatches.add(String(hall._id));
    if (hall.name) hallIdMatches.add(hall.name);
  }

  const targetDate = date.split('T')[0];
  const allExams = await Models.Exam.find();
  const examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);
  const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));

  // Auto-generate plans for these exams to guarantee fresh allocation if missing
  for (const exam of examsAtTime) {
    if (exam.assignedHalls && exam.assignedHalls.length > 0) {
      try {
        const firstHall = hall || (await resolveHall(exam.assignedHalls[0]));
        if (firstHall) {
          await generateSeatingPlan(exam._id, firstHall._id || exam.assignedHalls[0]);
        }
      } catch (e) {
        console.error('Error auto-generating plan in getHallSeatingStudentSequence:', e);
      }
    }
  }

  const allPlans = await Models.SeatingPlan.find();
  const plansForHall = allPlans.filter(p => 
    examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
  );

  let hallName = hall ? hall.name : (plansForHall.length > 0 ? plansForHall[0].hallName : 'HALL');
  const studentRegNos = [];

  plansForHall.forEach(p => {
    if (Array.isArray(p.seatingGrid) && p.seatingGrid.length > 0) {
      p.seatingGrid.forEach(bench => {
        if (bench.seat1 && bench.seat1.registerNo) studentRegNos.push(bench.seat1.registerNo);
        if (bench.seat2 && bench.seat2.registerNo) studentRegNos.push(bench.seat2.registerNo);
        if (bench.seat3 && bench.seat3.registerNo) studentRegNos.push(bench.seat3.registerNo);
      });
    } else if (Array.isArray(p.attendanceRoster)) {
      p.attendanceRoster.forEach(s => {
        if (s && s.registerNo) studentRegNos.push(s.registerNo);
      });
    }
  });

  return { hallName, studentRegNos };
}

// GET export seat labels as styled Excel file (.xlsx) - Overall All-Halls Export (7 cols x 12 rows per page block)
app.get('/api/seating/labels/download-excel', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
    } else if (hallId) {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    }

    if (studentRegNos.length === 0) {
      return res.status(404).json({ error: 'No student seating allocation found for the selected Date and Session.' });
    }

    let XLSXLib;
    try {
      XLSXLib = require('xlsx-js-style');
    } catch (e) {
      XLSXLib = require('xlsx');
    }

    const wb = XLSXLib.utils.book_new();
    const ws = {};

    const borderStyle = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } }
    };

    const labelsPerPage = 84;
    const totalPages = Math.ceil(studentRegNos.length / labelsPerPage);
    const merges = [];

    let currentExcelRow = 0;

    for (let p = 0; p < totalPages; p++) {
      const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);

      // Write 12 rows x 7 cols
      for (let r = 0; r < 12; r++) {
        const rowIdx = currentExcelRow + r;
        for (let c = 0; c < 7; c++) {
          const studentIdx = r * 7 + c;
          const regNo = studentIdx < pageStudents.length ? pageStudents[studentIdx] : '';
          const cellRef = XLSXLib.utils.encode_cell({ r: rowIdx, c });

          ws[cellRef] = {
            v: regNo,
            t: 's',
            s: {
              font: { name: 'Times New Roman', size: 12, bold: true },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: borderStyle
            }
          };
        }
      }

      currentExcelRow += 12;
      if (p < totalPages - 1) {
        currentExcelRow += 1;
      }
    }

    ws['!cols'] = [
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
    ];

    ws['!rows'] = [];
    for (let r = 0; r < currentExcelRow; r++) {
      ws['!rows'][r] = { hpt: 28 };
    }

    ws['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 };
    finalizeWorksheet(XLSXLib, ws, merges);

    const sheetName = 'Seat_Labels_All';
    XLSXLib.utils.book_append_sheet(wb, ws, sheetName);

    const buffer = XLSXLib.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const targetDate = date ? date.split('T')[0] : 'Date';
    const filename = `Seat_Labels_${fileSuffix}_${targetDate}_${session || ''}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export seat labels as CSV file (.csv) - Overall All-Halls Export (7 columns per row)
app.get('/api/seating/labels/download-csv', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
    } else if (hallId) {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    }

    if (studentRegNos.length === 0) {
      return res.status(404).json({ error: 'No student seating allocation found for the selected Date and Session.' });
    }

    const csvRows = [];
    for (let i = 0; i < studentRegNos.length; i += 7) {
      const chunk = studentRegNos.slice(i, i + 7);
      csvRows.push(chunk.join(','));
    }

    const csvContent = csvRows.join('\n');
    const targetDate = date ? date.split('T')[0] : 'Date';
    const filename = `Seat_Labels_${fileSuffix}_${targetDate}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export colorful seating layout as PDF (.pdf)
app.get('/api/seating/layout/download-pdf', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    if (!date || !session || !hallId) {
      return res.status(400).json({ error: 'Missing date, session, or hallId.' });
    }

    const hall = await resolveHall(hallId);
    const hallIdMatches = new Set();
    if (hallId) hallIdMatches.add(String(hallId));
    if (hall) {
      hallIdMatches.add(String(hall._id));
      if (hall.name) hallIdMatches.add(hall.name);
    }

    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    const examsAtTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session
    );

    if (examsAtTime.length === 0) {
      return res.status(404).json({ error: 'No exams scheduled for this date/session.' });
    }

    const allPlans = await Models.SeatingPlan.find();
    const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
    const plansForHall = allPlans.filter(p => 
      examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
    );

    if (plansForHall.length === 0) {
      return res.status(404).json({ error: 'Seating plan not generated yet for this hall.' });
    }

    // Merge complementary grids
    let seatingGrid = [];
    const grids = plansForHall.map(p => p.seatingGrid).filter(Boolean);
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
      seatingGrid = baseGrid;
    }

    const hallName = (hall && hall.name) || plansForHall[0].hallName || 'Hall';
    const colsCount = (hall && hall.columns) || plansForHall[0].columns || 4;
    const isLandscape = colsCount >= 4;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      layout: isLandscape ? 'landscape' : 'portrait',
      margin: 20
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      const filename = `Seating_Layout_${hallName.replace(/[^A-Z0-9]/gi, '_')}_${targetDate}_${session}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfData);
    });

    const pageW = isLandscape ? 841.89 : 595.28;
    const pageH = isLandscape ? 595.28 : 841.89;
    const margin = 20;
    const printableW = pageW - (2 * margin);

    let y = margin;

    // Header Background Bar
    doc.roundedRect(margin, y, printableW, 36, 4).fillAndStroke('#4F46E5', '#3730A3');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14).text("RAJAPALAYAM RAJUS' COLLEGE (AUTONOMOUS)", margin, y + 6, { align: 'center', width: printableW });
    doc.fontSize(8.5).font('Helvetica').text("Affiliated to Madurai Kamaraj University | Re-accredited with 'A' Grade by NAAC", margin, y + 22, { align: 'center', width: printableW });
    y += 42;

    // Title & Meta Info Box
    const metaBoxH = 22;
    doc.roundedRect(margin, y, printableW, metaBoxH, 4).fillAndStroke('#F1F5F9', '#CBD5E1');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(9);
    
    const formattedDate = new Date(targetDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const metaColW = printableW / 4;
    const totalBenchesCount = seatingGrid.filter(b => !b.isPlaceholder).length;
    doc.text(`HALL: ${hallName}`, margin + 8, y + 6, { width: metaColW });
    doc.text(`DATE: ${formattedDate}`, margin + metaColW, y + 6, { width: metaColW });
    doc.text(`SESSION: ${session === 'FN' ? 'Forenoon (FN)' : 'Afternoon (AN)'}`, margin + (metaColW * 2), y + 6, { width: metaColW });
    doc.text(`GRID: ${colsCount} Cols · ${totalBenchesCount} Benches`, margin + (metaColW * 3), y + 6, { width: metaColW - 8, align: 'right' });
    y += metaBoxH + 10;

    // Grid Layout Computation
    const is3Seat = seatingGrid.some(b => b.seat3 !== undefined);
    const benchGap = 6;
    const benchW = (printableW - (benchGap * (colsCount - 1))) / colsCount;
    const availableH = pageH - y - margin - 35;
    const rowsCountTotal = Math.max(Math.ceil(seatingGrid.length / colsCount), 1);
    const benchH = Math.min(42, Math.max(28, (availableH - (benchGap * (rowsCountTotal - 1))) / rowsCountTotal));

    // Render Benches
    seatingGrid.forEach((bench, bIdx) => {
      if (bench.isPlaceholder) return;
      const colIdx = (bench.col ? bench.col - 1 : (bIdx % colsCount));
      const rowIdx = Math.floor(bIdx / colsCount);

      const bx = margin + colIdx * (benchW + benchGap);
      const by = y + rowIdx * (benchH + benchGap);

      // Bench card container
      doc.roundedRect(bx, by, benchW, benchH, 4).fillAndStroke('#FFFFFF', '#CBD5E1');

      // Bench Code text on top
      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text(bench.benchCode, bx, by + 3, { width: benchW, align: 'center' });

      // Seats inside bench
      const seatsCount = is3Seat ? 3 : 2;
      const seatSectionW = (benchW - 8) / seatsCount;
      const seatKeys = is3Seat ? ['seat1', 'seat2', 'seat3'] : ['seat1', 'seat2'];

      seatKeys.forEach((sKey, sIdx) => {
        const sx = bx + 4 + (sIdx * seatSectionW);
        const sy = by + 12;
        const sH = benchH - 15;
        const st = bench[sKey];

        const sideTheme = sIdx === 0 
          ? { bg: '#F5F3FF', stroke: '#A855F7', text: '#7C3AED' } // Left (Purple)
          : (is3Seat && sIdx === 1)
            ? { bg: '#FFFBEB', stroke: '#F59E0B', text: '#D97706' } // Middle (Amber/Orange)
            : { bg: '#ECFDF5', stroke: '#10B981', text: '#059669' }; // Right (Green)

        if (st && st.registerNo) {
          doc.roundedRect(sx, sy, seatSectionW - 2, sH, 2).fillAndStroke(sideTheme.bg, sideTheme.stroke);
          doc.fillColor(sideTheme.text).font('Helvetica-Bold').fontSize(6.5).text(st.registerNo, sx, sy + 2, { width: seatSectionW - 2, align: 'center' });
          doc.font('Helvetica').fontSize(5.5).text(st.department || '', sx, sy + 8.5, { width: seatSectionW - 2, align: 'center' });
        } else {
          doc.roundedRect(sx, sy, seatSectionW - 2, sH, 2).stroke('#CBD5E1');
          doc.fillColor('#94A3B8').font('Helvetica-Oblique').fontSize(6).text('Empty', sx, sy + (sH / 2) - 3, { width: seatSectionW - 2, align: 'center' });
        }
      });
    });

    // Signature Box at bottom
    const sigY = pageH - margin - 20;
    doc.strokeColor('#94A3B8').dash(3, { space: 3 }).moveTo(margin, sigY).lineTo(margin + printableW, sigY).stroke().undash();
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8);
    doc.text("Hall Invigilator's Signature: _______________________", margin, sigY + 6);
    doc.text("Chief Superintendent Signature: _______________________", margin + printableW - 260, sigY + 6, { width: 260, align: 'right' });

    doc.end();
  } catch (error) {
    console.error('Error generating seating layout PDF:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET export seat labels as printable A4 PDF file (.pdf) - Overall All-Halls Export (7 cols x 12 rows per page)
app.get('/api/seating/labels/download-pdf', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
    } else if (hallId) {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    }

    if (studentRegNos.length === 0) {
      return res.status(404).json({ error: 'No student seating allocation found for the selected Date and Session.' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      const targetDate = date ? date.split('T')[0] : 'Date';
      const filename = `Seat_Labels_${fileSuffix}_${targetDate}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfData);
    });

    const pageW = 595.28;
    const pageH = 841.89;
    const marginX = 14;
    const marginY = 14;
    const cols = 7;
    const rows = 12;
    const gapX = 3;
    const gapY = 3;

    const labelW = (pageW - (2 * marginX) - ((cols - 1) * gapX)) / cols;
    const labelH = (pageH - (2 * marginY) - ((rows - 1) * gapY)) / rows;

    const labelsPerPage = cols * rows;
    const totalPages = Math.ceil(studentRegNos.length / labelsPerPage);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();

      const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const regNo = idx < pageStudents.length ? pageStudents[idx] : '';
          const x = marginX + c * (labelW + gapX);
          const y = marginY + r * (labelH + gapY);

          // Draw thin border for cutting
          doc.lineWidth(0.5).rect(x, y, labelW, labelH).stroke('#000000');

          if (regNo) {
            doc.font('Helvetica-Bold')
               .fontSize(11)
               .fillColor('#000000')
               .text(regNo, x, y + (labelH / 2) - 6, {
                 width: labelW,
                 align: 'center'
               });
          }
        }
      }
    }

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to parse Month and Year in uppercase from date string (e.g. "2026-04-16" -> "APRIL 2026")
function getMonthYearString(dateStr) {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
      return `${months[d.getMonth()]} ${d.getFullYear()}`;
    }
  } catch (e) {}
  return "EXAMINATIONS";
}

// Helper to summarize register numbers into ranges (e.g. [2002, 2003, 2004, 2006] -> "2002 TO 2004, 2006")
function summarizeRegisterNumbers(regNos) {
  if (!regNos || regNos.length === 0) return '';
  
  const parsed = regNos.map(reg => {
    const match = reg.match(/^(.*?)(\d+)$/);
    if (match) {
      return {
        original: reg,
        prefix: match[1],
        numStr: match[2],
        numVal: parseInt(match[2], 10)
      };
    }
    return {
      original: reg,
      prefix: '',
      numStr: reg,
      numVal: NaN
    };
  });

  const groups = {};
  parsed.forEach(p => {
    const key = p.prefix;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  const summarizedParts = [];

  Object.entries(groups).forEach(([prefix, items]) => {
    items.sort((a, b) => {
      if (isNaN(a.numVal) || isNaN(b.numVal)) {
        return a.original.localeCompare(b.original);
      }
      return a.numVal - b.numVal;
    });

    const ranges = [];
    let rangeStart = null;
    let rangeEnd = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (isNaN(item.numVal)) {
        ranges.push(item.original);
        continue;
      }

      if (rangeStart === null) {
        rangeStart = item;
        rangeEnd = item;
      } else if (item.numVal === rangeEnd.numVal + 1) {
        rangeEnd = item;
      } else {
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = item;
        rangeEnd = item;
      }
    }
    
    if (rangeStart !== null) {
      ranges.push({ start: rangeStart, end: rangeEnd });
    }

    const formattedRanges = ranges.map(r => {
      if (typeof r === 'string') return r;
      if (r.start.numVal === r.end.numVal) {
        return r.start.numStr;
      } else if (r.end.numVal === r.start.numVal + 1) {
        return `${r.start.numStr}, ${r.end.numStr}`;
      } else {
        return `${r.start.numStr} TO ${r.end.numStr}`;
      }
    });

    if (prefix) {
      if (formattedRanges.length > 0) {
        const firstRange = ranges[0];
        let firstPartFormatted = '';
        if (typeof firstRange === 'string') {
          firstPartFormatted = firstRange;
        } else {
          if (firstRange.start.numVal === firstRange.end.numVal) {
            firstPartFormatted = prefix + firstRange.start.numStr;
          } else if (firstRange.end.numVal === firstRange.start.numVal + 1) {
            firstPartFormatted = `${prefix}${firstRange.start.numStr}, ${firstRange.end.numStr}`;
          } else {
            firstPartFormatted = `${prefix}${firstRange.start.numStr} TO ${firstRange.end.numStr}`;
          }
        }
        
        const subsequentParts = formattedRanges.slice(1);
        if (subsequentParts.length > 0) {
          summarizedParts.push(`${firstPartFormatted}, ${subsequentParts.join(', ')}`);
        } else {
          summarizedParts.push(firstPartFormatted);
        }
      }
    } else {
      summarizedParts.push(formattedRanges.join(', '));
    }
  });

  return summarizedParts.join('; ');
}

// Helper to compute Exam Location Summary data dynamically for a given date and session
async function getLocationsSummaryData(date, session) {
  const allExams = await Models.Exam.find();
  const targetDate = getDateString(date);
  const examsAtTime = allExams.filter(e => 
    getDateString(e.date) === targetDate && e.session === session
  );
  const examIds = examsAtTime.map(e => String(e._id));

  // Auto-regenerate fresh seating plans for these exams
  for (const exam of examsAtTime) {
    if (exam.assignedHalls && exam.assignedHalls.length > 0) {
      try {
        const firstHall = await resolveHall(exam.assignedHalls[0]);
        if (firstHall) {
          await generateSeatingPlan(exam._id, firstHall._id || exam.assignedHalls[0]);
        }
      } catch (e) {
        console.error("Error auto-generating plan for locations:", e);
      }
    }
  }

  const allPlans = await Models.SeatingPlan.find();
  const plansForTime = allPlans.filter(p => examIds.includes(String(p.examId)));

  if (plansForTime.length === 0) {
    return { targetDate, formattedDate: targetDate, session, examsAtTime, plansForTime: [], result: [] };
  }

  let formattedDate = targetDate;
  try {
    const d = new Date(targetDate);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      formattedDate = `${dd}-${mm}-${yyyy}`;
    }
  } catch (err) {}

  // Group plans by hallId / hallName
  const hallPlans = {};
  plansForTime.forEach(p => {
    const hKey = p.hallId || p.hallName;
    if (!hallPlans[hKey]) {
      hallPlans[hKey] = [];
    }
    hallPlans[hKey].push(p);
  });

  const result = [];

  for (const [, plans] of Object.entries(hallPlans)) {
    const hallName = plans[0].hallName;
    
    // Merge attendance rosters
    const attendanceRoster = [];
    plans.forEach(p => {
      if (p.attendanceRoster) {
        attendanceRoster.push(...p.attendanceRoster);
      }
    });

    // Group students by department / subjectCode
    const classGroups = {};
    attendanceRoster.forEach(s => {
      const classKey = formatClassCode(s.department, s.subjectCode, s.registerNo);
      if (!classGroups[classKey]) {
        classGroups[classKey] = [];
      }
      classGroups[classKey].push(s.registerNo);
    });

    const classes = Object.entries(classGroups).map(([classCode, regNos]) => {
      return {
        classCode,
        regNos: regNos.sort((a,b) => a.localeCompare(b)),
        summarizedRange: summarizeRegisterNumbers(regNos.sort((a,b) => a.localeCompare(b))),
        count: regNos.length
      };
    });

    classes.sort((a,b) => a.classCode.localeCompare(b.classCode));

    const totalStudents = attendanceRoster.length;

    result.push({
      hallName,
      totalStudents,
      classes
    });
  }

  result.sort((a,b) => a.hallName.localeCompare(b.hallName));

  const timeOfExam = (examsAtTime[0] && examsAtTime[0].time) || (session === "FN" ? "10:00 AM - 01:00 PM" : "02:00 PM - 05:00 PM");
  const sessionName = session === "FN" ? "FORENOON (FN)" : "AFTERNOON (AN)";

  return {
    targetDate,
    formattedDate,
    session,
    sessionName,
    timeOfExam,
    examsAtTime,
    plansForTime,
    result
  };
}

// Helper to generate professional Exam Location Summary PDF document
function generateExamLocationsPdf(doc, data) {
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 35;
  const printableW = pageW - (2 * margin);
  const safeBottom = pageH - 45;

  const formattedDate = data.formattedDate || data.targetDate;
  const sessionName = data.sessionName || (data.session === "FN" ? "FORENOON (FN)" : "AFTERNOON (AN)");
  const timeText = data.timeOfExam || (data.session === "FN" ? "10:00 AM - 01:00 PM" : "02:00 PM - 05:00 PM");

  // Draw Primary Header on First Page
  const drawMainHeader = () => {
    let y = margin;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827")
       .text("MADURAI KAMARAJ UNIVERSITY EXAMINATIONS", margin, y, { align: "center", width: printableW });
    y += 18;

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1F2937")
       .text("RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM", margin, y, { align: "center", width: printableW });
    y += 20;

    doc.lineWidth(1).strokeColor("#374151")
       .moveTo(margin, y).lineTo(margin + printableW, y).stroke();
    y += 8;

    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111827");
    doc.text(`DATE OF EXAM: ${formattedDate}`, margin + 5, y, { width: printableW / 2 });
    doc.text(`TIME / SESSION: ${timeText} / ${sessionName}`, margin + (printableW / 2), y, { width: (printableW / 2) - 5, align: "right" });
    y += 18;

    const badgeH = 22;
    doc.rect(margin, y, printableW, badgeH).fillAndStroke("#E5E7EB", "#9CA3AF");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827")
       .text("EXAM LOCATION SUMMARY", margin, y + 5, { align: "center", width: printableW });
    y += badgeH + 14;

    return y;
  };

  // Draw Compact Header on Subsequent Pages
  const drawCompactHeader = () => {
    let y = margin;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827")
       .text("RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM — EXAM LOCATION SUMMARY", margin, y, { align: "center", width: printableW });
    y += 14;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#4B5563")
       .text(`DATE: ${formattedDate}   |   SESSION: ${sessionName} (${timeText})`, margin, y, { align: "center", width: printableW });
    y += 14;
    doc.lineWidth(0.8).strokeColor("#6B7280")
       .moveTo(margin, y).lineTo(margin + printableW, y).stroke();
    y += 12;
    return y;
  };

  // Table Column configuration: Total = 525.28 pt
  const colW = [95, 235.28, 95, 100];
  const colX = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2]
  ];

  const headerH = 20;
  const rowH = 19;

  const drawTableHeader = (y) => {
    doc.rect(margin, y, printableW, headerH).fillAndStroke("#F3F4F6", "#1F2937");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");

    doc.text("CLASS / CODE NO", colX[0], y + 5, { width: colW[0], align: "center" });
    doc.text("REGISTER NO", colX[1], y + 5, { width: colW[1], align: "center" });
    doc.text("CANDIDATE NO", colX[2], y + 5, { width: colW[2], align: "center" });
    doc.text("TOTAL CANDIDATE NO", colX[3], y + 5, { width: colW[3], align: "center" });

    for (let c = 1; c < colX.length; c++) {
      doc.moveTo(colX[c], y).lineTo(colX[c], y + headerH).stroke("#1F2937");
    }

    return y + headerH;
  };

  let currentY = drawMainHeader();

  data.result.forEach((hall) => {
    const classCount = (hall.classes && hall.classes.length) || 0;
    const hallTitleH = 20;
    const tableBodyH = classCount * rowH;
    const totalHallH = hallTitleH + headerH + tableBodyH + 16;

    // Check if entire hall fits on current page
    if (currentY + totalHallH > safeBottom) {
      doc.addPage();
      currentY = drawCompactHeader();
    }

    // Hall Title Header Banner
    doc.rect(margin, currentY, printableW, hallTitleH).fillAndStroke("#E0E7FF", "#4F46E5");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#312E81")
       .text(`HALL NO. ${hall.hallName}`, margin + 8, currentY + 5, { width: printableW - 16, align: "left" });
    currentY += hallTitleH;

    // Table Header
    currentY = drawTableHeader(currentY);
    const tableStartY = currentY;

    // Class rows
    hall.classes.forEach((c) => {
      doc.rect(margin, currentY, printableW, rowH).stroke("#4B5563");

      doc.moveTo(colX[1], currentY).lineTo(colX[1], currentY + rowH).stroke("#4B5563");
      doc.moveTo(colX[2], currentY).lineTo(colX[2], currentY + rowH).stroke("#4B5563");
      doc.moveTo(colX[3], currentY).lineTo(colX[3], currentY + rowH).stroke("#4B5563");

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
      doc.text(c.classCode || "", colX[0], currentY + 5, { width: colW[0], align: "center" });

      doc.font("Helvetica").fontSize(9).fillColor("#111827");
      doc.text(c.summarizedRange || "", colX[1], currentY + 5, { width: colW[1], align: "center" });

      doc.font("Helvetica").fontSize(9).fillColor("#111827");
      doc.text(String(c.count || ""), colX[2], currentY + 5, { width: colW[2], align: "center" });

      currentY += rowH;
    });

    // Vertically merged TOTAL CANDIDATE NO in Col 3
    if (classCount > 0) {
      doc.rect(colX[3] + 0.5, tableStartY + 0.5, colW[3] - 1, tableBodyH - 1).fill("#FFFFFF");
      doc.rect(colX[3], tableStartY, colW[3], tableBodyH).stroke("#4B5563");

      const textY = tableStartY + (tableBodyH / 2) - 5;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827")
         .text(String(hall.totalStudents || ""), colX[3], textY, { width: colW[3], align: "center" });
    }

    currentY += 16;
  });

  // Footer: Page Numbers on all pages
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.lineWidth(0.5).strokeColor("#9CA3AF")
       .moveTo(margin, pageH - 32).lineTo(margin + printableW, pageH - 32).stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
    doc.text("ExamFlow | Exam Location Summary Report", margin, pageH - 24, { width: 250, align: "left" });
    doc.text(`Page ${i + 1} of ${pages.count}`, margin + printableW - 150, pageH - 24, { width: 150, align: "right" });
  }

  doc.end();
}

// GET seating summary (locations) for all halls on a date and session
app.get("/api/seating/locations-by-date-session", async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    res.json({
      date: data.targetDate,
      session: data.session,
      locations: data.result
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export exam locations seating summary as styled PDF file (.pdf)
app.get(["/api/seating/download-locations-pdf", "/api/seating/locations/download-pdf"], async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({
      size: "A4",
      margin: 35,
      bufferPages: true
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Exam_Locations_${data.formattedDate}.pdf"`);
      res.send(pdfData);
    });

    generateExamLocationsPdf(doc, data);

  } catch (error) {
    console.error("Error generating locations PDF:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET export exam locations seating summary as styled Excel file (.xlsx)
app.get("/api/seating/download-locations", async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    let { targetDate, formattedDate, result } = data;

// Dynamic import of xlsx-js-style with fallback to xlsx
    let XLSXLib;
    try {
      XLSXLib = require('xlsx-js-style');
    } catch (e) {
      XLSXLib = require('xlsx');
    }

    const wb = XLSXLib.utils.book_new();
    const ws = {};

    const borderStyle = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } }
    };

    const writeCell = (r, c, val, bold = false, align = 'left', fontSize = 11, border = false, isHeader = false) => {
      const cellRef = XLSXLib.utils.encode_cell({ r, c });
      ws[cellRef] = {
        v: val,
        t: typeof val === 'number' ? 'n' : 's',
        s: {
          font: {
            name: 'Times New Roman',
            size: fontSize,
            bold: bold
          },
          alignment: {
            horizontal: align,
            vertical: 'center',
            wrapText: true
          }
        }
      };

      if (border) {
        ws[cellRef].s.border = borderStyle;
      }

      if (isHeader) {
        ws[cellRef].s.fill = {
          patternType: 'solid',
          fgColor: { rgb: 'EAEAEA' }
        };
      }
    };

    // Format headers
    if (!formattedDate) {
      formattedDate = targetDate;
      try {
        const d = new Date(targetDate);
        if (!isNaN(d.getTime())) {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          formattedDate = `${dd}-${mm}-${yyyy}`;
        }
      } catch (err) {}
    }

    const monthYear = getMonthYearString(targetDate);
    const sessionText = session === 'FN' ? 'F.N' : 'A.N';
    const dateSessionHeader = `${formattedDate} / ${sessionText}`;

    // Header Rows
    writeCell(0, 0, 'MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', true, 'center', 14);
    writeCell(1, 0, monthYear, true, 'center', 12);
    writeCell(3, 0, dateSessionHeader, true, 'center', 11);

    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } }
    ];

    let currentRow = 5;

    result.forEach(hall => {
      const hallTitle = `HALL NO. ${hall.hallName}`;

      // Write Hall Title Row
      writeCell(currentRow, 0, hallTitle, true, 'left', 11);
      merges.push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: 3 } });
      currentRow++;

      // Write Table Headers
      writeCell(currentRow, 0, 'CLASS/ CODE NO', true, 'center', 10, true, true);
      writeCell(currentRow, 1, 'REGISTER NO', true, 'center', 10, true, true);
      writeCell(currentRow, 2, 'CANDIDATE NO', true, 'center', 10, true, true);
      writeCell(currentRow, 3, 'TOTAL CANDIDATE NO', true, 'center', 10, true, true);
      currentRow++;

      const tableStartRow = currentRow;

      // Write Class Seating details
      hall.classes.forEach(c => {
        writeCell(currentRow, 0, c.classCode, true, 'center', 10, true);
        
        const summarizedRange = summarizeRegisterNumbers(c.regNos);
        writeCell(currentRow, 1, summarizedRange, false, 'center', 10, true);
        
        writeCell(currentRow, 2, c.count, false, 'center', 10, true);
        writeCell(currentRow, 3, '', false, 'center', 10, true);
        currentRow++;
      });

      const tableEndRow = currentRow - 1;

      // Write total candidates and merge the cell vertically
      writeCell(tableStartRow, 3, hall.totalStudents, true, 'center', 11, true);
      if (tableEndRow > tableStartRow) {
        merges.push({ s: { r: tableStartRow, c: 3 }, e: { r: tableEndRow, c: 3 } });
      }

      // Add blank spacing row after hall table
      currentRow++;
    });

    finalizeWorksheet(XLSXLib, ws, merges);

    // Set column widths
    ws['!cols'] = [
      { wch: 18 }, // CLASS/ CODE NO
      { wch: 48 }, // REGISTER NO
      { wch: 16 }, // CANDIDATE NO
      { wch: 20 }  // TOTAL CANDIDATE NO
    ];

    // Set row heights
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 24 };
    ws['!rows'][1] = { hpt: 20 };
    ws['!rows'][3] = { hpt: 20 };

    XLSXLib.utils.book_append_sheet(wb, ws, 'Exam Locations');

    const buf = XLSXLib.write(wb, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Disposition', `attachment; filename="Exam_Locations_${formattedDate}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// POST to generate seating plans for all exams scheduled for a specific date, session, and hall
app.post('/api/seating/generate-by-date-session', async (req, res) => {
  try {
    const { date, session, hallId, seatsPerBench } = req.body;
    if (!date || !session || !hallId) {
      return res.status(400).json({ error: 'date, session, and hallId are required.' });
    }

    const hall = await resolveHall(hallId);
    const hallIdMatches = new Set();
    if (hallId) hallIdMatches.add(String(hallId));
    if (hall) {
      hallIdMatches.add(String(hall._id));
      if (hall.name) hallIdMatches.add(hall.name);
    }

    const allExams = await Models.Exam.find();
    const targetDate = date.split('T')[0];
    // Find exams on that day & session that have this hall assigned (matching by ID or Name)
    const examsAtTime = allExams.filter(e => 
      e.date.split('T')[0] === targetDate && e.session === session &&
      (e.assignedHalls && e.assignedHalls.some(h => hallIdMatches.has(String(h))))
    );

    if (examsAtTime.length === 0) {
      return res.status(400).json({ error: 'No exams are scheduled for this date, session, and hall.' });
    }

    // Optionally update seatsPerBench for exams if specified
    if (seatsPerBench) {
      const spbNum = parseInt(seatsPerBench) || 2;
      for (const exam of examsAtTime) {
        exam.seatsPerBench = spbNum;
        await Models.Exam.findByIdAndUpdate(exam._id, { seatsPerBench: spbNum });
      }
    }

    // Generate plans sequentially
    const generatedPlans = [];
    for (const exam of examsAtTime) {
      const plan = await generateSeatingPlan(exam._id, hall ? hall._id : hallId);
      if (plan) generatedPlans.push(plan);
    }

    // Fetch newly generated merged plan
    const allPlans = await Models.SeatingPlan.find();
    const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
    const matchedFromDb = allPlans.filter(p => 
      examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
    );
    const plansForHall = generatedPlans.length > 0 ? generatedPlans : matchedFromDb;

    const allExamSubCodesGen = [];
    examsAtTime.forEach(e => {
      if (e.subjectCodes) {
        e.subjectCodes.forEach(sc => {
          if (!allExamSubCodesGen.includes(sc)) allExamSubCodesGen.push(sc);
        });
      }
    });

    const mergedPlan = {
      date,
      session,
      hallId,
      hallName: plansForHall.length > 0 ? plansForHall[0].hallName : (hall ? hall.name : ''),
      totalBenches: plansForHall.length > 0 ? plansForHall[0].totalBenches : (hall ? hall.benches : 0),
      subjectCodes: allExamSubCodesGen,
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

    // Reconstruct attendanceRoster, totalStudents and emptySeats directly from merged seatingGrid
    const rosterFromGridGen = [];
    let emptyCountGen = 0;
    if (mergedPlan.seatingGrid) {
      mergedPlan.seatingGrid.forEach(bench => {
        if (bench.isPlaceholder) return;
        if (bench.seat1) {
          rosterFromGridGen.push({
            registerNo: bench.seat1.registerNo,
            name: bench.seat1.name || '',
            department: bench.seat1.department || '',
            subjectCode: getMatchingSubCodeForStudent(bench.seat1, allExamSubCodesGen),
            bench: bench.benchCode,
            seat: 'Left'
          });
        } else {
          emptyCountGen++;
        }

        if (bench.seat2) {
          rosterFromGridGen.push({
            registerNo: bench.seat2.registerNo,
            name: bench.seat2.name || '',
            department: bench.seat2.department || '',
            subjectCode: getMatchingSubCodeForStudent(bench.seat2, allExamSubCodesGen),
            bench: bench.benchCode,
            seat: bench.seat3 !== undefined ? 'Middle' : 'Right'
          });
        } else {
          emptyCountGen++;
        }

        if (bench.seat3 !== undefined) {
          if (bench.seat3) {
            rosterFromGridGen.push({
              registerNo: bench.seat3.registerNo,
              name: bench.seat3.name || '',
              department: bench.seat3.department || '',
              subjectCode: getMatchingSubCodeForStudent(bench.seat3, allExamSubCodesGen),
              bench: bench.benchCode,
              seat: 'Right'
            });
          } else {
            emptyCountGen++;
          }
        }
      });
    }

    mergedPlan.attendanceRoster = sortAttendanceRoster(rosterFromGridGen, allExamSubCodesGen);
    mergedPlan.totalStudents = mergedPlan.attendanceRoster.length;
    mergedPlan.emptySeats = Math.max(0, emptyCountGen);
    mergedPlan.totalBenches = mergedPlan.seatingGrid ? mergedPlan.seatingGrid.filter(b => !b.isPlaceholder).length : (plansForHall.length > 0 ? plansForHall[0].totalBenches : (hall ? hall.benches : 0));

    const unseatedMap = new Map();
    plansForHall.forEach(p => {
      if (p.unseatedStudents) {
        p.unseatedStudents.forEach(s => {
          unseatedMap.set(s.registerNo, s);
        });
      }
    });
    
    const allPlansForExams = allPlans.filter(p => examIdsSet.has(String(p.examId)));
    allPlansForExams.forEach(p => {
      if (p.attendanceRoster) {
        p.attendanceRoster.forEach(s => {
          unseatedMap.delete(s.registerNo);
        });
      }
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

// Auto-seed default admin user if no users exist or update existing admin
async function ensureAdminUser() {
  try {
    const existingUsers = await Models.User.find();
    const adminUser = existingUsers.find(u => u.username && u.username.toLowerCase() === 'admin');
    const hashedPassword = hashPassword('admin');
    if (!adminUser) {
      await Models.User.create({
        username: 'admin',
        email: 'admin@examflow.com',
        password: hashedPassword
      });
      console.log('Default Admin user initialized (Username: admin, Password: admin)');
    }
  } catch (err) {
    console.error('Error seeding admin user:', err);
  }
}

// Auto-repair & normalize student departments (e.g. derive CA, CS, CHE, COM, PHY, MAT from register numbers if missing or GENERAL)
async function normalizeStudentDepartments() {
  try {
    const students = await Models.Student.find();
    let updatedCount = 0;
    for (const student of students) {
      const currentDept = (student.department || '').trim().toUpperCase();
      if (!currentDept || currentDept === 'GENERAL' || currentDept === 'UNKNOWN' || currentDept.length > 25) {
        const derivedDept = formatClassCode('', '', student.registerNo);
        if (derivedDept && derivedDept !== 'GENERAL' && derivedDept !== currentDept) {
          student.department = derivedDept;
          await Models.Student.findByIdAndUpdate(student._id, { department: derivedDept });
          updatedCount++;
        }
      }
    }
    if (updatedCount > 0) {
      console.log(`[Data Normalization] Successfully updated departments for ${updatedCount} student records.`);
    }
  } catch (err) {
    console.error('Error normalizing student departments:', err);
  }
}

// Start Server
const server = app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`ExamFlow Backend Server running on port ${PORT}`);
  console.log(`Database connected successfully`);
  console.log(`==================================================\n`);
  await ensureAdminUser();
  await normalizeStudentDepartments();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Check if the running server is already an active ExamFlow backend instance
    const http = require('http');
    const checkReq = http.get(`http://127.0.0.1:${PORT}/api/status`, (checkRes) => {
      let data = '';
      checkRes.on('data', chunk => { data += chunk; });
      checkRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed.connected !== 'undefined') {
            console.log(`\n==================================================`);
            console.log(`ExamFlow Backend is ALREADY running and healthy on port ${PORT} (Mode: ${parsed.mode || 'Active'}).`);
            console.log(`Exactly one ExamFlow backend server is active and serving requests.`);
            console.log(`No action required. (To restart, stop the existing process first).`);
            console.log(`==================================================\n`);
            process.exit(0);
          }
        } catch (e) {}
        console.error(`\n==================================================`);
        console.error(`ERROR: Port ${PORT} is in use by another application or process.`);
        console.error(`Please stop the existing process on port ${PORT} before running npm start.`);
        console.error(`==================================================\n`);
        process.exit(1);
      });
    });
    checkReq.on('error', () => {
      console.error(`\n==================================================`);
      console.error(`ERROR: Port ${PORT} is already in use by another process.`);
      console.error(`Please stop the existing process on port ${PORT} before running npm start.`);
      console.error(`==================================================\n`);
      process.exit(1);
    });
    checkReq.setTimeout(2000, () => {
      checkReq.destroy();
      console.error(`\n==================================================`);
      console.error(`ERROR: Port ${PORT} is already in use by another process.`);
      console.error(`Please stop the existing process on port ${PORT} before running npm start.`);
      console.error(`==================================================\n`);
      process.exit(1);
    });
  } else {
    console.error('Server startup error:', err);
    process.exit(1);
  }
});

const gracefulShutdown = () => {
  console.log('\n[ExamFlow Backend] Shutting down gracefully...');
  server.close(() => {
    console.log('[ExamFlow Backend] Server closed successfully.');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(0);
  }, 2000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
