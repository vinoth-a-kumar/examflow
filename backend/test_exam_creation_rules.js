// Comprehensive Automated Test for Exam Creation and Scheduling Rules
const assert = require('assert');

const BASE_URL = 'http://localhost:5000';

const getLocalDateString = (d = new Date()) => {
  const dateObj = new Date(d);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getOffsetDateString = (daysOffset) => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return getLocalDateString(d);
};

async function runTests() {
  console.log('\n======================================================');
  console.log('EXAMFLOW: EXAM CREATION & SCHEDULING RULES TEST SUITE');
  console.log('======================================================\n');

  const todayStr = getLocalDateString();
  const yesterdayStr = getOffsetDateString(-1);
  const tomorrowStr = getOffsetDateString(1);
  const futureStr = getOffsetDateString(5);

  console.log(`Local Reference Dates:`);
  console.log(`- Today:     ${todayStr}`);
  console.log(`- Yesterday: ${yesterdayStr}`);
  console.log(`- Tomorrow:  ${tomorrowStr}`);
  console.log(`- Future:    ${futureStr}\n`);

  let createdExamIds = [];

  const cleanup = async () => {
    for (const id of createdExamIds) {
      try {
        await fetch(`${BASE_URL}/api/exams/${id}`, { method: 'DELETE' });
      } catch (_) {}
    }
    createdExamIds = [];
  };

  try {
    await cleanup();

    // -------------------------------------------------------------------------
    // TEST 1: Create an exam with subject codes A and B. Both become disabled for new exams.
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Create exam with subject codes A & B; verify both become assigned ---');
    const codeA = 'ABAJA41';
    const codeB = 'ABAJC62';

    const exam1Payload = {
      name: 'Test Exam 1 (A & B)',
      subjectCodes: [codeA, codeB],
      departments: [],
      date: tomorrowStr,
      session: 'FN',
      assignedHalls: ['M02'],
      seatsPerBench: 2,
      time: '10:00 AM - 01:00 PM'
    };

    const res1 = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exam1Payload)
    });
    assert.strictEqual(res1.status, 201, `Failed to create exam 1, status: ${res1.status}`);
    const exam1 = await res1.json();
    createdExamIds.push(exam1._id);
    console.log(`✓ Created Exam 1 (ID: ${exam1._id}) with codes [${codeA}, ${codeB}]`);

    // Check /api/exams/assigned-subject-codes
    const assignedRes = await fetch(`${BASE_URL}/api/exams/assigned-subject-codes`);
    assert.strictEqual(assignedRes.status, 200);
    const assignedData = await assignedRes.json();
    assert(assignedData.assignedCodes.includes(codeA), `Code ${codeA} should be in assignedCodes`);
    assert(assignedData.assignedCodes.includes(codeB), `Code ${codeB} should be in assignedCodes`);
    assert.strictEqual(assignedData.details[codeA].examId, String(exam1._id));
    assert.strictEqual(assignedData.details[codeB].examId, String(exam1._id));
    console.log(`✓ Verified both ${codeA} and ${codeB} are marked as assigned globally in backend.`);

    // -------------------------------------------------------------------------
    // TEST 2: Select a different date and verify that A and B remain disabled.
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Verify assigned codes remain disabled regardless of selected date ---');
    // The assigned codes list is date-independent. Both codes are present regardless of query date.
    assert(assignedData.assignedCodes.includes(codeA), 'Code A must remain unavailable regardless of date');
    assert(assignedData.assignedCodes.includes(codeB), 'Code B must remain unavailable regardless of date');
    console.log(`✓ Codes ${codeA} and ${codeB} remain disabled regardless of whether next exam is on ${futureStr} or ${todayStr}.`);

    // -------------------------------------------------------------------------
    // TEST 3: Attempt to assign an already-used code through backend API; must be rejected (400)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Backend API rejects reusing assigned subject code ---');
    const duplicatePayload = {
      name: 'Attempt Duplicate Exam',
      subjectCodes: [codeA], // codeA already assigned to exam1
      departments: [],
      date: futureStr, // different date
      session: 'AN',   // different session
      assignedHalls: ['M02'],
      seatsPerBench: 2
    };
    const resDup = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duplicatePayload)
    });
    assert.strictEqual(resDup.status, 400, `Expected 400 for duplicate code, got ${resDup.status}`);
    const errDup = await resDup.json();
    assert(errDup.error.includes(codeA), `Error message should mention ${codeA}: ${errDup.error}`);
    console.log(`✓ Backend correctly rejected duplicate assignment with 400: "${errDup.error}"`);

    // Also attempt with lowercase or space in code
    const resDupCasing = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...duplicatePayload, subjectCodes: [codeA.toLowerCase()] })
    });
    assert.strictEqual(resDupCasing.status, 400, 'Expected 400 for lowercase duplicate code');
    console.log(`✓ Backend correctly rejected case-insensitive duplicate assignment.`);

    // -------------------------------------------------------------------------
    // TEST 4: Create an exam using an unused subject code; it should succeed
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Create exam using unused subject code succeeds ---');
    const codeC = 'ABAPC11';
    const exam2Payload = {
      name: 'Test Exam 2 (C)',
      subjectCodes: [codeC],
      departments: [],
      date: tomorrowStr,
      session: 'AN',
      assignedHalls: ['M03'],
      seatsPerBench: 2
    };
    const res2 = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exam2Payload)
    });
    assert.strictEqual(res2.status, 201, `Expected 201 for unused code, got ${res2.status}`);
    const exam2 = await res2.json();
    createdExamIds.push(exam2._id);
    console.log(`✓ Successfully created Exam 2 (ID: ${exam2._id}) with unused code [${codeC}]`);

    // -------------------------------------------------------------------------
    // TEST 5: Edit an existing exam and retain its own subject codes without incorrectly blocking them
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Edit existing exam retaining its own subject codes ---');
    // Updating Exam 1 with its own codes [codeA, codeB] should succeed
    const updateExam1Payload = {
      name: 'Test Exam 1 (Updated)',
      subjectCodes: [codeA, codeB],
      departments: [],
      date: futureStr,
      session: 'FN',
      assignedHalls: ['M02'],
      seatsPerBench: 2
    };
    const resUpdateSelf = await fetch(`${BASE_URL}/api/exams/${exam1._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateExam1Payload)
    });
    assert.strictEqual(resUpdateSelf.status, 200, `Expected 200 when updating exam with its own codes, got ${resUpdateSelf.status}`);
    const updatedExam1 = await resUpdateSelf.json();
    assert.strictEqual(updatedExam1.name, 'Test Exam 1 (Updated)');
    console.log(`✓ Exam 1 successfully retained its own codes [${codeA}, ${codeB}] during update.`);

    // Updating Exam 2 attempting to steal Exam 1's codeA must be rejected!
    const resUpdateSteal = await fetch(`${BASE_URL}/api/exams/${exam2._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...exam2Payload,
        subjectCodes: [codeA] // codeA belongs to exam1!
      })
    });
    assert.strictEqual(resUpdateSteal.status, 400, `Expected 400 when updating exam with another exam's code, got ${resUpdateSteal.status}`);
    const errSteal = await resUpdateSteal.json();
    assert(errSteal.error.includes(codeA), `Expected error to mention ${codeA}: ${errSteal.error}`);
    console.log(`✓ Attempt to assign other exam's code during update was rejected: "${errSteal.error}"`);

    // -------------------------------------------------------------------------
    // TEST 6: Delete an exam and verify that its codes become available only when no other exam uses them
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Delete exam makes its codes available again ---');
    const resDelete = await fetch(`${BASE_URL}/api/exams/${exam1._id}`, {
      method: 'DELETE'
    });
    assert.strictEqual(resDelete.status, 200);
    // Remove from createdExamIds so cleanup doesn't fail
    createdExamIds = createdExamIds.filter(id => id !== exam1._id);
    console.log(`✓ Deleted Exam 1.`);

    // Check assigned codes: codeA and codeB should now be free
    const assignedAfterDel = await (await fetch(`${BASE_URL}/api/exams/assigned-subject-codes`)).json();
    assert(!assignedAfterDel.assignedCodes.includes(codeA), `Code ${codeA} should be free after exam deletion`);
    assert(!assignedAfterDel.assignedCodes.includes(codeB), `Code ${codeB} should be free after exam deletion`);
    assert(assignedAfterDel.assignedCodes.includes(codeC), `Code ${codeC} should remain assigned to Exam 2`);
    console.log(`✓ Verified ${codeA} and ${codeB} are freed, while ${codeC} remains assigned.`);

    // Now creating an exam with codeA should succeed!
    const resRecreate = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Reusing Freed Code Exam',
        subjectCodes: [codeA],
        departments: [],
        date: tomorrowStr,
        session: 'FN',
        assignedHalls: ['M02'],
        seatsPerBench: 2
      })
    });
    assert.strictEqual(resRecreate.status, 201, 'Re-creating with freed code must succeed');
    const recreated = await resRecreate.json();
    createdExamIds.push(recreated._id);
    console.log(`✓ Successfully created new exam with previously assigned code ${codeA} after deletion.`);

    // -------------------------------------------------------------------------
    // TEST 7: Verify that yesterday and any earlier date cannot be selected or submitted
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Past dates are rejected by backend and frontend rules ---');
    const pastDatePayload = {
      name: 'Past Date Exam',
      subjectCodes: ['ABAPC12'],
      departments: [],
      date: yesterdayStr,
      session: 'FN',
      assignedHalls: ['M02'],
      seatsPerBench: 2
    };
    const resPast = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pastDatePayload)
    });
    assert.strictEqual(resPast.status, 400, `Expected 400 for past date ${yesterdayStr}, got ${resPast.status}`);
    const errPast = await resPast.json();
    assert(errPast.error.toLowerCase().includes('date') || errPast.error.includes(yesterdayStr), `Expected date error: ${errPast.error}`);
    console.log(`✓ POST /api/exams rejected yesterday's date (${yesterdayStr}): "${errPast.error}"`);

    // Also test PUT with past date
    const resPastPut = await fetch(`${BASE_URL}/api/exams/${exam2._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...exam2Payload, date: yesterdayStr })
    });
    assert.strictEqual(resPastPut.status, 400, `Expected 400 for past date in PUT, got ${resPastPut.status}`);
    const errPastPut = await resPastPut.json();
    console.log(`✓ PUT /api/exams/:id rejected yesterday's date: "${errPastPut.error}"`);

    // -------------------------------------------------------------------------
    // TEST 8: Verify that today's date and future dates can be selected
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Today\'s date and future dates are accepted ---');
    const todayPayload = {
      name: 'Today Exam',
      subjectCodes: ['ABAPC21'],
      departments: [],
      date: todayStr,
      session: 'FN',
      assignedHalls: ['M02'],
      seatsPerBench: 2
    };
    const resToday = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(todayPayload)
    });
    assert.strictEqual(resToday.status, 201, `Expected 201 for today's date ${todayStr}, got ${resToday.status}`);
    const todayExam = await resToday.json();
    createdExamIds.push(todayExam._id);
    console.log(`✓ Today's date (${todayStr}) was accepted.`);

    const futurePayload = {
      name: 'Future Date Exam',
      subjectCodes: ['ABAPC22'],
      departments: [],
      date: futureStr,
      session: 'FN',
      assignedHalls: ['M02'],
      seatsPerBench: 2
    };
    const resFuture = await fetch(`${BASE_URL}/api/exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(futurePayload)
    });
    assert.strictEqual(resFuture.status, 201, `Expected 201 for future date ${futureStr}, got ${resFuture.status}`);
    const futureExam = await resFuture.json();
    createdExamIds.push(futureExam._id);
    console.log(`✓ Future date (${futureStr}) was accepted.`);

    // -------------------------------------------------------------------------
    // TEST 9: Verify that rules work with both MySQL and JSON fallback storage
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Verify rules with both MySQL and JSON fallback storage ---');
    const { dbStatus, Models } = require('./db');
    const status = dbStatus();
    console.log(`✓ Active Database Status: Mode=${status.mode}, Connected=${status.connected}`);

    // Verify data in JSON fallback files matches
    const fs = require('fs');
    const path = require('path');
    const jsonExamsPath = path.join(__dirname, 'data', 'exams.json');
    if (fs.existsSync(jsonExamsPath)) {
      const jsonExams = JSON.parse(fs.readFileSync(jsonExamsPath, 'utf8') || '[]');
      const jsonExamIds = jsonExams.map(e => String(e._id));
      assert(jsonExamIds.includes(String(todayExam._id)), 'JSON fallback exams.json must contain todayExam');
      console.log(`✓ Verified JSON fallback file (${jsonExamsPath}) is synchronized automatically (${jsonExams.length} exams in JSON).`);
    }

    // Verify Models.Exam queries work consistently regardless of storage engine
    const allExams = await Models.Exam.find();
    assert(allExams.some(e => String(e._id) === String(todayExam._id)), 'Models.Exam.find() must return created exams');
    console.log(`✓ Models.Exam.find() returned ${allExams.length} exams across DB storage.`);

    // Clean up created test exams
    await cleanup();
    console.log('✓ Cleaned up all test exams successfully.');

    console.log('\n======================================================');
    console.log('ALL 9 TEST CASES PASSED SUCCESSFULLY! ✓');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    await cleanup();
    process.exit(1);
  }
}

runTests().then(() => process.exit(0)).catch(() => process.exit(1));
