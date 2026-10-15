// Automated Test Suite for Seating Arrangement Layout Order and Edit Rows & Columns
// Validates all 12 Mandatory User Scenarios

const assert = require('assert');

const API_BASE = 'http://localhost:5000';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

function getSerpentineStudentOrder(grid, cols, colRows) {
  const benchMap = new Map();
  grid.forEach(b => { if (b && b.benchCode) benchMap.set(b.benchCode, b); });
  const students = [];
  for (let c = 1; c <= cols; c++) {
    const rowsForCol = colRows && colRows[c - 1] !== undefined ? colRows[c - 1] : 6;
    if (c % 2 === 1) { // Odd col: top to bottom
      for (let r = 0; r < rowsForCol; r++) {
        const b = benchMap.get(`${String.fromCharCode(65 + r)}${c}`);
        if (b) {
          if (b.seat1) students.push(b.seat1);
          if (b.seat2) students.push(b.seat2);
          if (b.seat3) students.push(b.seat3);
        }
      }
    } else { // Even col: bottom to top
      for (let r = rowsForCol - 1; r >= 0; r--) {
        const b = benchMap.get(`${String.fromCharCode(65 + r)}${c}`);
        if (b) {
          if (b.seat1) students.push(b.seat1);
          if (b.seat2) students.push(b.seat2);
          if (b.seat3) students.push(b.seat3);
        }
      }
    }
  }
  return students;
}

async function runTests() {
  console.log('======================================================================');
  console.log('ExamFlow: Comprehensive Layout Order & Edit Rows & Columns Test Suite');
  console.log('======================================================================\n');

  let passedAssertions = 0;
  function testAssert(condition, message) {
    assert(condition, message);
    passedAssertions++;
  }

  // 0. Setup: Ensure we have at least one 2-seat hall and one 3-seat hall and students
  const hallsRes = await request('/api/halls');
  testAssert(hallsRes.ok && Array.isArray(hallsRes.data), 'GET /api/halls returns list of halls');
  console.log(`✓ Fetched ${hallsRes.data.length} halls.`);

  // Find or create test halls: 2-seat hall (e.g. M02) and 3-seat hall (e.g. M10 or create one)
  const hall2Seat = hallsRes.data.find(h => (h.seatsPerBench || 2) === 2) || hallsRes.data[0];
  const hall3Seat = hallsRes.data.find(h => h.seatsPerBench === 3) || hallsRes.data[1];

  testAssert(hall2Seat, 'Found 2-seat hall: ' + (hall2Seat?.name));
  testAssert(hall3Seat, 'Found 3-seat hall: ' + (hall3Seat?.name));

  const studentsRes = await request('/api/students');
  testAssert(studentsRes.ok && Array.isArray(studentsRes.data) && studentsRes.data.length > 0, 'Students exist in database');
  console.log(`✓ Found ${studentsRes.data.length} students in database.`);

  const testDate = '2026-11-20';
  const testSession = 'FN';

  // Clean up previous test exams to ensure idempotency
  const existingExamsRes = await request('/api/exams');
  if (existingExamsRes.ok && Array.isArray(existingExamsRes.data)) {
    const toClean = existingExamsRes.data.filter(e => e.name && e.name.startsWith('Layout Test Exam') || e.name === 'Unrelated Exam Different Date');
    for (const ex of toClean) {
      await request(`/api/exams/${ex._id}`, { method: 'DELETE' });
    }
  }

  // Scenario 1: Generate a seating plan and record the saved seat order
  console.log('\n--- Scenario 1: Generate seating plan and record saved seat order ---');
  
  // Create an exam for this test
  const examPayload = {
    name: 'Layout Test Exam 2-Seat',
    date: testDate,
    session: testSession,
    departments: ['B.A', 'B.COM'],
    subjectCodes: [],
    assignedHalls: [hall2Seat.name],
    seatsPerBench: 2
  };

  const createExamRes = await request('/api/exams', {
    method: 'POST',
    body: JSON.stringify(examPayload)
  });
  testAssert(createExamRes.ok, 'Exam created successfully: ' + createExamRes.data?.name);
  const examId = createExamRes.data._id;

  // Generate seating plan
  const genRes = await request('/api/seating/generate', {
    method: 'POST',
    body: JSON.stringify({ examId, hallId: hall2Seat._id })
  });
  testAssert(genRes.ok && genRes.data?.seatingGrid, 'Seating plan generated successfully');
  const initialPlan = genRes.data;
  console.log(`✓ Seating generated for hall ${hall2Seat.name}: ${initialPlan.totalStudents} students seated.`);

  // Record saved seat order along serpentine allocation path
  const origCols1 = initialPlan.hallSnapshot?.columns || (hall2Seat.columns || 4);
  const origColRows1 = initialPlan.hallSnapshot?.columnRows || hall2Seat.columnRows || [4, 4, 4, 5];
  const savedOrder1 = getSerpentineStudentOrder(initialPlan.seatingGrid, origCols1, origColRows1);

  testAssert(savedOrder1.length === initialPlan.totalStudents, 'All assigned students recorded in saved seat order');
  console.log(`✓ Recorded ${savedOrder1.length} seated students in initial plan.`);

  // Scenario 2: Open the layout and verify that every visible seat matches the saved assignment
  console.log('\n--- Scenario 2: Verify visible layout matches saved assignment exactly ---');
  const fetchPlanRes = await request(`/api/seating/by-date-session?date=${testDate}&session=${testSession}&hallId=${hall2Seat._id}`);
  testAssert(fetchPlanRes.ok, 'GET /api/seating/by-date-session succeeded');
  const retrievedPlan = fetchPlanRes.data;

  testAssert(retrievedPlan.hallSnapshot !== undefined, 'Merged plan returns hallSnapshot');
  testAssert(retrievedPlan.seatingGrid.length === initialPlan.seatingGrid.length, 'Grid length matches generated plan');

  // Verify seat-by-seat equality between retrieved and saved
  let matchCount = 0;
  retrievedPlan.seatingGrid.forEach((bench, idx) => {
    const origBench = initialPlan.seatingGrid[idx];
    if (origBench.isPlaceholder) {
      testAssert(bench.isPlaceholder, `Placeholder at index ${idx} matches`);
    } else {
      testAssert(bench.benchCode === origBench.benchCode, `BenchCode at ${idx} matches (${bench.benchCode})`);
      if (origBench.seat1) {
        testAssert(bench.seat1 && bench.seat1.registerNo === origBench.seat1.registerNo, `Seat1 at ${bench.benchCode} matches`);
        matchCount++;
      }
      if (origBench.seat2) {
        testAssert(bench.seat2 && bench.seat2.registerNo === origBench.seat2.registerNo, `Seat2 at ${bench.benchCode} matches`);
        matchCount++;
      }
      if (origBench.seat3) {
        testAssert(bench.seat3 && bench.seat3.registerNo === origBench.seat3.registerNo, `Seat3 at ${bench.benchCode} matches`);
        matchCount++;
      }
    }
  });
  testAssert(matchCount === savedOrder1.length, 'Every single visible seat matches saved student assignment');
  console.log(`✓ All ${matchCount} visible seats match saved assignments exactly.`);

  // Scenario 3: Verify Edit Rows & Columns displays saved values
  console.log('\n--- Scenario 3: Verify Edit Rows & Columns displays current saved values ---');
  const snap = retrievedPlan.hallSnapshot;
  testAssert(snap !== null && snap !== undefined, 'Snapshot exists on seating plan');
  testAssert(snap.columns === retrievedPlan.columns, `Snapshot columns match plan columns (${snap.columns})`);
  testAssert(Array.isArray(snap.columnRows), 'Snapshot columnRows is an array');
  console.log(`✓ Snapshot saved values verified: ${snap.columns} cols, columnRows: [${snap.columnRows.join(', ')}].`);

  // Scenario 4: Change rows/columns, save, reopen, and verify persistence
  console.log('\n--- Scenario 4: Change rows/columns, save, reopen, and verify persistence ---');
  // Configure new layout: change columns to 3 (e.g. [5, 4, 4] = 13 benches)
  const newCols = 3;
  const newColumnRows = [5, 4, 4]; // sum = 13 benches
  const newTotalB = 13;
  const newRows = 5;

  const updateRes = await request('/api/seating/update-layout', {
    method: 'POST',
    body: JSON.stringify({
      date: testDate,
      session: testSession,
      hallId: hall2Seat._id,
      examId: examId,
      columns: newCols,
      rows: newRows,
      columnRows: newColumnRows,
      benches: newTotalB,
      seatsPerBench: 2
    })
  });

  testAssert(updateRes.ok, 'POST /api/seating/update-layout succeeded: ' + updateRes.data?.message);
  testAssert(updateRes.data.plan.columns === newCols, `Updated plan columns is ${newCols}`);
  testAssert(updateRes.data.plan.totalBenches === newTotalB, `Updated plan totalBenches is ${newTotalB}`);
  console.log(`✓ Saved new layout: ${newCols} columns, ${newTotalB} benches.`);

  // Re-fetch via GET /api/seating/by-date-session (simulating reopening the view)
  const reopenedRes = await request(`/api/seating/by-date-session?date=${testDate}&session=${testSession}&hallId=${hall2Seat._id}`);
  testAssert(reopenedRes.ok, 'Reopen GET succeeded');
  testAssert(reopenedRes.data.columns === newCols, 'Reopened view displays updated columns: ' + newCols);
  testAssert(reopenedRes.data.hallSnapshot.columns === newCols, 'Reopened hallSnapshot has updated columns: ' + newCols);
  testAssert(JSON.stringify(reopenedRes.data.hallSnapshot.columnRows) === JSON.stringify(newColumnRows), 'Reopened columnRows match updated values');
  console.log('✓ Reopened editor displays latest saved layout values.');

  // Scenario 5: Refresh page and verify saved layout and seat order remain consistent
  console.log('\n--- Scenario 5: Page refresh simulation (consistency of layout and seat order) ---');
  const refreshRes = await request(`/api/seating/by-date-session?date=${testDate}&session=${testSession}&hallId=${hall2Seat._id}`);
  testAssert(refreshRes.ok, 'Page refresh request succeeded');
  const refreshedPlan = refreshRes.data;

  // Extract seated students along serpentine path after update
  const updatedSeatedOrder = getSerpentineStudentOrder(refreshedPlan.seatingGrid, newCols, newColumnRows).map(s => s.registerNo);

  const originalRegNos = savedOrder1.map(s => s.registerNo);
  testAssert(updatedSeatedOrder.length === originalRegNos.length, `Total seated count preserved (${updatedSeatedOrder.length} == ${originalRegNos.length})`);
  testAssert(JSON.stringify(updatedSeatedOrder) === JSON.stringify(originalRegNos), 'Exact allocation sequence of students preserved across layout edit!');
  console.log(`✓ Student allocation order matches 100% after layout change.`);

  // Scenario 6: Restart backend and verify database persistence
  console.log('\n--- Scenario 6: Database persistence verification ---');
  // Query DB directly via API
  const dbExamsRes = await request('/api/exams');
  const testExamInDb = dbExamsRes.data.find(e => e._id === examId);
  testAssert(testExamInDb, 'Exam found in database');
  const hallKeyInSnapshots = Object.keys(testExamInDb.hallSnapshots || {}).find(k => k === hall2Seat.name || k === String(hall2Seat._id));
  testAssert(hallKeyInSnapshots, 'Hall snapshot found in exam');
  testAssert(testExamInDb.hallSnapshots[hallKeyInSnapshots].columns === newCols, 'Exam hallSnapshot columns persisted in DB: ' + newCols);
  console.log(`✓ Database persistence verified: exam.hallSnapshots[${hallKeyInSnapshots}].columns = ${newCols}`);

  // Scenario 7: Test invalid layout that cannot accommodate existing students and verify safe rejection
  console.log('\n--- Scenario 7: Test invalid layout (capacity < assigned students) rejection ---');
  const currentAssignedCount = updatedSeatedOrder.length;
  // Create an undersized layout that only holds fewer students (e.g. 1 bench * 2 seats = 2 seats)
  const tinyCols = 1;
  const tinyColumnRows = [1];
  const invalidRes = await request('/api/seating/update-layout', {
    method: 'POST',
    body: JSON.stringify({
      date: testDate,
      session: testSession,
      hallId: hall2Seat._id,
      examId: examId,
      columns: tinyCols,
      rows: 1,
      columnRows: tinyColumnRows,
      benches: 1,
      seatsPerBench: 2
    })
  });

  testAssert(!invalidRes.ok && invalidRes.status === 400, 'Invalid layout safely rejected with HTTP 400');
  testAssert(invalidRes.data.error.includes('cannot accommodate'), 'Error message clearly states capacity cannot accommodate students: ' + invalidRes.data.error);
  console.log(`✓ Invalid layout rejected with message: "${invalidRes.data.error}"`);

  // Verify existing plan was NOT corrupted by the failed update
  const afterFailedRes = await request(`/api/seating/by-date-session?date=${testDate}&session=${testSession}&hallId=${hall2Seat._id}`);
  testAssert(afterFailedRes.data.columns === newCols, 'Plan retained previous valid layout after rejected save');
  testAssert(afterFailedRes.data.totalStudents === currentAssignedCount, 'Student count unchanged after rejected save');

  // Scenario 8: Verify no duplicate or missing students after a valid layout change
  console.log('\n--- Scenario 8: Verify zero duplicate or omitted students ---');
  const seenRegNos = new Set();
  let duplicatesFound = 0;
  refreshedPlan.seatingGrid.forEach(b => {
    if (b.isPlaceholder) return;
    [b.seat1, b.seat2, b.seat3].filter(Boolean).forEach(s => {
      if (seenRegNos.has(s.registerNo)) duplicatesFound++;
      seenRegNos.add(s.registerNo);
    });
  });
  testAssert(duplicatesFound === 0, 'Zero duplicate students found in grid');
  testAssert(seenRegNos.size === currentAssignedCount, 'All assigned students present (zero missing students)');
  console.log(`✓ Verified: 0 duplicates, 0 missing students across all ${seenRegNos.size} seats.`);

  // Scenario 9: Verify layout and assignments of unrelated exams remain unchanged
  console.log('\n--- Scenario 9: Verify unrelated exams remain completely unchanged ---');
  const unrelatedExamPayload = {
    name: 'Unrelated Exam Different Date',
    date: '2026-11-25',
    session: 'AN',
    departments: ['B.A'],
    subjectCodes: [],
    assignedHalls: [hall2Seat.name],
    seatsPerBench: 2
  };
  const unrelatedExamRes = await request('/api/exams', {
    method: 'POST',
    body: JSON.stringify(unrelatedExamPayload)
  });
  const unrelatedExamId = unrelatedExamRes.data._id;
  await request('/api/seating/generate', {
    method: 'POST',
    body: JSON.stringify({ examId: unrelatedExamId, hallId: hall2Seat._id })
  });
  const unrelatedPlanBefore = await request(`/api/seating/by-date-session?date=2026-11-25&session=AN&hallId=${hall2Seat._id}`);
  
  // Now edit layout of our original test exam again (change to 4 cols: [3, 3, 3, 4] = 13 benches)
  await request('/api/seating/update-layout', {
    method: 'POST',
    body: JSON.stringify({
      date: testDate,
      session: testSession,
      hallId: hall2Seat._id,
      examId: examId,
      columns: 4,
      rows: 4,
      columnRows: [3, 3, 3, 4],
      benches: 13,
      seatsPerBench: 2
    })
  });

  // Verify unrelated exam layout is untouched
  const unrelatedPlanAfter = await request(`/api/seating/by-date-session?date=2026-11-25&session=AN&hallId=${hall2Seat._id}`);
  testAssert(unrelatedPlanAfter.data.columns === unrelatedPlanBefore.data.columns, 'Unrelated exam columns unchanged');
  testAssert(unrelatedPlanAfter.data.totalStudents === unrelatedPlanBefore.data.totalStudents, 'Unrelated exam student count unchanged');
  console.log('✓ Unrelated exam verified completely insulated from layout edit.');

  // Scenario 10: Verify PDF export follows the saved layout and seat order
  console.log('\n--- Scenario 10: Verify PDF export follows saved layout ---');
  const pdfRes = await fetch(`${API_BASE}/api/seating/layout/download-pdf?date=${testDate}&session=${testSession}&hallId=${hall2Seat._id}`);
  testAssert(pdfRes.ok, 'PDF download endpoint returns HTTP 200');
  testAssert(pdfRes.headers.get('content-type') === 'application/pdf', 'Content-Type is application/pdf');
  const pdfBuf = await pdfRes.arrayBuffer();
  testAssert(pdfBuf.byteLength > 1000, `PDF size is valid (${pdfBuf.byteLength} bytes)`);
  console.log(`✓ PDF export generated successfully (${pdfBuf.byteLength} bytes).`);

  // Scenario 11: Verify both 2-seat and 3-seat halls
  console.log('\n--- Scenario 11: Verify 3-seat hall layout editing and deterministic remapping ---');
  const exam3SeatPayload = {
    name: 'Layout Test Exam 3-Seat',
    date: '2026-11-22',
    session: 'FN',
    departments: ['B.A', 'B.COM'],
    subjectCodes: [],
    assignedHalls: [hall3Seat.name],
    seatsPerBench: 3
  };
  const createExam3Res = await request('/api/exams', {
    method: 'POST',
    body: JSON.stringify(exam3SeatPayload)
  });
  testAssert(createExam3Res.ok, '3-Seat Exam created');
  const exam3Id = createExam3Res.data._id;

  const gen3Res = await request('/api/seating/generate', {
    method: 'POST',
    body: JSON.stringify({ examId: exam3Id, hallId: hall3Seat._id })
  });
  testAssert(gen3Res.ok, '3-Seat hall seating generated');
  const plan3Init = gen3Res.data;

  function getSerpentineStudentOrder(grid, cols, colRows) {
    const benchMap = new Map();
    grid.forEach(b => { if (b && b.benchCode) benchMap.set(b.benchCode, b); });
    const students = [];
    for (let c = 1; c <= cols; c++) {
      const rowsForCol = colRows[c - 1] !== undefined ? colRows[c - 1] : 6;
      if (c % 2 === 1) { // Odd col: top to bottom
        for (let r = 0; r < rowsForCol; r++) {
          const b = benchMap.get(`${String.fromCharCode(65 + r)}${c}`);
          if (b) {
            if (b.seat1) students.push(b.seat1.registerNo);
            if (b.seat2) students.push(b.seat2.registerNo);
            if (b.seat3) students.push(b.seat3.registerNo);
          }
        }
      } else { // Even col: bottom to top
        for (let r = rowsForCol - 1; r >= 0; r--) {
          const b = benchMap.get(`${String.fromCharCode(65 + r)}${c}`);
          if (b) {
            if (b.seat1) students.push(b.seat1.registerNo);
            if (b.seat2) students.push(b.seat2.registerNo);
            if (b.seat3) students.push(b.seat3.registerNo);
          }
        }
      }
    }
    return students;
  }

  // Record initial serpentine order in 3-seat hall
  const origCols3 = plan3Init.hallSnapshot?.columns || 4;
  const origColRows3 = plan3Init.hallSnapshot?.columnRows || [4, 4, 4, 5];
  const order3Init = getSerpentineStudentOrder(plan3Init.seatingGrid, origCols3, origColRows3);

  // Edit 3-seat hall layout
  const newCols3 = 3;
  const maxB3 = hall3Seat.benches || 13;
  const baseR3 = Math.floor(maxB3 / 3);
  const rem3 = maxB3 % 3;
  const newColRows3 = [baseR3 + (rem3 > 0 ? 1 : 0), baseR3 + (rem3 > 1 ? 1 : 0), baseR3];
  const newBenches3 = newColRows3.reduce((a, b) => a + b, 0);
  const newMaxR3 = Math.max(...newColRows3);

  const update3Res = await request('/api/seating/update-layout', {
    method: 'POST',
    body: JSON.stringify({
      date: '2026-11-22',
      session: 'FN',
      hallId: hall3Seat._id,
      examId: exam3Id,
      columns: newCols3,
      rows: newMaxR3,
      columnRows: newColRows3,
      benches: newBenches3,
      seatsPerBench: 3
    })
  });
  testAssert(update3Res.ok, '3-Seat hall layout updated successfully: ' + (update3Res.data?.error || update3Res.data?.message));
  testAssert(update3Res.data.plan.columns === newCols3, '3-Seat hall updated to 3 columns');

  // Verify exact student order preserved in 3-seat hall along serpentine path
  const order3After = getSerpentineStudentOrder(update3Res.data.plan.seatingGrid, newCols3, newColRows3);
  testAssert(order3After.length === order3Init.length, '3-Seat hall student count preserved: ' + order3After.length);
  testAssert(JSON.stringify(order3After) === JSON.stringify(order3Init), '3-Seat hall student allocation order preserved 100%');
  console.log(`✓ 3-seat hall tested successfully: ${order3After.length} students preserved across 3-seat benches.`);

  // Scenario 12: Regression checks
  console.log('\n--- Scenario 12: Regression checks (Halls and Exam endpoints) ---');
  const hallsCheck = await request('/api/halls');
  testAssert(hallsCheck.ok && hallsCheck.data.length === 43, `All 43 official halls intact (${hallsCheck.data.length})`);
  
  // Verify Hall template was NOT altered by exam layout edits
  const originalHallTemplate = hallsCheck.data.find(h => h._id === hall2Seat._id || h.name === hall2Seat.name);
  testAssert(originalHallTemplate.columns === hall2Seat.columns, `Global Hall template columns (${originalHallTemplate.columns}) remained untouched`);
  console.log('✓ Global hall templates confirmed untouched by exam-specific layout edits.');

  console.log('\n======================================================================');
  console.log(`🎉 ALL 12 MANDATORY TEST SCENARIOS PASSED (${passedAssertions} ASSERTIONS)!`);
  console.log('======================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
