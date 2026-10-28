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

const { Models, dbStatus, initMysql } = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'examflow_jwt_secret_salt_2026_secure';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Token generation and verification helpers
const generateAuthToken = (user) => {
  const payload = {
    userId: user._id,
    username: user.username,
    email: user.email,
    role: user.role || 'Administrator',
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
};

const verifyAuthToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Authentication token required.' });
  }
  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
  req.user = user;
  next();
};

// HELPER: Hash Password
const hashPassword = (password) => {
  const salt = process.env.AUTH_SECRET || 'examflow_secret_salt_123';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
};

// HELPER: Get local YYYY-MM-DD date string avoiding timezone off-by-one errors
const getLocalDateString = (date = new Date()) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Set up Multer for CSV/Excel uploads (using memory storage with strict extension & type verification)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel (.xlsx, .xls) files are supported.'));
    }
  }
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
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rawRows || rawRows.length === 0) continue;

      const cleanLines = rawRows.map(row => {
        return row.map(cell => {
          let s = cell === null || cell === undefined ? '' : String(cell).replace(/[\r\n]+/g, ' ').trim();
          if (s.includes(',') || s.includes('"')) {
            s = `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        }).join(',');
      }).filter(line => line.replace(/,/g, '').trim().length > 0);

      if (cleanLines.length > maxDataRows) {
        maxDataRows = cleanLines.length;
        bestCsv = cleanLines.join('\n');
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
  let deptIndex = headers.findIndex(h => /dept|depart|branch|course|degree|prog/i.test(h));
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

      // If department is missing, GENERAL, or UNKNOWN, derive from Register No prefix or csvData
      if (!department || department.toUpperCase() === 'GENERAL' || department.toUpperCase() === 'UNKNOWN') {
        department = formatClassCode('', '', registerNo, { csvData, registerNo });
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
  // Exclude pure numbers: serial numbers (SNo), counts, roll numbers
  if (/^\d+$/.test(trimmed)) return false;
  // Alphanumeric with optional hyphens/underscores/slashes
  if (!/^[A-Za-z0-9\-_/]+$/.test(trimmed)) return false;
  // Exclude common long non-code words
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length > 12) return false;
  return true;
}

// Helper: check if a string matches subject code format
const isSubjectCodePattern = (str, sub = '') => {
  if (!str) return false;
  const upper = String(str).trim().toUpperCase();
  if (sub && upper === String(sub).trim().toUpperCase()) return true;
  if (/^[A-Z0-9\-_/]{4,15}$/i.test(upper) && (/\d/.test(upper) || upper.length >= 6)) {
    const knownDepts = ['BBA', 'BCA', 'BCOM', 'BSC', 'BA', 'MA', 'MSC', 'MCOM', 'MATHS', 'PHYSICS', 'CHEMISTRY', 'ENGLISH', 'TAMIL', 'COMMERCE', 'COMPUTER SCIENCE', 'CS', 'IT', 'ENG', 'MAT', 'PHY', 'COM', 'CHE', 'BIO', 'BOT', 'ZOO', 'ECO', 'HIS'];
    if (!knownDepts.includes(upper)) {
      return true;
    }
  }
  return false;
};

// Normalize department names, removing dots and mapping aliases cleanly
function normalizeDepartmentName(raw) {
  if (!raw) return 'GENERAL';
  let str = String(raw).trim();
  const dotCleaned = str.replace(/\./g, '').trim().toUpperCase();

  const knownMap = {
    'BBA': 'BBA',
    'BA': 'BA',
    'BCOM': 'BCOM',
    'BSC': 'BSC',
    'BCA': 'BCA',
    'MSC': 'MSC',
    'MCOM': 'MCOM',
    'MA': 'MA',
    'CS': 'CS',
    'CA': 'CA',
    'IT': 'IT',
    'MATHS': 'MATHS',
    'MATHEMATICS': 'MATHS',
    'PHYSICS': 'PHYSICS',
    'CHEMISTRY': 'CHEMISTRY',
    'ENGLISH': 'ENGLISH',
    'TAMIL': 'TAMIL',
    'COMMERCE': 'BCOM',
    'BUSINESS ADMINISTRATION': 'BBA',
    'COMPUTER SCIENCE': 'CS',
    'COMPUTER APPLICATIONS': 'CA'
  };

  if (knownMap[dotCleaned]) return knownMap[dotCleaned];

  if (/^[A-Z0-9\s\-_]{2,20}$/i.test(dotCleaned)) {
    return dotCleaned;
  }

  return str.toUpperCase();
}

// Robust helper to dynamically resolve a student's real academic Department
function resolveStudentDepartment(student, registerNo = '', fallbackDept = '') {
  const reg = String((student && student.registerNo) || registerNo || '').trim().toUpperCase();
  const rawDept = String((student && student.department) || fallbackDept || '').trim();

  const isInvalid = (d) => !d || ['GENERAL', 'UNKNOWN'].includes(d.toUpperCase()) || isSubjectCodePattern(d);

  // 1. Direct valid department on student
  if (!isInvalid(rawDept)) {
    return normalizeDepartmentName(rawDept);
  }

  // 2. Check student's csvData for Department, Branch, Course, Degree, Programme
  if (student && student.csvData && typeof student.csvData === 'object') {
    const keys = Object.keys(student.csvData);

    const deptKey = keys.find(k => /dept|depart|branch|course/i.test(k));
    if (deptKey && student.csvData[deptKey]) {
      const val = String(student.csvData[deptKey]).trim();
      if (!isInvalid(val)) {
        return normalizeDepartmentName(val);
      }
    }

    const degreeKey = keys.find(k => /degree|programme|prog/i.test(k));
    if (degreeKey && student.csvData[degreeKey]) {
      const val = String(student.csvData[degreeKey]).trim();
      if (!isInvalid(val)) {
        return normalizeDepartmentName(val);
      }
    }
  }

  // 3. Direct degree field
  if (student && student.degree && typeof student.degree === 'string' && student.degree.trim()) {
    const val = student.degree.trim();
    if (!isInvalid(val)) {
      return normalizeDepartmentName(val);
    }
  }

  // 4. Derive from Register Number patterns
  if (reg) {
    // MKU Single-letter Degree code pattern: C + digit + Letter + digits (e.g. C6B12118 -> BBA, C4A19160 -> BA, C4C17451 -> BCOM, C2S24926 -> BSC, C5E13851 -> MSC, C5T11601 -> MCOM/MA)
    const mkuMatch = reg.match(/^C\d([A-Z])\d+/);
    if (mkuMatch) {
      const code = mkuMatch[1];
      const mkuMap = {
        'B': 'BBA',
        'A': 'BA',
        'C': 'BCOM',
        'S': 'BSC',
        'E': 'MSC',
        'T': 'MCOM'
      };
      if (mkuMap[code]) return mkuMap[code];
    }

    // Pattern A: Leading 2-6 letters (e.g. CS26001 -> CS, CA26001 -> CA, BBA2401 -> BBA)
    const leadMatch = reg.match(/^([A-Z]{2,6})\d+/);
    if (leadMatch) return normalizeDepartmentName(leadMatch[1]);

    // Pattern B: Digits then 2-6 letters (e.g. 25BBA001 -> BBA, 24MAT001 -> MAT)
    const digLetMatch = reg.match(/^(?:\d{2,4}|[A-Z]\d|[A-Z]{2}\d)([A-Z]{2,6})/);
    if (digLetMatch) return normalizeDepartmentName(digLetMatch[1]);

    // Pattern C: Any 2-6 letters anywhere in reg
    const anyMatch = reg.match(/([A-Z]{2,6})/);
    if (anyMatch) return normalizeDepartmentName(anyMatch[1]);
  }

  return rawDept && !isInvalid(rawDept) ? normalizeDepartmentName(rawDept) : 'GENERAL';
}

// Helper: Clean class code so that raw subject codes or GENERAL in department aren't shown, returning clean Department/Class name
function formatClassCode(department, subjectCode, registerNo = '', student = null) {
  let dept = (department || '').trim().toUpperCase();
  const sub = (subjectCode || '').trim().toUpperCase();
  const reg = (registerNo || '').trim().toUpperCase();

  const resolved = resolveStudentDepartment(student, reg, dept);
  if (resolved && resolved !== 'GENERAL') {
    return resolved;
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
  if (student && student.degree && typeof student.degree === 'string' && student.degree.trim()) {
    return student.degree.trim();
  }

  if (student && student.csvData && typeof student.csvData === 'object') {
    const keys = Object.keys(student.csvData);
    const degreeKey = keys.find(k => /degree|programme|prog/i.test(k));
    if (degreeKey && student.csvData[degreeKey] && String(student.csvData[degreeKey]).trim()) {
      return String(student.csvData[degreeKey]).trim();
    }
  }

  const dept = (student && student.department) || defaultDept || '';
  return expandDegreeCode(dept, (student && student.registerNo) || '');
}

function expandDegreeCode(deptOrCode, regNo = '') {
  let code = (deptOrCode || '').trim();
  if (!code || code === 'GENERAL' || code === 'UNKNOWN') {
    code = resolveStudentDepartment(null, regNo, '');
  }

  const u = code.replace(/\./g, '').trim().toUpperCase();

  const degreeMap = {
    'BBA': 'B.B.A.',
    'BA': 'B.A.',
    'BCOM': 'B.Com.',
    'BSC': 'B.Sc.',
    'BCA': 'B.C.A.',
    'MSC': 'M.Sc.',
    'MCOM': 'M.Com.',
    'MA': 'M.A.',
    'CA': 'B.Sc. Computer Applications',
    'CS': 'B.Sc. Computer Science',
    'BSC CS': 'B.Sc. Computer Science',
    'BSC CA': 'B.Sc. Computer Applications',
    'COM': 'B.Com.',
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

// Robust helper to dynamically resolve academic level ('UG' or 'PG')
function getAcademicLevel(student, deptName = '', degreeName = '', subCode = '') {
  const deg = String(degreeName || (student && student.degree) || (student && student.csvData && (student.csvData.Degree || student.csvData.degree || student.csvData.Programme || student.csvData.programme)) || '').trim().toUpperCase();
  const dept = String(deptName || (student && student.department) || '').trim().toUpperCase();
  const reg = String((student && student.registerNo) || '').trim().toUpperCase();
  const sc = String(subCode || (student && student.subjectCode) || '').trim().toUpperCase();

  // 1. Direct Degree check (e.g. M.Sc, M.Com, M.A, Master, B.Sc, B.Com, B.A, Bachelor)
  if (/^M\.|\bMASTER\b|\bPOST\s*GRAD|\bPG\b|^M[A-Z]{1,4}\b/i.test(deg)) return 'PG';
  if (/^B\.|\bBACHELOR\b|\bUNDER\s*GRAD|\bUG\b|^B[A-Z]{1,4}\b/i.test(deg)) return 'UG';

  // 2. Department code / name check
  if (/^(MSC|MCOM|MA|MBA|MCA|MSW|MPHIL|MTECH|ME)\b/i.test(dept)) return 'PG';
  if (/^(BSC|BCOM|BA|BBA|BCA|BTECH|BE)\b/i.test(dept)) return 'UG';
  if (/^M\./i.test(dept) || /\(PG\)/i.test(dept) || /POST\s*GRAD/i.test(dept)) return 'PG';
  if (/^B\./i.test(dept) || /\(UG\)/i.test(dept) || /UNDER\s*GRAD/i.test(dept)) return 'UG';

  // 3. Register Number MKU pattern check (E -> MSC, T -> MCOM/MA vs A, B, C, S)
  const mkuMatch = reg.match(/^C\d([A-Z])\d+/);
  if (mkuMatch) {
    if (['E', 'T'].includes(mkuMatch[1])) return 'PG';
    if (['B', 'A', 'C', 'S'].includes(mkuMatch[1])) return 'UG';
  }

  // 4. Subject code pattern (U... -> UG, P... -> PG, digits starting with 5/6/7 -> PG, 1/2/3/4 -> UG)
  if (/^U[A-Z0-9]/i.test(sc)) return 'UG';
  if (/^P[A-Z0-9]/i.test(sc)) return 'PG';
  if (/\b[A-Z0-9]*(PC|PE)\d+/i.test(sc)) return 'PG';
  const subDigits = sc.match(/\d+/);
  if (subDigits && ['5', '6', '7'].includes(subDigits[0][0])) return 'PG';
  if (subDigits && ['1', '2', '3', '4'].includes(subDigits[0][0])) return 'UG';

  // Default to UG
  return 'UG';
}


// Global cached detected subject code column
let globalDetectedSubCodeCol = 'Subjects Appearing';

/**
 * Dynamically detect the column key in student records (csvData) that contains multiple space-separated Subject Codes.
 * Scans every column across student records without relying on fixed column names like "Subjects Appearing".
 * Finds column whose cells contain multiple values separated by spaces.
 * If multiple columns contain subject-code-like values, uses the column with highest number of valid subject codes.
 */
function detectSubjectCodeColumn(students) {
  if (!Array.isArray(students) || students.length === 0) {
    return globalDetectedSubCodeCol || 'Subjects Appearing';
  }

  const columnKeys = new Set();
  students.forEach(s => {
    if (s && s.csvData && typeof s.csvData === 'object') {
      Object.keys(s.csvData).forEach(k => columnKeys.add(k));
    }
  });

  if (columnKeys.size === 0) return globalDetectedSubCodeCol || 'Subjects Appearing';

  let bestColumn = null;
  let maxValidCodesCount = 0;
  let maxMultiValueCellCount = 0;

  columnKeys.forEach(colKey => {
    // Ignore pure student metadata columns
    if (/^(sno|sl|s_no|id|sex|gender|dob|community|comm|fee|phone|mobile|email|name|student_name|regno|reg_no|rollno|roll_no)$/i.test(colKey.trim())) {
      return;
    }

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

  if (bestColumn) {
    globalDetectedSubCodeCol = bestColumn;
  }
  return bestColumn || globalDetectedSubCodeCol || 'Subjects Appearing';
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
    let colKey = targetColumnKey || globalDetectedSubCodeCol;

    if (!colKey) {
      const keys = Object.keys(student.csvData);
      colKey = keys.find(k => /subjects?\s*appearing|sub.*code|courses?/i.test(k));
      if (!colKey) {
        colKey = detectSubjectCodeColumn([student]);
      }
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
    // scan all keys in csvData for valid subject code values, ignoring metadata columns (SNo, RegNo, Sex, etc.)
    if (codes.length === 0) {
      Object.keys(student.csvData).forEach(k => {
        if (/^(sno|sl|s_no|id|sex|gender|dob|community|comm|fee|phone|mobile|email|name|student_name|regno|reg_no|rollno|roll_no)$/i.test(k.trim())) {
          return;
        }
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

  // Also include student.subjectCode if present and valid
  if (student.subjectCode && isValidSubjectCodeToken(student.subjectCode)) {
    codes.push(String(student.subjectCode).trim().toUpperCase());
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
// Helper: System logs for dashboard recent activities (persisted in data/activities.json)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
let recentActivities = [];

try {
  if (fs.existsSync(ACTIVITIES_FILE)) {
    const rawActs = fs.readFileSync(ACTIVITIES_FILE, 'utf8');
    const parsedActs = JSON.parse(rawActs || '[]');
    if (Array.isArray(parsedActs)) {
      recentActivities = parsedActs;
    }
  }
} catch (e) {}

const logActivity = (type, message, detail) => {
  const newActivity = {
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    message,
    detail,
    time: new Date()
  };
  recentActivities.unshift(newActivity);
  if (recentActivities.length > 30) recentActivities.pop();
  try {
    if (!fs.existsSync(path.dirname(ACTIVITIES_FILE))) {
      fs.mkdirSync(path.dirname(ACTIVITIES_FILE), { recursive: true });
    }
    fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(recentActivities, null, 2), 'utf8');
  } catch (err) {}
};

const getPrintoutCount = () => {
  const filePath = path.join(DATA_DIR, 'printouts.json');
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
  const filePath = path.join(DATA_DIR, 'printouts.json');
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

// 0.1 Check if first-time administrator setup is required
app.get('/api/auth/setup-status', async (req, res) => {
  try {
    const allUsers = await Models.User.find();
    res.json({ setupRequired: allUsers.length === 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check setup status: ' + err.message });
  }
});

// 0.2 First-time administrator creation endpoint (strictly allowed only when 0 users exist)
app.post('/api/auth/first-time-setup', async (req, res) => {
  try {
    const allUsers = await Models.User.find();
    if (allUsers.length > 0) {
      return res.status(403).json({ error: 'Administrator setup has already been completed. Please sign in.' });
    }

    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, Email, and Password are all required.' });
    }

    const trimmedUser = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedUser.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const hashedPassword = hashPassword(password);
    const newAdmin = await Models.User.create({
      username: trimmedUser,
      email: trimmedEmail,
      password: hashedPassword,
      role: 'Administrator'
    });

    const userPayload = {
      _id: newAdmin._id,
      username: newAdmin.username,
      email: newAdmin.email,
      role: 'Administrator'
    };

    const token = generateAuthToken(userPayload);
    const userWithToken = { ...userPayload, token };

    logActivity('user', 'Initial Administrator Created', `Administrator account '${newAdmin.username}' was configured.`);
    console.log(`[AUTH] First-time administrator setup completed for: ${newAdmin.username} (${newAdmin.email})`);
    res.status(201).json({ success: true, user: userWithToken, token });
  } catch (error) {
    console.error('[AUTH] First-time setup error:', error);
    res.status(500).json({ error: 'Setup server error: ' + error.message });
  }
});

// 0.3 Standard User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    console.log(`[AUTH] Login request received for user: '${emailOrUsername || 'empty'}'`);

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Username/Email and Password are required.' });
    }

    const inputTrimmed = emailOrUsername.trim();
    const inputLower = inputTrimmed.toLowerCase();

    // Check database users (MySQL or JSON fallback)
    const allUsers = await Models.User.find();
    let dbUser = allUsers.find(u => 
      (u.username && u.username.toLowerCase() === inputLower) || 
      (u.email && u.email.toLowerCase() === inputLower)
    );

    const hashedInput = hashPassword(password);
    let isAuthenticated = false;

    if (dbUser) {
      if (dbUser.password === hashedInput || dbUser.password === password) {
        isAuthenticated = true;
        // Auto-upgrade legacy plaintext passwords to secure hash
        if (dbUser.password === password && password !== hashedInput) {
          try {
            await Models.User.findByIdAndUpdate(dbUser._id, { password: hashedInput });
          } catch (upErr) {}
        }
      }
    }

    if (!isAuthenticated || !dbUser) {
      console.log(`[AUTH] Response status: 401 (Invalid credentials for '${inputLower}')`);
      return res.status(401).json({ error: 'Invalid username or password. Please try again.' });
    }

    const userPayload = {
      _id: dbUser._id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role || 'Administrator'
    };

    const token = generateAuthToken(userPayload);
    const userWithToken = { ...userPayload, token };

    console.log(`[AUTH] Response status: 200 OK (User authenticated: ${dbUser.username})`);
    logActivity('user', 'User Logged In', `${dbUser.username} logged into the system.`);
    res.json({ success: true, user: userWithToken, token });
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
    const dataDir = DATA_DIR;
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
      const backupsDir = path.join(DATA_DIR, 'backups');
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
app.post('/api/settings/restore', authenticateToken, async (req, res) => {
  let preRestoreSnapshot = null;
  try {
    const { students, halls, exams, seatingPlans } = req.body;
    
    if (!Array.isArray(students) || !Array.isArray(halls) || !Array.isArray(exams) || !Array.isArray(seatingPlans)) {
      return res.status(400).json({ error: 'Invalid backup format. Must contain students, halls, exams, and seatingPlans arrays.' });
    }

    // 1. Create emergency safety snapshot of current data before modifying anything
    try {
      preRestoreSnapshot = {
        timestamp: new Date().toISOString(),
        students: await Models.Student.find(),
        halls: await Models.Hall.find(),
        exams: await Models.Exam.find(),
        seatingPlans: await Models.SeatingPlan.find()
      };
      const backupsDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      fs.writeFileSync(path.join(backupsDir, `pre_restore_safety_${Date.now()}.json`), JSON.stringify(preRestoreSnapshot, null, 2));
    } catch (snapErr) {
      console.warn('[Safety Backup Warning] Failed to write safety snapshot to disk:', snapErr.message);
    }
    
    // 2. Clear existing collections
    await Models.Student.deleteMany({});
    await Models.Hall.deleteMany({});
    await Models.Exam.deleteMany({});
    await Models.SeatingPlan.deleteMany({});
    
    // 3. Restore data from validated backup payload
    if (students.length > 0) await Models.Student.create(students);
    if (halls.length > 0) await Models.Hall.create(halls);
    if (exams.length > 0) await Models.Exam.create(exams);
    if (seatingPlans.length > 0) await Models.SeatingPlan.create(seatingPlans);
    
    logActivity('database', 'Database Restored', `Restored ${students.length} students, ${halls.length} halls, ${exams.length} exams, and ${seatingPlans.length} seating plans from backup.`);
    
    res.json({ success: true, message: 'Database restored successfully!' });
  } catch (error) {
    console.error("Restore failed:", error);
    // 4. Automatic Rollback if preRestoreSnapshot was saved
    if (preRestoreSnapshot) {
      try {
        console.warn('[EMERGENCY ROLLBACK] Restoring previous database state after failed restore...');
        await Models.Student.deleteMany({});
        await Models.Hall.deleteMany({});
        await Models.Exam.deleteMany({});
        await Models.SeatingPlan.deleteMany({});
        if (preRestoreSnapshot.students.length > 0) await Models.Student.create(preRestoreSnapshot.students);
        if (preRestoreSnapshot.halls.length > 0) await Models.Hall.create(preRestoreSnapshot.halls);
        if (preRestoreSnapshot.exams.length > 0) await Models.Exam.create(preRestoreSnapshot.exams);
        if (preRestoreSnapshot.seatingPlans.length > 0) await Models.SeatingPlan.create(preRestoreSnapshot.seatingPlans);
        console.log('[EMERGENCY ROLLBACK] Rollback completed successfully.');
      } catch (rollbackErr) {
        console.error('[CRITICAL] Rollback failed:', rollbackErr);
      }
    }
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
    
    // Degree & Department distribution
    const students = await Models.Student.find();
    const degreeMap = {};
    students.forEach(s => {
      let d = resolveStudentDegree(s, s.department);
      if (!d || d === 'GENERAL' || d === 'UNKNOWN') {
        if (s.csvData && typeof s.csvData === 'object') {
          const keys = Object.keys(s.csvData);
          const degKey = keys.find(k => /degree|programme|prog/i.test(k));
          if (degKey && s.csvData[degKey]) {
            d = String(s.csvData[degKey]).trim();
          }
        }
      }
      if (!d || d === 'GENERAL' || d === 'UNKNOWN') {
        d = (s.department && s.department !== 'GENERAL') ? s.department : 'GENERAL';
      }
      degreeMap[d] = (degreeMap[d] || 0) + 1;
    });

    const totalCount = students.length;
    const departmentDistribution = Object.keys(degreeMap).map(deg => ({
      department: deg,
      degree: deg,
      count: degreeMap[deg],
      percentage: totalCount > 0 ? Math.round((degreeMap[deg] / totalCount) * 100) : 0
    })).sort((a, b) => b.count - a.count);

    // Get all seating plans to compute seat usage per hall with fast Map index
    const allPlans = await Models.SeatingPlan.find();
    const plansByHall = new Map();
    allPlans.forEach(p => {
      if (p.hallId) {
        const k = String(p.hallId);
        if (!plansByHall.has(k)) plansByHall.set(k, []);
        plansByHall.get(k).push(p);
      }
      if (p.hallName) {
        if (!plansByHall.has(p.hallName)) plansByHall.set(p.hallName, []);
        plansByHall.get(p.hallName).push(p);
      }
    });

    const hallsData = allHalls.map(hall => {
      const plansForHall = plansByHall.get(String(hall._id)) || plansByHall.get(hall.name) || [];
      
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
      departmentsCount: Object.keys(degreeMap).length,
      degreesCount: Object.keys(degreeMap).length,
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

app.post('/api/dashboard/activities', (req, res) => {
  try {
    const { type = 'system', title = 'System Activity', text = '' } = req.body || {};
    logActivity(type, title, text);
    res.json({ success: true, activities: recentActivities });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// Dynamic helper to provide realistic column/row layout for any given bench count
function getDefaultLayoutForBenches(benches) {
  const b = Math.max(1, parseInt(benches) || 1);
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(b))));
  const base = Math.floor(b / cols);
  const rem = b % cols;
  const colRows = Array(cols).fill(base);
  for (let i = 0; i < rem; i++) colRows[i]++;
  const rows = Math.max(...colRows, 1);
  return { rows, columns: cols, columnRows: colRows };
}



// Seed official halls disabled - System strictly uses user-uploaded data
app.post('/api/halls/seed-official', async (req, res) => {
  return res.status(400).json({ 
    error: 'Hardcoded hall seeding is disabled. Please upload your hall data via CSV or create halls dynamically in the UI.' 
  });
});

app.post('/api/halls', async (req, res) => {
  try {
    const { name, block, rows, columns, benches, seatsPerBench, columnRows, columnGaps, idx } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    const spb = parseInt(seatsPerBench) === 3 ? 3 : 2;
    let parsedColRows = Array.isArray(columnRows) && columnRows.length > 0
      ? columnRows.map(n => Math.max(1, parseInt(n) || 1))
      : [];
    let parsedCols = parsedColRows.length > 0 ? parsedColRows.length : (parseInt(columns) || 1);
    let parsedRows = parsedColRows.length > 0 ? Math.max(...parsedColRows) : (parseInt(rows) || 1);
    let parsedBenches = benches !== undefined && benches !== null
      ? parseInt(benches)
      : (parsedColRows.length > 0 ? parsedColRows.reduce((a, b) => a + b, 0) : (parsedRows * parsedCols));

    if ((!parsedRows || !parsedCols) && parsedBenches > 0) {
      const defLayout = getDefaultLayoutForBenches(parsedBenches);
      parsedRows = defLayout.rows;
      parsedCols = defLayout.columns;
      parsedColRows = defLayout.columnRows;
    }
    const capacity = parsedBenches * spb;
    
    const newHall = await Models.Hall.create({
      name,
      block: block || '',
      rows: parsedRows,
      columns: parsedCols,
      benches: parsedBenches,
      capacity,
      columnRows: parsedColRows,
      columnGaps: columnGaps || null,
      seatsPerBench: spb,
      idx: idx !== undefined ? idx : null
    });

    logActivity('hall', 'Hall Created', `${name} (${block || 'General'}) configured with ${capacity} seats (${parsedBenches} benches, ${spb} seats/bench).`);
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
    const { name, block, rows, columns, benches, capacity, columnRows, columnGaps, seatsPerBench, idx } = req.body;

    let existingHall = await Models.Hall.findById(req.params.id);
    if (!existingHall) {
      const allHalls = await Models.Hall.find();
      existingHall = allHalls.find(h => String(h._id) === String(req.params.id) || h.name === req.params.id);
    }
    if (!existingHall) {
      return res.status(404).json({ error: 'Hall not found.' });
    }

    const updatedName = name || existingHall.name;
    const updatedBlock = block !== undefined ? block : (existingHall.block || '');
    const parsedSpb = seatsPerBench !== undefined ? (parseInt(seatsPerBench) || 2) : (existingHall.seatsPerBench || 2);

    let parsedBenches = (benches !== undefined && benches !== null && !isNaN(parseInt(benches)) && parseInt(benches) > 0)
      ? parseInt(benches)
      : (capacity !== undefined && !isNaN(parseInt(capacity)) && parseInt(capacity) > 0 ? Math.round(parseInt(capacity) / parsedSpb) : (existingHall.benches || 0));

    let parsedCols = parseInt(columns) || existingHall.columns || 1;
    let parsedRows = parseInt(rows) || existingHall.rows || 1;

    if (parsedBenches <= 0) {
      parsedBenches = parsedRows * parsedCols;
    }

    let parsedColumnRows;
    if (Array.isArray(columnRows) && columnRows.length > 0 && columnRows.reduce((a, b) => a + b, 0) === parsedBenches) {
      parsedColumnRows = columnRows.map(n => Math.max(1, parseInt(n) || 1));
      parsedCols = parsedColumnRows.length;
      parsedRows = Math.max(...parsedColumnRows);
    } else {
      if (parsedCols <= 0) parsedCols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(parsedBenches))));
      const base = Math.floor(parsedBenches / parsedCols);
      const rem = parsedBenches % parsedCols;
      parsedColumnRows = Array(parsedCols).fill(base);
      for (let i = 0; i < rem; i++) parsedColumnRows[i]++;
      parsedRows = Math.max(...parsedColumnRows, 1);
    }

    const parsedCapacity = (capacity !== undefined && capacity !== null && !isNaN(parseInt(capacity)) && parseInt(capacity) > 0)
      ? parseInt(capacity)
      : (parsedBenches * parsedSpb);

    let updatedCsvData = existingHall.csvData ? { ...existingHall.csvData } : {};
    delete updatedCsvData.columnRows;
    delete updatedCsvData.columnrows;
    updatedCsvData['seatsPerBench'] = parsedSpb;
    Object.keys(updatedCsvData).forEach(key => {
      if (/2\*seat|2_seat|2seat/i.test(key)) {
        updatedCsvData[key] = parsedBenches * 2;
      } else if (/3\*seat|3_seat|3seat/i.test(key)) {
        updatedCsvData[key] = parsedBenches * 3;
      } else if (/capacity/i.test(key)) {
        updatedCsvData[key] = parsedCapacity;
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
      block: updatedBlock,
      rows: parsedRows,
      columns: parsedCols,
      benches: parsedBenches,
      capacity: parsedCapacity,
      columnRows: parsedColumnRows,
      columnGaps: columnGaps !== undefined ? columnGaps : (existingHall.columnGaps || null),
      seatsPerBench: parsedSpb,
      csvData: updatedCsvData,
      idx: idx !== undefined ? idx : existingHall.idx
    }, { new: true });

    // If hall was renamed, update string references in exams without touching snapshots or seating plans
    if (existingHall.name && existingHall.name !== updatedName) {
      try {
        const allExams = await Models.Exam.find();
        for (const ex of allExams) {
          if ((ex.assignedHalls || []).includes(existingHall.name)) {
            const updatedAssigned = ex.assignedHalls.map(h => h === existingHall.name ? updatedName : h);
            await Models.Exam.findByIdAndUpdate(ex._id, { assignedHalls: updatedAssigned });
          }
        }
      } catch (renameErr) {
        console.warn('[Hall Update] Error updating renamed hall reference:', renameErr.message);
      }
    }

    logActivity('hall', 'Hall Updated', `${updatedName} (${updatedBlock}) updated: ${parsedCapacity} seats (${parsedBenches} benches, ${parsedSpb} seats/bench).`);
    res.json(updated || { _id: existingHall._id || req.params.id, name: updatedName, block: updatedBlock, rows: parsedRows, columns: parsedCols, benches: parsedBenches, capacity: parsedCapacity, columnRows: parsedColumnRows, seatsPerBench: parsedSpb, columnGaps: columnGaps || null, csvData: updatedCsvData, idx: existingHall.idx });
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

    // 1. Robust Header Row Detection (scans top lines to skip college name, titles, metadata banners)
    let headerRowIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const parts = splitCsvLine(lines[i]).map(p => p.replace(/^["']|["']$/g, '').trim());
      const nonEmpty = parts.filter(Boolean);
      if (nonEmpty.length < 2) continue; // Skip single-cell title or banner rows

      const hasHallCol = parts.some(p => 
        /^(hall\s*(?:no|num|name)?|room\s*(?:no|num|name)?|class\s*room|h\s*no|hall|room)$/i.test(p) ||
        (/\b(hall|room|class\s*room)\b/i.test(p) && !/arrangements?|allotment|details?|list|master|college/i.test(p))
      );
      const hasBenchCol = parts.some(p => /bench|set/i.test(p));
      const hasCapCol = parts.some(p => /capacit|seat|strength/i.test(p));
      const hasBlockCol = parts.some(p => /block|building|floor/i.test(p));
      const hasSNoCol = parts.some(p => /s\.?\s*no|sl\.?\s*no|serial/i.test(p));
      const hasRowCol = parts.some(p => /^(row|col|rows|cols|columns)$/i.test(p));

      const matchCount = [hasHallCol, hasBenchCol, hasCapCol, hasBlockCol, hasSNoCol, hasRowCol].filter(Boolean).length;
      if (matchCount >= 2 || (hasHallCol && nonEmpty.length >= 2)) {
        headerRowIdx = i;
        headers = parts;
        break;
      }
    }

    let startIdx = 0;
    if (headerRowIdx !== -1) {
      startIdx = headerRowIdx + 1;
    } else {
      // Fallback: check if line 0 looks like a header or raw data
      const firstParts = splitCsvLine(lines[0]).map(p => p.replace(/^["']|["']$/g, '').trim());
      const hasHeader = firstParts.some(p => /hall|name|room|block|bench|seat|row|col/i.test(p));
      if (hasHeader) {
        headers = firstParts;
        startIdx = 1;
      } else {
        headers = ['Hall Name', 'Rows', 'Columns'];
        startIdx = 0;
      }
    }

    // Explicit detection preventing "Block" column from colliding with "Hall Name"
    const blockIdx = headers.findIndex(h => /block|building|floor/i.test(h) && !/hall|room|name/i.test(h));
    const nameIdx = headers.findIndex((h, idx) => idx !== blockIdx && /hall\s*(?:no|num|name)?|room\s*(?:no|num|name)?|class\s*room|h\s*no|^hall$|^room$/i.test(h));
    const benchesIdx = headers.findIndex(h => /bench|set/i.test(h) && !/seat|capacity|spb/i.test(h));
    const rowsIdx = headers.findIndex(h => /row/i.test(h) && !/seat|capacity|bench|set/i.test(h));
    const colsIdx = headers.findIndex(h => /col/i.test(h) && !/alloc|allot/i.test(h));
    const capacityIdx = headers.findIndex(h => /seat|capacity|strength/i.test(h) && !/bench|spb|set/i.test(h));
    const sNoIdx = headers.findIndex(h => /s\.?\s*no|sl\.?\s*no|serial/i.test(h));
    const spbIdx = headers.findIndex(h => /seats?[-_\s]*per[-_\s]*bench|bench[-_\s]*config|spb/i.test(h));

    const nameIndex = nameIdx !== -1 ? nameIdx : (blockIdx === 0 && headers.length > 1 ? 1 : 0);
    const defaultSeatsPerBench = parseInt(req.body.seatsPerBench) === 3 ? 3 : 2;
    const hallRecords = [];
    let currentBlock = '';

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = splitCsvLine(line).map(p => p.replace(/^["']|["']$/g, '').trim());
      if (parts.every(p => !p)) continue;

      const name = (parts[nameIndex] || '').trim();
      if (!name) continue;

      // Filter out total, summary, banners, college names, academic years, and repeated headers
      if (name.toUpperCase() === 'T' || /total|summary|grand\s*total|count/i.test(name)) continue;
      if (/college|university|institute|arrangements?|department\s*&|examination/i.test(name)) continue;
      if (/^\(?\s*\d{4}\s*[-–/]\s*\d{2,4}\s*\)?$/i.test(name)) continue;
      if (/^(s\.?\s*no|sl\.?\s*no|serial|hall\s*(?:no|num|name)?|room\s*(?:no|num|name)?|class\s*room|block|benches?|sets?|capacity|rows?|cols?)$/i.test(name)) continue;

      // Maintain forward-fill block name for merged Excel block cells
      if (blockIdx !== -1 && parts[blockIdx]) {
        currentBlock = parts[blockIdx].trim();
      }
      const blockName = currentBlock;

      let sNo = sNoIdx !== -1 && !isNaN(parseInt(parts[sNoIdx])) ? parseInt(parts[sNoIdx]) : (hallRecords.length + 1);

      let rowSpb = defaultSeatsPerBench;
      if (spbIdx !== -1 && parts[spbIdx]) {
        const p = parseInt(parts[spbIdx]);
        if (p === 2 || p === 3) rowSpb = p;
      }

      let benches = benchesIdx !== -1 && !isNaN(parseInt(parts[benchesIdx])) ? parseInt(parts[benchesIdx]) : NaN;
      let rows = rowsIdx !== -1 && !isNaN(parseInt(parts[rowsIdx])) ? parseInt(parts[rowsIdx]) : NaN;
      let columns = colsIdx !== -1 && !isNaN(parseInt(parts[colsIdx])) ? parseInt(parts[colsIdx]) : NaN;
      let capacity = capacityIdx !== -1 && !isNaN(parseInt(parts[capacityIdx])) ? parseInt(parts[capacityIdx]) : NaN;

      if (isNaN(benches) || benches <= 0) {
        if (!isNaN(rows) && !isNaN(columns) && rows > 0 && columns > 0) {
          benches = rows * columns;
        } else if (!isNaN(capacity) && capacity > 0) {
          benches = Math.round(capacity / rowSpb);
        } else {
          benches = 15;
        }
      }

      const layout = (!isNaN(rows) && !isNaN(columns) && rows > 0 && columns > 0)
        ? { rows, columns, columnRows: Array(columns).fill(rows) }
        : getDefaultLayoutForBenches(benches);

      const computedCap = !isNaN(capacity) && capacity > 0 ? capacity : benches * rowSpb;

      // Build csvData preserving all original CSV columns
      const csvData = {};
      headers.forEach((header, index) => {
        if (!/^column[_-]?rows?$/i.test((header || '').trim())) {
          csvData[header] = parts[index] || '';
        }
      });
      csvData['seatsPerBench'] = rowSpb;

      hallRecords.push({
        name,
        block: blockName,
        benches,
        rows: layout.rows,
        columns: layout.columns,
        columnRows: layout.columnRows,
        capacity: computedCap,
        seatsPerBench: rowSpb,
        csvData,
        idx: sNo
      });
    }

    if (hallRecords.length === 0) {
      throw new Error('No valid hall records found in CSV.');
    }

    let insertedCount = 0;
    for (const h of hallRecords) {
      await Models.Hall.create({
        name: h.name,
        block: h.block,
        rows: h.rows,
        columns: h.columns,
        benches: h.benches,
        capacity: h.capacity,
        columnRows: h.columnRows,
        seatsPerBench: h.seatsPerBench,
        csvData: h.csvData,
        idx: h.idx
      });
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

    // Fast indexed lookups
    const hallsByName = new Map();
    allHalls.forEach(h => {
      if (h.name) hallsByName.set(h.name, h);
      if (h._id) hallsByName.set(String(h._id), h);
    });

    const plansByExamId = new Map();
    plans.forEach(p => {
      const k = String(p.examId);
      if (!plansByExamId.has(k)) plansByExamId.set(k, []);
      plansByExamId.get(k).push(p);
    });

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
      const otherExamIds = new Set(examsAtTime.map(o => String(o._id)));
      
      // Seated student register numbers in OTHER exams at this time
      const seatedInOtherExams = new Set();
      plans.forEach(p => {
        if (otherExamIds.has(String(p.examId)) && p.attendanceRoster) {
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
      const examPlans = plansByExamId.get(String(e._id)) || [];
      let allocatedCount = 0;
      examPlans.forEach(p => {
        if (p.attendanceRoster) {
          allocatedCount += p.attendanceRoster.length;
        }
      });

      const remainingCount = Math.max(0, studentsCount - allocatedCount);

      // Build assigned halls details with vacant seats
      const assignedHallsDetails = (e.assignedHalls || []).map(hallName => {
        const plan = examPlans.find(p => p.hallId === hallName || p.hallName === hallName);
        const snap = e.hallSnapshots && (e.hallSnapshots[hallName] || e.hallSnapshots[String(hallName)]);
        const hallObj = hallsByName.get(hallName) || snap;
        
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
          const spb = (hallObj && hallObj.seatsPerBench) || (snap && snap.seatsPerBench) || e.seatsPerBench || 2;
          vacantSeats = hallObj ? ((hallObj.capacity && parseInt(hallObj.capacity) > 0) ? parseInt(hallObj.capacity) : getHallCapacityForSeatsPerBench(hallObj, spb)) : 0;
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

// GET all assigned subject codes across all exams (for real-time availability checking)
app.get('/api/exams/assigned-subject-codes', async (req, res) => {
  try {
    const exams = await Models.Exam.find();
    const assignedCodes = new Set();
    const details = {};
    (exams || []).forEach(e => {
      (e.subjectCodes || []).forEach(c => {
        const clean = c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (clean) {
          assignedCodes.add(clean);
          if (!details[clean]) {
            details[clean] = {
              code: clean,
              examId: String(e._id),
              examName: e.name,
              date: e.date,
              session: e.session
            };
          }
        }
      });
    });
    res.json({
      assignedCodes: Array.from(assignedCodes),
      details
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/exams/:id', async (req, res) => {
  try {
    const exam = await Models.Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    res.json(exam);
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

    // 1. Validate exam date: allow only current (today) and future dates (using local date)
    const todayStr = getLocalDateString();
    const examDateOnly = (date || '').split('T')[0];
    if (!examDateOnly) {
      return res.status(400).json({ error: 'Valid exam date is required.' });
    }
    if (examDateOnly < todayStr) {
      return res.status(400).json({
        error: `Invalid exam date (${examDateOnly}). Exams can only be scheduled for today (${todayStr}) or future dates.`
      });
    }

    // 2. Prevent reusing assigned subject codes across all exams
    const existingExams = await Models.Exam.find();
    const assignedCodesMap = new Map();
    existingExams.forEach(e => {
      (e.subjectCodes || []).forEach(c => {
        const clean = c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (clean) assignedCodesMap.set(clean, e.name || clean);
      });
    });

    const upperSubCodes = (subjectCodes || []).map(c => c.toUpperCase());
    const duplicateAssignedCodes = [];
    upperSubCodes.forEach(c => {
      const clean = c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (clean && assignedCodesMap.has(clean)) {
        duplicateAssignedCodes.push(c);
      }
    });

    if (duplicateAssignedCodes.length > 0) {
      return res.status(400).json({
        error: `Subject code(s) already assigned to an exam: ${duplicateAssignedCodes.join(', ')}. Reusing assigned subject codes across exams is not permitted.`
      });
    }

    // Check if any of the assigned halls are fully occupied on the same date and session
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
    const upperDepts = (departments || []).map(d => d.toUpperCase());
    
    let relevantStudents;
    if (upperSubCodes.length > 0) {
      relevantStudents = students.filter(s => hasMatchingSubCode(s, upperSubCodes));
    } else {
      relevantStudents = students.filter(s => 
        upperDepts.includes(s.department.toUpperCase())
      );
    }

    const allHalls = await Models.Hall.find();
    let effectiveSeatsPerBench = (seatsPerBench !== undefined && seatsPerBench !== null && !isNaN(parseInt(seatsPerBench)))
      ? parseInt(seatsPerBench)
      : null;
    if (!effectiveSeatsPerBench) {
      const firstAssigned = (assignedHalls || [])[0];
      const firstHall = allHalls.find(h => h.name === firstAssigned || String(h._id) === String(firstAssigned));
      effectiveSeatsPerBench = (firstHall && firstHall.seatsPerBench) ? parseInt(firstHall.seatsPerBench) : 2;
    }

    const hallSnapshots = {};
    for (const hallIdentifier of (assignedHalls || [])) {
      const matchedHall = allHalls.find(h => 
        h.name === hallIdentifier || 
        String(h._id) === String(hallIdentifier) ||
        (h.name && h.name.toLowerCase() === String(hallIdentifier).toLowerCase())
      );
      if (matchedHall) {
        // Hall Upload Configuration is the Authority: each hall uses its own saved seatsPerBench
        const spb = matchedHall.seatsPerBench 
          ? parseInt(matchedHall.seatsPerBench) 
          : (parseInt(seatsPerBench) || effectiveSeatsPerBench || 2);
        const benches = (matchedHall.benches && parseInt(matchedHall.benches) > 0)
          ? parseInt(matchedHall.benches)
          : (matchedHall.rows * matchedHall.columns);
        const hallCapacity = (matchedHall.capacity && parseInt(matchedHall.capacity) > 0)
          ? parseInt(matchedHall.capacity)
          : (benches * spb);
        const snapshot = {
          _id: String(matchedHall._id),
          name: matchedHall.name,
          block: matchedHall.block || '',
          idx: matchedHall.idx !== undefined ? matchedHall.idx : 0,
          rows: matchedHall.rows,
          columns: matchedHall.columns,
          benches: benches,
          capacity: hallCapacity,
          columnRows: matchedHall.columnRows,
          seatsPerBench: spb,
          csvData: matchedHall.csvData || null,
          columnGaps: matchedHall.columnGaps || null,
          createdAt: new Date().toISOString()
        };
        hallSnapshots[matchedHall.name] = snapshot;
        hallSnapshots[String(matchedHall._id)] = snapshot;
      }
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
      seatsPerBench: effectiveSeatsPerBench,
      hallSnapshots,
      status: 'Scheduled'
    });

    logActivity('exam', 'Exam Scheduled', `${name} scheduled for ${date} (${session}). Assigned to ${assignedHalls?.length || 0} halls.`);
    
    // Auto-generate seating plans for all assigned halls
    if (assignedHalls && assignedHalls.length > 0) {
      try {
        const firstHall = assignedHalls[0];
        const matchedHall = allHalls.find(h => h.name === firstHall || String(h._id) === String(firstHall))
          || hallSnapshots[firstHall] || hallSnapshots[String(firstHall)] || firstHall;
        await generateSeatingPlan(newExam._id, matchedHall._id || matchedHall);
      } catch (e) {
        console.error('Auto seating generation error on create:', e);
      }
    }

    setImmediate(async () => {
      try {
        await syncDateRecordSnapshot(newExam.date, newExam.session);
      } catch (_) {}
    });

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
    try {
      await syncDateRecordSnapshot(deleted.date, deleted.session);
    } catch (_) {}
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

    const currentExam = await Models.Exam.findById(req.params.id);
    if (!currentExam) {
      return res.status(404).json({ error: 'Exam not found.' });
    }

    // 1. Validate exam date: allow only current (today) and future dates (using local date)
    const todayStr = getLocalDateString();
    const examDateOnly = (date || '').split('T')[0];
    if (!examDateOnly) {
      return res.status(400).json({ error: 'Valid exam date is required.' });
    }
    if (examDateOnly < todayStr) {
      return res.status(400).json({
        error: `Invalid exam date (${examDateOnly}). Exams can only be scheduled for today (${todayStr}) or future dates.`
      });
    }

    // 2. Prevent reusing assigned subject codes from OTHER exams
    const existingExams = await Models.Exam.find();
    const assignedCodesMap = new Map();
    existingExams.forEach(e => {
      if (String(e._id) === String(req.params.id)) return; // Exclude current exam being edited
      (e.subjectCodes || []).forEach(c => {
        const clean = c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (clean) assignedCodesMap.set(clean, e.name || clean);
      });
    });

    const upperSubCodes = (subjectCodes || []).map(c => c.toUpperCase());
    const duplicateAssignedCodes = [];
    upperSubCodes.forEach(c => {
      const clean = c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (clean && assignedCodesMap.has(clean)) {
        duplicateAssignedCodes.push(c);
      }
    });

    if (duplicateAssignedCodes.length > 0) {
      return res.status(400).json({
        error: `Subject code(s) already assigned to another exam: ${duplicateAssignedCodes.join(', ')}. Reusing assigned subject codes across exams is not permitted.`
      });
    }

    // Check if any of the assigned halls are fully occupied on the same date and session (excluding current exam)
    const selectedDateOnly = date.split('T')[0];
    const examsAtSameTime = existingExams.filter(e => 
      String(e._id) !== String(req.params.id) && e.date.split('T')[0] === selectedDateOnly && e.session === session
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
    const upperDepts = (departments || []).map(d => d.toUpperCase());
    
    let relevantStudents;
    if (upperSubCodes.length > 0) {
      relevantStudents = students.filter(s => hasMatchingSubCode(s, upperSubCodes));
    } else {
      relevantStudents = students.filter(s => 
        upperDepts.includes(s.department.toUpperCase())
      );
    }

    // Build updated hall snapshots for assigned halls
    const allHalls = await Models.Hall.find();
    const newHallSnapshots = {};
    const explicitSpb = (seatsPerBench !== undefined && seatsPerBench !== null && !isNaN(parseInt(seatsPerBench)))
      ? parseInt(seatsPerBench)
      : null;

    let totalAllocatableCapacity = 0;
    for (const hallIdentifier of (assignedHalls || [])) {
      let hallSource = allHalls.find(h => h.name === hallIdentifier || String(h._id) === String(hallIdentifier));
      const existingSnap = currentExam.hallSnapshots && 
        (currentExam.hallSnapshots[hallIdentifier] || (hallSource && currentExam.hallSnapshots[String(hallSource._id)]) || (hallSource && currentExam.hallSnapshots[hallSource.name]));
      const explicitHallSnap = req.body.hallSnapshots && 
        (req.body.hallSnapshots[hallIdentifier] || (hallSource && req.body.hallSnapshots[String(hallSource._id)]) || (hallSource && req.body.hallSnapshots[hallSource.name]));

      if (!hallSource) {
        hallSource = existingSnap;
      }
      if (!hallSource) continue;

      let snap;
      if (explicitHallSnap) {
        // Explicitly passed in request body
        const spb = parseInt(explicitHallSnap.seatsPerBench) || 2;
        const benches = explicitHallSnap.benches !== undefined ? parseInt(explicitHallSnap.benches) : (hallSource.benches || 0);
        const cap = benches * spb;
        totalAllocatableCapacity += cap;
        snap = {
          _id: String(explicitHallSnap._id || hallSource._id),
          name: explicitHallSnap.name || hallSource.name,
          block: explicitHallSnap.block || hallSource.block || '',
          idx: explicitHallSnap.idx !== undefined ? explicitHallSnap.idx : (hallSource.idx !== undefined ? hallSource.idx : 0),
          rows: explicitHallSnap.rows !== undefined ? explicitHallSnap.rows : hallSource.rows,
          columns: explicitHallSnap.columns !== undefined ? explicitHallSnap.columns : hallSource.columns,
          benches: benches,
          capacity: cap,
          columnRows: explicitHallSnap.columnRows || hallSource.columnRows,
          seatsPerBench: spb,
          csvData: explicitHallSnap.csvData || hallSource.csvData || null,
          columnGaps: explicitHallSnap.columnGaps || hallSource.columnGaps || null,
          updatedAt: new Date().toISOString()
        };
      } else if (hallSource && hallSource._id) {
        // Hall exists in Hall Management - ALWAYS snapshot latest general hall record!
        // This ensures edits made in Hall Management before editing exam are fully reflected.
        const spb = hallSource.seatsPerBench ? parseInt(hallSource.seatsPerBench) : (explicitSpb !== null ? explicitSpb : (currentExam.seatsPerBench || 2));
        const benches = (hallSource.benches && parseInt(hallSource.benches) > 0)
          ? parseInt(hallSource.benches)
          : (hallSource.rows * hallSource.columns);
        const cap = (hallSource.capacity && parseInt(hallSource.capacity) > 0)
          ? parseInt(hallSource.capacity)
          : (benches * spb);
        totalAllocatableCapacity += cap;
        snap = {
          _id: String(hallSource._id),
          name: hallSource.name,
          block: hallSource.block || '',
          idx: hallSource.idx !== undefined ? hallSource.idx : 0,
          rows: hallSource.rows,
          columns: hallSource.columns,
          benches: benches,
          capacity: cap,
          columnRows: hallSource.columnRows,
          seatsPerBench: spb,
          csvData: hallSource.csvData || null,
          columnGaps: hallSource.columnGaps || null,
          updatedAt: new Date().toISOString()
        };
      } else if (existingSnap) {
        // Fallback to existing snapshot only if hall was removed from allHalls
        totalAllocatableCapacity += (existingSnap.capacity || 0);
        snap = { ...existingSnap };
      }
      newHallSnapshots[snap.name] = snap;
      newHallSnapshots[String(snap._id)] = snap;
    }

    const effectiveExamSpb = explicitSpb !== null ? explicitSpb : (currentExam.seatsPerBench || 2);

    // Backup existing seating plans for rollback safety
    const previousPlans = await Models.SeatingPlan.find({ examId: req.params.id });
    const backupPlans = JSON.parse(JSON.stringify(previousPlans));

    // Update the exam record with new snapshot
    const updated = await Models.Exam.findByIdAndUpdate(req.params.id, {
      name,
      departments: upperDepts,
      subjectCodes: upperSubCodes,
      date,
      session,
      time: time || (session === 'FN' ? '10:00 AM - 01:00 PM' : '02:00 PM - 05:00 PM'),
      studentsCount: relevantStudents.length,
      assignedHalls: assignedHalls || [],
      seatsPerBench: effectiveExamSpb,
      hallSnapshots: newHallSnapshots
    });

    if (!updated) {
      return res.status(404).json({ error: 'Exam not found.' });
    }

    // Attempt to regenerate seating plans
    try {
      await Models.SeatingPlan.deleteMany({ examId: req.params.id });
      if (assignedHalls && assignedHalls.length > 0) {
        const firstHall = assignedHalls[0];
        const matchedHall = allHalls.find(h => h.name === firstHall || String(h._id) === String(firstHall))
          || (newHallSnapshots && (newHallSnapshots[firstHall] || newHallSnapshots[String(firstHall)])) || firstHall;
        await generateSeatingPlan(req.params.id, matchedHall._id || matchedHall);
      }
    } catch (genError) {
      console.error('[Rollback] Error regenerating seating plans on exam update:', genError);
      // Safe rollback to previous exam state and seating plans
      await Models.Exam.findByIdAndUpdate(req.params.id, {
        name: currentExam.name,
        departments: currentExam.departments,
        subjectCodes: currentExam.subjectCodes,
        date: currentExam.date,
        session: currentExam.session,
        time: currentExam.time,
        studentsCount: currentExam.studentsCount,
        assignedHalls: currentExam.assignedHalls,
        seatsPerBench: currentExam.seatsPerBench,
        hallSnapshots: currentExam.hallSnapshots
      });
      await Models.SeatingPlan.deleteMany({ examId: req.params.id });
      for (const bp of backupPlans) {
        delete bp.id;
        await Models.SeatingPlan.create(bp);
      }
      return res.status(500).json({
        error: `Failed to regenerate seating plans: ${genError.message}. Previous assignments were restored.`,
        rolledBack: true
      });
    }

    // Inspect if any students could not be seated
    const newlyCreatedPlans = await Models.SeatingPlan.find({ examId: req.params.id });
    const seatedCount = newlyCreatedPlans.reduce((sum, p) => sum + (p.attendanceRoster ? p.attendanceRoster.length : 0), 0);
    const unallocatedCount = Math.max(0, relevantStudents.length - seatedCount);
    let allocationReport = null;
    if (unallocatedCount > 0) {
      allocationReport = `${unallocatedCount} student(s) could not be seated due to hall capacity constraints (${relevantStudents.length} eligible, ${seatedCount} seated in ${assignedHalls?.length || 0} halls).`;
    }

    logActivity('exam', 'Exam Updated', `${name} configuration was updated.${allocationReport ? ' ' + allocationReport : ''}`);
    setImmediate(async () => {
      try {
        await syncDateRecordSnapshot(date, session);
      } catch (_) {}
    });
    res.json({
      ...updated,
      allocatedCount: seatedCount,
      unallocatedCount,
      allocationWarning: allocationReport
    });
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
function getHallCapacityForSeatsPerBench(hall, seatsPerBench) {
  if (!hall) return 0;
  const spb = seatsPerBench !== undefined && seatsPerBench !== null
    ? (parseInt(seatsPerBench) || 2)
    : (hall.seatsPerBench ? parseInt(hall.seatsPerBench) : 2);

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
    const reqSpb = req.query.seatsPerBench ? parseInt(req.query.seatsPerBench) : null;
    
    const availability = {};
    allHalls.forEach(hall => {
      const spb = hall.seatsPerBench || reqSpb || 2;
      const hallCap = (hall.capacity && parseInt(hall.capacity) > 0)
        ? parseInt(hall.capacity)
        : (hall.benches ? parseInt(hall.benches) * spb : getHallCapacityForSeatsPerBench(hall, spb));
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

// Dynamically inspect all students to compute maximum batch/year metrics
function getMaxStudentBatchInfo(allStudents = []) {
  let maxMkuDigit = 6;
  let maxYearNum = 26;
  let maxBatchYear = 2026;

  if (Array.isArray(allStudents)) {
    allStudents.forEach(s => {
      const reg = String((s && s.registerNo) || '').trim().toUpperCase();
      const mku = reg.match(/^C(\d)/i);
      if (mku) {
        const d = parseInt(mku[1], 10);
        if (d > maxMkuDigit) maxMkuDigit = d;
      }
      const yr = reg.match(/^(?:[A-Z]{1,4})?(\d{2})/i);
      if (yr) {
        const y = parseInt(yr[1], 10);
        if (y >= 15 && y <= 40 && y > maxYearNum) maxYearNum = y;
      }
      const b = String((s && s.batch) || '');
      const bMatch = b.match(/(\d{4})/);
      if (bMatch) {
        const by = parseInt(bMatch[1], 10);
        if (by > maxBatchYear) maxBatchYear = by;
      }
    });
  }

  return { maxMkuDigit, maxYearNum, maxBatchYear };
}

// Dynamically determine academic year (1st, 2nd, 3rd) and whether student is appearing as an Arrear candidate
function getStudentYearAndArrear(student, maxInfo = null, targetSubCode = '') {
  const reg = String((student && student.registerNo) || '').trim().toUpperCase();
  const maxMku = (maxInfo && maxInfo.maxMkuDigit) || 6;
  const maxYr = (maxInfo && maxInfo.maxYearNum) || 26;
  const sub = String(targetSubCode || (student && student.subjectCode) || '').trim().toUpperCase();

  let year = 1;
  let isArrearBatch = false;

  const mkuMatch = reg.match(/^C(\d)/i);
  if (mkuMatch) {
    const digit = parseInt(mkuMatch[1], 10);
    const diff = maxMku - digit;
    // diff === 0 -> 1st Year (C6)
    // diff === 1 -> 2nd Year (C5)
    // diff === 2 -> 3rd Year (C4)
    // diff >= 3 -> Senior / Arrear batch (C3, C2, C1)
    year = Math.max(1, diff + 1);
    isArrearBatch = diff >= 3;
  } else {
    const yrMatch = reg.match(/^(?:[A-Z]{1,4})?(\d{2})/i);
    if (yrMatch) {
      const yr = parseInt(yrMatch[1], 10);
      if (yr >= 15 && yr <= 40) {
        const diff = maxYr - yr;
        year = Math.max(1, diff + 1);
        isArrearBatch = diff >= 3;
      }
    }
  }

  let isArrearForSub = isArrearBatch;
  if (sub) {
    const semDigits = sub.match(/\d+/);
    if (semDigits) {
      const semFirstDigit = parseInt(semDigits[0][0], 10);
      let paperYear = 1;
      if ([1, 2].includes(semFirstDigit)) paperYear = 1;
      else if ([3, 4].includes(semFirstDigit)) paperYear = 2;
      else if ([5, 6].includes(semFirstDigit)) paperYear = 3;

      if (year > paperYear) {
        isArrearForSub = true;
      }
    }
  }

  const yearLabel = isArrearForSub 
    ? (year <= 3 ? `${year === 1 ? '1st' : year === 2 ? '2nd' : '3rd'} Year (Arrear)` : `${year}th Year (Arrear)`)
    : (year === 1 ? '1st Year' : year === 2 ? '2nd Year' : year === 3 ? '3rd Year' : `${year}th Year`);

  return {
    year,
    isArrear: isArrearForSub,
    yearLabel
  };
}

// Canonicalize degree strings so formats like B.A, B.A., and BA consistently map together
function canonicalizeDegree(degreeStr) {
  if (!degreeStr) return '';
  let str = String(degreeStr).trim();
  const clean = str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean === 'BA') return 'B.A.';
  if (clean === 'BCOM') return 'B.Com.';
  if (clean === 'BBA') return 'B.B.A.';
  if (clean === 'BSC') return 'B.Sc.';
  if (clean === 'BCA') return 'B.C.A.';
  if (clean === 'MA') return 'M.A.';
  if (clean === 'MCOM') return 'M.Com.';
  if (clean === 'MSC') return 'M.Sc.';
  return str;
}

// Helper to sort attendance roster cleanly by Academic Level -> Department -> Subject Code -> Year -> Arrear -> Register Number
// PART 1 REQUIREMENT: Within each hall, arrange students department-wise (e.g. B.A. -> B.COM -> B.B.A.)
const sortAttendanceRoster = (roster, examSubCodes = [], studentMap = null, maxBatchInfo = null) => {
  if (!roster) return [];
  const upperSubCodes = (examSubCodes || []).map(c => String(c).trim().toUpperCase()).filter(Boolean);

  return [...roster].sort((a, b) => {
    const dbA = studentMap ? studentMap.get(String(a.registerNo || '').toUpperCase()) : null;
    const dbB = studentMap ? studentMap.get(String(b.registerNo || '').toUpperCase()) : null;
    const deptA = resolveStudentDepartment(dbA || a, a.registerNo, a.department);
    const deptB = resolveStudentDepartment(dbB || b, b.registerNo, b.department);
    const subA = String(a.subjectCode || '').trim().toUpperCase();
    const subB = String(b.subjectCode || '').trim().toUpperCase();
    const lvlA = getAcademicLevel(dbA || a, deptA, '', subA);
    const lvlB = getAcademicLevel(dbB || b, deptB, '', subB);

    // 1. Academic level: UG first, then PG
    if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;

    // 2. Course code order (exam subject codes selection order)
    const idxA = upperSubCodes.indexOf(subA);
    const idxB = upperSubCodes.indexOf(subB);

    if (idxA !== -1 && idxB !== -1 && idxA !== idxB) {
      return idxA - idxB;
    }
    if (idxA !== -1 && idxB === -1) return -1;
    if (idxA === -1 && idxB !== -1) return 1;

    // 3. Department order - Group students by canonical department
    const canonDeptA = canonicalizeDegree(deptA) || deptA;
    const canonDeptB = canonicalizeDegree(deptB) || deptB;
    const deptComp = canonDeptA.localeCompare(canonDeptB);
    if (deptComp !== 0) return deptComp;

    const subCompare = subA.localeCompare(subB);
    if (subCompare !== 0) return subCompare;

    // 4. Register number strictly natural ascending order (e.g. C5 before C6)
    const regA = String(a.registerNo || '').trim().toUpperCase();
    const regB = String(b.registerNo || '').trim().toUpperCase();
    return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
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

// Robust helper to retrieve actual student Department / Course Code identity
function getStudentCourseIdentity(student) {
  if (!student) return 'GENERAL';
  if (student.courseCode && typeof student.courseCode === 'string' && student.courseCode.trim()) {
    const val = student.courseCode.trim().toUpperCase();
    if (!['GENERAL', 'UNKNOWN', 'NULL', 'UNDEFINED'].includes(val)) return val;
  }
  if (student.csvData && typeof student.csvData === 'object') {
    const keys = Object.keys(student.csvData);
    const cKey = keys.find(k => /cours|cousr/i.test(k));
    if (cKey && student.csvData[cKey]) {
      const val = String(student.csvData[cKey]).trim().toUpperCase();
      if (val && !['GENERAL', 'UNKNOWN', 'NULL', 'UNDEFINED'].includes(val)) {
        return val;
      }
    }
    const dKey = keys.find(k => /dept|depart|branch/i.test(k));
    if (dKey && student.csvData[dKey]) {
      const val = String(student.csvData[dKey]).trim().toUpperCase();
      if (val && !['GENERAL', 'UNKNOWN', 'NULL', 'UNDEFINED'].includes(val)) {
        return val;
      }
    }
  }
  const rawDept = student.department;
  const resolved = resolveStudentDepartment(student, student.registerNo, rawDept);
  return (canonicalizeDegree(resolved) || resolved || rawDept || 'GENERAL').toUpperCase();
}

// Helper to realign seating grid benches so students are placed in strictly natural ascending register number order
function realignSeatingGridToAscending(seatingGrid, colsCount = 4, examSubCodes = []) {
  if (!seatingGrid || !Array.isArray(seatingGrid) || seatingGrid.length === 0) return seatingGrid;

  // 1. Build bench map and determine dimensions
  const gridMap = {};
  let maxCol = 1;
  let maxRow = 0;
  seatingGrid.forEach(b => {
    if (b && b.benchCode) {
      gridMap[b.benchCode] = b;
      const m = String(b.benchCode).match(/^([A-Z]+)(\d+)$/);
      if (m) {
        const c = parseInt(m[2], 10);
        if (c > maxCol) maxCol = c;
        let rVal = 0;
        for (let i = 0; i < m[1].length; i++) {
          rVal = rVal * 26 + (m[1].charCodeAt(i) - 64);
        }
        if (rVal > maxRow) maxRow = rVal;
      }
    }
  });

  const effectiveCols = Math.max(maxCol, parseInt(colsCount) || 1);
  const effectiveRows = Math.max(maxRow, 1);

  // 2. Canonical bench order: Column 1 top-to-bottom, Column 2 top-to-bottom, etc.
  const orderedBenches = [];
  for (let c = 1; c <= effectiveCols; c++) {
    for (let r = 0; r < effectiveRows; r++) {
      const code = getRowLetter(r) + c;
      if (gridMap[code] && !gridMap[code].isPlaceholder) {
        orderedBenches.push(gridMap[code]);
      }
    }
  }

  // 3. Helper to sort students: course code order (by examSubCodes), then strictly ascending register number
  const upperExamCodes = (examSubCodes || []).map(c => String(c).trim().toUpperCase());
  const sortStudentList = (list) => {
    return list.sort((a, b) => {
      const scA = (a.subjectCode || '').trim().toUpperCase();
      const scB = (b.subjectCode || '').trim().toUpperCase();
      const idxA = upperExamCodes.indexOf(scA);
      const idxB = upperExamCodes.indexOf(scB);
      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
      if (idxA !== -1 && idxB === -1) return -1;
      if (idxA === -1 && idxB !== -1) return 1;
      if (scA !== scB) {
        const cComp = scA.localeCompare(scB);
        if (cComp !== 0) return cComp;
      }
      const regA = String(a.registerNo || '').trim();
      const regB = String(b.registerNo || '').trim();
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });
  };

  // 4. Check distinct subject codes seated in the hall
  const allSeated = [];
  ['seat1', 'seat2', 'seat3'].forEach(k => {
    orderedBenches.forEach(b => {
      if (b[k]) allSeated.push(b[k]);
    });
  });

  const subCodes = new Set();
  allSeated.forEach(s => {
    const sc = (s.subjectCode || '').trim().toUpperCase();
    if (sc && sc !== 'GENERAL' && sc !== 'UNKNOWN') subCodes.add(sc);
  });

  const isSingleSub = subCodes.size <= 1;

  if (isSingleSub) {
    // Single subject: Sort all students in natural ascending register number order
    sortStudentList(allSeated);

    let sIdx = 0;
    // Assign Left first, then Right on each bench in column top-to-bottom order
    for (const b of orderedBenches) {
      if (b.seat1 && sIdx < allSeated.length) b.seat1 = allSeated[sIdx++];
      if (b.seat2 && sIdx < allSeated.length) b.seat2 = allSeated[sIdx++];
      if (b.seat3 !== undefined && b.seat3 && sIdx < allSeated.length) b.seat3 = allSeated[sIdx++];
    }
  } else {
    // Multi-subject: Realign each seat track independently in natural ascending order by subject & registerNo
    const seatKeys = ['seat1', 'seat2', 'seat3'];
    seatKeys.forEach(k => {
      const trackStudents = [];
      orderedBenches.forEach(b => {
        if (b[k]) trackStudents.push(b[k]);
      });
      if (trackStudents.length === 0) return;

      sortStudentList(trackStudents);

      let tIdx = 0;
      orderedBenches.forEach(b => {
        if (b[k] && tIdx < trackStudents.length) {
          b[k] = trackStudents[tIdx++];
        }
      });
    });
  }

  return seatingGrid;
}

// Unified Department-Wise Consecutive Seating Allocation by Seat Position (Tracks along column-by-column traversal)
function allocateStudentsToBenchesBySeatPosition(benchesList, students, seatsPerBench, maxCap = 0, onAssign = null) {
  if (!benchesList || benchesList.length === 0 || !students || students.length === 0) {
    return { seatedCount: 0 };
  }

  const effectiveCap = maxCap > 0 ? Math.min(maxCap, students.length) : students.length;
  const spb = parseInt(seatsPerBench) || 2;

  // Sort candidate students deterministically: course code, department, then strictly ascending register number
  students.sort((a, b) => {
    const scA = (a.subjectCode || getStudentSubCode(a) || '').trim().toUpperCase();
    const scB = (b.subjectCode || getStudentSubCode(b) || '').trim().toUpperCase();
    if (scA !== scB) return scA.localeCompare(scB);
    const regA = String(a.registerNo || '').trim();
    const regB = String(b.registerNo || '').trim();
    return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Check if this hall has a single subject code
  const distinctSubCodes = new Set();
  students.forEach(st => {
    const sc = (st.subjectCode || getStudentSubCode(st) || '').trim().toUpperCase();
    if (sc && sc !== 'GENERAL' && sc !== 'UNKNOWN') distinctSubCodes.add(sc);
  });
  const isSingleSubject = distinctSubCodes.size <= 1;

  // 2 seats per bench with a single subject code selected
  // Traverse column by column in strictly top-to-bottom ascending order:
  // 1. Complete Left seat sequence (seat1) for that column
  // 2. Complete Right seat sequence (seat2) for that column
  if (spb === 2 && isSingleSubject) {
    const colMap = new Map();
    for (const bench of benchesList) {
      let c = bench.col;
      if (c === undefined || c === null) {
        const m = String(bench.benchCode).match(/\d+$/);
        c = m ? parseInt(m[0], 10) : 1;
      }
      if (!colMap.has(c)) {
        colMap.set(c, []);
      }
      colMap.get(c).push(bench);
    }

    const colKeys = Array.from(colMap.keys()).sort((a, b) => a - b);
    const slots = [];

    colKeys.forEach(c => {
      const colBenches = colMap.get(c);
      // Every column: Top to Bottom (A -> B -> C ...) in strictly ascending order
      colBenches.sort((a, b) => getRowIndex(a.row || String(a.benchCode).replace(/\d+$/, '')) - getRowIndex(b.row || String(b.benchCode).replace(/\d+$/, '')));

      // 1. Complete Left seat sequence (seat1) for this column first
      for (const bench of colBenches) {
        if (!bench.seat1) {
          slots.push({ bench, seatKey: 'seat1', pos: 'Left' });
        }
      }

      // 2. Complete Right seat sequence (seat2) for this column next
      for (const bench of colBenches) {
        if (!bench.seat2) {
          slots.push({ bench, seatKey: 'seat2', pos: 'Right' });
        }
      }
    });

    let seatedCount = 0;
    const countToSeat = Math.min(effectiveCap, slots.length, students.length);
    for (let i = 0; i < countToSeat; i++) {
      const slot = slots[i];
      const student = students[i];
      slot.bench[slot.seatKey] = student;
      seatedCount++;

      if (typeof onAssign === 'function') {
        onAssign(slot.bench, slot.seatKey, slot.pos, {
          student,
          dept: student.department || '',
          code: student.subjectCode || '',
          isSecondary: !!student.isSecondary
        });
      }
    }

    return { seatedCount };
  }

  const trackDefs = spb === 3
    ? [
        { key: 'seat1', pos: 'Left' },
        { key: 'seat2', pos: 'Middle' },
        { key: 'seat3', pos: 'Right' }
      ]
    : [
        { key: 'seat1', pos: 'Left' },
        { key: 'seat2', pos: 'Right' }
      ];

  const tracks = trackDefs.map(() => []);
  for (const bench of benchesList) {
    trackDefs.forEach((def, tIdx) => {
      if (!bench[def.key]) {
        tracks[tIdx].push({
          bench,
          seatKey: def.key,
          pos: def.pos
        });
      }
    });
  }

  // Group candidate students by Subject Code + Course/Department identity preserving selection order
  const deptMap = new Map();
  students.forEach(st => {
    const sCode = (st.subjectCode || '').trim().toUpperCase();
    const courseId = getStudentCourseIdentity(st);
    const dId = sCode ? `${sCode}___${courseId}` : courseId;
    if (!deptMap.has(dId)) {
      deptMap.set(dId, []);
    }
    deptMap.get(dId).push(st);
  });

  const pools = Array.from(deptMap.entries()).map(([dId, stList]) => {
    const sorted = [...stList].sort((a, b) => {
      const regA = String(a.registerNo || '').trim();
      const regB = String(b.registerNo || '').trim();
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });
    return {
      dId,
      dept: sorted[0]?.department || (dId.includes('___') ? dId.split('___')[1] : dId),
      students: sorted
    };
  });

  const trackQueues = trackDefs.map(() => []);
  const totalBenchCount = benchesList.length;

  // Helper to fill remaining capacity of tracks in specific track preference order
  // taking contiguous chunks from remaining pools to guarantee consecutive sequence
  function fillTracksContiguously(trackOrder, unallocatedPools) {
    for (const t of trackOrder) {
      let needed = tracks[t].length - trackQueues[t].length;
      if (needed <= 0) continue;
      for (const pool of unallocatedPools) {
        if (needed <= 0) break;
        if (pool.students.length > 0) {
          const takeCount = Math.min(needed, pool.students.length);
          const chunk = pool.students.splice(0, takeCount);
          trackQueues[t].push(...chunk);
          needed -= takeCount;
        }
      }
    }
  }

  if (spb === 3) {
    if (pools.length >= 3) {
      // 3 or more departments: Track 0 (Left) -> Pool 0, Track 1 (Middle) -> Pool 1, Track 2 (Right) -> Pool 2
      trackQueues[0] = pools[0].students.splice(0, totalBenchCount);
      trackQueues[1] = pools[1].students.splice(0, totalBenchCount);
      trackQueues[2] = pools[2].students.splice(0, totalBenchCount);

      // Remaining distinct pools (pools 3, 4, etc.) first
      const otherPools = pools.slice(3);
      fillTracksContiguously([2, 1, 0], otherPools);

      // Then fill overflow from primary pools (pools 0, 1, 2)
      // Prefer Track 2 (Right) for Pool 0 (Left) overflow so Left & Right are separated by Middle
      fillTracksContiguously([2, 1, 0], pools.slice(0, 3));
    } else if (pools.length === 2) {
      // 2 departments:
      const p0 = pools[0];
      const p1 = pools[1];
      const pMaj = p0.students.length >= p1.students.length ? p0 : p1;
      const pMin = p0.students.length >= p1.students.length ? p1 : p0;

      if (pMaj.students.length > totalBenchCount) {
        // Majority pool occupies Track 0 (Left) and overflows to Track 2 (Right).
        // Minority pool occupies Track 1 (Middle) to separate Left & Right!
        trackQueues[0] = pMaj.students.splice(0, totalBenchCount);
        trackQueues[1] = pMin.students.splice(0, totalBenchCount);
        trackQueues[2] = pMaj.students.splice(0, totalBenchCount);

        fillTracksContiguously([2, 1, 0], [pMin, pMaj]);
      } else {
        // Neither department exceeds bench count: place on Left and Right with Middle empty!
        trackQueues[0] = pMaj.students.splice(0, totalBenchCount);
        trackQueues[2] = pMin.students.splice(0, totalBenchCount);
        // Middle remains empty unless additional students need placement
        fillTracksContiguously([1, 2, 0], [pMaj, pMin]);
      }
    } else if (pools.length === 1) {
      // 1 department: Check if multiple subject codes exist
      const singlePool = pools[0];
      const subMap = new Map();
      singlePool.students.forEach(st => {
        const sub = (st.subjectCode || '').trim().toUpperCase() || 'GENERAL';
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub).push(st);
      });
      const subPools = Array.from(subMap.values()).map((sts, idx) => ({
        dId: `SUB_${idx}`,
        dept: sts[0]?.department || singlePool.dept,
        students: sts
      }));

      if (subPools.length >= 3) {
        trackQueues[0] = subPools[0].students.splice(0, totalBenchCount);
        trackQueues[1] = subPools[1].students.splice(0, totalBenchCount);
        trackQueues[2] = subPools[2].students.splice(0, totalBenchCount);
        fillTracksContiguously([2, 1, 0], subPools);
      } else if (subPools.length === 2) {
        const sMaj = subPools[0].students.length >= subPools[1].students.length ? subPools[0] : subPools[1];
        const sMin = subPools[0].students.length >= subPools[1].students.length ? subPools[1] : subPools[0];
        if (sMaj.students.length > totalBenchCount) {
          trackQueues[0] = sMaj.students.splice(0, totalBenchCount);
          trackQueues[1] = sMin.students.splice(0, totalBenchCount);
          trackQueues[2] = sMaj.students.splice(0, totalBenchCount);
          fillTracksContiguously([2, 1, 0], [sMin, sMaj]);
        } else {
          trackQueues[0] = sMaj.students.splice(0, totalBenchCount);
          trackQueues[2] = sMin.students.splice(0, totalBenchCount);
          fillTracksContiguously([1, 2, 0], [sMaj, sMin]);
        }
      } else {
        // Single subject: Fill Left (Track 0) and Right (Track 2) first, Middle (Track 1) last
        trackQueues[0] = singlePool.students.splice(0, totalBenchCount);
        trackQueues[2] = singlePool.students.splice(0, totalBenchCount);
        trackQueues[1] = singlePool.students.splice(0, totalBenchCount);
      }
    }
  } else {
    // 2 seats per bench
    if (pools.length >= 2) {
      trackQueues[0] = pools[0].students.splice(0, totalBenchCount);
      trackQueues[1] = pools[1].students.splice(0, totalBenchCount);
      fillTracksContiguously([0, 1], pools);
    } else if (pools.length === 1) {
      const singlePool = pools[0];
      const subMap = new Map();
      singlePool.students.forEach(st => {
        const sub = (st.subjectCode || '').trim().toUpperCase() || 'GENERAL';
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub).push(st);
      });
      const subPools = Array.from(subMap.values()).map((sts, idx) => ({
        dId: `SUB_${idx}`,
        dept: sts[0]?.department || singlePool.dept,
        students: sts
      }));

      if (subPools.length >= 2) {
        trackQueues[0] = subPools[0].students.splice(0, totalBenchCount);
        trackQueues[1] = subPools[1].students.splice(0, totalBenchCount);
        fillTracksContiguously([0, 1], subPools);
      } else {
        trackQueues[0] = singlePool.students.splice(0, totalBenchCount);
        trackQueues[1] = singlePool.students.splice(0, totalBenchCount);
      }
    }
  }

  // Physically assign students along tracks in W-order traversal
  let seatedCount = 0;
  for (let t = 0; t < trackDefs.length; t++) {
    const trackSlots = tracks[t];
    const queue = trackQueues[t];
    for (let i = 0; i < trackSlots.length; i++) {
      if (i >= queue.length) break;
      if (seatedCount >= effectiveCap) break;

      const slot = trackSlots[i];
      const student = queue[i];
      slot.bench[slot.seatKey] = student;
      seatedCount++;

      if (typeof onAssign === 'function') {
        onAssign(slot.bench, slot.seatKey, slot.pos, {
          student,
          dept: student.department,
          code: student.subjectCode || '',
          isSecondary: student.isSecondary
        });
      }
    }
  }

  // Safety sweep: Guarantee ZERO empty seats up to effectiveCap without duplicates
  if (seatedCount < effectiveCap) {
    const unassigned = [];
    pools.forEach(p => {
      if (p.students.length > 0) unassigned.push(...p.students);
    });
    for (let t = 0; t < trackDefs.length; t++) {
      const placed = tracks[t].length;
      if (trackQueues[t].length > placed) {
        unassigned.push(...trackQueues[t].slice(placed));
      }
    }

    if (unassigned.length > 0) {
      for (let t = 0; t < trackDefs.length && unassigned.length > 0; t++) {
        const trackSlots = tracks[t];
        for (let i = 0; i < trackSlots.length && unassigned.length > 0; i++) {
          if (seatedCount >= effectiveCap) break;
          const slot = trackSlots[i];
          if (!slot.bench[slot.seatKey]) {
            const student = unassigned.shift();
            slot.bench[slot.seatKey] = student;
            seatedCount++;
            if (typeof onAssign === 'function') {
              onAssign(slot.bench, slot.seatKey, slot.pos, {
                student,
                dept: student.department,
                code: student.subjectCode || '',
                isSecondary: student.isSecondary
              });
            }
          }
        }
      }
    }
  }

  return { seatedCount };
}

// Helper to perform seating generation for a single exam and hall
async function generateSeatingPlan(examId, hallId) {
  const exam = await Models.Exam.findById(examId);
  let hall = null;
  if (exam && exam.hallSnapshots) {
    hall = exam.hallSnapshots[String(hallId)] || 
           exam.hallSnapshots[hallId] || 
           (typeof hallId === 'string' && Object.values(exam.hallSnapshots).find(s => s.name === hallId || String(s._id) === hallId));
  }
  if (!hall) {
    hall = await resolveHall(hallId);
  }

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
  // CRITICAL: Always use the exam's saved hallSnapshots if available to guarantee that hall setting changes do not alter existing exams!
  const assignedHallsInOrder = exam.assignedHalls.map(hallName => {
    if (exam.hallSnapshots) {
      const snap = exam.hallSnapshots[hallName] || 
                   exam.hallSnapshots[String(hallName)] ||
                   Object.values(exam.hallSnapshots).find(s => s.name === hallName || String(s._id) === String(hallName));
      if (snap) return snap;
    }
    return allHalls.find(h => h.name === hallName || String(h._id) === String(hallName));
  }).filter(Boolean);

  const maxBatchInfo = getMaxStudentBatchInfo(allStudents);

  // Helper to dynamically sort students within any pool: Level -> Dept -> Year -> Arrear -> RegNo
  // STRICT USER RULE: First finish one department completely, in 1st Year -> 2nd Year -> 3rd Year -> Arrear order!
  const sortStudentsByDeptAndReg = (students, subCode = '') => {
    return [...students].sort((a, b) => {
      const sSubA = getMatchingSubCodeForStudent(a, examSubCodes) || subCode;
      const sSubB = getMatchingSubCodeForStudent(b, examSubCodes) || subCode;
      const deptA = resolveStudentDepartment(a, a.registerNo, a.department);
      const deptB = resolveStudentDepartment(b, b.registerNo, b.department);
      const lvlA = getAcademicLevel(a, deptA, a.degree, sSubA);
      const lvlB = getAcademicLevel(b, deptB, b.degree, sSubB);

      // 1. Course code order (strictly matching the exact user click/selection order of exam.subjectCodes)
      const upperExamSubs = (examSubCodes || []).map(c => String(c).trim().toUpperCase());
      const idxA = upperExamSubs.indexOf(String(sSubA).trim().toUpperCase());
      const idxB = upperExamSubs.indexOf(String(sSubB).trim().toUpperCase());
      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
      if (idxA !== -1 && idxB === -1) return -1;
      if (idxA === -1 && idxB !== -1) return 1;

      // 2. Academic Level (UG first, then PG)
      if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;

      // 3. Department alphabetical order
      const deptComp = deptA.localeCompare(deptB);
      if (deptComp !== 0) return deptComp;

      // 4. Register Number strictly natural ascending order (e.g. C3 before C5, C5 before C6)
      const regA = String(a.registerNo || '').trim();
      const regB = String(b.registerNo || '').trim();
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });
  };

  // Initial student pool for this exam (by subject codes or departments, minus anyone seated in OTHER exams)
  let currentPool = allStudents.filter(s => {
    if (examSubCodes.length > 0) {
      if (!hasMatchingSubCode(s, examSubCodes)) return false;
    } else {
      if (!examDepts.includes((s.department || '').toUpperCase())) return false;
    }
    if (seatedStudentRegNos.has(s.registerNo)) return false;
    return true;
  });

  currentPool = sortStudentsByDeptAndReg(currentPool);

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
    if (otherExamsDepts.has((s.department || '').toUpperCase())) return true;
    return false;
  });

  secondaryPool = sortStudentsByDeptAndReg(secondaryPool);

  // 1. Group candidate students strictly by Selected Subject-Code Priority
  const orderedSubCodes = (examSubCodes && examSubCodes.length > 0)
    ? examSubCodes
    : (examDepts && examDepts.length > 0 ? examDepts : ['GENERAL']);

  const subjectPools = orderedSubCodes.map(code => ({
    code,
    dept: '',
    students: []
  }));

  const assignedRegs = new Set();
  orderedSubCodes.forEach((code, cIdx) => {
    allStudents.forEach(s => {
      if (assignedRegs.has(s.registerNo) || seatedStudentRegNos.has(s.registerNo)) return;
      let matched = false;
      if (examSubCodes.length > 0) {
        if (s.subjectCode && String(s.subjectCode).trim().toUpperCase() === code) {
          matched = true;
        } else if (hasMatchingSubCode(s, [code])) {
          matched = true;
        }
      } else {
        if ((s.department || '').trim().toUpperCase() === code) {
          matched = true;
        }
      }
      if (matched) {
        assignedRegs.add(s.registerNo);
        let rawDept = s.department;
        if (!rawDept || rawDept === 'GENERAL' || rawDept === 'UNKNOWN') {
          if (s.csvData && typeof s.csvData === 'object') {
            const k = Object.keys(s.csvData).find(key => /dept|depart|branch|course|degree|programme|prog/i.test(key));
            if (k && s.csvData[k]) rawDept = s.csvData[k];
          }
        }
        const resolvedDept = resolveStudentDepartment(s, s.registerNo, rawDept);
        const canonicalDept = canonicalizeDegree(resolvedDept) || resolvedDept || 'GENERAL';
        s.department = canonicalDept;
        s.subjectCode = code;
        subjectPools[cIdx].students.push(s);
        if (!subjectPools[cIdx].dept) subjectPools[cIdx].dept = canonicalDept;
      }
    });
  });

  // Sort students within each pool strictly in natural ascending register number order
  subjectPools.forEach(p => {
    p.students.sort((a, b) => {
      const regA = String(a.registerNo || '').trim();
      const regB = String(b.registerNo || '').trim();
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });
  });

  const initialPoolForUnseated = subjectPools.flatMap(p => [...p.students]);
  // Track which subject-code pools have been started (partially allocated) so they get
  // first priority in subsequent halls, preventing skipped students mid-group.
  const inProgressPoolCodes = new Set(); // pool.code values that started but have remaining students
  // Store each pool's original selection-priority index so ordering is stable across halls
  const subjectPoolOriginalIndex = new Map();
  subjectPools.forEach((p, idx) => subjectPoolOriginalIndex.set(p, idx));

  // Secondary candidate queue for other exams scheduled at the same date/session
  const secondaryQueue = [];
  if (secondaryPool.length > 0) {
    const secDeptGroups = new Map();
    secondaryPool.forEach(s => {
      let rawDept = s.department;
      if (!rawDept || rawDept === 'GENERAL' || rawDept === 'UNKNOWN') {
        if (s.csvData && typeof s.csvData === 'object') {
          const k = Object.keys(s.csvData).find(key => /dept|depart|branch|course|degree|programme|prog/i.test(key));
          if (k && s.csvData[k]) rawDept = s.csvData[k];
        }
      }
      const resolvedDept = resolveStudentDepartment(s, s.registerNo, rawDept);
      const canonicalDept = canonicalizeDegree(resolvedDept) || resolvedDept || 'GENERAL';
      const sSub = getMatchingSubCodeForStudent(s, Array.from(otherExamsSubCodes)) || getStudentSubCode(s) || '';
      s.department = canonicalDept;
      s.subjectCode = sSub;
      s.isSecondary = true;

      if (!secDeptGroups.has(canonicalDept)) secDeptGroups.set(canonicalDept, []);
      secDeptGroups.get(canonicalDept).push(s);
    });

    secDeptGroups.forEach((stList, dept) => {
      stList.sort((a, b) => {
        const lvlA = getAcademicLevel(a, dept, a.degree, a.subjectCode);
        const lvlB = getAcademicLevel(b, dept, b.degree, b.subjectCode);
        if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;
        return (a.registerNo || '').localeCompare(b.registerNo || '');
      });
    });

    const secDepts = Array.from(secDeptGroups.keys()).sort((a, b) => a.localeCompare(b));
    secDepts.forEach(d => {
      secondaryQueue.push(...(secDeptGroups.get(d) || []));
    });
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

    const seatsPerBench = (h && h.seatsPerBench) ? parseInt(h.seatsPerBench) : ((exam && exam.seatsPerBench) ? parseInt(exam.seatsPerBench) : 2);
    const targetBenches = (h && h.benches && parseInt(h.benches) > 0)
      ? parseInt(h.benches)
      : (h && h.capacity && parseInt(h.capacity) > 0 ? Math.round(parseInt(h.capacity) / seatsPerBench) : 0);

    let colRowsList = (Array.isArray(rawColRows) && rawColRows.length >= colsCount)
      ? rawColRows.slice(0, colsCount).map(n => Math.max(1, parseInt(n) || 1))
      : Array(colsCount).fill(Math.max(1, parseInt(h.rows) || 1));

    if (targetBenches > 0 && colRowsList.reduce((sum, r) => sum + r, 0) !== targetBenches) {
      const base = Math.floor(targetBenches / colsCount);
      const rem = targetBenches % colsCount;
      colRowsList = Array(colsCount).fill(base);
      for (let i = 0; i < rem; i++) colRowsList[i]++;
    }

    const rowsCount = Math.max(...colRowsList, parseInt(h.rows) || 1);
    const totalBenchesInHall = colRowsList.reduce((sum, r) => sum + r, 0) || (rowsCount * colsCount);
    const maxHallCap = (h && h.capacity && parseInt(h.capacity) > 0)
      ? parseInt(h.capacity)
      : (totalBenchesInHall * seatsPerBench);
    const totalSeats = maxHallCap > 0 ? maxHallCap : (totalBenchesInHall * seatsPerBench);
    const currentHallIdStr = String(h._id);
    const currentHallNameLower = (h.name || '').trim().toLowerCase();

    const secondarySeatedByExam = {};

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

    const occupiedInOtherExams = otherPlansForThisHall.reduce((acc, p) => acc + (p.attendanceRoster ? p.attendanceRoster.length : 0), 0);
    const availableCap = Math.max(0, (maxHallCap > 0 ? maxHallCap : totalSeats) - occupiedInOtherExams);

    // Pull students for this hall using Strict Subject-Code Distribution
    let remainingNeeded = availableCap;
    const hallStudents = [];

    // Target per group across B benches is B students (1 per bench)
    const targetPerGroup = totalBenchesInHall;

    // Group active subject pools by Course/Department identity so multiple subject codes under the same department do not crowd out distinct departments
    const courseMap = new Map();
    subjectPools.forEach(p => {
      const sampleStudent = p.students[0];
      const dId = sampleStudent ? getStudentCourseIdentity(sampleStudent) : (p.dept || p.code);
      if (!courseMap.has(dId)) {
        courseMap.set(dId, []);
      }
      courseMap.get(dId).push(p);
    });

    const distinctCourseList = Array.from(courseMap.values());
    // CRITICAL: Sort so that in-progress pools (started in a previous hall but still have
    // remaining students) come FIRST, preserving their original selection priority among themselves.
    // Untouched pools follow, also in their original selection-priority order.
    // This guarantees that hall N+1 continues from exactly where hall N left off.
    distinctCourseList.sort((a, b) => {
      const aHasInProgress = a.some(p => inProgressPoolCodes.has(p.code) && p.students.length > 0);
      const bHasInProgress = b.some(p => inProgressPoolCodes.has(p.code) && p.students.length > 0);
      if (aHasInProgress && !bHasInProgress) return -1;
      if (!aHasInProgress && bHasInProgress) return 1;
      // Within the same tier (both in-progress or both untouched), preserve original selection order
      const minIdxA = Math.min(...a.map(p => subjectPoolOriginalIndex.get(p) ?? Infinity));
      const minIdxB = Math.min(...b.map(p => subjectPoolOriginalIndex.get(p) ?? Infinity));
      return minIdxA - minIdxB;
    });

    const allocations = new Map();
    subjectPools.forEach(p => allocations.set(p, 0));

    // Step 1: Base target allocation across top active distinct courses (up to seatsPerBench courses)
    const activeCourses = distinctCourseList.filter(cPools => cPools.some(p => p.students && p.students.length > 0));
    const primaryCourses = activeCourses.slice(0, seatsPerBench);
    const tracksPerCourse = Math.floor(seatsPerBench / Math.max(1, primaryCourses.length));
    let extraTracks = seatsPerBench % Math.max(1, primaryCourses.length);

    for (const cPools of primaryCourses) {
      if (remainingNeeded <= 0) break;
      const courseTarget = targetPerGroup * (tracksPerCourse + (extraTracks > 0 ? 1 : 0));
      if (extraTracks > 0) extraTracks--;

      let courseNeeded = Math.min(courseTarget, remainingNeeded);
      for (const p of cPools) {
        if (courseNeeded <= 0) break;
        const canTake = Math.min(courseNeeded, p.students.length);
        allocations.set(p, canTake);
        courseNeeded -= canTake;
        remainingNeeded -= canTake;
      }
    }

    // Step 2: If capacity remains, distribute across other courses in selection priority order
    if (remainingNeeded > 0) {
      const otherCourses = activeCourses.slice(seatsPerBench);
      for (const cPools of otherCourses) {
        if (remainingNeeded <= 0) break;
        let courseNeeded = Math.min(targetPerGroup, remainingNeeded);
        for (const p of cPools) {
          if (courseNeeded <= 0) break;
          const canTake = Math.min(courseNeeded, p.students.length);
          allocations.set(p, canTake);
          courseNeeded -= canTake;
          remainingNeeded -= canTake;
        }
      }
    }

    // Step 3: If capacity STILL remains, fill from any groups with students left in selection priority order
    if (remainingNeeded > 0) {
      for (const p of subjectPools) {
        if (remainingNeeded <= 0) break;
        const alreadyAllocated = allocations.get(p) || 0;
        const availableInPool = p.students.length - alreadyAllocated;
        if (availableInPool > 0) {
          const takeMore = Math.min(availableInPool, remainingNeeded);
          allocations.set(p, alreadyAllocated + takeMore);
          remainingNeeded -= takeMore;
        }
      }
    }

    // Splice allocated students from pools into hallStudents
    // Maintain subjectPools order for hallStudents so track assignment inside the hall is stable
    for (const p of subjectPools) {
      const count = allocations.get(p) || 0;
      if (count > 0) {
        const taken = p.students.splice(0, count);
        hallStudents.push(...taken);
        // Mark this pool as in-progress if it still has remaining students after this hall
        if (p.students.length > 0) {
          inProgressPoolCodes.add(p.code);
        } else {
          // Pool fully exhausted — remove from in-progress tracking
          inProgressPoolCodes.delete(p.code);
        }
      }
    }

    // Step C: Pull secondary students from OTHER exams if capacity remains
    if (hallStudents.length < availableCap && secondaryQueue.length > 0) {
      const remainingForSec = availableCap - hallStudents.length;
      hallStudents.push(...secondaryQueue.splice(0, remainingForSec));
    }

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
          seat2: seatsPerBench >= 2 ? (occupiedSeatsInThisHall[`${benchCode}_seat2`] || null) : undefined,
          seat3: seatsPerBench === 3 ? (occupiedSeatsInThisHall[`${benchCode}_seat3`] || null) : undefined
        };
      }
    }

    // Construct list of benches in column order: Col 1 top-to-bottom (A -> B -> C), Col 2 top-to-bottom (A -> B -> C), etc.
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

    function handleSecondaryStudent(res, bench, pos) {
      const student = res.student;
      const sCode = res.code || getMatchingSubCodeForStudent(student, Array.from(otherExamsSubCodes));
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
        secondarySeatedByExam[eIdStr].students.push({ student, code: sCode, bench: bench.benchCode, seat: pos });
      }
    }

    const localRoster = [];
    let totalSeatedInThisHall = 0;

    function assignStudentToSeat(bench, seatKey, pos, res) {
      bench[seatKey] = res.student;
      totalSeatedInThisHall++;
      if (res.isSecondary) {
        handleSecondaryStudent(res, bench, pos);
      } else {
        localRoster.push({
          registerNo: res.student.registerNo,
          name: res.student.name,
          department: res.dept,
          subjectCode: res.code,
          bench: bench.benchCode,
          seat: pos
        });
      }
    }

    // Allocate students by seat position (Track-by-Track in W-order traversal)
    allocateStudentsToBenchesBySeatPosition(
      benchesList,
      hallStudents,
      seatsPerBench,
      availableCap,
      (bench, seatKey, pos, res) => {
        assignStudentToSeat(bench, seatKey, pos, res);
      }
    );

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
      hallSnapshot: h,
      date: targetDate,
      session: exam.session,
      seatingGrid: localGrid,
      attendanceRoster: sortAttendanceRoster(localRoster, examSubCodes),
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
        hallSnapshot: h,
        date: targetDate,
        session: secExam.session || exam.session,
        seatingGrid: localGrid,
        attendanceRoster: sortAttendanceRoster(secRoster, (secExam.subjectCodes || examSubCodes)),
        unseatedStudents: [],
        totalBenches: (localGrid && localGrid.filter(b => !b.isPlaceholder).length) || h.benches || totalBenchesInHall,
        totalStudents: secRoster.length,
        emptySeats: Math.max(0, emptySeatsCount)
      });
    }
  }

  // Calculate final unseated students across ALL assigned halls for this exam:
  // User Reconciliation Rule: Eligible Students = Allocated Students + Unallocated Students
  const finalSeatedRegNos = new Set();
  allCreatedPlansForThisExam.forEach(p => {
    if (p.attendanceRoster) {
      p.attendanceRoster.forEach(s => finalSeatedRegNos.add(s.registerNo));
    }
  });

  const finalUnseatedForExam = initialPoolForUnseated
    .filter(s => !finalSeatedRegNos.has(s.registerNo))
    .sort((a, b) => (a.registerNo || '').localeCompare(b.registerNo || ''));

  // Update all generated plans for this exam so they reflect the true remaining unseated students
  for (const p of allCreatedPlansForThisExam) {
    p.unseatedStudents = finalUnseatedForExam;
    try {
      await Models.SeatingPlan.findByIdAndUpdate(p._id, { unseatedStudents: finalUnseatedForExam });
    } catch (_) {}
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
    try {
      const exam = await Models.Exam.findById(examId);
      if (exam) await syncDateRecordSnapshot(exam.date, exam.session);
    } catch (_) {}
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dedicated endpoint to update Hall Layout (rows & columns) for a specific exam date/session
app.post('/api/seating/update-layout', async (req, res) => {
  try {
    const { date, session, hallId, examId, rows, columns, columnRows, benches, seatsPerBench } = req.body;
    if (!date || !session || !hallId) {
      return res.status(400).json({ error: 'date, session, and hallId are required.' });
    }

    const newCols = parseInt(columns);
    if (!newCols || isNaN(newCols) || newCols < 1) {
      return res.status(400).json({ error: 'Columns must be a positive integer.' });
    }

    let parsedColumnRows = [];
    if (Array.isArray(columnRows) && columnRows.length > 0) {
      parsedColumnRows = columnRows.slice(0, newCols).map(n => Math.max(1, parseInt(n) || 1));
      while (parsedColumnRows.length < newCols) {
        parsedColumnRows.push(parseInt(rows) || 1);
      }
    } else {
      const r = Math.max(1, parseInt(rows) || 1);
      parsedColumnRows = Array(newCols).fill(r);
    }

    const maxRows = Math.max(...parsedColumnRows);
    const newTotalBenches = parsedColumnRows.reduce((a, b) => a + b, 0);

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

    // Determine seatsPerBench: request override -> snapshot -> exam -> hall -> fallback 2
    let effectiveSpb = parseInt(seatsPerBench);
    if (!effectiveSpb || isNaN(effectiveSpb)) {
      const snapSpb = examsAtTime[0].hallSnapshots && (
        examsAtTime[0].hallSnapshots[hallId]?.seatsPerBench ||
        (hall && examsAtTime[0].hallSnapshots[hall.name]?.seatsPerBench) ||
        (hall && examsAtTime[0].hallSnapshots[String(hall._id)]?.seatsPerBench)
      );
      effectiveSpb = snapSpb || examsAtTime[0].seatsPerBench || (hall && hall.seatsPerBench) || 2;
    }
    const newCapacity = newTotalBenches * effectiveSpb;

    // Physical template capacity check removed to allow flexible row/column customization for exams

    // Retrieve existing seating plans for this hall on this date/session
    const allPlans = await Models.SeatingPlan.find();
    const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
    const plansForHall = allPlans.filter(p => 
      examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
    );

    const hallName = (hall && hall.name) || (plansForHall[0] && plansForHall[0].hallName) || String(hallId);

    const updatedSnapshot = {
      _id: (hall && hall._id) || hallId,
      name: hallName,
      block: (hall && hall.block) || '',
      columns: newCols,
      rows: maxRows,
      columnRows: parsedColumnRows,
      benches: newTotalBenches,
      capacity: newCapacity,
      seatsPerBench: effectiveSpb
    };

    // If no seating plan was generated yet, simply update exam.hallSnapshots and return
    if (plansForHall.length === 0) {
      for (const ex of examsAtTime) {
        if (!ex.hallSnapshots) ex.hallSnapshots = {};
        const keysToUpdate = [hallId, String(hallId), hallName];
        if (hall) {
          keysToUpdate.push(String(hall._id));
          keysToUpdate.push(hall.name);
        }
        keysToUpdate.forEach(k => {
          ex.hallSnapshots[k] = { ...(ex.hallSnapshots[k] || {}), ...updatedSnapshot };
        });
        await Models.Exam.findByIdAndUpdate(ex._id, { ...ex, hallSnapshots: ex.hallSnapshots });
      }

      return res.json({
        success: true,
        message: 'Hall layout snapshot updated for exam(s).',
        snapshot: updatedSnapshot
      });
    }

    // 1. Extract currently seated students from existing grid in exact serpentine allocation order
    const primaryPlan = plansForHall[0];
    const oldSnapshot = primaryPlan.hallSnapshot || {};
    const oldCols = oldSnapshot.columns || primaryPlan.columns || 4;
    const oldColRows = Array.isArray(oldSnapshot.columnRows) && oldSnapshot.columnRows.length >= oldCols
      ? oldSnapshot.columnRows.slice(0, oldCols)
      : Array(oldCols).fill(oldSnapshot.rows || 6);

    // Merge grids if multiple plans exist
    const baseGrid = JSON.parse(JSON.stringify(primaryPlan.seatingGrid || []));
    const benchMap = new Map();
    baseGrid.forEach(b => {
      if (b && b.benchCode) benchMap.set(b.benchCode, b);
    });
    for (let i = 1; i < plansForHall.length; i++) {
      const otherGrid = plansForHall[i].seatingGrid;
      if (Array.isArray(otherGrid)) {
        otherGrid.forEach(b => {
          if (b && b.benchCode && benchMap.has(b.benchCode)) {
            const target = benchMap.get(b.benchCode);
            if (!target.seat1 && b.seat1) target.seat1 = b.seat1;
            if (!target.seat2 && b.seat2) target.seat2 = b.seat2;
            if (b.seat3 !== undefined && !target.seat3 && b.seat3) target.seat3 = b.seat3;
          }
        });
      }
    }

    // Collect all seated students along serpentine path
    const seatedStudents = [];
    const collectedRegNos = new Set();

    let maxColFound = oldCols;
    const colMaxRowMapOld = new Map();
    for (const [code] of benchMap.entries()) {
      const m = code.match(/^([A-Za-z]+)(\d+)$/);
      if (m) {
        const rIdx = getRowIndex(m[1]);
        const cNum = parseInt(m[2], 10);
        if (cNum > maxColFound) maxColFound = cNum;
        const cur = colMaxRowMapOld.get(cNum) || 0;
        if (rIdx + 1 > cur) colMaxRowMapOld.set(cNum, rIdx + 1);
      }
    }

    for (let c = 1; c <= maxColFound; c++) {
      const rowsForCol = Math.max(
        colMaxRowMapOld.get(c) || 0,
        oldColRows[c - 1] !== undefined ? oldColRows[c - 1] : Math.max(1, Math.ceil(baseGrid.length / oldCols))
      );
      if (c % 2 === 1) { // Odd col: top to bottom
        for (let r = 0; r < rowsForCol; r++) {
          const code = `${getRowLetter(r)}${c}`;
          const bench = benchMap.get(code);
          if (bench) {
            if (bench.seat1 && bench.seat1.registerNo && !collectedRegNos.has(bench.seat1.registerNo)) {
              seatedStudents.push(bench.seat1);
              collectedRegNos.add(bench.seat1.registerNo);
            }
            if (bench.seat2 && bench.seat2.registerNo && !collectedRegNos.has(bench.seat2.registerNo)) {
              seatedStudents.push(bench.seat2);
              collectedRegNos.add(bench.seat2.registerNo);
            }
            if (bench.seat3 && bench.seat3.registerNo && !collectedRegNos.has(bench.seat3.registerNo)) {
              seatedStudents.push(bench.seat3);
              collectedRegNos.add(bench.seat3.registerNo);
            }
          }
        }
      } else { // Even col: bottom to top
        for (let r = rowsForCol - 1; r >= 0; r--) {
          const code = `${getRowLetter(r)}${c}`;
          const bench = benchMap.get(code);
          if (bench) {
            if (bench.seat1 && bench.seat1.registerNo && !collectedRegNos.has(bench.seat1.registerNo)) {
              seatedStudents.push(bench.seat1);
              collectedRegNos.add(bench.seat1.registerNo);
            }
            if (bench.seat2 && bench.seat2.registerNo && !collectedRegNos.has(bench.seat2.registerNo)) {
              seatedStudents.push(bench.seat2);
              collectedRegNos.add(bench.seat2.registerNo);
            }
            if (bench.seat3 && bench.seat3.registerNo && !collectedRegNos.has(bench.seat3.registerNo)) {
              seatedStudents.push(bench.seat3);
              collectedRegNos.add(bench.seat3.registerNo);
            }
          }
        }
      }
    }

    // Safety sweep in case any bench was outside the computed bounds
    baseGrid.forEach(b => {
      if (b && !b.isPlaceholder) {
        [b.seat1, b.seat2, b.seat3].forEach(s => {
          if (s && s.registerNo && !collectedRegNos.has(s.registerNo)) {
            seatedStudents.push(s);
            collectedRegNos.add(s.registerNo);
          }
        });
      }
    });

    const totalAssignedStudents = seatedStudents.length;

    // 2. Validate capacity: new capacity must accommodate all currently assigned students
    if (newCapacity < totalAssignedStudents) {
      return res.status(400).json({
        error: `Cannot update layout: New capacity (${newCapacity} seats) cannot accommodate the ${totalAssignedStudents} students currently assigned to this hall.`
      });
    }

    // Sort seatedStudents deterministically by course identity and register number to preserve department consecutive order
    seatedStudents.sort((a, b) => {
      const idA = getStudentCourseIdentity(a);
      const idB = getStudentCourseIdentity(b);
      if (idA !== idB) return idA.localeCompare(idB);
      return (a.registerNo || '').localeCompare(b.registerNo || '');
    });

    // 3. Build new gridMap and newBenchesList in serpentine W-order
    const newGridMap = {};
    for (let c = 1; c <= newCols; c++) {
      const rowsInCol = parsedColumnRows[c - 1];
      for (let r = 0; r < rowsInCol; r++) {
        const rowLetter = getRowLetter(r);
        const benchCode = `${rowLetter}${c}`;
        newGridMap[benchCode] = {
          benchCode,
          row: rowLetter,
          col: c,
          seat1: null,
          seat2: effectiveSpb >= 2 ? null : undefined,
          seat3: effectiveSpb === 3 ? null : undefined
        };
      }
    }

    const newBenchesList = [];
    for (let c = 1; c <= newCols; c++) {
      const rowsInCol = parsedColumnRows[c - 1];
      for (let r = 0; r < rowsInCol; r++) {
        const code = `${getRowLetter(r)}${c}`;
        if (newGridMap[code]) newBenchesList.push(newGridMap[code]);
      }
    }

    // 4. Deterministically place students into newBenchesList using seat-position consecutive allocation
    const studentNewCoords = new Map(); // regNo -> { bench, seat }
    allocateStudentsToBenchesBySeatPosition(
      newBenchesList,
      seatedStudents,
      effectiveSpb,
      totalAssignedStudents,
      (bench, seatKey, pos, res) => {
        studentNewCoords.set(res.student.registerNo, { bench: bench.benchCode, seat: pos });
      }
    );

    // 5. Construct newSeatingGrid in row-major order with placeholders
    const newSeatingGrid = [];
    for (let r = 0; r < maxRows; r++) {
      const rowLetter = getRowLetter(r);
      for (let c = 1; c <= newCols; c++) {
        const rowsInCol = parsedColumnRows[c - 1];
        const benchCode = `${rowLetter}${c}`;
        if (r < rowsInCol && newGridMap[benchCode]) {
          newSeatingGrid.push(newGridMap[benchCode]);
        } else {
          newSeatingGrid.push({
            benchCode: '',
            isPlaceholder: true,
            col: c,
            row: rowLetter
          });
        }
      }
    }

    const mainExam = (examId ? examsAtTime.find(e => String(e._id) === String(examId)) : null) || examsAtTime[0] || {};
    realignSeatingGridToAscending(newSeatingGrid, newCols, (mainExam.subjectCodes || []));
    newSeatingGrid.forEach(bench => {
      if (bench.isPlaceholder) return;
      if (bench.seat1) studentNewCoords.set(bench.seat1.registerNo, { bench: bench.benchCode, seat: 'Left' });
      if (bench.seat2) studentNewCoords.set(bench.seat2.registerNo, { bench: bench.benchCode, seat: bench.seat3 !== undefined ? 'Middle' : 'Right' });
      if (bench.seat3) studentNewCoords.set(bench.seat3.registerNo, { bench: bench.benchCode, seat: 'Right' });
    });

    // 6. Persist updated layout and coordinates to each SeatingPlan for this hall
    for (const p of plansForHall) {
      // Update attendance roster coordinates
      if (p.attendanceRoster && Array.isArray(p.attendanceRoster)) {
        p.attendanceRoster.forEach(student => {
          const newCoord = studentNewCoords.get(student.registerNo);
          if (newCoord) {
            student.bench = newCoord.bench;
            student.seat = newCoord.seat;
          }
        });
      }

      const emptyCount = Math.max(0, newCapacity - totalAssignedStudents);

      await Models.SeatingPlan.findByIdAndUpdate(p._id, {
        seatingGrid: newSeatingGrid,
        attendanceRoster: p.attendanceRoster,
        totalBenches: newTotalBenches,
        emptySeats: emptyCount,
        hallSnapshot: updatedSnapshot,
        date: targetDate,
        session: session
      });
    }

    // 7. Update exam.hallSnapshots on Models.Exam
    for (const ex of examsAtTime) {
      if (!ex.hallSnapshots) ex.hallSnapshots = {};
      const keysToUpdate = [hallId, String(hallId), hallName];
      if (hall) {
        keysToUpdate.push(String(hall._id));
        keysToUpdate.push(hall.name);
      }
      keysToUpdate.forEach(k => {
        ex.hallSnapshots[k] = { ...(ex.hallSnapshots[k] || {}), ...updatedSnapshot };
      });
      await Models.Exam.findByIdAndUpdate(ex._id, { ...ex, hallSnapshots: ex.hallSnapshots });
    }

    try {
      await syncDateRecordSnapshot(targetDate, session);
    } catch (_) {}

    // 8. Reconstruct merged response
    const allExamSubCodes = [];
    examsAtTime.forEach(e => {
      if (e.subjectCodes) {
        e.subjectCodes.forEach(sc => {
          if (!allExamSubCodes.includes(sc)) allExamSubCodes.push(sc);
        });
      }
    });

    const rosterFromGrid = [];
    let emptyCountFinal = 0;
    newSeatingGrid.forEach(bench => {
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
        emptyCountFinal++;
      }

      if (bench.seat2) {
        rosterFromGrid.push({
          registerNo: bench.seat2.registerNo,
          name: bench.seat2.name || '',
          department: bench.seat2.department || '',
          subjectCode: getMatchingSubCodeForStudent(bench.seat2, allExamSubCodes),
          bench: bench.benchCode,
          seat: effectiveSpb === 3 ? 'Middle' : 'Right'
        });
      } else {
        emptyCountFinal++;
      }

      if (effectiveSpb === 3) {
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
          emptyCountFinal++;
        }
      }
    });

    const mergedPlan = {
      date,
      session,
      hallId,
      examId: plansForHall[0].examId,
      hallName,
      totalBenches: newTotalBenches,
      hallSnapshot: updatedSnapshot,
      columns: newCols,
      rows: maxRows,
      columnRows: parsedColumnRows,
      subjectCodes: allExamSubCodes,
      seatingGrid: newSeatingGrid,
      attendanceRoster: sortAttendanceRoster(rosterFromGrid, allExamSubCodes),
      totalStudents: totalAssignedStudents,
      emptySeats: Math.max(0, emptyCountFinal),
      unseatedStudents: plansForHall[0].unseatedStudents || []
    };

    logActivity('hall', 'Hall Layout Updated', `Updated layout for ${hallName}: ${newCols} Cols, ${newTotalBenches} Benches (${newCapacity} Seats) for ${date} ${session}.`);

    return res.json({
      success: true,
      message: `Hall ${hallName} layout saved: ${newCols} Columns (${parsedColumnRows.join(', ')} rows) · ${newTotalBenches} Benches!`,
      plan: mergedPlan
    });
  } catch (error) {
    console.error('Error in /api/seating/update-layout:', error);
    res.status(500).json({ error: error.message || 'Internal server error while updating layout.' });
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

    // Fetch saved seating plans directly from database (never overwrite existing plans on GET)
    const allPlans = await Models.SeatingPlan.find();
    const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
    const matchedFromDb = allPlans.filter(p => 
      examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
    );
    const plansForHall = matchedFromDb;

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

    const activeSnapshot = plansForHall[0].hallSnapshot || (examsAtTime[0]?.hallSnapshots && (examsAtTime[0].hallSnapshots[hallId] || examsAtTime[0].hallSnapshots[plansForHall[0].hallName])) || null;

    // Merge complementary grids
    const mergedPlan = {
      date,
      session,
      hallId,
      examId: plansForHall[0].examId,
      hallName: plansForHall[0].hallName,
      totalBenches: plansForHall[0].totalBenches,
      hallSnapshot: activeSnapshot,
      columns: activeSnapshot?.columns || plansForHall[0].columns || (hall && hall.columns) || 4,
      rows: activeSnapshot?.rows || plansForHall[0].rows || (hall && hall.rows) || 4,
      columnRows: activeSnapshot?.columnRows || plansForHall[0].columnRows || null,
      subjectCodes: allExamSubCodes,
      seatingGrid: [],
      attendanceRoster: [],
      unseatedStudents: []
    };

    const grids = plansForHall.map(p => p.seatingGrid).filter(Boolean);
    if (grids.length > 0) {
      const baseGrid = JSON.parse(JSON.stringify(grids[0]));
      const benchMap = new Map();
      baseGrid.forEach(b => {
        if (b && b.benchCode) benchMap.set(b.benchCode, b);
      });
      for (let i = 1; i < grids.length; i++) {
        const otherGrid = grids[i];
        if (Array.isArray(otherGrid)) {
          otherGrid.forEach(bench => {
            if (bench && bench.benchCode && benchMap.has(bench.benchCode)) {
              const target = benchMap.get(bench.benchCode);
              if (!target.seat1 && bench.seat1) target.seat1 = bench.seat1;
              if (!target.seat2 && bench.seat2) target.seat2 = bench.seat2;
              if (bench.seat3 !== undefined && !target.seat3 && bench.seat3) target.seat3 = bench.seat3;
            }
          });
        }
      }
      mergedPlan.seatingGrid = baseGrid;
      realignSeatingGridToAscending(mergedPlan.seatingGrid, mergedPlan.columns, allExamSubCodes);
      for (const p of plansForHall) {
        if (p._id && p.seatingGrid) {
          realignSeatingGridToAscending(p.seatingGrid, p.columns || mergedPlan.columns, allExamSubCodes);
          try {
            await Models.SeatingPlan.findByIdAndUpdate(p._id, {
              seatingGrid: p.seatingGrid
            });
          } catch (_) {}
        }
      }
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

    try {
      await syncDateRecordSnapshot(date, session);
    } catch (_) {}

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

// Helper to build Department + Subject Code Attendance Roster pages (Subject Code -> Department-ordered, 25/page, page-segregated)
// Strictly enforces UG first, followed by PG across all pages, worksheets, and printouts
async function buildAttendanceRosterPages({ date, session, subjectCodesInput = [], departmentFilter = 'ALL', hallId = null, level = 'ALL' }) {
  const allExams = await Models.Exam.find();
  const targetDate = date ? date.split('T')[0] : '';

  // 1. Determine target exams & scheduled subject codes
  let examsAtTime = [];
  if (targetDate && session) {
    examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);
  } else {
    examsAtTime = allExams;
  }

  // Collect all subject codes scheduled at this date & session
  const scheduledSubCodesSet = new Set();
  examsAtTime.forEach(e => {
    (e.subjectCodes || []).forEach(sc => {
      const u = sc.trim().toUpperCase();
      if (u) scheduledSubCodesSet.add(u);
    });
  });

  let targetSubCodes = [];
  if (Array.isArray(subjectCodesInput) && subjectCodesInput.length > 0) {
    targetSubCodes = subjectCodesInput.map(c => String(c).trim().toUpperCase()).filter(c => c && c !== 'ALL');
  } else if (typeof subjectCodesInput === 'string' && subjectCodesInput.trim().length > 0 && subjectCodesInput.trim().toUpperCase() !== 'ALL') {
    targetSubCodes = subjectCodesInput.split(',').map(c => c.trim().toUpperCase()).filter(c => c && c !== 'ALL');
  }

  // If user didn't specify a specific subject code, target all subject codes scheduled at this date/session
  if (targetSubCodes.length === 0) {
    targetSubCodes = Array.from(scheduledSubCodesSet);
  }

  // 2. Fetch all student records and index by regNo
  const allStudents = await Models.Student.find();
  const maxBatchInfo = getMaxStudentBatchInfo(allStudents);
  const studentMapByReg = new Map();
  allStudents.forEach(s => {
    if (s.registerNo) studentMapByReg.set(s.registerNo.trim().toUpperCase(), s);
  });
  const detectedColKey = detectSubjectCodeColumn(allStudents);

  // Map students to their assigned hall if seating plans were generated
  const allPlans = await Models.SeatingPlan.find();
  const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
  const relevantPlans = allPlans.filter(p => 
    examIdsSet.has(String(p.examId)) || (p.date && p.date.split('T')[0] === targetDate && p.session === session)
  );

  const studentAllocatedHallMap = new Map();
  relevantPlans.forEach(p => {
    const hName = p.hallName || 'ALL';
    const rItems = Array.isArray(p.attendanceRoster) && p.attendanceRoster.length > 0
      ? p.attendanceRoster
      : (p.seatingGrid ? p.seatingGrid.flatMap(b => [b.seat1, b.seat2, b.seat3].filter(Boolean)) : []);
    rItems.forEach(item => {
      const reg = String(item.registerNo || '').trim().toUpperCase();
      if (reg) studentAllocatedHallMap.set(reg, hName);
    });
  });

  // 3. Hall identification and student resolution
  let hallName = 'ALL';
  let candidateStudents = [];

  if (hallId && hallId !== 'ALL') {
    const hallObj = await resolveHall(hallId);
    if (hallObj && hallObj.name) hallName = hallObj.name;
    else hallName = String(hallId);

    const hallIdMatches = new Set();
    hallIdMatches.add(String(hallId));
    if (hallObj) {
      hallIdMatches.add(String(hallObj._id));
      if (hallObj.name) hallIdMatches.add(hallObj.name);
    }

    const matchedPlans = relevantPlans.filter(p => 
      hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName)
    );

    if (matchedPlans.length > 0) {
      // Collect students allocated to this specific hall
      const seenRegs = new Set();
      matchedPlans.forEach(p => {
        const rosterItems = Array.isArray(p.attendanceRoster) && p.attendanceRoster.length > 0
          ? p.attendanceRoster
          : (p.seatingGrid ? p.seatingGrid.flatMap(b => [b.seat1, b.seat2, b.seat3].filter(Boolean)) : []);

        rosterItems.forEach(item => {
          const reg = String(item.registerNo || '').trim().toUpperCase();
          if (!reg || seenRegs.has(reg)) return;

          const dbStudent = studentMapByReg.get(reg) || item;
          let subCode = (item.subjectCode || dbStudent.subjectCode || '').trim().toUpperCase();
          if (!subCode && targetSubCodes.length > 0) {
            const studentCodes = getStudentAllSubCodes(dbStudent, detectedColKey);
            const match = studentCodes.find(c => targetSubCodes.includes(c));
            subCode = match || targetSubCodes[0];
          }

          // If a specific subject code is targeted, skip students of other subjects
          if (targetSubCodes.length > 0 && subCode && !targetSubCodes.includes(subCode)) {
            return;
          }

          const sDept = resolveStudentDepartment(dbStudent, reg, item.department);
          const sDegree = (dbStudent && dbStudent.degree) || resolveStudentDegree(dbStudent, sDept);
          const academicLevel = getAcademicLevel(dbStudent, sDept, sDegree, subCode);

          if (level && level !== 'ALL' && academicLevel !== level.toUpperCase()) {
            return;
          }

          seenRegs.add(reg);
          candidateStudents.push({
            student: dbStudent,
            registerNo: reg,
            name: item.name || dbStudent.name || '',
            subjectCode: subCode || targetSubCodes[0] || 'GENERAL',
            department: sDept,
            degree: sDegree,
            academicLevel: academicLevel,
            hallName: hallName
          });
        });
      });
    }
  }

  // If no hallId specified or 'ALL', or no seating plan found for the hall, collect from all students matching the exams
  if (candidateStudents.length === 0) {
    const seenRegs = new Set();
    allStudents.forEach(s => {
      const studentCodes = getStudentAllSubCodes(s, detectedColKey);
      let matchedSub = null;
      if (studentCodes.length > 0) {
        matchedSub = studentCodes.find(c => targetSubCodes.includes(c));
      } else {
        const sSub = (s.subjectCode || '').trim().toUpperCase();
        if (sSub && targetSubCodes.includes(sSub)) matchedSub = sSub;
        else if (targetSubCodes.length > 0) {
          const matchingExam = examsAtTime.find(e => (e.subjectCodes || []).some(sc => targetSubCodes.includes(sc.toUpperCase())));
          if (matchingExam) {
            const eDepts = (matchingExam.departments || []).map(d => d.toUpperCase());
            const sDept = resolveStudentDepartment(s, s.registerNo, s.department);
            if (eDepts.includes(sDept)) matchedSub = (matchingExam.subjectCodes && matchingExam.subjectCodes[0]) || targetSubCodes[0];
          }
        }
      }

      if (matchedSub) {
        const reg = (s.registerNo || '').trim().toUpperCase();
        if (!reg || seenRegs.has(reg)) return;

        const sDept = resolveStudentDepartment(s, reg, s.department);
        const sDegree = (s && s.degree) || resolveStudentDegree(s, sDept);
        const academicLevel = getAcademicLevel(s, sDept, sDegree, matchedSub);

        if (level && level !== 'ALL' && academicLevel !== level.toUpperCase()) {
          return;
        }

        seenRegs.add(reg);

        candidateStudents.push({
          student: s,
          registerNo: reg,
          name: s.name || '',
          subjectCode: matchedSub,
          department: sDept,
          degree: sDegree,
          academicLevel: academicLevel,
          hallName: studentAllocatedHallMap.get(reg) || hallName
        });
      }
    });
  }

  // Group candidate students: Primary by Academic Level ('UG' first, then 'PG')
  // -> Secondary by Subject Code -> Tertiary by Department -> Register No
  const allDepartmentsSet = new Set();
  const allSubjectCodesSet = new Set();
  const levelGroups = {
    UG: {},
    PG: {}
  };

  candidateStudents.forEach(cs => {
    const sc = cs.subjectCode || 'GENERAL';
    const dept = cs.department || 'GENERAL';
    const lvl = cs.academicLevel || 'UG';
    allSubjectCodesSet.add(sc);
    allDepartmentsSet.add(dept);

    if (departmentFilter && departmentFilter !== 'ALL' && departmentFilter.toUpperCase() !== dept.toUpperCase()) {
      return;
    }

    if (!levelGroups[lvl]) levelGroups[lvl] = {};
    if (!levelGroups[lvl][sc]) levelGroups[lvl][sc] = {};
    if (!levelGroups[lvl][sc][dept]) levelGroups[lvl][sc][dept] = [];
    levelGroups[lvl][sc][dept].push(cs);
  });

  // Ensure all scheduled subject codes are present in the list of available codes
  scheduledSubCodesSet.forEach(sc => allSubjectCodesSet.add(sc));

  const allPages = [];
  // STRICT USER RULE: First UG must be shown, after that PG must be shown in attendance sheet!
  const levelOrder = ['UG', 'PG'];

  levelOrder.forEach(lvl => {
    const subCodeMap = levelGroups[lvl] || {};
    const scheduledSubCodesList = targetSubCodes.length > 0 ? targetSubCodes : Array.from(scheduledSubCodesSet);
    const sortedSubCodes = Object.keys(subCodeMap).sort((a, b) => {
      const idxA = scheduledSubCodesList.indexOf(a.toUpperCase());
      const idxB = scheduledSubCodesList.indexOf(b.toUpperCase());
      if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
      if (idxA !== -1 && idxB === -1) return -1;
      if (idxA === -1 && idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    sortedSubCodes.forEach(subCode => {
      const deptMap = subCodeMap[subCode];
      const sortedDepts = Object.keys(deptMap).sort((a, b) => a.localeCompare(b));

      sortedDepts.forEach(deptName => {
        const groupStudents = deptMap[deptName];
        if (!groupStudents || groupStudents.length === 0) return;

        // STRICT USER RULE: Register Number strictly in natural ascending order (e.g. C5 before C6)
        groupStudents.sort((a, b) => {
          const regA = String(a.registerNo || '').trim().toUpperCase();
          const regB = String(b.registerNo || '').trim().toUpperCase();
          return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
        });

        // STRICT CHUNKING: Maximum 25 students per page (ST-ROST-001)
        const chunkSize = 25;
        const totalPagesForGroup = Math.ceil(groupStudents.length / chunkSize);

        for (let i = 0; i < groupStudents.length; i += chunkSize) {
          const chunk = groupStudents.slice(i, i + chunkSize);
          const pageNum = Math.floor(i / chunkSize) + 1;
          const startIndex = i + 1;

          const sampleStudent = chunk[0].student;
          const pageDegree = chunk[0].degree || resolveStudentDegree(sampleStudent, deptName);

          allPages.push({
            academicLevel: lvl,
            subjectCode: subCode,
            deptName: deptName,
            degree: pageDegree,
            students: chunk.map(c => {
              const yInfo = getStudentYearAndArrear(c.student || c, maxBatchInfo, subCode);
              return {
                registerNo: c.registerNo,
                name: c.name,
                department: deptName,
                degree: pageDegree,
                academicLevel: lvl,
                academicYear: yInfo.year,
                yearLabel: yInfo.yearLabel,
                isArrear: yInfo.isArrear,
                subjectCode: subCode,
                hallName: c.hallName || hallName
              };
            }),
            totalDeptStudents: groupStudents.length,
            pageNum: pageNum,
            totalPages: totalPagesForGroup,
            startIndex: startIndex,
            hallName: hallName
          });
        }
        // When this department finishes, ANY balance space (25 - chunk.length)
        // remains empty/padded on this sheet. The next department will NEVER fill into it
        // and will start fresh on allPages[next] / on the next sheet!
      });
    });
  });

  // Sort Subject Codes & Departments with UG first, PG second for dropdown options (preserving course code sequence)
  const scheduledSubCodesList = targetSubCodes.length > 0 ? targetSubCodes : Array.from(scheduledSubCodesSet);
  const sortSubList = (list) => [...list].sort((a, b) => {
    const idxA = scheduledSubCodesList.indexOf(a.toUpperCase());
    const idxB = scheduledSubCodesList.indexOf(b.toUpperCase());
    if (idxA !== -1 && idxB !== -1 && idxA !== idxB) return idxA - idxB;
    if (idxA !== -1 && idxB === -1) return -1;
    if (idxA === -1 && idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const ugSubCodes = sortSubList(Array.from(allSubjectCodesSet).filter(sc => getAcademicLevel(null, '', '', sc) === 'UG'));
  const pgSubCodes = sortSubList(Array.from(allSubjectCodesSet).filter(sc => getAcademicLevel(null, '', '', sc) === 'PG'));
  const sortedSubCodesResult = [...ugSubCodes, ...pgSubCodes];

  const ugDepts = Array.from(allDepartmentsSet).filter(d => getAcademicLevel(null, d, '', '') === 'UG').sort();
  const pgDepts = Array.from(allDepartmentsSet).filter(d => getAcademicLevel(null, d, '', '') === 'PG').sort();
  const sortedDeptsResult = [...ugDepts, ...pgDepts];

  return {
    date: targetDate,
    session: session || '',
    subjectCodes: sortedSubCodesResult,
    departments: sortedDeptsResult,
    pages: allPages,
    totalStudents: candidateStudents.length
  };
}

// Helper to inject Legal paper size (paperSize="5"), portrait orientation, margins, and fitToPage in OpenXML worksheet XML
function applyLegalPaperSizeToXlsxBuffer(buffer) {
  try {
    const zlib = require('zlib');
    const files = [];
    let pos = 0;
    while (pos < buffer.length - 4) {
      if (buffer[pos] === 0x50 && buffer[pos+1] === 0x4B && buffer[pos+2] === 0x03 && buffer[pos+3] === 0x04) {
        const compMethod = buffer.readUInt16LE(pos + 8);
        const modTime = buffer.readUInt16LE(pos + 10);
        const modDate = buffer.readUInt16LE(pos + 12);
        const compSize = buffer.readUInt32LE(pos + 18);
        const uncompSize = buffer.readUInt32LE(pos + 22);
        const fnameLen = buffer.readUInt16LE(pos + 26);
        const extraLen = buffer.readUInt16LE(pos + 28);
        const fname = buffer.toString('utf8', pos + 30, pos + 30 + fnameLen);
        const dataStart = pos + 30 + fnameLen + extraLen;
        const rawData = buffer.subarray(dataStart, dataStart + compSize);
        let content;
        if (compMethod === 8) {
          content = zlib.inflateRawSync(rawData);
        } else {
          content = rawData;
        }
        files.push({ name: fname, content: content, modTime, modDate });
        pos = dataStart + compSize;
      } else {
        pos++;
      }
    }

    let modified = false;
    for (const file of files) {
      if (file.name.startsWith('xl/worksheets/sheet') && file.name.endsWith('.xml')) {
        let xml = file.content.toString('utf8');
        if (!xml.includes('<pageSetUpPr')) {
          if (xml.includes('<sheetViews>')) {
            xml = xml.replace('<sheetViews>', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>');
          } else if (xml.includes('<sheetData')) {
            xml = xml.replace('<sheetData', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData');
          }
        }
        const legalPageSetupXml = '<pageSetup paperSize="5" orientation="portrait" fitToWidth="1" fitToHeight="0" scale="100"/>';
        if (!xml.includes('<pageSetup')) {
          if (xml.includes('</worksheet>')) {
            xml = xml.replace('</worksheet>', legalPageSetupXml + '</worksheet>');
          }
        } else {
          xml = xml.replace(/<pageSetup[^>]*\/>/g, legalPageSetupXml);
        }
        file.content = Buffer.from(xml, 'utf8');
        modified = true;
      }
    }

    if (modified) {
      const localChunks = [];
      const cdChunks = [];
      let curOffset = 0;

      for (const file of files) {
        const uncomp = file.content;
        const comp = zlib.deflateRawSync(uncomp);
        const crc = zlib.crc32(uncomp);
        const fnameBuf = Buffer.from(file.name, 'utf8');

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0, 6);
        lh.writeUInt16LE(8, 8);
        lh.writeUInt16LE(file.modTime || 0, 10);
        lh.writeUInt16LE(file.modDate || 0, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(comp.length, 18);
        lh.writeUInt32LE(uncomp.length, 22);
        lh.writeUInt16LE(fnameBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        localChunks.push(lh, fnameBuf, comp);

        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0);
        cdh.writeUInt16LE(20, 4);
        cdh.writeUInt16LE(20, 6);
        cdh.writeUInt16LE(0, 8);
        cdh.writeUInt16LE(8, 10);
        cdh.writeUInt16LE(file.modTime || 0, 12);
        cdh.writeUInt16LE(file.modDate || 0, 14);
        cdh.writeUInt32LE(crc, 16);
        cdh.writeUInt32LE(comp.length, 20);
        cdh.writeUInt32LE(uncomp.length, 24);
        cdh.writeUInt16LE(fnameBuf.length, 28);
        cdh.writeUInt16LE(0, 30);
        cdh.writeUInt16LE(0, 32);
        cdh.writeUInt16LE(0, 34);
        cdh.writeUInt16LE(0, 36);
        cdh.writeUInt32LE(0, 38);
        cdh.writeUInt32LE(curOffset, 42);
        cdChunks.push(cdh, fnameBuf);

        curOffset += 30 + fnameBuf.length + comp.length;
      }

      const cdOffset = curOffset;
      const cdBuf = Buffer.concat(cdChunks);
      const cdSize = cdBuf.length;

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(files.length, 8);
      eocd.writeUInt16LE(files.length, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdOffset, 16);
      eocd.writeUInt16LE(0, 20);

      return Buffer.concat([...localChunks, cdBuf, eocd]);
    }
  } catch (e) {
    console.warn('Could not inject legal pageSetup into xlsx archive:', e);
  }
  return buffer;
}

// GET attendance roster JSON data grouped by Department + Subject Code (max 25/page)
app.get('/api/seating/attendance-roster', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId, level } = req.query;
    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId,
      level: level || 'ALL'
    });
    res.json(rosterData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export attendance roster as formatted Excel file (.xlsx) - Each Department in its own Worksheet Tab!
app.get('/api/seating/download-roster', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId, level } = req.query;

    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId,
      level: level || 'ALL'
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

    // Group pages by Level, Subject Code and Department: Each department gets its OWN Worksheet Tab in Excel!
    const deptGroups = new Map();
    rosterData.pages.forEach(page => {
      const key = `${page.academicLevel || 'UG'}___${page.subjectCode}___${page.deptName}`;
      if (!deptGroups.has(key)) {
        deptGroups.set(key, []);
      }
      deptGroups.get(key).push(page);
    });

    const usedSheetNames = new Set();

    deptGroups.forEach((pages, key) => {
      const firstPage = pages[0];
      const { deptName, subjectCode } = firstPage;
      const ws = {};
      const allMerges = [];
      const rowHeights = [];

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

      // Each 25-student page in this department is rendered as an official 25-student table with header & footer
      pages.forEach((page, pIdx) => {
        const rStart = pIdx * 40; // 40 rows per page block: 38 content rows + 2 spacer rows
        const { degree, students, startIndex, hallName } = page;
        const pageDegree = degree || resolveStudentDegree((students && students[0]), deptName);

        // Header - Unwanted underline removed
        writeCell(rStart + 0, 0, 'MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', true, 'center', 14, false, false, false);
        writeCell(rStart + 1, 0, "RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM", true, 'center', 12, false, false, false);

        writeCell(rStart + 2, 0, `DATE OF EXAM: ${formattedDate}`, true, 'left', 10);
        writeCell(rStart + 2, 3, `TIME OF EXAM : ${timeOfExam}`, true, 'right', 10);
        writeCell(rStart + 3, 0, `SUBJECT CODE: ${subjectCode.toUpperCase()}`, true, 'left', 10);
        writeCell(rStart + 3, 3, `DEGREE: ${pageDegree}`, true, 'right', 10);

        // Table Header
        writeCell(rStart + 5, 0, 'SL NO', true, 'center', 10, true, true);
        writeCell(rStart + 5, 1, 'REGISTER NUMBER', true, 'center', 10, true, true);
        writeCell(rStart + 5, 2, 'NAME OF THE CANDIDATE', true, 'center', 10, true, true);
        writeCell(rStart + 5, 3, 'SIGNATURE OF THE CANDIDATE', true, 'center', 10, true, true);

        // 25 Rows (Filled + Padded blanks with continuous SL NO)
        for (let idx = 0; idx < 25; idx++) {
          const row = rStart + 6 + idx;
          const currentSlNo = startIndex + idx;
          writeCell(row, 0, currentSlNo, false, 'center', 10, true);
          if (idx < students.length) {
            const s = students[idx];
            writeCell(row, 1, s.registerNo || '', true, 'center', 10, true);
            writeCell(row, 2, (s.name || '').toUpperCase(), false, 'left', 10, true);
            writeCell(row, 3, '', false, 'left', 10, true);
          } else {
            writeCell(row, 1, '', false, 'center', 10, true);
            writeCell(row, 2, '', false, 'left', 10, true);
            writeCell(row, 3, '', false, 'left', 10, true);
          }
        }

        const fStart = rStart + 32;
        // Footer section: consistent two-column layout (Col 0-1 Left, Col 2-3 Right)
        writeCell(fStart, 0, 'Absentees Reg. No.:', true, 'left', 10);
        writeCell(fStart, 2, 'Hall No.:', true, 'left', 10);

        writeCell(fStart + 1, 0, '', false, 'left', 10); // writing space for absentees

        writeCell(fStart + 2, 0, 'Total No. of Absentees:', true, 'left', 10);
        writeCell(fStart + 2, 2, 'Name of the Invigilator and College:', true, 'left', 10);

        writeCell(fStart + 3, 0, '', false, 'left', 10); // signature breathing space
        writeCell(fStart + 4, 0, '', false, 'left', 10); // signature breathing space

        writeCell(fStart + 5, 0, 'Signature of the Chief Superintendent', true, 'left', 10);
        writeCell(fStart + 5, 2, 'Signature of the Invigilator', true, 'left', 10);

        allMerges.push(
          { s: { r: rStart + 0, c: 0 }, e: { r: rStart + 0, c: 3 } },
          { s: { r: rStart + 1, c: 0 }, e: { r: rStart + 1, c: 3 } },
          { s: { r: rStart + 2, c: 0 }, e: { r: rStart + 2, c: 2 } },
          { s: { r: rStart + 3, c: 0 }, e: { r: rStart + 3, c: 2 } },
          { s: { r: fStart + 0, c: 0 }, e: { r: fStart + 0, c: 1 } },
          { s: { r: fStart + 0, c: 2 }, e: { r: fStart + 0, c: 3 } },
          { s: { r: fStart + 1, c: 0 }, e: { r: fStart + 1, c: 3 } },
          { s: { r: fStart + 2, c: 0 }, e: { r: fStart + 2, c: 1 } },
          { s: { r: fStart + 2, c: 2 }, e: { r: fStart + 2, c: 3 } },
          { s: { r: fStart + 5, c: 0 }, e: { r: fStart + 5, c: 1 } },
          { s: { r: fStart + 5, c: 2 }, e: { r: fStart + 5, c: 3 } }
        );

        rowHeights[rStart + 0] = { hpt: 26 };
        rowHeights[rStart + 1] = { hpt: 24 };
        rowHeights[rStart + 2] = { hpt: 20 };
        rowHeights[rStart + 3] = { hpt: 20 };
        rowHeights[rStart + 4] = { hpt: 12 };
        rowHeights[rStart + 5] = { hpt: 24 };
        for (let i = 0; i < 25; i++) {
          rowHeights[rStart + 6 + i] = { hpt: 25 };
        }
        rowHeights[rStart + 31] = { hpt: 14 }; // spacer
        rowHeights[fStart + 0] = { hpt: 20 };  // Absentees Reg. No. & Hall No.
        rowHeights[fStart + 1] = { hpt: 22 };  // writing line
        rowHeights[fStart + 2] = { hpt: 20 };  // Total Absentees & Invigilator
        rowHeights[fStart + 3] = { hpt: 24 };  // signature space
        rowHeights[fStart + 4] = { hpt: 24 };  // signature space
        rowHeights[fStart + 5] = { hpt: 24 };  // Signatures
        rowHeights[rStart + 38] = { hpt: 14 }; // inter-page spacer
        rowHeights[rStart + 39] = { hpt: 14 }; // inter-page spacer
      });

      ws['!rows'] = rowHeights;
      finalizeWorksheet(XLSXLib, ws, allMerges);
      ws['!pageSetup'] = {
        paperSize: 5,               // 5 = Legal (8.5 x 14 in)
        orientation: 'portrait',
        fitToWidth: 1,
        fitToHeight: 0,
        scale: 100
      };
      ws['!margins'] = {
        left: 0.35,
        right: 0.35,
        top: 0.5,
        bottom: 0.5,
        header: 0.3,
        footer: 0.3
      };
      ws['!cols'] = [
        { wch: 8 },  // SL NO
        { wch: 24 }, // REGISTER NUMBER
        { wch: 42 }, // NAME OF THE CANDIDATE
        { wch: 36 }  // SIGNATURE OF THE CANDIDATE
      ];

      const cleanDept = deptName.replace(/[^A-Z0-9]/gi, '').substring(0, 10);
      const cleanSub = subjectCode.replace(/[^A-Z0-9]/gi, '').substring(0, 10);
      let baseSheetName = deptGroups.size > 1 ? `${cleanSub}_${cleanDept}`.substring(0, 28) : cleanDept;
      if (!baseSheetName) baseSheetName = cleanDept || 'Sheet1';
      let sheetName = baseSheetName;
      let counter = 1;
      while (usedSheetNames.has(sheetName)) {
        sheetName = `${baseSheetName.substring(0, 25)}_${counter}`;
        counter++;
      }
      usedSheetNames.add(sheetName);
      XLSXLib.utils.book_append_sheet(wb, ws, sheetName);
    });

    let buffer = XLSXLib.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Explicitly configure Legal paper (paperSize="5"), orientation, margins, and fitToPage in OpenXML worksheet XML
    buffer = applyLegalPaperSizeToXlsxBuffer(buffer);

    const levelPart = level && level !== 'ALL' ? `${level.toUpperCase()}_` : '';
    const subPart = subjectCodes && subjectCodes !== 'ALL' ? `${subjectCodes.replace(/[^A-Z0-9]/gi, '_')}_` : '';
    const deptPart = department && department !== 'ALL' ? `${department.replace(/[^A-Z0-9]/gi, '_')}_` : '';
    const filename = `Attendance_Roster_${levelPart}${subPart}${deptPart}${targetDate || 'Exam'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export attendance roster as printable Legal PDF file (.pdf)
app.get('/api/seating/roster/download-pdf', async (req, res) => {
  try {
    const { date, session, department, subjectCodes, hallId, level } = req.query;

    const rosterData = await buildAttendanceRosterPages({
      date,
      session,
      subjectCodesInput: subjectCodes,
      departmentFilter: department || 'ALL',
      hallId,
      level: level || 'ALL'
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
      size: 'legal', // 8.5 x 14 inches (612 x 1008 pt)
      margin: 25
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      const levelPart = level && level !== 'ALL' ? `${level.toUpperCase()}_` : '';
      const subPart = subjectCodes && subjectCodes !== 'ALL' ? `${subjectCodes.replace(/[^A-Z0-9]/gi, '_')}_` : '';
      const deptPart = department && department !== 'ALL' ? `${department.replace(/[^A-Z0-9]/gi, '_')}_` : '';
      const filename = `Attendance_Roster_${levelPart}${subPart}${deptPart}${targetDate}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfData);
    });

    const pageW = 612; // 8.5 in * 72 pt/in
    const pageH = 1008; // 14.0 in * 72 pt/in
    const margin = 25;
    const printableW = pageW - (2 * margin); // 562 pt

    rosterData.pages.forEach((page, pIdx) => {
      if (pIdx > 0) doc.addPage();

      let y = margin;

      // Header - Unwanted underline removed
      doc.font('Helvetica-Bold').fontSize(14).text('MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', margin, y, { align: 'center', width: printableW });
      y += 20;
      doc.font('Helvetica-Bold').fontSize(12).text("RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM", margin, y, { align: 'center', width: printableW });
      y += 24;

      // Meta info
      doc.font('Helvetica-Bold').fontSize(9.5);
      doc.text(`DATE OF EXAM: ${formattedDate}`, margin, y);
      doc.text(`TIME OF EXAM: ${timeOfExam}`, margin + 300, y, { align: 'right', width: printableW - 300 });
      y += 16;

      const pageDegree = page.degree || resolveStudentDegree((page.students && page.students[0]), page.deptName);
      doc.text(`SUBJECT CODE: ${page.subjectCode.toUpperCase()}`, margin, y);
      doc.text(`DEGREE: ${pageDegree}`, margin + 300, y, { align: 'right', width: printableW - 300 });
      y += 20;

      // Table Header (Width = 562)
      const colWidths = [42, 120, 235, 165];
      const colX = [
        margin,
        margin + colWidths[0],
        margin + colWidths[0] + colWidths[1],
        margin + colWidths[0] + colWidths[1] + colWidths[2]
      ];

      const headerH = 22;
      doc.rect(margin, y, printableW, headerH).fillAndStroke('#EAEAEA', '#000000');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8.5);

      doc.text('SL NO', colX[0], y + 6, { width: colWidths[0], align: 'center' });
      doc.text('REGISTER NUMBER', colX[1], y + 6, { width: colWidths[1], align: 'center' });
      doc.text('NAME OF THE CANDIDATE', colX[2] + 6, y + 6, { width: colWidths[2] - 12, align: 'left' });
      doc.text('SIGNATURE OF THE CANDIDATE', colX[3], y + 6, { width: colWidths[3], align: 'center' });
      y += headerH;

      // 25 Student Rows (filled + blank rows padded with continuous SL NO)
      const rowH = 22;
      for (let r = 0; r < 25; r++) {
        doc.rect(margin, y, printableW, rowH).stroke('#000000');
        // vertical grid lines
        doc.moveTo(colX[1], y).lineTo(colX[1], y + rowH).stroke('#000000');
        doc.moveTo(colX[2], y).lineTo(colX[2], y + rowH).stroke('#000000');
        doc.moveTo(colX[3], y).lineTo(colX[3], y + rowH).stroke('#000000');

        const currentSlNo = page.startIndex + r;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
        doc.text(`${currentSlNo}`, colX[0], y + 6, { width: colWidths[0], align: 'center' });

        if (r < page.students.length) {
          const st = page.students[r];
          doc.text(st.registerNo || '', colX[1], y + 6, { width: colWidths[1], align: 'center' });
          doc.font('Helvetica').fontSize(8.5);
          doc.text((st.name || '').toUpperCase(), colX[2] + 6, y + 6, { width: colWidths[2] - 12, align: 'left' });
        }
        y += rowH;
      }

      // Footer section - Official layout: consistent two-column alignment (Left column at margin, Right column at rightColX)
      y += 28;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
      const rightColX = margin + 280; // 305 pt (consistent right-side column boundary)

      // First row: Absentees Reg. No.: (left) and Hall No.: (right) - empty value after Hall No.:
      doc.text('Absentees Reg. No.:', margin, y);
      doc.text('Hall No.:', rightColX, y);
      y += 44;

      // Second row: Total No. of Absentees: (left) and Name of the Invigilator and College: (right)
      doc.text('Total No. of Absentees:', margin, y);
      doc.text('Name of the Invigilator and College:', rightColX, y);
      y += 76;

      // Third row: Signature of the Chief Superintendent (left) and Signature of the Invigilator (right)
      doc.text('Signature of the Chief Superintendent', margin, y);
      doc.text('Signature of the Invigilator', rightColX, y);
    });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to reverse getRowLetter (e.g. 'A' -> 0, 'B' -> 1, 'Z' -> 25, 'AA' -> 26)
function getRowIndex(rowStr) {
  if (!rowStr) return 0;
  let index = 0;
  const clean = rowStr.trim().toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    index = index * 26 + (clean.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Shared Deterministic Student Sequence Extractor for a Single Hall.
 * Groups and orders students subject code by subject code (following exam's configured subject code order),
 * and within each subject code, ordered strictly by Register Number in ascending natural order.
 */
function extractHallSavedSeatingSequence(plansForHall, hallSnapshot = null, configuredSubjectCodes = [], studentMapByReg = null) {
  if (!Array.isArray(plansForHall) || plansForHall.length === 0) {
    return [];
  }

  const snapshot = hallSnapshot || plansForHall[0].hallSnapshot || {};
  const hallName = snapshot.name || plansForHall[0].hallName || 'HALL';

  // 1. Collect all distinct students seated in this hall
  const studentMap = new Map(); // cleanReg -> studentObj

  // From seatingGrid
  plansForHall.forEach(p => {
    if (Array.isArray(p.seatingGrid)) {
      p.seatingGrid.forEach(bench => {
        if (bench && !bench.isPlaceholder) {
          ['seat1', 'seat2', 'seat3'].forEach(seatKey => {
            const st = bench[seatKey];
            if (st && st.registerNo) {
              const reg = String(st.registerNo).trim().toUpperCase();
              if (reg && !studentMap.has(reg)) {
                studentMap.set(reg, {
                  ...st,
                  registerNo: reg,
                  benchCode: bench.benchCode || '',
                  seatKey: seatKey,
                  hallName: hallName
                });
              }
            }
          });
        }
      });
    }
  });

  // From attendanceRoster (in case any seated students were only in roster or vice-versa)
  plansForHall.forEach(p => {
    if (Array.isArray(p.attendanceRoster)) {
      p.attendanceRoster.forEach(s => {
        if (s && s.registerNo) {
          const reg = String(s.registerNo).trim().toUpperCase();
          if (reg && !studentMap.has(reg)) {
            studentMap.set(reg, {
              ...s,
              registerNo: reg,
              benchCode: s.bench || '',
              seatKey: s.seat || '',
              hallName: hallName
            });
          }
        }
      });
    }
  });

  if (studentMap.size === 0) {
    return [];
  }

  // 2. Resolve true subject code for each student
  const hallStudents = Array.from(studentMap.values()).map(st => {
    let subCode = (st.subjectCode || st.code || '').trim().toUpperCase();
    if (!subCode || subCode === 'GENERAL' || subCode === 'UNKNOWN') {
      if (studentMapByReg && studentMapByReg.has(st.registerNo)) {
        const dbStudent = studentMapByReg.get(st.registerNo);
        if (dbStudent && dbStudent.subjectCode) {
          subCode = String(dbStudent.subjectCode).trim().toUpperCase();
        }
      }
    }
    if (!subCode) {
      if (st.csvData && (st.csvData['Course Code'] || st.csvData['Cousr Code'])) {
        subCode = String(st.csvData['Course Code'] || st.csvData['Cousr Code']).trim().toUpperCase();
      }
    }
    if (!subCode) {
      subCode = 'GENERAL';
    }
    return {
      ...st,
      subjectCode: subCode
    };
  });

  // 3. Group students by subjectCode
  const subCodeGroups = new Map();
  hallStudents.forEach(st => {
    const sc = st.subjectCode;
    if (!subCodeGroups.has(sc)) {
      subCodeGroups.set(sc, []);
    }
    subCodeGroups.get(sc).push(st);
  });

  // 4. Determine ordered list of subject codes
  // Priority: configuredSubjectCodes from exam, followed by any remaining subject codes alphabetically
  const orderedSubCodes = [];
  const seenSubCodes = new Set();

  if (Array.isArray(configuredSubjectCodes)) {
    configuredSubjectCodes.forEach(sc => {
      const cleanSc = String(sc).trim().toUpperCase();
      if (cleanSc && !seenSubCodes.has(cleanSc)) {
        seenSubCodes.add(cleanSc);
        if (subCodeGroups.has(cleanSc)) {
          orderedSubCodes.push(cleanSc);
        }
      }
    });
  }

  // Any remaining subject codes present in this hall
  const remainingSubCodes = [];
  for (const sc of subCodeGroups.keys()) {
    if (!seenSubCodes.has(sc)) {
      remainingSubCodes.push(sc);
    }
  }
  remainingSubCodes.sort((a, b) => a.localeCompare(b));
  orderedSubCodes.push(...remainingSubCodes);

  // 5. Build final student sequence:
  // For each subject code in order, sort students by registerNo in ascending natural order
  const result = [];
  orderedSubCodes.forEach(sc => {
    const group = subCodeGroups.get(sc) || [];
    group.sort((a, b) => {
      const regA = String(a.registerNo || '');
      const regB = String(b.registerNo || '');
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });
    result.push(...group);
  });

  return result;
}

// Helper to extract complete seating arrangement student sequence across ALL halls for a selected Date and Session,
// ordered strictly by exam's configured Hall Order (Hall A1 -> Hall A2 -> Hall A3), preserving actual seat order from saved seating plans.
// Continuous filling across sheets (84 labels/sheet). A1 students first, then A2, then A3...
async function getAllHallsSeatingStudentSequence(date, session) {
  if (!date || !session) return { studentRegNos: [], totalStudents: 0, departmentCounts: {}, hallsProcessed: 0, studentDetails: [] };

  const targetDate = date.split('T')[0];
  const allExams = await Models.Exam.find();
  const examsAtTime = allExams.filter(e => e.date.split('T')[0] === targetDate && e.session === session);
  if (examsAtTime.length === 0) {
    return { studentRegNos: [], totalStudents: 0, departmentCounts: {}, hallsProcessed: 0, studentDetails: [] };
  }

  // Extract configured subject codes order from exams
  const configuredSubjectCodesInOrder = [];
  const seenSubCodes = new Set();
  examsAtTime.forEach(e => {
    if (Array.isArray(e.subjectCodes)) {
      e.subjectCodes.forEach(sc => {
        const cleanSc = String(sc).trim().toUpperCase();
        if (cleanSc && !seenSubCodes.has(cleanSc)) {
          seenSubCodes.add(cleanSc);
          configuredSubjectCodesInOrder.push(cleanSc);
        }
      });
    }
  });

  // Fetch saved plans for these exams directly from database
  const examIdsSet = new Set(examsAtTime.map(e => String(e._id)));
  const allPlans = await Models.SeatingPlan.find();
  const plansForTime = allPlans.filter(p => {
    const matchesExamId = examIdsSet.has(String(p.examId));
    const matchesDateSession = p.date && p.date.split('T')[0] === targetDate && p.session === session;
    return matchesExamId || matchesDateSession;
  });

  // Fetch all students to resolve true department if missing in roster/grid
  const allStudents = await Models.Student.find();
  const studentMapByReg = new Map();
  allStudents.forEach(s => {
    if (s.registerNo) studentMapByReg.set(s.registerNo.trim().toUpperCase(), s);
  });

  const allHalls = await Models.Hall.find();

  // 1. Establish configured exam hall order (preserving exam.assignedHalls sequence, e.g. A1 -> A2 -> A3)
  const configuredHallsInOrder = [];
  const seenHallKeys = new Set();

  examsAtTime.forEach(e => {
    (e.assignedHalls || []).forEach(hIdentifier => {
      const key = String(hIdentifier).trim();
      const lowerKey = key.toLowerCase();
      if (!seenHallKeys.has(lowerKey)) {
        seenHallKeys.add(lowerKey);
        let hallObj = null;
        if (e.hallSnapshots) {
          hallObj = e.hallSnapshots[key] ||
                    e.hallSnapshots[String(key)] ||
                    Object.values(e.hallSnapshots).find(s => s && (s.name === key || String(s._id) === key));
        }
        if (!hallObj) {
          hallObj = allHalls.find(h => h && (h.name === key || String(h._id) === key));
        }
        configuredHallsInOrder.push({
          identifier: key,
          hallId: hallObj ? String(hallObj._id) : key,
          hallName: hallObj ? hallObj.name : key,
          hallObj
        });
      }
    });
  });

  // Include any extra halls that have plans generated but weren't in assignedHalls
  plansForTime.forEach(p => {
    const pId = p.hallId ? String(p.hallId) : '';
    const pName = p.hallName ? String(p.hallName).trim() : '';
    const lowerPName = pName.toLowerCase();
    const alreadyIncluded = configuredHallsInOrder.some(ch => 
      (pId && ch.hallId === pId) || 
      (pName && ch.hallName.toLowerCase() === lowerPName) || 
      (pId && ch.identifier === pId) || 
      (pName && ch.identifier.toLowerCase() === lowerPName)
    );
    if (!alreadyIncluded && (pId || pName)) {
      configuredHallsInOrder.push({
        identifier: pId || pName,
        hallId: pId,
        hallName: pName || 'HALL',
        hallObj: null
      });
    }
  });

  const finalRegNos = [];
  const studentDetails = [];
  const departmentCounts = {};
  const globalSeenRegNos = new Set();
  const hallsProcessedSet = new Set();

  // 2. Iterate hall-by-hall strictly in configured hall order (Hall A1 -> Hall A2 -> Hall A3...)
  for (const ch of configuredHallsInOrder) {
    const matchingPlans = plansForTime.filter(p => {
      const pId = p.hallId ? String(p.hallId) : '';
      const pName = p.hallName ? String(p.hallName).trim().toLowerCase() : '';
      const chId = ch.hallId ? String(ch.hallId) : '';
      const chName = ch.hallName ? String(ch.hallName).trim().toLowerCase() : '';
      const chIdent = ch.identifier ? String(ch.identifier).trim().toLowerCase() : '';

      return (pId && chId && pId === chId) ||
             (pName && chName && pName === chName) ||
             (chIdent && (pId === chIdent || pName === chIdent));
    });

    if (matchingPlans.length === 0) continue;

    hallsProcessedSet.add(ch.hallName || ch.identifier);

    const hallSnapshot = ch.hallObj || (matchingPlans[0] && matchingPlans[0].hallSnapshot) || null;
    const hallStudents = extractHallSavedSeatingSequence(matchingPlans, hallSnapshot, configuredSubjectCodesInOrder, studentMapByReg);

    hallStudents.forEach(st => {
      const cleanReg = String(st.registerNo || '').trim().toUpperCase();
      if (!cleanReg) return;
      if (globalSeenRegNos.has(cleanReg)) {
        console.warn(`[Seating Plan Sequence] Warning: Student ${cleanReg} was already assigned to an earlier hall. Skipping duplicate in ${ch.hallName}.`);
        return;
      }

      globalSeenRegNos.add(cleanReg);
      finalRegNos.push(cleanReg);
      studentDetails.push({
        ...st,
        registerNo: cleanReg,
        hallName: ch.hallName || ch.identifier
      });

      const dbStudent = studentMapByReg.get(cleanReg);
      const rawDept = (st.department || (dbStudent ? dbStudent.department : '') || '').trim();
      const cleanDept = formatClassCode(rawDept, st.subjectCode || (dbStudent ? dbStudent.subjectCode : ''), cleanReg) || 'GENERAL';
      departmentCounts[cleanDept] = (departmentCounts[cleanDept] || 0) + 1;
    });
  }

  return {
    studentRegNos: finalRegNos,
    totalStudents: finalRegNos.length,
    departmentCounts,
    hallsProcessed: hallsProcessedSet.size,
    studentDetails
  };
}

// Helper to extract exact seating arrangement student sequence for a selected Hall, Date, and Session
async function getHallSeatingStudentSequence(date, session, hallId) {
  if (!date || !session || !hallId) return { hallName: 'HALL', studentRegNos: [], studentDetails: [] };

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

  const configuredSubjectCodesInOrder = [];
  const seenSubCodes = new Set();
  examsAtTime.forEach(e => {
    if (Array.isArray(e.subjectCodes)) {
      e.subjectCodes.forEach(sc => {
        const cleanSc = String(sc).trim().toUpperCase();
        if (cleanSc && !seenSubCodes.has(cleanSc)) {
          seenSubCodes.add(cleanSc);
          configuredSubjectCodesInOrder.push(cleanSc);
        }
      });
    }
  });

  const allStudents = await Models.Student.find();
  const studentMapByReg = new Map();
  allStudents.forEach(s => {
    if (s.registerNo) studentMapByReg.set(s.registerNo.trim().toUpperCase(), s);
  });

  // Fetch saved plans directly from database
  const allPlans = await Models.SeatingPlan.find();
  const plansForHall = allPlans.filter(p => 
    examIdsSet.has(String(p.examId)) && (hallIdMatches.has(String(p.hallId)) || hallIdMatches.has(p.hallName))
  );

  let hallName = hall ? hall.name : (plansForHall.length > 0 ? plansForHall[0].hallName : 'HALL');
  const snapshot = (hall && hall.columns) ? hall : (plansForHall[0]?.hallSnapshot || null);
  const hallStudents = extractHallSavedSeatingSequence(plansForHall, snapshot, configuredSubjectCodesInOrder, studentMapByReg);

  return {
    hallName,
    studentRegNos: hallStudents.map(s => s.registerNo),
    studentDetails: hallStudents
  };
}

// GET export seat labels as styled Excel file (.xlsx) - Overall All-Halls Export (7 cols x 12 rows per page block)
app.get(['/api/seating/labels/download-excel', '/api/seating/download-labels', '/api/seating/download-labels-excel'], async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (hallId && hallId !== 'ALL') {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    } else if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
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

    const totalCols = 4;
    const rowsPerPage = 21;
    const labelsPerPage = totalCols * rowsPerPage; // 84 labels per A4 page
    const totalPages = Math.ceil(studentRegNos.length / labelsPerPage) || 1;
    const totalExcelRows = totalPages * rowsPerPage;
    const merges = [];

    // Fill vertically down each column (Column 1 first, then Column 2, Column 3, Column 4) per 21-row page block
    for (let p = 0; p < totalPages; p++) {
      const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);
      for (let r = 0; r < rowsPerPage; r++) {
        for (let c = 0; c < totalCols; c++) {
          const studentIdx = c * rowsPerPage + r;
          const regNo = studentIdx < pageStudents.length ? pageStudents[studentIdx] : '';
          const excelRow = p * rowsPerPage + r;
          const cellRef = XLSXLib.utils.encode_cell({ r: excelRow, c: c });

          ws[cellRef] = {
            v: regNo,
            t: 's',
            s: {
              font: { name: 'Arial Black', sz: 20, size: 20, bold: true },
              alignment: { horizontal: 'center', vertical: 'center' }
            }
          };
        }
      }
    }

    ws['!cols'] = [
      { width: 25.14453125, wch: 24.43, wpx: 176 },
      { width: 23.71484375, wch: 23.0,  wpx: 166 },
      { width: 25.14453125, wch: 24.43, wpx: 176 },
      { width: 25.14453125, wch: 24.43, wpx: 176 }
    ];

    ws['!rows'] = [];
    for (let r = 0; r < totalExcelRows; r++) {
      ws['!rows'][r] = { hpt: 36.75 };
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

// GET raw ordered student sequence for seat labels as JSON
app.get('/api/seating/labels/sequence', async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    if (hallId && hallId !== 'ALL') {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      return res.json(seq);
    } else if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      return res.json(seq);
    }
    return res.json({ studentRegNos: [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET export seat labels as CSV file (.csv) - Overall All-Halls Export (4 columns per row, column-first vertical order)
app.get(['/api/seating/labels/download-csv', '/api/seating/download-labels-csv'], async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (hallId && hallId !== 'ALL') {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    } else if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
    }

    if (studentRegNos.length === 0) {
      return res.status(404).json({ error: 'No student seating allocation found for the selected Date and Session.' });
    }

    const totalCols = 4;
    const rowsPerPage = 21;
    const labelsPerPage = totalCols * rowsPerPage; // 84
    const totalPages = Math.ceil(studentRegNos.length / labelsPerPage) || 1;

    const csvRows = [];
    for (let p = 0; p < totalPages; p++) {
      const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);
      for (let r = 0; r < rowsPerPage; r++) {
        const rowCells = [];
        let hasAnyInRow = false;
        for (let c = 0; c < totalCols; c++) {
          const idx = c * rowsPerPage + r;
          const val = idx < pageStudents.length ? pageStudents[idx] : '';
          if (val) hasAnyInRow = true;
          rowCells.push(val);
        }
        if (p === totalPages - 1 && !hasAnyInRow) {
          continue;
        }
        csvRows.push(rowCells.join(','));
      }
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
      const benchMap = new Map();
      baseGrid.forEach(b => {
        if (b && b.benchCode) benchMap.set(b.benchCode, b);
      });
      for (let i = 1; i < grids.length; i++) {
        const otherGrid = grids[i];
        if (Array.isArray(otherGrid)) {
          otherGrid.forEach(bench => {
            if (bench && bench.benchCode && benchMap.has(bench.benchCode)) {
              const target = benchMap.get(bench.benchCode);
              if (!target.seat1 && bench.seat1) target.seat1 = bench.seat1;
              if (!target.seat2 && bench.seat2) target.seat2 = bench.seat2;
              if (bench.seat3 !== undefined && !target.seat3 && bench.seat3) target.seat3 = bench.seat3;
            }
          });
        }
      }
      seatingGrid = baseGrid;
      const allExamSubCodesPdf = [];
      examsAtTime.forEach(e => {
        if (e.subjectCodes) {
          e.subjectCodes.forEach(sc => {
            if (!allExamSubCodesPdf.includes(sc)) allExamSubCodesPdf.push(sc);
          });
        }
      });
      realignSeatingGridToAscending(seatingGrid, colsCount, allExamSubCodesPdf);
    }

    const snapshot = plansForHall[0].hallSnapshot || (examsAtTime[0]?.hallSnapshots && (examsAtTime[0].hallSnapshots[hallId] || examsAtTime[0].hallSnapshots[plansForHall[0].hallName])) || {};
    const hallName = (hall && hall.name) || snapshot.name || plansForHall[0].hallName || 'Hall';
    const colsCount = snapshot.columns || plansForHall[0].columns || (hall && hall.columns) || 4;
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

    // Title & Meta Info Box (Hall information row positioned at top)
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
      const rowIdx = bench.row ? getRowIndex(bench.row) : Math.floor(bIdx / colsCount);

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
app.get(['/api/seating/labels/download-pdf', '/api/seating/download-labels-pdf'], async (req, res) => {
  try {
    const { date, session, hallId } = req.query;
    let studentRegNos = [];
    let fileSuffix = 'All_Halls';

    if (hallId && hallId !== 'ALL') {
      const seq = await getHallSeatingStudentSequence(date, session, hallId);
      studentRegNos = seq.studentRegNos;
      fileSuffix = seq.hallName || 'HALL';
    } else if (date && session) {
      const seq = await getAllHallsSeatingStudentSequence(date, session);
      studentRegNos = seq.studentRegNos;
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
    const cols = 4;
    const rows = 21;
    const gapX = 3;
    const gapY = 2;

    const printableW = pageW - (2 * marginX) - ((cols - 1) * gapX);
    const colRatios = [24.43, 23.0, 24.43, 24.43];
    const totalRatio = colRatios.reduce((a, b) => a + b, 0);
    const colWidths = colRatios.map(r => (r / totalRatio) * printableW);
    const labelH = 36.75;

    const labelsPerPage = cols * rows;
    const totalPages = Math.ceil(studentRegNos.length / labelsPerPage);

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();

      const pageStudents = studentRegNos.slice(p * labelsPerPage, (p + 1) * labelsPerPage);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = c * rows + r;
          const regNo = idx < pageStudents.length ? pageStudents[idx] : '';
          
          let colX = marginX;
          for (let prevC = 0; prevC < c; prevC++) {
            colX += colWidths[prevC] + gapX;
          }
          const x = colX;
          const y = marginY + r * (labelH + gapY);
          const w = colWidths[c];

          // Sticker box without border (exact label size and position preserved)

          if (regNo) {
            const fs = require('fs');
            if (fs.existsSync('C:\\Windows\\Fonts\\ariblk.ttf')) {
              doc.font('C:\\Windows\\Fonts\\ariblk.ttf');
            } else {
              doc.font('Helvetica-Bold');
            }
            doc.fontSize(18)
               .fillColor('#000000')
               .text(regNo, x, y + (labelH / 2) - 10, {
                 width: w,
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
  const sortedPrefixes = Object.keys(groups).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  sortedPrefixes.forEach(prefix => {
    const items = groups[prefix];
    items.sort((a, b) => {
      if (isNaN(a.numVal) || isNaN(b.numVal)) {
        return a.original.localeCompare(b.original, undefined, { numeric: true, sensitivity: 'base' });
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
async function getLocationsSummaryData(date, session, forceCompute = false) {
  const targetDate = getDateString(date);

  // 1. Check if isolated date record exists in exam_date_records table
  if (!forceCompute) {
    try {
      const savedRecord = await Models.ExamDateRecord.findOne({ date: targetDate, session });
      if (savedRecord && Array.isArray(savedRecord.locationsSummary) && savedRecord.locationsSummary.length > 0) {
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

        const timeOfExam = (savedRecord.exams && savedRecord.exams[0] && savedRecord.exams[0].time) || (session === "FN" ? "10:00 AM - 01:00 PM" : "02:00 PM - 05:00 PM");
        const sessionName = session === "FN" ? "FORENOON (FN)" : "AFTERNOON (AN)";

        return {
          targetDate,
          formattedDate,
          session,
          sessionName,
          timeOfExam,
          examsAtTime: savedRecord.exams || [],
          plansForTime: savedRecord.seatingPlans || [],
          result: savedRecord.locationsSummary
        };
      }
    } catch (err) {
      console.warn('[ExamDateRecord] Lookup error in getLocationsSummaryData:', err.message);
    }
  }

  const allExams = await Models.Exam.find();
  const examsAtTime = allExams.filter(e => 
    getDateString(e.date) === targetDate && e.session === session
  );
  const examIds = examsAtTime.map(e => String(e._id));

  // Fetch saved seating plans directly from database
  const allPlans = await Models.SeatingPlan.find();
  const plansForTime = allPlans.filter(p => examIds.includes(String(p.examId)));

  if (plansForTime.length === 0) {
    return { targetDate, formattedDate: targetDate, session, examsAtTime, plansForTime: [], result: [] };
  }

  // Fetch all students to dynamically resolve Degree and Subject Codes
  const allStudents = await Models.Student.find();
  const studentMap = new Map();
  allStudents.forEach(st => {
    if (st && st.registerNo) {
      studentMap.set(String(st.registerNo).trim().toUpperCase(), st);
    }
  });
  const detectedColKey = detectSubjectCodeColumn(allStudents);

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

  // Lookup maps for resolving between hallId and hallName
  const allHalls = await Models.Hall.find();
  const hallIdToName = new Map();
  const hallNameToId = new Map();
  allHalls.forEach(h => {
    if (h && h.name) {
      if (h._id) {
        hallIdToName.set(String(h._id), h.name);
        hallNameToId.set(h.name.toUpperCase(), String(h._id));
      }
    }
  });
  examsAtTime.forEach(e => {
    if (e.hallSnapshots) {
      Object.values(e.hallSnapshots).forEach(s => {
        if (s && s.name) {
          if (s._id) {
            hallIdToName.set(String(s._id), s.name);
            hallNameToId.set(s.name.toUpperCase(), String(s._id));
          }
        }
      });
    }
  });

  // Sort halls in exam's configured hall order
  const configuredHallOrder = [];
  examsAtTime.forEach(e => {
    (e.assignedHalls || []).forEach(h => {
      const hStr = String(h).trim();
      const resolvedName = hallIdToName.get(hStr) || (e.hallSnapshots && e.hallSnapshots[hStr]?.name) || hStr;
      if (!configuredHallOrder.some(name => name.toUpperCase() === resolvedName.toUpperCase())) {
        configuredHallOrder.push(resolvedName);
      }
    });
  });

  // Re-align students across halls in strictly natural ascending register number order for each subject code
  // This guarantees that earlier halls (like A06) receive the lowest register numbers (e.g. C3S25863)
  const allExamSubs = examsAtTime.flatMap(e => (e.subjectCodes || []).map(sc => String(sc).trim().toUpperCase()));
  const distinctSubs = new Set();
  plansForTime.forEach(p => {
    (p.attendanceRoster || []).forEach(s => {
      const sc = (s.subjectCode || '').trim().toUpperCase();
      if (sc) distinctSubs.add(sc);
    });
  });

  const orderedPlansForRealign = [...plansForTime].sort((a, b) => {
    const nameA = (a.hallName || hallIdToName.get(String(a.hallId)) || '').trim().toUpperCase();
    const nameB = (b.hallName || hallIdToName.get(String(b.hallId)) || '').trim().toUpperCase();
    const idxA = configuredHallOrder.indexOf(nameA);
    const idxB = configuredHallOrder.indexOf(nameB);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  distinctSubs.forEach(subCode => {
    const pool = [];
    orderedPlansForRealign.forEach(p => {
      (p.attendanceRoster || []).forEach(s => {
        if ((s.subjectCode || '').trim().toUpperCase() === subCode) {
          pool.push(s);
        }
      });
    });

    if (pool.length === 0) return;

    pool.sort((a, b) => {
      const regA = String(a.registerNo || '').trim();
      const regB = String(b.registerNo || '').trim();
      return regA.localeCompare(regB, undefined, { numeric: true, sensitivity: 'base' });
    });

    let poolIdx = 0;
    orderedPlansForRealign.forEach(p => {
      const hallSubStudents = (p.attendanceRoster || []).filter(s => (s.subjectCode || '').trim().toUpperCase() === subCode);
      const countForThisHall = hallSubStudents.length;
      if (countForThisHall === 0) return;

      const newAssigned = pool.slice(poolIdx, poolIdx + countForThisHall);
      poolIdx += countForThisHall;

      let replaceIdx = 0;
      p.attendanceRoster = (p.attendanceRoster || []).map(s => {
        if ((s.subjectCode || '').trim().toUpperCase() === subCode && replaceIdx < newAssigned.length) {
          const replacement = newAssigned[replaceIdx++];
          return {
            ...replacement,
            bench: s.bench,
            seat: s.seat
          };
        }
        return s;
      });

      if (p.seatingGrid && Array.isArray(p.seatingGrid)) {
        realignSeatingGridToAscending(p.seatingGrid, p.columns, allExamSubs);
      }
    });
  });

  // Group plans by hallName (or resolved hall name from hallId)
  const hallPlans = {};
  plansForTime.forEach(p => {
    const resolvedName = p.hallName || (p.hallId && hallIdToName.get(String(p.hallId))) || p.hallId;
    const hKey = (resolvedName || '').trim().toUpperCase();
    if (!hallPlans[hKey]) {
      hallPlans[hKey] = [];
    }
    hallPlans[hKey].push(p);
  });

  const result = [];

  for (const [, plans] of Object.entries(hallPlans)) {
    const hallName = plans[0].hallName || hallIdToName.get(String(plans[0].hallId)) || '';
    const hallId = plans[0].hallId || hallNameToId.get(hallName.toUpperCase()) || null;
    
    // Merge attendance rosters
    const attendanceRoster = [];
    plans.forEach(p => {
      if (p.attendanceRoster) {
        attendanceRoster.push(...p.attendanceRoster);
      }
    });

    // Group students dynamically by Degree AND Subject Code
    const classGroups = {};
    attendanceRoster.forEach(s => {
      const regNo = String(s.registerNo || '').trim().toUpperCase();
      const dbStudent = studentMap.get(regNo);

      // 1. Resolve dynamic Degree
      let degree = resolveStudentDegree(dbStudent, s.department);
      if (!degree || degree === 'GENERAL' || degree === 'UNKNOWN') {
        if (dbStudent && dbStudent.csvData && typeof dbStudent.csvData === 'object') {
          const keys = Object.keys(dbStudent.csvData);
          const degKey = keys.find(k => /degree|programme|prog/i.test(k));
          if (degKey && dbStudent.csvData[degKey]) {
            degree = String(dbStudent.csvData[degKey]).trim();
          }
        }
      }
      if (!degree || degree === 'GENERAL' || degree === 'UNKNOWN') {
        degree = (s.department && s.department !== 'GENERAL') ? s.department : '';
      }
      if (!degree) {
        degree = formatClassCode(s.department, s.subjectCode, regNo);
      }

      // Canonicalize degree (e.g. 'B.A', 'B.A.', 'BA' all consistently map to 'B.A.')
      const canonicalDegree = canonicalizeDegree(degree) || degree || 'GENERAL';

      // 2. Resolve dynamic Subject Code
      let subCode = (s.subjectCode || '').trim().toUpperCase();
      if (!subCode && dbStudent) {
        subCode = (dbStudent.subjectCode || '').trim().toUpperCase();
      }
      if (!subCode && dbStudent) {
        const studentSubCodes = getStudentAllSubCodes(dbStudent, detectedColKey);
        const matchingExamCodes = examsAtTime.flatMap(e => (e.subjectCodes || []).map(sc => sc.trim().toUpperCase()));
        const matched = studentSubCodes.find(code => matchingExamCodes.includes(code));
        if (matched) {
          subCode = matched;
        } else if (studentSubCodes.length > 0) {
          subCode = studentSubCodes[0];
        }
      }

      // Group strictly by canonical degree and subject code so disjoint register ranges belong to one single logical row
      const classKey = `${canonicalDegree.toUpperCase()}|||${subCode.toUpperCase()}`;
      if (!classGroups[classKey]) {
        classGroups[classKey] = {
          degree: canonicalDegree,
          subjectCode: subCode,
          classCode: (canonicalDegree && subCode) ? `${canonicalDegree} / ${subCode}` : (canonicalDegree || subCode || 'GENERAL'),
          regNos: []
        };
      }
      if (!classGroups[classKey].regNos.includes(regNo)) {
        classGroups[classKey].regNos.push(regNo);
      }
    });

    const classes = Object.values(classGroups).map(g => {
      const sortedRegNos = g.regNos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      return {
        degree: g.degree,
        subjectCode: g.subjectCode,
        classCode: g.classCode,
        regNos: sortedRegNos,
        summarizedRange: summarizeRegisterNumbers(sortedRegNos),
        count: sortedRegNos.length
      };
    });

    const configuredDeptsForSummary = (examsAtTime.flatMap(e => e.departments || [])).map(d => canonicalizeDegree(d).toUpperCase());
    const allExamSubsForSummary = (examsAtTime.flatMap(e => e.subjectCodes || [])).map(c => String(c).trim().toUpperCase());

    classes.sort((a, b) => {
      // 1. Course code order (strictly matching the exact user click/selection order of exam.subjectCodes)
      const subA = String(a.subjectCode || '').trim().toUpperCase();
      const subB = String(b.subjectCode || '').trim().toUpperCase();
      const idxSubA = allExamSubsForSummary.indexOf(subA);
      const idxSubB = allExamSubsForSummary.indexOf(subB);
      if (idxSubA !== -1 && idxSubB !== -1 && idxSubA !== idxSubB) return idxSubA - idxSubB;
      if (idxSubA !== -1 && idxSubB === -1) return -1;
      if (idxSubA === -1 && idxSubB !== -1) return 1;

      // 2. Configured departments order
      const degA = (a.degree || '').toUpperCase();
      const degB = (b.degree || '').toUpperCase();
      const idxDeptA = configuredDeptsForSummary.indexOf(degA);
      const idxDeptB = configuredDeptsForSummary.indexOf(degB);
      if (idxDeptA !== -1 && idxDeptB !== -1 && idxDeptA !== idxDeptB) return idxDeptA - idxDeptB;
      if (idxDeptA !== -1 && idxDeptB === -1) return -1;
      if (idxDeptA === -1 && idxDeptB !== -1) return 1;

      // 3. Academic level: UG before PG
      const lvlA = (degA.startsWith('M.') || degA.startsWith('M')) ? 'PG' : 'UG';
      const lvlB = (degB.startsWith('M.') || degB.startsWith('M')) ? 'PG' : 'UG';
      if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;

      const dComp = degA.localeCompare(degB);
      if (dComp !== 0) return dComp;

      return subA.localeCompare(subB);
    });

    const totalStudents = attendanceRoster.length;

    result.push({
      hallName,
      hallId,
      totalStudents,
      classes
    });
  }

  // Sort halls strictly in exam's configured hall order (preserving saved selection order)
  result.sort((a, b) => {
    const nameA = (a.hallName || '').trim().toUpperCase();
    const nameB = (b.hallName || '').trim().toUpperCase();
    const idA = a.hallId ? String(a.hallId) : '';
    const idB = b.hallId ? String(b.hallId) : '';

    const idxA = configuredHallOrder.findIndex(h => {
      const hNorm = h.trim().toUpperCase();
      return hNorm === nameA || (idA && hallIdToName.get(idA)?.toUpperCase() === hNorm);
    });
    const idxB = configuredHallOrder.findIndex(h => {
      const hNorm = h.trim().toUpperCase();
      return hNorm === nameB || (idB && hallIdToName.get(idB)?.toUpperCase() === hNorm);
    });

    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  const timeOfExam = (examsAtTime[0] && examsAtTime[0].time) || (session === "FN" ? "10:00 AM - 01:00 PM" : "02:00 PM - 05:00 PM");
  const sessionName = session === "FN" ? "FORENOON (FN)" : "AFTERNOON (AN)";

  const summaryPayload = {
    targetDate,
    formattedDate,
    session,
    sessionName,
    timeOfExam,
    examsAtTime,
    plansForTime,
    result
  };

  // Persist into exam_date_records for date isolation and ultra-fast retrieval
  try {
    const totalStudents = result.reduce((sum, h) => sum + (h.totalStudents || 0), 0);
    const hallSnapshots = {};
    examsAtTime.forEach(e => {
      if (e.hallSnapshots) Object.assign(hallSnapshots, e.hallSnapshots);
    });

    await Models.ExamDateRecord.upsert({
      date: targetDate,
      session,
      examIds,
      exams: examsAtTime,
      hallSnapshots,
      seatingPlans: plansForTime,
      locationsSummary: result,
      totalStudents,
      totalHalls: result.length
    });
  } catch (recErr) {
    console.warn('[ExamDateRecord] Upsert error in getLocationsSummaryData:', recErr.message);
  }

  return summaryPayload;
}

// Synchronize and persist isolated date snapshot into exam_date_records
async function syncDateRecordSnapshot(date, session) {
  try {
    return await getLocationsSummaryData(date, session, true);
  } catch (err) {
    console.warn('[syncDateRecordSnapshot] Error syncing date record:', err.message);
    return null;
  }
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
  // Col 0: CLASS / CODE NO (Degree & Sub Code) = 115 pt
  // Col 1: REGISTER NO = 235.28 pt
  // Col 2: CANDIDATE NO = 85 pt
  // Col 3: TOTAL CANDIDATE NO = 90 pt
  const colW = [115, 235.28, 85, 90];
  const colX = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2]
  ];

  const headerH = 20;

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

    // Calculate dynamic row heights based on Degree + Sub Code and Register Number ranges
    const rowHeights = (hall.classes || []).map((c) => {
      const range = c.summarizedRange || "";
      doc.font("Helvetica").fontSize(8.5);
      const textH = doc.heightOfString(range, { width: colW[1] - 8 });
      const deg = c.degree || "";
      const sub = c.subjectCode || "";
      const codeH = (deg && sub && deg !== sub) ? 22 : 12;
      return Math.max(26, textH + 8, codeH + 6);
    });

    const tableBodyH = rowHeights.reduce((a, b) => a + b, 0);
    const totalHallH = hallTitleH + headerH + tableBodyH + 16;

    // Check if entire hall fits on current page
    if (currentY + totalHallH > safeBottom) {
      doc.addPage();
      currentY = drawCompactHeader();
    }

    // Hall Title Header Banner
    doc.rect(margin, currentY, printableW, hallTitleH).fillAndStroke("#E0E7FF", "#4F46E5");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#312E81")
       .text(`HALL NO. ${hall.hallName}`, margin, currentY + 5, { width: printableW, align: "center" });
    currentY += hallTitleH;

    // Table Header
    currentY = drawTableHeader(currentY);
    const tableStartY = currentY;

    // Class rows
    hall.classes.forEach((c, idx) => {
      const rH = rowHeights[idx];
      doc.rect(margin, currentY, printableW, rH).stroke("#4B5563");

      doc.moveTo(colX[1], currentY).lineTo(colX[1], currentY + rH).stroke("#4B5563");
      doc.moveTo(colX[2], currentY).lineTo(colX[2], currentY + rH).stroke("#4B5563");
      doc.moveTo(colX[3], currentY).lineTo(colX[3], currentY + rH).stroke("#4B5563");

      // Col 0: CLASS / CODE NO showing Degree on top and Subject Code below
      const deg = c.degree || "";
      const sub = c.subjectCode || "";
      if (deg && sub && deg !== sub) {
        const topY = currentY + Math.max(3, (rH - 22) / 2);
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
           .text(deg, colX[0] + 2, topY, { width: colW[0] - 4, align: "center" });
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#374151")
           .text(sub, colX[0] + 2, topY + 11, { width: colW[0] - 4, align: "center" });
      } else {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
           .text(deg || sub || c.classCode || "", colX[0] + 2, currentY + (rH - 10) / 2, { width: colW[0] - 4, align: "center" });
      }

      // Col 1: REGISTER NO Range
      const range = c.summarizedRange || "";
      doc.font("Helvetica").fontSize(8.5).fillColor("#111827");
      const rTextH = doc.heightOfString(range, { width: colW[1] - 8 });
      doc.text(range, colX[1] + 4, currentY + Math.max(4, (rH - rTextH) / 2), { width: colW[1] - 8, align: "center" });

      // Col 2: CANDIDATE NO
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
      doc.text(String(c.count || ""), colX[2], currentY + (rH - 10) / 2, { width: colW[2], align: "center" });

      currentY += rH;
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

// Helper to format a register number range for Nominal Roll
// Rule: Display complete first register number.
// For ending register number, display only its last four digits when sharing the same prefix and unambiguous.
// Example: C4A19151 to C4A19164 -> C4A19151 to 9164
function formatNominalRollRange(rStart, rEnd) {
  if (!rStart) return '';
  if (!rEnd || rStart.original === rEnd.original || rStart.numVal === rEnd.numVal) {
    return rStart.original;
  }

  const startOrig = rStart.original;
  const endOrig = rEnd.original;

  // If prefixes differ, display full register number
  if (rStart.prefix !== rEnd.prefix) {
    return `${startOrig} to ${endOrig}`;
  }

  const startDigits = rStart.numStr || '';
  const endDigits = rEnd.numStr || '';

  // The ending register number must have at least 4 digits in its numeric part
  if (endDigits.length >= 4 && startDigits.length === endDigits.length) {
    // Check that higher-order digits before the last 4 digits are identical (unambiguous)
    const startLeading = startDigits.slice(0, -4);
    const endLeading = endDigits.slice(0, -4);

    if (startLeading === endLeading) {
      const lastFour = endDigits.slice(-4);
      return `${startOrig} to ${lastFour}`;
    }
  }

  // Fallback to full register number if ambiguous or fewer than 4 digits
  return `${startOrig} to ${endOrig}`;
}

// Helper to build compact register number ranges (e.g. C4A19151 to 9164) for MKU Nominal Roll
function buildNominalRollRanges(regNos) {
  if (!regNos || regNos.length === 0) return [];
  const prefixGroups = {};

  regNos.forEach(reg => {
    const clean = String(reg).trim();
    const m = clean.match(/^(.*?)(\d+)$/);
    if (m) {
      const pfx = m[1];
      const numStr = m[2];
      const numVal = parseInt(numStr, 10);
      if (!prefixGroups[pfx]) prefixGroups[pfx] = [];
      prefixGroups[pfx].push({ original: clean, prefix: pfx, numStr, numVal, len: numStr.length });
    } else {
      if (!prefixGroups['__RAW__']) prefixGroups['__RAW__'] = [];
      prefixGroups['__RAW__'].push({ original: clean, prefix: clean, numVal: NaN, len: 0 });
    }
  });

  const ranges = [];
  const sortedPfx = Object.keys(prefixGroups).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  sortedPfx.forEach(pfx => {
    const items = prefixGroups[pfx];
    if (pfx === '__RAW__') {
      items.sort((a, b) => a.original.localeCompare(b.original, undefined, { numeric: true, sensitivity: 'base' })).forEach(it => {
        ranges.push({ text: it.original, count: 1 });
      });
      return;
    }

    // Sort strictly numerically, with length tie-breaker
    items.sort((a, b) => a.numVal - b.numVal || a.len - b.len);

    let rStart = items[0];
    let rEnd = items[0];

    for (let i = 1; i < items.length; i++) {
      const curr = items[i];
      if (curr.numVal === rEnd.numVal + 1 && curr.len === rEnd.len) {
        rEnd = curr;
      } else if (curr.numVal === rEnd.numVal && curr.original === rEnd.original) {
        // Skip identical duplicate if any
      } else {
        if (rStart.numVal === rEnd.numVal) {
          ranges.push({ text: rStart.original, count: 1 });
        } else {
          ranges.push({
            text: formatNominalRollRange(rStart, rEnd),
            count: rEnd.numVal - rStart.numVal + 1
          });
        }
        rStart = curr;
        rEnd = curr;
      }
    }

    if (rStart.numVal === rEnd.numVal) {
      ranges.push({ text: rStart.original, count: 1 });
    } else {
      ranges.push({
        text: formatNominalRollRange(rStart, rEnd),
        count: rEnd.numVal - rStart.numVal + 1
      });
    }
  });

  return ranges;
}

// Helper to generate print-ready MKU Nominal Roll PDF document matching official University format
function generateMkuNominalRollPdf(doc, data, groups) {
  const pageW = 612; // Legal / Long Bond width: 8.5 in (612 pt)
  const pageH = 1008; // Legal / Long Bond height: 14 in (1008 pt)
  const margin = 36;
  const printableW = pageW - (2 * margin); // 540 pt
  const safeBottom = pageH - 45; // 963 pt

  // Format header month, year and session
  // In MKU, university semester examinations are officially titled:
  // "NOVEMBER - [YEAR] - F.N." (odd semester) or "APRIL - [YEAR] - F.N." (even semester)
  let examMonth = "NOVEMBER";
  let examYear = new Date().getFullYear();
  try {
    const rawDateStr = String(data.targetDate || (data.examsAtTime && data.examsAtTime[0] && data.examsAtTime[0].date) || "");
    const isoMatch = rawDateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmyMatch = rawDateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (isoMatch) {
      examYear = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10) - 1;
      examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
    } else if (dmyMatch) {
      examYear = parseInt(dmyMatch[3], 10);
      const m = parseInt(dmyMatch[2], 10) - 1;
      examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
    } else {
      const d = new Date(rawDateStr);
      if (!isNaN(d.getTime())) {
        examYear = d.getFullYear();
        const m = d.getMonth();
        examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
      }
    }
  } catch (e) {}

  const sessionText = (data.session || "").toUpperCase().includes("AN") ? "A.N." : "F.N.";
  const examSubTitle = `${examMonth} - ${examYear} - ${sessionText}`;

  // Column widths: Total = 540 pt (Legal printable width)
  // Col 0: FOIL NO = 75 pt
  // Col 1: ABSENTS = 85 pt
  // Col 2: [BLANK HEADER] (Department / Subject Code) = 110 pt
  // Col 3: NOMINAL ROLL (Register Numbers) = 218 pt
  // Col 4: TOTAL = 52 pt
  const colW = [75, 85, 110, 218, 52];
  const colX = [
    margin,
    margin + colW[0],
    margin + colW[0] + colW[1],
    margin + colW[0] + colW[1] + colW[2],
    margin + colW[0] + colW[1] + colW[2] + colW[3]
  ];

  const headerH = 24;
  const lineH = 17; // Line height for each compact register number range
  const pad = 10;
  const grandTotalH = 24;

  const drawHeader = () => {
    let y = margin;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000")
       .text("MADURAI KAMARAJ UNIVERSITY EXAMINATIONS", margin, y, { align: "center", width: printableW });
    y += 18;

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000")
       .text(examSubTitle, margin, y, { align: "center", width: printableW });
    y += 16;

    // Table Header Row: exactly 5 columns
    // | FOIL NO | ABSENTS | [BLANK HEADER] | NOMINAL ROLL | TOTAL |
    // Critical: Col 2 header MUST remain completely blank on every page!
    doc.rect(margin, y, printableW, headerH).lineWidth(0.8).stroke("#000000");
    for (let c = 1; c < colX.length; c++) {
      doc.moveTo(colX[c], y).lineTo(colX[c], y + headerH).stroke("#000000");
    }

    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000");
    doc.text("FOIL NO", colX[0], y + 7, { width: colW[0], align: "center" });
    doc.text("ABSENTS", colX[1], y + 7, { width: colW[1], align: "center" });
    // Third column heading is left completely empty!
    doc.text("NOMINAL ROLL", colX[3], y + 7, { width: colW[3], align: "center" });
    doc.text("TOTAL", colX[4], y + 7, { width: colW[4], align: "center" });

    return y + headerH;
  };

  let currentY = drawHeader();

  const grandTotal = groups.reduce((sum, g) => sum + g.count, 0);

  // Render each department/subject-code group with compact register number ranges
  groups.forEach((group) => {
    const ranges = buildNominalRollRanges(group.regNos);
    let remainingRanges = [...ranges];
    let isContinuation = false;

    // Determine whole group height
    const wholeGroupH = Math.max(30, ranges.length * lineH + pad);
    const maxPageBodyH = safeBottom - (margin + 18 + 18 + 16 + headerH);

    // If whole group fits on a fresh page, but doesn't fit in remaining space on current page, move to fresh page
    if (wholeGroupH <= maxPageBodyH && (currentY + wholeGroupH > safeBottom)) {
      doc.addPage();
      currentY = drawHeader();
    }

    while (remainingRanges.length > 0) {
      let spaceLeft = safeBottom - currentY;
      let maxFit = Math.floor((spaceLeft - pad) / lineH);

      // If cannot fit even 1 range and we have ranges left, start a new page
      if (maxFit < 1) {
        doc.addPage();
        currentY = drawHeader();
        spaceLeft = safeBottom - currentY;
        maxFit = Math.floor((spaceLeft - pad) / lineH);
      }

      const takeCount = Math.min(remainingRanges.length, Math.max(1, maxFit));
      const chunkRanges = remainingRanges.slice(0, takeCount);
      remainingRanges = remainingRanges.slice(takeCount);

      const chunkH = Math.max(30, takeCount * lineH + pad);
      // Fifth column TOTAL must show the actual number of students in this group/chunk!
      const chunkStudents = chunkRanges.reduce((sum, r) => sum + r.count, 0);

      // Draw Group Cell Outline & Divider Lines
      doc.rect(margin, currentY, printableW, chunkH).lineWidth(0.8).stroke("#000000");
      for (let c = 1; c < colX.length; c++) {
        doc.moveTo(colX[c], currentY).lineTo(colX[c], currentY + chunkH).stroke("#000000");
      }

      // Col 2: Department and Subject Code inside body
      // e.g. "B.A. / AENPC31" or "B.A. / AENPC31 (Contd.)"
      const degText = group.degree || "";
      const subText = group.subjectCode || "";
      let deptSubLabel = (degText && subText) ? `${degText} / ${subText}` : (degText || subText || "GENERAL");
      if (isContinuation) {
        deptSubLabel += " (Contd.)";
      }

      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000");
      const labelH = doc.heightOfString(deptSubLabel, { width: colW[2] - 8 });
      const labelY = currentY + Math.max(6, (chunkH - labelH) / 2);
      doc.text(deptSubLabel, colX[2] + 4, labelY, { width: colW[2] - 8, align: "center" });

      // Col 3: NOMINAL ROLL (Compact register-number ranges)
      const rangesStartY = currentY + (chunkH - (chunkRanges.length * lineH)) / 2;
      chunkRanges.forEach((r, idx) => {
        const rY = rangesStartY + (idx * lineH);
        doc.font("Helvetica").fontSize(9.5).fillColor("#000000");
        doc.text(r.text, colX[3] + 4, rY, { width: colW[3] - 8, align: "center" });
      });

      // Col 4: TOTAL (actual student count, not range count!)
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
      doc.text(String(chunkStudents), colX[4], currentY + (chunkH - 10) / 2, { width: colW[4], align: "center" });

      currentY += chunkH;
      isContinuation = true;
    }
  });

  // Grand Total Row
  if (currentY + grandTotalH > safeBottom) {
    doc.addPage();
    currentY = drawHeader();
  }

  doc.rect(margin, currentY, printableW, grandTotalH).lineWidth(0.8).stroke("#000000");
  for (let c = 1; c < colX.length; c++) {
    doc.moveTo(colX[c], currentY).lineTo(colX[c], currentY + grandTotalH).stroke("#000000");
  }

  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000000");
  doc.text("TOTAL", colX[3], currentY + 7, { width: colW[3] - 12, align: "right" });
  doc.text(String(grandTotal), colX[4], currentY + 7, { width: colW[4], align: "center" });

  // Footer: Page Numbers on all pages
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.lineWidth(0.5).strokeColor("#9CA3AF")
       .moveTo(margin, pageH - 32).lineTo(margin + printableW, pageH - 32).stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
    doc.text("ExamFlow | MKU Nominal Roll", margin, pageH - 24, { width: 250, align: "left" });
    doc.text(`Page ${i + 1} of ${pages.count}`, margin + printableW - 150, pageH - 24, { width: 150, align: "right" });
  }

  doc.end();
}

// Helper to derive Examination Month and Year for Hall-wise Invigilator Report
// Follows established MKU Exam-Session Rule:
// Odd semester session (Aug - Feb) -> NOVEMBER [YEAR]
// Even semester session (Mar - Jul) -> APRIL [YEAR]
function getInvigilatorReportMonthYear(data) {
  let examMonth = "NOVEMBER";
  let examYear = new Date().getFullYear();

  const targetDateVal = data?.targetDate || (data?.examsAtTime && data.examsAtTime[0] && data.examsAtTime[0].date);
  
  if (targetDateVal instanceof Date && !isNaN(targetDateVal.getTime())) {
    examYear = targetDateVal.getFullYear();
    const m = targetDateVal.getMonth();
    examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
  } else if (targetDateVal) {
    const rawDateStr = String(targetDateVal).trim();
    const isoMatch = rawDateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmyMatch = rawDateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (isoMatch) {
      examYear = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10) - 1; // 0-indexed: 0=Jan, 3=Apr, 10=Nov
      examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
    } else if (dmyMatch) {
      examYear = parseInt(dmyMatch[3], 10);
      const m = parseInt(dmyMatch[2], 10) - 1;
      examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
    } else {
      const d = new Date(rawDateStr);
      if (!isNaN(d.getTime())) {
        examYear = d.getFullYear();
        const m = d.getMonth();
        examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
      }
    }
  }

  // If no date was found, check if exam records explicitly specify an examination session / month
  if (!targetDateVal && Array.isArray(data?.examsAtTime)) {
    for (const ex of data.examsAtTime) {
      const explicitVal = (ex.examMonth || ex.month || ex.examSession || "").toString().trim().toUpperCase();
      if (explicitVal.includes("APRIL") || explicitVal === "APR") {
        examMonth = "APRIL";
        break;
      } else if (explicitVal.includes("NOVEMBER") || explicitVal === "NOV") {
        examMonth = "NOVEMBER";
        break;
      }
    }
  }

  return { examMonth, examYear, headerLine3: `${examMonth} ${examYear}` };
}

// Shared PDF generator for Hall-wise Invigilator Report (Exact Box-by-Box College Form Layout, Legal Paper, 2 forms per sheet)
function generateInvigilatorReportPdf(doc, data) {
  const margin = 36;
  const printableW = 540; // 612 - 72

  // Exact relative column widths matching reference image (641px -> 196px, 207px, 238px)
  const col1W = 165; // CLASS (30.6%)
  const col2W = 175; // SUBJECT (32.4%)
  const col3W = 200; // NO OF STUDENTS (37.0%)
  const footerLeftW = 305; // 56.5% (divides at x=362 in 641px)
  const footerRightW = 235; // 43.5%

  const { examMonth, examYear, headerLine3 } = getInvigilatorReportMonthYear(data);

  const headerLine1 = "RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM.";
  const headerLine2 = "MADURAI KAMARAJ UNIVERSITY EXAMINATIONS";

  const formattedDate = data.formattedDate || data.targetDate;
  const timeText = data.timeOfExam 
    ? `${data.session} (${data.timeOfExam})` 
    : (data.session === 'FN' ? 'FN (10:00 AM - 01:00 PM)' : 'AN (02:00 PM - 05:00 PM)');

  const renderSingleForm = (hall, startY) => {
    let y = startY;

    // 1. College Header (Full width box)
    doc.rect(margin, y, printableW, 20).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000')
       .text(headerLine1, margin, y + 4.5, { width: printableW, align: 'center' });
    y += 20;

    // 2. University Header (Full width box)
    doc.rect(margin, y, printableW, 18).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
       .text(headerLine2, margin, y + 4, { width: printableW, align: 'center' });
    y += 18;

    // 3. Examination Month & Year (Full width box)
    doc.rect(margin, y, printableW, 18).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000')
       .text(headerLine3, margin, y + 4, { width: printableW, align: 'center' });
    y += 18;

    // 4. Examination Details Row (Divided into 3 cells matching columns below)
    doc.rect(margin, y, printableW, 20).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + col1W, y).lineTo(margin + col1W, y + 20).stroke();
    doc.moveTo(margin + col1W + col2W, y).lineTo(margin + col1W + col2W, y + 20).stroke();

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text(`DATE : ${formattedDate}`, margin + 6, y + 5.5, { width: col1W - 12, align: 'left' });
    doc.text(`TIME: ${timeText}`, margin + col1W + 4, y + 5.5, { width: col2W - 8, align: 'center' });
    doc.text(`HALL NO : ${hall ? (hall.hallName || '') : ''}`, margin + col1W + col2W + 8, y + 5.5, { width: col3W - 16, align: 'left' });
    y += 20;

    // 5. Student Table Header (CLASS | SUBJECT | NO OF STUDENTS)
    doc.rect(margin, y, printableW, 20).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + col1W, y).lineTo(margin + col1W, y + 20).stroke();
    doc.moveTo(margin + col1W + col2W, y).lineTo(margin + col1W + col2W, y + 20).stroke();

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
    doc.text('CLASS', margin, y + 5.5, { width: col1W, align: 'center' });
    doc.text('SUBJECT', margin + col1W, y + 5.5, { width: col2W, align: 'center' });
    doc.text('NO OF STUDENTS', margin + col1W + col2W, y + 5.5, { width: col3W, align: 'center' });
    y += 20;

    // 6. Student Rows (Only actual groups, no unnecessary empty rows)
    const classes = (hall && hall.classes) || [];
    const numRows = classes.length;
    const rowH = 21;

    for (let r = 0; r < numRows; r++) {
      const cls = classes[r];
      doc.rect(margin, y, printableW, rowH).lineWidth(0.8).strokeColor('#000000').stroke();
      doc.moveTo(margin + col1W, y).lineTo(margin + col1W, y + rowH).stroke();
      doc.moveTo(margin + col1W + col2W, y).lineTo(margin + col1W + col2W, y + rowH).stroke();

      if (cls) {
        doc.font('Helvetica').fontSize(8.5).fillColor('#000000');
        doc.text(cls.degree || cls.classCode || '', margin + 8, y + 5.5, { width: col1W - 16, align: 'left' });
        doc.text(cls.subjectCode || '', margin + col1W, y + 5.5, { width: col2W, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(8.5);
        doc.text(String(cls.count || 0), margin + col1W + col2W, y + 5.5, { width: col3W, align: 'center' });
      }
      y += rowH;
    }

    // 7. Footer Box 1: NAME OF INVIGILATOR | M/s
    doc.rect(margin, y, printableW, 24).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + footerLeftW, y).lineTo(margin + footerLeftW, y + 24).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('NAME OF INVIGILATER', margin + 8, y + 7, { width: footerLeftW - 16, align: 'left' });
    doc.font('Helvetica').fontSize(8.5);
    doc.text('M/s', margin + footerLeftW + 8, y + 7, { width: footerRightW - 16, align: 'left' });
    y += 24;

    // 8. Footer Box 2: TOTAL NO OF CANDIDATES | [total]
    doc.rect(margin, y, printableW, 24).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + footerLeftW, y).lineTo(margin + footerLeftW, y + 24).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('TOTAL NO OF CANDIDATES', margin + 8, y + 7, { width: footerLeftW - 16, align: 'left' });
    if (hall && hall.totalStudents) {
      doc.text(String(hall.totalStudents), margin + footerLeftW, y + 7, { width: footerRightW, align: 'center' });
    }
    y += 24;

    // 9. Footer Box 3: REGISTER NOS OF ABSENTEES (Tall writing area: 56 pt)
    const absH = 56;
    doc.rect(margin, y, printableW, absH).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + footerLeftW, y).lineTo(margin + footerLeftW, y + absH).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('REGISTER NOS OF ABSENTEES', margin + 8, y + 8, { width: footerLeftW - 16, align: 'left' });
    y += absH;

    // 10. Footer Box 4: TOTAL NO OF PAPERS COLLECTED | [blank]
    doc.rect(margin, y, printableW, 24).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + footerLeftW, y).lineTo(margin + footerLeftW, y + 24).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('TOTAL NO OF PAPERS COLLECTED', margin + 8, y + 7, { width: footerLeftW - 16, align: 'left' });
    y += 24;

    // 11. Footer Box 5: SIGNATURE OF THE INVIGILATER | [blank]
    doc.rect(margin, y, printableW, 24).lineWidth(0.8).strokeColor('#000000').stroke();
    doc.moveTo(margin + footerLeftW, y).lineTo(margin + footerLeftW, y + 24).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('SIGNATURE OF THE INVIGILATER', margin + 8, y + 7, { width: footerLeftW - 16, align: 'left' });
    y += 24;

    return y;
  };

  const results = data.result || [];
  for (let i = 0; i < results.length; i += 2) {
    if (i > 0) {
      doc.addPage({ size: [612, 1008], margin: 0 });
    }

    const hall1 = results[i];
    const hall2 = results[i + 1] || null;

    // Render Top Form (starts at Y = 20)
    const endY1 = renderSingleForm(hall1, 20);

    if (hall2) {
      // Subtle dashed cutting line in middle gap
      const cutY = Math.max(492, endY1 + 14);
      doc.lineWidth(0.6).dash(4, { space: 3 }).strokeColor('#888888')
         .moveTo(margin, cutY).lineTo(margin + printableW, cutY).stroke().undash();
      doc.font('Helvetica').fontSize(7.5).fillColor('#888888')
         .text('✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂', margin, cutY - 3, { width: printableW, align: 'center' });

      // Render Bottom Form (starts at Y = 510 or below cut line)
      const form2StartY = Math.max(510, cutY + 16);
      renderSingleForm(hall2, form2StartY);
    }
  }

  doc.end();
}

// Shared Excel generator for Hall-wise Invigilator Report (Exact Box-by-Box Layout, 2 forms per Legal worksheet)
function generateInvigilatorReportExcel(data) {
  let XLSXLib;
  try {
    XLSXLib = require('xlsx-js-style');
  } catch (e) {
    XLSXLib = require('xlsx');
  }

  const wb = XLSXLib.utils.book_new();

  const { examMonth, examYear, headerLine3 } = getInvigilatorReportMonthYear(data);

  const headerLine1 = "RAJAPALAYAM RAJUS' COLLEGE, RAJAPALAYAM.";
  const headerLine2 = "MADURAI KAMARAJ UNIVERSITY EXAMINATIONS";

  const formattedDate = data.formattedDate || data.targetDate;
  const timeText = data.timeOfExam 
    ? `${data.session} (${data.timeOfExam})` 
    : (data.session === 'FN' ? 'FN (10:00 AM - 01:00 PM)' : 'AN (02:00 PM - 05:00 PM)');

  const borderAll = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } }
  };

  const results = data.result || [];
  const usedSheetNames = new Set();

  for (let idx = 0; idx < results.length; idx += 2) {
    const hall1 = results[idx];
    const hall2 = results[idx + 1] || null;

    const ws = {};
    const merges = [];
    const rowHeights = [];

    const writeCell = (r, c, val, bold = false, align = 'left', fontSize = 9.5, vAlign = 'center') => {
      const cellRef = XLSXLib.utils.encode_cell({ r, c });
      ws[cellRef] = {
        v: val !== undefined && val !== null ? val : '',
        t: typeof val === 'number' ? 'n' : 's',
        s: {
          font: {
            name: 'Times New Roman',
            size: fontSize,
            bold: bold
          },
          alignment: {
            horizontal: align,
            vertical: vAlign,
            wrapText: true
          },
          border: borderAll
        }
      };
    };

    const renderFormOnSheet = (hall, baseR) => {
      let r = baseR;

      // 1. College Header (Merged A-C)
      writeCell(r, 0, headerLine1, true, 'center', 11);
      writeCell(r, 1, '');
      writeCell(r, 2, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
      rowHeights[r] = { hpt: 20 };
      r++;

      // 2. University Header (Merged A-C)
      writeCell(r, 0, headerLine2, true, 'center', 10.5);
      writeCell(r, 1, '');
      writeCell(r, 2, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
      rowHeights[r] = { hpt: 18 };
      r++;

      // 3. Month & Year (Merged A-C)
      writeCell(r, 0, headerLine3, true, 'center', 10);
      writeCell(r, 1, '');
      writeCell(r, 2, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
      rowHeights[r] = { hpt: 18 };
      r++;

      // 4. Details (Date | Time | Hall No)
      writeCell(r, 0, `DATE : ${formattedDate}`, true, 'left', 9);
      writeCell(r, 1, `TIME: ${timeText}`, true, 'center', 9);
      writeCell(r, 2, `HALL NO : ${hall ? (hall.hallName || '') : ''}`, true, 'left', 9);
      rowHeights[r] = { hpt: 20 };
      r++;

      // 5. Table Header (CLASS | SUBJECT | NO OF STUDENTS)
      writeCell(r, 0, 'CLASS', true, 'center', 9.5);
      writeCell(r, 1, 'SUBJECT', true, 'center', 9.5);
      writeCell(r, 2, 'NO OF STUDENTS', true, 'center', 9.5);
      rowHeights[r] = { hpt: 20 };
      r++;

      // 6. Student Rows (Only actual groups, no unnecessary empty rows)
      const classes = (hall && hall.classes) || [];
      const numRows = classes.length;
      for (let i = 0; i < numRows; i++) {
        const cls = classes[i];
        writeCell(r, 0, cls ? (cls.degree || cls.classCode || 'GENERAL') : '', false, 'left', 9);
        writeCell(r, 1, cls ? (cls.subjectCode || '') : '', false, 'center', 9);
        writeCell(r, 2, cls ? (cls.count || 0) : '', cls ? true : false, 'center', 9);
        rowHeights[r] = { hpt: 18 };
        r++;
      }

      // 7. Footer Row 1: NAME OF INVIGILATOR | M/s
      writeCell(r, 0, 'NAME OF INVIGILATER', true, 'left', 9);
      writeCell(r, 1, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      writeCell(r, 2, 'M/s', false, 'left', 9);
      rowHeights[r] = { hpt: 22 };
      r++;

      // 8. Footer Row 2: TOTAL NO OF CANDIDATES | [total]
      writeCell(r, 0, 'TOTAL NO OF CANDIDATES', true, 'left', 9);
      writeCell(r, 1, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      writeCell(r, 2, hall && hall.totalStudents ? hall.totalStudents : '', true, 'center', 9.5);
      rowHeights[r] = { hpt: 22 };
      r++;

      // 9. Footer Row 3: REGISTER NOS OF ABSENTEES (Tall writing box: 48 pt)
      writeCell(r, 0, 'REGISTER NOS OF ABSENTEES', true, 'left', 9, 'top');
      writeCell(r, 1, '', false, 'left', 9, 'top');
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      writeCell(r, 2, '', false, 'left', 9, 'top');
      rowHeights[r] = { hpt: 48 };
      r++;

      // 10. Footer Row 4: TOTAL NO OF PAPERS COLLECTED | [blank]
      writeCell(r, 0, 'TOTAL NO OF PAPERS COLLECTED', true, 'left', 9);
      writeCell(r, 1, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      writeCell(r, 2, '', false, 'left', 9);
      rowHeights[r] = { hpt: 22 };
      r++;

      // 11. Footer Row 5: SIGNATURE OF THE INVIGILATER | [blank]
      writeCell(r, 0, 'SIGNATURE OF THE INVIGILATER', true, 'left', 9);
      writeCell(r, 1, '');
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      writeCell(r, 2, '', false, 'left', 9);
      rowHeights[r] = { hpt: 24 };
      r++;

      return r;
    };

    // Render Form 1 (Top)
    let endR1 = renderFormOnSheet(hall1, 0);
    let finalRow = endR1;

    if (hall2) {
      // Gap / cut line between forms
      const cellRefGap = XLSXLib.utils.encode_cell({ r: endR1, c: 0 });
      ws[cellRefGap] = {
        v: '✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂',
        t: 's',
        s: {
          font: { name: 'Times New Roman', size: 8, color: { rgb: '888888' } },
          alignment: { horizontal: 'center', vertical: 'center' }
        }
      };
      merges.push({ s: { r: endR1, c: 0 }, e: { r: endR1, c: 2 } });
      rowHeights[endR1] = { hpt: 16 };
      endR1++;

      rowHeights[endR1] = { hpt: 10 };
      endR1++;

      // Render Form 2 (Bottom)
      let endR2 = renderFormOnSheet(hall2, endR1);
      finalRow = endR2;
    }

    ws['!cols'] = [
      { wch: 26 }, // CLASS
      { wch: 28 }, // SUBJECT
      { wch: 32 }  // NO OF STUDENTS
    ];
    ws['!rows'] = rowHeights;
    ws['!merges'] = merges;
    ws['!ref'] = XLSXLib.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: finalRow, c: 2 }
    });

    ws['!pageSetup'] = {
      paperSize: 5, // Legal / Long Bond
      orientation: 'portrait'
    };

    let baseName;
    if (hall2 && hall2.hallName) {
      baseName = `Halls ${hall1.hallName} - ${hall2.hallName}`.trim().substring(0, 31);
    } else {
      baseName = `Hall ${hall1.hallName}`.trim().substring(0, 31);
    }
    if (!baseName) baseName = `Halls_${idx + 1}`;
    let sheetName = baseName;
    let sCounter = 1;
    while (usedSheetNames.has(sheetName)) {
      sheetName = `${baseName.substring(0, 27)}_${sCounter}`;
      sCounter++;
    }
    usedSheetNames.add(sheetName);

    XLSXLib.utils.book_append_sheet(wb, ws, sheetName);
  }

  return wb;
}

// GET seating summary (locations) for all halls on a date and session
app.get(["/api/seating/locations-by-date-session", "/api/seating/locations-summary"], async (req, res) => {
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

// GET export MKU Nominal Roll PDF file (.pdf)
app.get(["/api/seating/download-nominal-roll-pdf", "/api/seating/locations/download-nominal-roll-pdf"], async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    // Aggregate students across all halls into Department / Subject Code groups
    const groupMap = {};
    data.result.forEach(hall => {
      (hall.classes || []).forEach(c => {
        const key = `${(c.degree || '').trim().toUpperCase()}|||${(c.subjectCode || '').trim().toUpperCase()}`;
        if (!groupMap[key]) {
          groupMap[key] = {
            degree: c.degree,
            subjectCode: c.subjectCode,
            regNos: []
          };
        }
        (c.regNos || []).forEach(r => {
          const upperReg = String(r).trim().toUpperCase();
          if (upperReg && !groupMap[key].regNos.includes(upperReg)) {
            groupMap[key].regNos.push(upperReg);
          }
        });
      });
    });

    const configuredDeptsForSummary = (data.examsAtTime.flatMap(e => e.departments || [])).map(d => canonicalizeDegree(d).toUpperCase());
    const allExamSubsForSummary = (data.examsAtTime.flatMap(e => e.subjectCodes || [])).map(c => String(c).trim().toUpperCase());

    const groups = Object.values(groupMap).map(g => {
      const sortedRegNos = g.regNos.sort((a, b) => a.localeCompare(b));
      return {
        degree: g.degree,
        subjectCode: g.subjectCode,
        regNos: sortedRegNos,
        count: sortedRegNos.length
      };
    });

    groups.sort((a, b) => {
      // 1. Course code order (strictly matching the exact user click/selection order of exam.subjectCodes)
      const subA = String(a.subjectCode || '').trim().toUpperCase();
      const subB = String(b.subjectCode || '').trim().toUpperCase();
      const idxSubA = allExamSubsForSummary.indexOf(subA);
      const idxSubB = allExamSubsForSummary.indexOf(subB);
      if (idxSubA !== -1 && idxSubB !== -1 && idxSubA !== idxSubB) return idxSubA - idxSubB;
      if (idxSubA !== -1 && idxSubB === -1) return -1;
      if (idxSubA === -1 && idxSubB !== -1) return 1;

      // 2. Configured departments order
      const degA = (a.degree || '').toUpperCase();
      const degB = (b.degree || '').toUpperCase();
      const idxDeptA = configuredDeptsForSummary.indexOf(degA);
      const idxDeptB = configuredDeptsForSummary.indexOf(degB);
      if (idxDeptA !== -1 && idxDeptB !== -1 && idxDeptA !== idxDeptB) return idxDeptA - idxDeptB;
      if (idxDeptA !== -1 && idxDeptB === -1) return -1;
      if (idxDeptA === -1 && idxDeptB !== -1) return 1;

      // 3. Academic level: UG before PG
      const lvlA = (degA.startsWith('M.') || degA.startsWith('M')) ? 'PG' : 'UG';
      const lvlB = (degB.startsWith('M.') || degB.startsWith('M')) ? 'PG' : 'UG';
      if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;

      const dComp = degA.localeCompare(degB);
      if (dComp !== 0) return dComp;

      return subA.localeCompare(subB);
    });

    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({
      size: [612, 1008], // Legal / Long Bond: 8.5 x 14 in
      margin: 36,
      bufferPages: true,
      autoFirstPage: true
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Nominal_Roll_MKU_${data.formattedDate}_${session}.pdf"`);
      res.send(pdfData);
    });

    generateMkuNominalRollPdf(doc, data, groups);

  } catch (error) {
    console.error("Error generating MKU Nominal Roll PDF:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET export MKU Nominal Roll as styled Excel file (.xlsx)
app.get(["/api/seating/download-nominal-roll-excel", "/api/seating/locations/download-nominal-roll-excel", "/api/seating/download-nominal-roll-xlsx"], async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    // Aggregate students across all halls into Department / Subject Code groups
    const groupMap = {};
    data.result.forEach(hall => {
      (hall.classes || []).forEach(c => {
        const key = `${(c.degree || '').trim().toUpperCase()}|||${(c.subjectCode || '').trim().toUpperCase()}`;
        if (!groupMap[key]) {
          groupMap[key] = {
            degree: c.degree,
            subjectCode: c.subjectCode,
            regNos: []
          };
        }
        (c.regNos || []).forEach(r => {
          const upperReg = String(r).trim().toUpperCase();
          if (upperReg && !groupMap[key].regNos.includes(upperReg)) {
            groupMap[key].regNos.push(upperReg);
          }
        });
      });
    });

    const configuredDeptsForSummary = (data.examsAtTime.flatMap(e => e.departments || [])).map(d => canonicalizeDegree(d).toUpperCase());
    const allExamSubsForSummary = (data.examsAtTime.flatMap(e => e.subjectCodes || [])).map(c => String(c).trim().toUpperCase());

    const groups = Object.values(groupMap).map(g => {
      const sortedRegNos = g.regNos.sort((a, b) => a.localeCompare(b));
      return {
        degree: g.degree,
        subjectCode: g.subjectCode,
        regNos: sortedRegNos,
        count: sortedRegNos.length
      };
    });

    groups.sort((a, b) => {
      // 1. Course code order (strictly matching the exact user click/selection order of exam.subjectCodes)
      const subA = String(a.subjectCode || '').trim().toUpperCase();
      const subB = String(b.subjectCode || '').trim().toUpperCase();
      const idxSubA = allExamSubsForSummary.indexOf(subA);
      const idxSubB = allExamSubsForSummary.indexOf(subB);
      if (idxSubA !== -1 && idxSubB !== -1 && idxSubA !== idxSubB) return idxSubA - idxSubB;
      if (idxSubA !== -1 && idxSubB === -1) return -1;
      if (idxSubA === -1 && idxSubB !== -1) return 1;

      // 2. Configured departments order
      const degA = (a.degree || '').toUpperCase();
      const degB = (b.degree || '').toUpperCase();
      const idxDeptA = configuredDeptsForSummary.indexOf(degA);
      const idxDeptB = configuredDeptsForSummary.indexOf(degB);
      if (idxDeptA !== -1 && idxDeptB !== -1 && idxDeptA !== idxDeptB) return idxDeptA - idxDeptB;
      if (idxDeptA !== -1 && idxDeptB === -1) return -1;
      if (idxDeptA === -1 && idxDeptB !== -1) return 1;

      // 3. Academic level: UG before PG
      const lvlA = (degA.startsWith('M.') || degA.startsWith('M')) ? 'PG' : 'UG';
      const lvlB = (degB.startsWith('M.') || degB.startsWith('M')) ? 'PG' : 'UG';
      if (lvlA !== lvlB) return lvlA === 'UG' ? -1 : 1;

      const dComp = degA.localeCompare(degB);
      if (dComp !== 0) return dComp;

      return subA.localeCompare(subB);
    });

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

    // Header info
    let examMonth = "NOVEMBER";
    let examYear = new Date().getFullYear();
    try {
      const rawDateStr = String(data.targetDate || (data.examsAtTime && data.examsAtTime[0] && data.examsAtTime[0].date) || "");
      const isoMatch = rawDateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      const dmyMatch = rawDateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if (isoMatch) {
        examYear = parseInt(isoMatch[1], 10);
        const m = parseInt(isoMatch[2], 10) - 1;
        examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
      } else if (dmyMatch) {
        examYear = parseInt(dmyMatch[3], 10);
        const m = parseInt(dmyMatch[2], 10) - 1;
        examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
      } else {
        const d = new Date(rawDateStr);
        if (!isNaN(d.getTime())) {
          examYear = d.getFullYear();
          const m = d.getMonth();
          examMonth = (m >= 7 || m <= 1) ? "NOVEMBER" : "APRIL";
        }
      }
    } catch (e) {}

    const sessionText = (session || "").toUpperCase().includes("AN") ? "A.N." : "F.N.";
    const examSubTitle = `${examMonth} - ${examYear} - ${sessionText}`;

    // Header Rows
    writeCell(0, 0, 'MADURAI KAMARAJ UNIVERSITY EXAMINATIONS', true, 'center', 14);
    writeCell(1, 0, examSubTitle, true, 'center', 12);

    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } }
    ];

    // Table Header Row at Row 3
    // Critical: Col 2 header MUST remain completely blank!
    writeCell(3, 0, 'FOIL NO', true, 'center', 10, true, true);
    writeCell(3, 1, 'ABSENTS', true, 'center', 10, true, true);
    writeCell(3, 2, '', true, 'center', 10, true, true);
    writeCell(3, 3, 'NOMINAL ROLL', true, 'center', 10, true, true);
    writeCell(3, 4, 'TOTAL', true, 'center', 10, true, true);

    let currentRow = 4;

    groups.forEach(group => {
      const ranges = buildNominalRollRanges(group.regNos);
      const groupStartRow = currentRow;
      const degText = group.degree || "";
      const subText = group.subjectCode || "";
      const deptSubLabel = (degText && subText) ? `${degText} / ${subText}` : (degText || subText || "GENERAL");

      ranges.forEach(r => {
        writeCell(currentRow, 0, '', false, 'center', 10, true);
        writeCell(currentRow, 1, '', false, 'center', 10, true);
        writeCell(currentRow, 2, '', false, 'center', 10, true);
        writeCell(currentRow, 3, r.text, false, 'center', 10, true);
        writeCell(currentRow, 4, '', false, 'center', 10, true);
        currentRow++;
      });

      const groupEndRow = currentRow - 1;

      // Col 2: Department and Subject Code, bold, centered
      writeCell(groupStartRow, 2, deptSubLabel, true, 'center', 10, true);
      // Col 4: Actual student count in this group, bold, centered
      writeCell(groupStartRow, 4, group.count, true, 'center', 11, true);

      // If group has multiple ranges, vertically merge Col 0, Col 1, Col 2, Col 4
      if (groupEndRow > groupStartRow) {
        merges.push({ s: { r: groupStartRow, c: 0 }, e: { r: groupEndRow, c: 0 } });
        merges.push({ s: { r: groupStartRow, c: 1 }, e: { r: groupEndRow, c: 1 } });
        merges.push({ s: { r: groupStartRow, c: 2 }, e: { r: groupEndRow, c: 2 } });
        merges.push({ s: { r: groupStartRow, c: 4 }, e: { r: groupEndRow, c: 4 } });
      }
    });

    // Grand Total Row
    const grandTotal = groups.reduce((sum, g) => sum + g.count, 0);
    writeCell(currentRow, 0, '', false, 'center', 10, true);
    writeCell(currentRow, 1, '', false, 'center', 10, true);
    writeCell(currentRow, 2, '', false, 'center', 10, true);
    writeCell(currentRow, 3, 'TOTAL', true, 'right', 10, true);
    writeCell(currentRow, 4, grandTotal, true, 'center', 11, true);
    currentRow++;

    finalizeWorksheet(XLSXLib, ws, merges);

    // Set column widths
    ws['!cols'] = [
      { wch: 16 }, // FOIL NO
      { wch: 18 }, // ABSENTS
      { wch: 24 }, // [BLANK HEADER] (Dept / Subject Code)
      { wch: 45 }, // NOMINAL ROLL
      { wch: 14 }  // TOTAL
    ];

    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 26 };
    ws['!rows'][1] = { hpt: 20 };
    ws['!rows'][3] = { hpt: 22 };

    ws['!pageSetup'] = {
      paperSize: 5, // Legal / Long Bond (8.5 x 14 in)
      orientation: 'portrait',
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 100
    };
    XLSXLib.utils.book_append_sheet(wb, ws, 'MKU Nominal Roll');

    let buf = XLSXLib.write(wb, { bookType: 'xlsx', type: 'buffer' });
    buf = applyLegalPaperSizeToXlsxBuffer(buf);

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Disposition', `attachment; filename="Nominal_Roll_MKU_${data.formattedDate}_${session}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (error) {
    console.error("Error generating MKU Nominal Roll Excel:", error);
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
      writeCell(currentRow, 0, hallTitle, true, 'center', 11);
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
        const classCodeText = (c.degree && c.subjectCode && c.degree !== c.subjectCode)
          ? `${c.degree} / ${c.subjectCode}`
          : (c.classCode || c.degree || c.subjectCode || 'GENERAL');
        writeCell(currentRow, 0, classCodeText, true, 'center', 10, true);
        
        const summarizedRange = c.summarizedRange || summarizeRegisterNumbers(c.regNos);
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
      { wch: 24 }, // CLASS/ CODE NO (Degree & Sub Code)
      { wch: 52 }, // REGISTER NO
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

// GET export Hall-wise Invigilator Report as styled PDF file (.pdf)
app.get(["/api/seating/download-invigilator-report-pdf", "/api/seating/invigilator-report/download-pdf", "/api/seating/download-invigilator-pdf"], async (req, res) => {
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
      size: [612, 1008], // Legal size: 8.5 x 14 in
      margin: 0,
      autoFirstPage: true,
      bufferPages: true
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Invigilator_Report_${data.formattedDate}_${data.session}.pdf"`);
      res.send(pdfData);
    });

    generateInvigilatorReportPdf(doc, data);

  } catch (error) {
    console.error("Error generating Invigilator Report PDF:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET export Hall-wise Invigilator Report as styled Excel file (.xlsx)
app.get(["/api/seating/download-invigilator-report-excel", "/api/seating/invigilator-report/download-excel", "/api/seating/download-invigilator-report-xlsx", "/api/seating/download-invigilator-excel"], async (req, res) => {
  try {
    const { date, session } = req.query;
    if (!date || !session) {
      return res.status(400).json({ error: "date and session are required." });
    }

    const data = await getLocationsSummaryData(date, session);
    if (!data.result || data.result.length === 0) {
      return res.status(404).json({ error: "No seating plans generated for this date and session." });
    }

    let XLSXLib;
    try {
      XLSXLib = require('xlsx-js-style');
    } catch (e) {
      XLSXLib = require('xlsx');
    }

    const wb = generateInvigilatorReportExcel(data);
    let buf = XLSXLib.write(wb, { bookType: 'xlsx', type: 'buffer' });
    buf = applyLegalPaperSizeToXlsxBuffer(buf);

    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Content-Disposition', `attachment; filename="Invigilator_Report_${data.formattedDate}_${data.session}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (error) {
    console.error("Error generating Invigilator Report Excel:", error);
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

    const activeGenSnapshot = plansForHall.length > 0 ? (plansForHall[0].hallSnapshot || null) : null;
    const mergedPlan = {
      date,
      session,
      hallId,
      examId: plansForHall.length > 0 ? plansForHall[0].examId : (examsAtTime[0] ? examsAtTime[0]._id : null),
      hallName: plansForHall.length > 0 ? plansForHall[0].hallName : (hall ? hall.name : ''),
      totalBenches: plansForHall.length > 0 ? plansForHall[0].totalBenches : (hall ? hall.benches : 0),
      hallSnapshot: activeGenSnapshot,
      columns: activeGenSnapshot?.columns || (plansForHall[0] && plansForHall[0].columns) || (hall && hall.columns) || 4,
      rows: activeGenSnapshot?.rows || (plansForHall[0] && plansForHall[0].rows) || (hall && hall.rows) || 4,
      columnRows: activeGenSnapshot?.columnRows || (plansForHall[0] && plansForHall[0].columnRows) || null,
      subjectCodes: allExamSubCodesGen,
      seatingGrid: [],
      attendanceRoster: [],
      unseatedStudents: []
    };

    const grids = plansForHall.map(p => p.seatingGrid).filter(Boolean);
    if (grids.length > 0) {
      const baseGrid = JSON.parse(JSON.stringify(grids[0]));
      const benchMap = new Map();
      baseGrid.forEach(b => {
        if (b && b.benchCode) benchMap.set(b.benchCode, b);
      });
      for (let i = 1; i < grids.length; i++) {
        const otherGrid = grids[i];
        if (Array.isArray(otherGrid)) {
          otherGrid.forEach(bench => {
            if (bench && bench.benchCode && benchMap.has(bench.benchCode)) {
              const target = benchMap.get(bench.benchCode);
              if (!target.seat1 && bench.seat1) target.seat1 = bench.seat1;
              if (!target.seat2 && bench.seat2) target.seat2 = bench.seat2;
              if (bench.seat3 !== undefined && !target.seat3 && bench.seat3) target.seat3 = bench.seat3;
            }
          });
        }
      }
      mergedPlan.seatingGrid = baseGrid;
      realignSeatingGridToAscending(mergedPlan.seatingGrid, mergedPlan.columns, allExamSubCodesGen);
      for (const p of plansForHall) {
        if (p._id && p.seatingGrid) {
          realignSeatingGridToAscending(p.seatingGrid, p.columns || mergedPlan.columns, allExamSubCodesGen);
          try {
            await Models.SeatingPlan.findByIdAndUpdate(p._id, {
              seatingGrid: p.seatingGrid
            });
          } catch (_) {}
        }
      }
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

    try {
      await syncDateRecordSnapshot(date, session);
    } catch (_) {}

    res.json(mergedPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify administrator configuration status (securely requires new college to create its own admin)
async function checkAdminSetupStatus() {
  try {
    const existingUsers = await Models.User.find();
    if (existingUsers.length === 0) {
      console.log('[System Status] Fresh installation detected. First-time administrator setup is required.');
    } else {
      console.log(`[System Status] Authentication active (${existingUsers.length} user account(s) configured).`);
    }
  } catch (err) {
    console.error('Error checking admin status:', err.message);
  }
}

// Auto-repair & normalize student departments (e.g. derive BA, BBA, BCOM, BSC, MA, MCOM, MSC from degree, csvData, or register numbers)
async function normalizeStudentDepartments() {
  try {
    const students = await Models.Student.find();
    let updatedCount = 0;
    for (const student of students) {
      const currentDept = (student.department || '').trim().toUpperCase();
      if (!currentDept || currentDept === 'GENERAL' || currentDept === 'UNKNOWN' || currentDept.length > 25) {
        const derivedDept = resolveStudentDepartment(student, student.registerNo, student.department);
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

// Serve static React production build assets
const possibleBuildPaths = [
  path.join(__dirname, '../build'),
  path.join(__dirname, 'build'),
  path.join(process.cwd(), 'build')
];
const clientBuildPath = possibleBuildPaths.find(p => fs.existsSync(path.join(p, 'index.html')));

if (clientBuildPath) {
  console.log(`[ExamFlow] Serving frontend production build from: ${clientBuildPath}`);
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.warn('[ExamFlow] Frontend build folder not found. Running in API-only mode.');
}

// Start Server
const server = app.listen(PORT, async () => {
  await initMysql();
  const status = dbStatus();
  console.log(`\n==================================================`);
  console.log(`ExamFlow Backend Server running on port ${PORT}`);
  console.log(`Database status: ${status.mode} (Connected: ${status.connected})`);
  console.log(`==================================================\n`);
  await checkAdminSetupStatus();
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
