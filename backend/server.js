const express = require('express');
const cors = require('cors');
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

// Helper: Parse CSV text into array of objects
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  
  // Find column indexes
  let regIndex = headers.findIndex(h => /reg|roll|number|id/i.test(h));
  let nameIndex = headers.findIndex(h => /name|student/i.test(h));
  let deptIndex = headers.findIndex(h => /dept|branch|course|subject/i.test(h));

  // Fallbacks if not detected by regex
  if (regIndex === -1) regIndex = 0;
  if (nameIndex === -1) nameIndex = 1;
  if (deptIndex === -1) deptIndex = 2;

  const records = [];
  for (let i = 1; i < lines.length; i++) {
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

      if (registerNo && name && department) {
        records.push({
          registerNo,
          name,
          department: department.toUpperCase()
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

    res.json({
      totalStudents,
      totalHalls,
      totalCapacity,
      totalExams,
      departmentsCount: Object.keys(deptMap).length,
      departmentDistribution
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/activities', (req, res) => {
  res.json(recentActivities);
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

// 5. Exam Management
app.get('/api/exams', async (req, res) => {
  try {
    const exams = await Models.Exam.find();
    res.json(exams);
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
    
    // Filter students belonging to exam departments
    let matchingStudents = allStudents.filter(s => 
      examDepts.includes(s.department.toUpperCase())
    );

    // Group students by department to make alternation easy
    const studentsByDept = {};
    examDepts.forEach(dept => {
      studentsByDept[dept] = matchingStudents.filter(s => s.department.toUpperCase() === dept).sort((a, b) => a.registerNo.localeCompare(b.registerNo));
    });

    // We will place students alternating by department
    // Let's create two pools of departments to split between Seat 1 and Seat 2
    // If only one department, we'll split the students into two lists (even index vs odd index)
    let seat1Pool = [];
    let seat2Pool = [];

    if (examDepts.length === 1) {
      const dept = examDepts[0];
      const list = studentsByDept[dept] || [];
      list.forEach((student, index) => {
        if (index % 2 === 0) {
          seat1Pool.push(student);
        } else {
          seat2Pool.push(student);
        }
      });
    } else {
      // Multiple departments: e.g. CSE and IT
      // Seat 1 gets even index departments, Seat 2 gets odd index departments
      examDepts.forEach((dept, deptIndex) => {
        const list = studentsByDept[dept] || [];
        if (deptIndex % 2 === 0) {
          seat1Pool.push(...list);
        } else {
          seat2Pool.push(...list);
        }
      });
      // Sort pools by register number to keep it consistent
      seat1Pool.sort((a, b) => a.registerNo.localeCompare(b.registerNo));
      seat2Pool.sort((a, b) => a.registerNo.localeCompare(b.registerNo));
    }

    // Seating arrangement generation
    const seatingGrid = [];
    const attendanceRoster = [];
    let studentIndex1 = 0;
    let studentIndex2 = 0;
    let totalStudentsSeated = 0;

    const rowsCount = hall.rows;
    const colsCount = hall.columns;

    // Fill row by row, column by column
    for (let r = 0; r < rowsCount; r++) {
      const rowLetter = String.fromCharCode(65 + r); // A, B, C...
      for (let c = 1; c <= colsCount; c++) {
        const benchCode = `${rowLetter}${c}`;
        
        let seat1Student = null;
        let seat2Student = null;

        // Assign to seat 1 (Left)
        if (studentIndex1 < seat1Pool.length) {
          seat1Student = seat1Pool[studentIndex1++];
          totalStudentsSeated++;
          attendanceRoster.push({
            registerNo: seat1Student.registerNo,
            name: seat1Student.name,
            department: seat1Student.department,
            bench: benchCode,
            seat: 'Left'
          });
        }

        // Assign to seat 2 (Right)
        if (studentIndex2 < seat2Pool.length) {
          seat2Student = seat2Pool[studentIndex2++];
          totalStudentsSeated++;
          attendanceRoster.push({
            registerNo: seat2Student.registerNo,
            name: seat2Student.name,
            department: seat2Student.department,
            bench: benchCode,
            seat: 'Right'
          });
        }

        seatingGrid.push({
          benchCode,
          row: rowLetter,
          col: c,
          seat1: seat1Student,
          seat2: seat2Student
        });
      }
    }

    // Stats
    const totalBenches = hall.benches;
    const capacity = hall.capacity;
    const emptySeats = capacity - totalStudentsSeated;

    // Create/update the SeatingPlan
    const plan = await Models.SeatingPlan.create({
      examId,
      examName: exam.name,
      hallId,
      hallName: hall.name,
      seatingGrid,
      attendanceRoster: attendanceRoster.sort((a, b) => a.registerNo.localeCompare(b.registerNo)),
      totalBenches,
      totalStudents: totalStudentsSeated,
      emptySeats
    });

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
