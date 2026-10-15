// Comprehensive Automated Verification Suite for ExamFlow Fresh Customer Installation
// Tests clean installation on isolated database and storage while verifying development DB remains untouched.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  mysql = require('../backend/node_modules/mysql2/promise');
}

const TEST_PORT = 5055;
const TEST_API = `http://127.0.0.1:${TEST_PORT}`;
const ISOLATED_DATA_DIR = path.resolve(__dirname, 'test_fresh_data');
const ISOLATED_JSON_ONLY_DIR = path.resolve(__dirname, 'test_json_data');
const TEST_DB_NAME = 'examflow_clean_test';

async function queryMysql(dbName, sql, params = []) {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: dbName
  });
  const [rows] = await conn.query(sql, params);
  await conn.end();
  return rows;
}

async function getDevDbCounts() {
  const counts = {};
  for (const table of ['students', 'halls', 'exams', 'seating_plans', 'users']) {
    const rows = await queryMysql('examflow', `SELECT COUNT(*) as cnt FROM ${table}`);
    counts[table] = rows[0].cnt;
  }
  return counts;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(endpoint, options = {}) {
  const res = await fetch(`${TEST_API}${endpoint}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runCleanInstallationTest() {
  console.log('======================================================================');
  console.log('ExamFlow: Fresh Installation Verification Test Suite');
  console.log('======================================================================\n');

  let passed = 0;
  function verify(cond, desc) {
    assert(cond, desc);
    passed++;
    console.log(`  ✓ ${desc}`);
  }

  // -------------------------------------------------------------------------
  // STEP 1: Verify Development Database Before Tests
  // -------------------------------------------------------------------------
  console.log('--- Step 1: Checking Development Database (examflow) Before Testing ---');
  const initialDevCounts = await getDevDbCounts();
  console.log('  Development DB (examflow) counts:', initialDevCounts);
  verify(initialDevCounts.students === 1575, `Dev students is 1575 (got ${initialDevCounts.students})`);
  verify(initialDevCounts.halls === 43, `Dev halls is 43 (got ${initialDevCounts.halls})`);
  verify(initialDevCounts.exams === 4, `Dev exams is 4 (got ${initialDevCounts.exams})`);
  verify(initialDevCounts.seating_plans === 57, `Dev seating_plans is 57 (got ${initialDevCounts.seating_plans})`);
  verify(initialDevCounts.users === 1, `Dev users is 1 (got ${initialDevCounts.users})`);

  // -------------------------------------------------------------------------
  // STEP 2: Prepare Isolated Test Database & Data Directory
  // -------------------------------------------------------------------------
  console.log('\n--- Step 2: Preparing Isolated Test Environment ---');
  if (fs.existsSync(ISOLATED_DATA_DIR)) fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(ISOLATED_DATA_DIR, { recursive: true });

  // Create isolated MySQL test database
  const rootConn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' });
  await rootConn.query(`DROP DATABASE IF EXISTS \`${TEST_DB_NAME}\``);
  await rootConn.query(`CREATE DATABASE \`${TEST_DB_NAME}\``);
  await rootConn.end();
  console.log(`  ✓ Created clean isolated MySQL database: ${TEST_DB_NAME}`);

  // Initialize clean files in ISOLATED_DATA_DIR
  for (const f of ['students.json', 'exams.json', 'halls.json', 'seating_plans.json', 'upload_history.json', 'users.json', 'activities.json']) {
    fs.writeFileSync(path.join(ISOLATED_DATA_DIR, f), '[]', 'utf8');
  }
  fs.writeFileSync(path.join(ISOLATED_DATA_DIR, 'printouts.json'), JSON.stringify({ count: 0 }), 'utf8');
  fs.mkdirSync(path.join(ISOLATED_DATA_DIR, 'backups'), { recursive: true });
  console.log(`  ✓ Created clean isolated JSON stores in: ${ISOLATED_DATA_DIR}`);

  // -------------------------------------------------------------------------
  // STEP 3: Start Test Server on Port 5055 with Isolated Environment
  // -------------------------------------------------------------------------
  console.log('\n--- Step 3: Launching Isolated Test Backend Server ---');
  const serverEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    DB_NAME: TEST_DB_NAME,
    DATA_DIR: ISOLATED_DATA_DIR,
    AUTH_SECRET: 'clean_installation_secret_key_456'
  };

  const serverProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '../backend'),
    env: serverEnv,
    stdio: 'pipe'
  });

  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});

  // Wait for server to be responsive
  let serverReady = false;
  for (let i = 0; i < 40; i++) {
    await wait(300);
    try {
      const res = await fetch(`${TEST_API}/api/status`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch (e) {}
  }
  verify(serverReady, `Test server is up and responsive on port ${TEST_PORT}`);

  try {
    // -------------------------------------------------------------------------
    // STEP 4: Verify Initial Clean State (0 Records)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Verifying Fresh Installation Starts with 0 Records ---');
    const statusRes = await fetchJson('/api/status');
    verify(statusRes.data.connected === true, 'Test database is connected via MySQL');

    const setupStatus = await fetchJson('/api/auth/setup-status');
    verify(setupStatus.data.setupRequired === true, 'Setup status confirms: setupRequired is true (0 users)');

    const studentsRes = await fetchJson('/api/students');
    verify(studentsRes.data.length === 0, 'Fresh installation has 0 students');

    const hallsRes = await fetchJson('/api/halls');
    verify(hallsRes.data.length === 0, 'Fresh installation has 0 halls');

    const examsRes = await fetchJson('/api/exams');
    verify(examsRes.data.length === 0, 'Fresh installation has 0 exams');

    // -------------------------------------------------------------------------
    // STEP 5: Verify Default Credentials / Backdoor Are Rejected
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Testing Rejection of Hardcoded/Shared Default Credentials ---');
    const badLogin1 = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrUsername: 'admin', password: 'admin' })
    });
    verify(badLogin1.status === 401, 'Login with default password admin/admin is rejected (401)');

    const badLogin2 = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrUsername: 'admin', password: 'admin@123' })
    });
    verify(badLogin2.status === 401, 'Login with default password admin/admin@123 is rejected (401)');

    // -------------------------------------------------------------------------
    // STEP 6: First-Time Administrator Creation
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: First-Time Administrator Creation ---');
    const setupAdmin = await fetchJson('/api/auth/first-time-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'college_admin',
        email: 'exam.controller@newcollege.edu',
        password: 'CollegeSecretPassword#2026'
      })
    });
    verify(setupAdmin.status === 201, 'First-time administrator setup returned 201 Created');
    verify(setupAdmin.data.success === true, 'Setup response indicates success');
    verify(setupAdmin.data.user.username === 'college_admin', 'Admin username is college_admin');
    verify(Boolean(setupAdmin.data.token), 'Auth token generated for new administrator');
    const adminToken = setupAdmin.data.token;

    // Verify setupRequired is now false
    const setupStatusAfter = await fetchJson('/api/auth/setup-status');
    verify(setupStatusAfter.data.setupRequired === false, 'Setup status confirms: setupRequired is now false');

    // Verify subsequent calls to first-time setup are strictly blocked
    const secondSetup = await fetchJson('/api/auth/first-time-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'intruder',
        email: 'intruder@bad.com',
        password: 'password123'
      })
    });
    verify(secondSetup.status === 403, 'Subsequent first-time setup attempt rejected with 403 Forbidden');

    // Verify login with new credentials succeeds
    const goodLogin = await fetchJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailOrUsername: 'college_admin',
        password: 'CollegeSecretPassword#2026'
      })
    });
    verify(goodLogin.status === 200, 'Login with new administrator credentials succeeds (200 OK)');
    verify(goodLogin.data.user.email === 'exam.controller@newcollege.edu', 'Authenticated user email matches');

    // -------------------------------------------------------------------------
    // STEP 7: Customer Workflow (Halls, Students, Exam, Seating, Export)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 7: Testing Customer Workflow (Halls, Students, Exam, Seating) ---');

    // 7.1 Upload / Create Halls
    const hall1Res = await fetchJson('/api/halls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'HALL-101',
        block: 'SCIENCE BLOCK',
        rows: 4,
        columns: 4,
        benches: 15,
        seatsPerBench: 2,
        capacity: 30,
        columnRows: [4, 4, 4, 3]
      })
    });
    verify(hall1Res.status === 201 || hall1Res.status === 200, 'Created HALL-101 (capacity 30)');

    const hall2Res = await fetchJson('/api/halls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'HALL-102',
        block: 'SCIENCE BLOCK',
        rows: 4,
        columns: 4,
        benches: 15,
        seatsPerBench: 2,
        capacity: 30,
        columnRows: [4, 4, 4, 3]
      })
    });
    verify(hall2Res.status === 201 || hall2Res.status === 200, 'Created HALL-102 (capacity 30)');

    // 7.2 Upload / Create Students
    const studentData = [];
    const csvRows = ['RegNo,Student Name,Degree,Cousr Code,No of Sub,Subjects Appearing'];
    for (let i = 1; i <= 20; i++) {
      csvRows.push(`NC26CS${String(i).padStart(3, '0')},CS Student ${i},B.Sc,CS,2,CS301 CS302`);
    }
    for (let i = 1; i <= 20; i++) {
      csvRows.push(`NC26EC${String(i).padStart(3, '0')},EC Student ${i},B.Sc,EC,2,EC301 EC302`);
    }
    const csvContent = csvRows.join('\n');

    const uploadStudents = await fetchJson('/api/students/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ csvText: csvContent })
    });
    verify(uploadStudents.status === 200, 'Uploaded 40 new customer students via /api/students/upload');

    const studentCountCheck = await fetchJson('/api/students');
    verify(studentCountCheck.data.length === 40, `Confirmed 40 students in database (got ${studentCountCheck.data.length})`);

    // 7.3 Create Exam
    const examDate = '2026-12-10';
    const examSession = 'FN';
    const examRes = await fetchJson('/api/exams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'CS301, EC301 Semester Examination',
        departments: ['CS', 'EC'],
        subjectCodes: ['CS301', 'EC301'],
        date: examDate,
        session: examSession,
        assignedHalls: ['HALL-101', 'HALL-102'],
        seatsPerBench: 2
      })
    });
    verify(examRes.status === 200 || examRes.status === 201, 'Created Exam for 2026-12-10 FN');
    const createdExam = examRes.data;

    // 7.4 Generate Seating Plan
    const generateRes1 = await fetchJson('/api/seating/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ examId: createdExam._id, hallId: 'HALL-101' })
    });
    verify(generateRes1.status === 200, 'Generated seating arrangement for HALL-101');

    const generateRes2 = await fetchJson('/api/seating/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ examId: createdExam._id, hallId: 'HALL-102' })
    });
    verify(generateRes2.status === 200, 'Generated seating arrangement for HALL-102');

    // 7.5 Verify Exports
    const csvExport = await fetch(`${TEST_API}/api/seating/labels/download-csv?date=${examDate}&session=${examSession}`);
    verify(csvExport.status === 200, 'CSV Seat Label download endpoint returned 200 OK');
    const csvText = await csvExport.text();
    const labelCount = csvText.split(/[\n,]/).map(s => s.trim()).filter(Boolean).length;
    verify(labelCount === 40, `Exported labels count matches allocated students (40 === ${labelCount})`);

    const pdfExport = await fetch(`${TEST_API}/api/seating/labels/download-pdf?date=${examDate}&session=${examSession}`);
    verify(pdfExport.status === 200, 'PDF Seat Label download endpoint returned 200 OK');

    const excelExport = await fetch(`${TEST_API}/api/seating/labels/download-excel?date=${examDate}&session=${examSession}`);
    verify(excelExport.status === 200, 'Excel Seat Label download endpoint returned 200 OK');

  } finally {
    // Terminate test server
    serverProc.kill();
    await wait(500);
  }

  // -------------------------------------------------------------------------
  // STEP 8: Test Persistence Across Restart
  // -------------------------------------------------------------------------
  console.log('\n--- Step 8: Verifying Customer Data Persists Across Server Restart ---');
  const restartedServer = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '../backend'),
    env: serverEnv,
    stdio: 'pipe'
  });

  restartedServer.stdout.on('data', () => {});
  restartedServer.stderr.on('data', () => {});

  let restartedReady = false;
  for (let i = 0; i < 40; i++) {
    await wait(300);
    try {
      const res = await fetch(`${TEST_API}/api/status`);
      if (res.ok) {
        restartedReady = true;
        break;
      }
    } catch (e) {}
  }
  verify(restartedReady, 'Restarted test server is responsive');

  try {
    const studentsAfterRestart = await fetchJson('/api/students');
    verify(studentsAfterRestart.data.length === 40, `Students intact after restart: 40 (got ${studentsAfterRestart.data.length})`);

    const hallsAfterRestart = await fetchJson('/api/halls');
    verify(hallsAfterRestart.data.length === 2, `Halls intact after restart: 2 (got ${hallsAfterRestart.data.length})`);

    const examsAfterRestart = await fetchJson('/api/exams');
    verify(examsAfterRestart.data.length === 1, `Exams intact after restart: 1 (got ${examsAfterRestart.data.length})`);

    const setupStatusAfterRestart = await fetchJson('/api/auth/setup-status');
    verify(setupStatusAfterRestart.data.setupRequired === false, 'SetupRequired remains false after restart');
  } finally {
    restartedServer.kill();
    await wait(500);
  }

  // -------------------------------------------------------------------------
  // STEP 9: Test Isolated JSON Fallback Mode
  // -------------------------------------------------------------------------
  console.log('\n--- Step 9: Verifying Isolated JSON Fallback Mode ---');
  if (fs.existsSync(ISOLATED_JSON_ONLY_DIR)) fs.rmSync(ISOLATED_JSON_ONLY_DIR, { recursive: true, force: true });
  fs.mkdirSync(ISOLATED_JSON_ONLY_DIR, { recursive: true });
  for (const f of ['students.json', 'exams.json', 'halls.json', 'seating_plans.json', 'upload_history.json', 'users.json', 'activities.json']) {
    fs.writeFileSync(path.join(ISOLATED_JSON_ONLY_DIR, f), '[]', 'utf8');
  }
  fs.writeFileSync(path.join(ISOLATED_JSON_ONLY_DIR, 'printouts.json'), JSON.stringify({ count: 0 }), 'utf8');

  const jsonServerEnv = {
    ...process.env,
    PORT: String(TEST_PORT),
    DB_PORT: '39999', // Deliberately invalid MySQL port to force JSON fallback
    DATA_DIR: ISOLATED_JSON_ONLY_DIR,
    AUTH_SECRET: 'json_fallback_test_secret'
  };

  const jsonServerProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '../backend'),
    env: jsonServerEnv,
    stdio: 'pipe'
  });

  let jsonServerReady = false;
  for (let i = 0; i < 40; i++) {
    await wait(300);
    try {
      const res = await fetch(`${TEST_API}/api/status`);
      if (res.ok) {
        jsonServerReady = true;
        break;
      }
    } catch (e) {}
  }
  verify(jsonServerReady, 'JSON fallback server started successfully');

  try {
    const jsonStatus = await fetchJson('/api/status');
    verify(jsonStatus.data.connected === false, 'Confirmed running in JSON fallback mode');

    const jsonSetup = await fetchJson('/api/auth/setup-status');
    verify(jsonSetup.data.setupRequired === true, 'JSON fallback starts with setupRequired: true (0 users)');

    const jsonStudents = await fetchJson('/api/students');
    verify(jsonStudents.data.length === 0, 'JSON fallback starts with 0 students (no old records)');

    const jsonHalls = await fetchJson('/api/halls');
    verify(jsonHalls.data.length === 0, 'JSON fallback starts with 0 halls (no old records)');
  } finally {
    jsonServerProc.kill();
    await wait(500);
  }

  // -------------------------------------------------------------------------
  // STEP 10: MANDATORY VERIFICATION OF RULE 8: Dev DB Unchanged
  // -------------------------------------------------------------------------
  console.log('\n--- Step 10: MANDATORY RULE 8 - Verifying Development DB (examflow) ---');
  const finalDevCounts = await getDevDbCounts();
  console.log('  Development DB (examflow) counts after tests:', finalDevCounts);

  verify(finalDevCounts.students === initialDevCounts.students, `Rule 8 PASS: Dev students completely untouched (${finalDevCounts.students} === ${initialDevCounts.students})`);
  verify(finalDevCounts.halls === initialDevCounts.halls, `Rule 8 PASS: Dev halls completely untouched (${finalDevCounts.halls} === ${initialDevCounts.halls})`);
  verify(finalDevCounts.exams === initialDevCounts.exams, `Rule 8 PASS: Dev exams completely untouched (${finalDevCounts.exams} === ${initialDevCounts.exams})`);
  verify(finalDevCounts.seating_plans === initialDevCounts.seating_plans, `Rule 8 PASS: Dev seating plans completely untouched (${finalDevCounts.seating_plans} === ${initialDevCounts.seating_plans})`);
  verify(finalDevCounts.users === initialDevCounts.users, `Rule 8 PASS: Dev users completely untouched (${finalDevCounts.users} === ${initialDevCounts.users})`);

  // Cleanup isolated test resources
  try {
    const cleanRoot = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' });
    await cleanRoot.query(`DROP DATABASE IF EXISTS \`${TEST_DB_NAME}\``);
    await cleanRoot.end();
    if (fs.existsSync(ISOLATED_DATA_DIR)) fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
    if (fs.existsSync(ISOLATED_JSON_ONLY_DIR)) fs.rmSync(ISOLATED_JSON_ONLY_DIR, { recursive: true, force: true });
    console.log('  ✓ Cleaned up isolated test databases and directories');
  } catch (e) {}

  console.log('\n======================================================================');
  console.log(`ALL TESTS PASSED: ${passed} assertions verified successfully!`);
  console.log('======================================================================\n');
}

runCleanInstallationTest().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
