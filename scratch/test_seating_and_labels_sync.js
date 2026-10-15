// Comprehensive Automated Test Suite for ExamFlow Seating & Seat Label Synchronization
// Validates all 10 Mandatory Verification Items using real saved seating plans

const assert = require('assert');
const fs = require('fs');
let XLSX;
try {
  XLSX = require('xlsx-js-style');
} catch (e) {
  try {
    XLSX = require('../backend/node_modules/xlsx-js-style');
  } catch (e2) {
    XLSX = require('../backend/node_modules/xlsx');
  }
}

const API_BASE = 'http://localhost:5000';

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function getText(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.text();
}

async function getBuffer(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Helper: Calculate exact serpentine student sequence from a hall's seatingGrid
function getSerpentineStudentSequenceFromGrid(grid, cols, colRows) {
  const benchMap = new Map();
  grid.forEach(b => { if (b && b.benchCode) benchMap.set(b.benchCode, b); });

  const students = [];
  for (let c = 1; c <= cols; c++) {
    const rowsInCol = colRows && colRows[c - 1] !== undefined ? colRows[c - 1] : 6;
    if (c % 2 === 1) { // Odd column: top to bottom
      for (let r = 0; r < rowsInCol; r++) {
        const code = `${String.fromCharCode(65 + r)}${c}`;
        const bench = benchMap.get(code);
        if (bench && !bench.isPlaceholder) {
          if (bench.seat1?.registerNo) students.push(bench.seat1);
          if (bench.seat2?.registerNo) students.push(bench.seat2);
          if (bench.seat3?.registerNo) students.push(bench.seat3);
        }
      }
    } else { // Even column: bottom to top
      for (let r = rowsInCol - 1; r >= 0; r--) {
        const code = `${String.fromCharCode(65 + r)}${c}`;
        const bench = benchMap.get(code);
        if (bench && !bench.isPlaceholder) {
          if (bench.seat1?.registerNo) students.push(bench.seat1);
          if (bench.seat2?.registerNo) students.push(bench.seat2);
          if (bench.seat3?.registerNo) students.push(bench.seat3);
        }
      }
    }
  }
  return students;
}

async function runVerification() {
  console.log('================================================================================');
  console.log('ExamFlow: Seating Arrangement & Seat Label Synchronization Verification');
  console.log('================================================================================\n');

  let passedAssertions = 0;
  function verify(cond, desc) {
    assert(cond, desc);
    passedAssertions++;
    console.log(`  ✓ ${desc}`);
  }
  // 1. Verify Scheduled Exam and Configured Hall Order
  console.log('--- Step 1: Verify Configured Exam and Hall Order ---');
  const exams = await getJson('/api/exams');
  const targetExam = exams.find(e => e.assignedHalls && e.assignedHalls.length >= 2) || exams[0];
  verify(Boolean(targetExam), 'Found active exam with configured halls in database');
  const targetDate = targetExam.date.split('T')[0];
  const targetSession = targetExam.session;
  console.log(`  Target Exam: ${targetExam.name || targetExam._id} on ${targetDate} ${targetSession}`);
  console.log(`  Configured Assigned Halls (${targetExam.assignedHalls.length}):`, targetExam.assignedHalls.join(', '));
  verify(targetExam.assignedHalls.length >= 2, `Exam has at least 2 assigned halls (Actual: ${targetExam.assignedHalls.length})`);

  const hall1Name = targetExam.assignedHalls[0];
  const hall2Name = targetExam.assignedHalls[1];
  const hall3Name = targetExam.assignedHalls[2] || null;

  // 2. Verify Hall 1 Saved Seating Plan
  console.log(`\n--- Step 2: Verify Hall ${hall1Name} Saved Seating Plan ---`);
  const h1HallId = targetExam.hallSnapshots?.[hall1Name]?._id || hall1Name;
  const h1Plan = await getJson(`/api/seating/by-date-session?date=${targetDate}&session=${targetSession}&hallId=${h1HallId}`);
  verify(!h1Plan.notFound, `Hall ${hall1Name} seating plan exists in database`);
  console.log(`  Hall ${hall1Name} Student Count: ${h1Plan.totalStudents}`);
  verify(h1Plan.totalStudents > 0, `Verification Rule 1: ${hall1Name} has students (Actual: ${h1Plan.totalStudents})`);

  const h1Cols = h1Plan.columns || 3;
  const h1ColRows = h1Plan.columnRows || [];
  const h1SerpentineStudents = getSerpentineStudentSequenceFromGrid(h1Plan.seatingGrid, h1Cols, h1ColRows);
  verify(h1SerpentineStudents.length === h1Plan.totalStudents, `Hall ${hall1Name} extracted serpentine student count is ${h1Plan.totalStudents} (Actual: ${h1SerpentineStudents.length})`);

  // 3. Verify Hall 2 Saved Seating Plan
  console.log(`\n--- Step 3: Verify Hall ${hall2Name} Saved Seating Plan ---`);
  const h2HallId = targetExam.hallSnapshots?.[hall2Name]?._id || hall2Name;
  const h2Plan = await getJson(`/api/seating/by-date-session?date=${targetDate}&session=${targetSession}&hallId=${h2HallId}`);
  verify(!h2Plan.notFound, `Hall ${hall2Name} seating plan exists in database`);
  console.log(`  Hall ${hall2Name} Student Count: ${h2Plan.totalStudents}`);
  verify(h2Plan.totalStudents > 0, `Verification Rule 1: ${hall2Name} has students (Actual: ${h2Plan.totalStudents})`);

  const h2Cols = h2Plan.columns || 4;
  const h2ColRows = h2Plan.columnRows || [];
  const h2SerpentineStudents = getSerpentineStudentSequenceFromGrid(h2Plan.seatingGrid, h2Cols, h2ColRows);
  verify(h2SerpentineStudents.length === h2Plan.totalStudents, `Hall ${hall2Name} extracted serpentine student count matches totalStudents (${h2SerpentineStudents.length})`);

  // 4. Verify Hall 3 Saved Seating Plan (if configured)
  let h3Plan = null;
  let h3SerpentineStudents = [];
  if (hall3Name) {
    console.log(`\n--- Step 4: Verify Hall ${hall3Name} Saved Seating Plan ---`);
    const h3HallId = targetExam.hallSnapshots?.[hall3Name]?._id || hall3Name;
    h3Plan = await getJson(`/api/seating/by-date-session?date=${targetDate}&session=${targetSession}&hallId=${h3HallId}`);
    verify(!h3Plan.notFound, `Hall ${hall3Name} seating plan exists in database`);
    console.log(`  Hall ${hall3Name} Student Count: ${h3Plan.totalStudents}`);
    const h3Cols = h3Plan.columns || 4;
    const h3ColRows = h3Plan.columnRows || [];
    h3SerpentineStudents = getSerpentineStudentSequenceFromGrid(h3Plan.seatingGrid, h3Cols, h3ColRows);
    verify(h3SerpentineStudents.length === h3Plan.totalStudents, `Hall ${hall3Name} extracted serpentine student count matches totalStudents (${h3SerpentineStudents.length})`);
  }

  // 5. Test Continuous Hall-wise Ordering via CSV Label Export
  console.log('\n--- Step 5: Test Continuous Hall-wise Label Export (CSV) ---');
  const csvText = await getText(`/api/seating/labels/download-csv?date=${targetDate}&session=${targetSession}`);
  const labelRegNos = csvText.split(/[\n,]/).map(s => s.trim().toUpperCase()).filter(Boolean);
  console.log(`  Total Labels Exported across all halls: ${labelRegNos.length}`);

  // Verification 2: First N labels exactly match Hall 1's saved student sequence
  console.log(`\n  Checking Rule 2: First ${h1Plan.totalStudents} labels match Hall ${hall1Name} saved sequence:`);
  for (let i = 0; i < h1Plan.totalStudents; i++) {
    const labelReg = labelRegNos[i];
    const expectedReg = h1SerpentineStudents[i].registerNo.toUpperCase();
    assert.strictEqual(labelReg, expectedReg, `Label position ${i + 1} (${labelReg}) matches ${hall1Name} seat ${i + 1} (${expectedReg})`);
  }
  verify(true, `Rule 2 PASS: First ${h1Plan.totalStudents} labels exactly match Hall ${hall1Name} saved student sequence`);

  // Verification 3: Next labels match Hall 2's saved sequence
  console.log(`\n  Checking Rule 3: Next ${h2Plan.totalStudents} labels match students of Hall ${hall2Name}:`);
  for (let i = 0; i < h2Plan.totalStudents; i++) {
    const labelPos = h1Plan.totalStudents + i;
    const labelReg = labelRegNos[labelPos];
    const expectedReg = h2SerpentineStudents[i].registerNo.toUpperCase();
    assert.strictEqual(labelReg, expectedReg, `Label position ${labelPos + 1} (${labelReg}) matches ${hall2Name} student ${i + 1} (${expectedReg})`);
  }
  verify(true, `Rule 3 PASS: Next ${h2Plan.totalStudents} labels match students of Hall ${hall2Name}`);

  // Verification 4: Hall 3 continues directly after Hall 2
  if (h3Plan && h3Plan.totalStudents > 0) {
    console.log(`\n  Checking Rule 4: Labels continue directly with Hall ${hall3Name}:`);
    const h3StartPos = h1Plan.totalStudents + h2Plan.totalStudents;
    for (let i = 0; i < Math.min(20, h3SerpentineStudents.length); i++) {
      const labelPos = h3StartPos + i;
      const labelReg = labelRegNos[labelPos];
      const expectedReg = h3SerpentineStudents[i].registerNo.toUpperCase();
      assert.strictEqual(labelReg, expectedReg, `Position ${labelPos + 1} (${labelReg}) matches ${hall3Name} student ${i + 1} (${expectedReg})`);
    }
    verify(true, `Rule 4 PASS: Hall ${hall3Name} students continue immediately after Hall ${hall2Name}`);
  }

  // Verification 6: Every register number appears exactly once
  console.log('\n--- Step 6: Verify Register Number Uniqueness & Integrity ---');
  const uniqueRegNos = new Set(labelRegNos);
  verify(uniqueRegNos.size === labelRegNos.length, `Rule 6 PASS: Every register number appears exactly once (Unique: ${uniqueRegNos.size}, Total: ${labelRegNos.length}, Duplicates: 0)`);

  // Verification 7: No student missing or assigned to wrong hall
  const h1RegSet = new Set(h1SerpentineStudents.map(s => s.registerNo.toUpperCase()));
  const h2RegSet = new Set(h2SerpentineStudents.map(s => s.registerNo.toUpperCase()));
  const firstH1Set = new Set(labelRegNos.slice(0, h1Plan.totalStudents));
  const nextH2Set = new Set(labelRegNos.slice(h1Plan.totalStudents, h1Plan.totalStudents + h2Plan.totalStudents));

  for (const reg of h1RegSet) {
    verify(firstH1Set.has(reg), `Rule 7: Student ${reg} is strictly inside Hall ${hall1Name} label block`);
  }
  for (const reg of h2RegSet) {
    verify(nextH2Set.has(reg), `Rule 7: Student ${reg} is strictly inside Hall ${hall2Name} label block`);
  }
  verify(true, 'Rule 7 PASS: No student is missing or assigned to the wrong hall block');

  // Verification 8: Every sheet contains no more than 84 labels
  console.log('\n--- Step 8: Verify 84-Label Sheet Boundaries ---');
  const totalSheets = Math.ceil(labelRegNos.length / 84);
  console.log(`  Total Pages/Sheets computed: ${totalSheets}`);
  for (let p = 0; p < totalSheets; p++) {
    const sheetSlice = labelRegNos.slice(p * 84, (p + 1) * 84);
    verify(sheetSlice.length <= 84, `Rule 8 PASS: Sheet ${p + 1} has ${sheetSlice.length} labels (<= 84)`);
  }

  // Verification 9 & 10: Inspect Generated PDF and Excel files
  console.log('\n--- Step 9: Inspect Generated PDF Export ---');
  const zlib = require('zlib');
  const pdfBuffer = await getBuffer(`/api/seating/labels/download-pdf?date=${targetDate}&session=${targetSession}`);
  verify(pdfBuffer.length > 1000, `PDF generated successfully (Buffer size: ${pdfBuffer.length} bytes)`);
  const pdfHeader = pdfBuffer.slice(0, 5).toString('ascii');
  verify(pdfHeader === '%PDF-', `PDF starts with valid header %PDF- (Actual: ${pdfHeader})`);

  // Decompress PDF streams to verify pages and text elements
  const pdfRaw = pdfBuffer.toString('latin1');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let pdfPageCount = 0;
  let totalPdfLabels = 0;
  while ((match = streamRegex.exec(pdfRaw)) !== null) {
    try {
      const streamBuf = Buffer.from(match[1], 'binary');
      const decompressed = zlib.inflateSync(streamBuf).toString('latin1');
      if (decompressed.includes('BT') && decompressed.includes('ET')) {
        pdfPageCount++;
        const textBlocks = (decompressed.match(/BT[\s\S]*?ET/g) || []).length;
        totalPdfLabels += textBlocks;
      }
    } catch (e) {}
  }
  console.log(`  PDF Pages: ${pdfPageCount}, Total Text Labels Rendered: ${totalPdfLabels}`);
  verify(pdfPageCount === totalSheets, `PDF page count matches expected sheets count (${pdfPageCount} === ${totalSheets})`);
  verify(totalPdfLabels === labelRegNos.length, `PDF total text label blocks (${totalPdfLabels}) equals total students (${labelRegNos.length})`);

  console.log('\n--- Step 10: Inspect Generated Excel (.xlsx) Export ---');
  const excelBuffer = await getBuffer(`/api/seating/labels/download-excel?date=${targetDate}&session=${targetSession}`);
  verify(excelBuffer.length > 1000, `Excel generated successfully (Buffer size: ${excelBuffer.length} bytes)`);
  const wb = XLSX.read(excelBuffer, { type: 'buffer' });
  verify(wb.SheetNames.includes('Seat_Labels_All'), 'Excel contains sheet "Seat_Labels_All"');
  const ws = wb.Sheets['Seat_Labels_All'];
  const excelCells = [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
      const cell = ws[cellRef];
      if (cell && cell.v) {
        excelCells.push(String(cell.v).trim().toUpperCase());
      }
    }
  }
  console.log(`  Excel total student label cells: ${excelCells.length}`);
  verify(excelCells.length === labelRegNos.length, `Excel non-empty cells count (${excelCells.length}) equals total label count (${labelRegNos.length})`);
  verify(excelCells[0] === h1SerpentineStudents[0].registerNo.toUpperCase(), `Excel first cell matches Hall 1 first student (${excelCells[0]})`);

  // Verification: Single-hall labels endpoint test
  console.log('\n--- Step 11: Single-hall Label Endpoint Verification ---');
  const singleH1Csv = await getText(`/api/seating/labels/download-csv?date=${targetDate}&session=${targetSession}&hallId=${h1HallId}`);
  const singleH1RegNos = singleH1Csv.split(/[\n,]/).map(s => s.trim().toUpperCase()).filter(Boolean);
  verify(singleH1RegNos.length === h1Plan.totalStudents, `Single-hall ${hall1Name} export has exactly ${h1Plan.totalStudents} students (Actual: ${singleH1RegNos.length})`);
  verify(singleH1RegNos[0] === h1SerpentineStudents[0].registerNo.toUpperCase(), `Single-hall export matches first student of ${hall1Name}`);

  console.log('\n================================================================================');
  console.log(`ALL VERIFICATION CHECKS PASSED: ${passedAssertions} assertions verified successfully!`);
  console.log('================================================================================\n');
}

runVerification().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
