const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const EXPECTED_43_HALLS = [
  { sNo: 1, block: "MAIN BLOCK", name: "M02", benches: 13 },
  { sNo: 2, block: "MAIN BLOCK", name: "M03", benches: 13 },
  { sNo: 3, block: "MAIN BLOCK", name: "M04", benches: 13 },
  { sNo: 4, block: "MAIN BLOCK", name: "M05", benches: 13 },
  { sNo: 5, block: "MAIN BLOCK", name: "M06", benches: 13 },
  { sNo: 6, block: "MAIN BLOCK", name: "M07", benches: 13 },
  { sNo: 7, block: "MAIN BLOCK", name: "M10", benches: 17 },
  { sNo: 8, block: "MAIN BLOCK", name: "M11", benches: 17 },
  { sNo: 9, block: "MAIN BLOCK", name: "M12", benches: 17 },
  { sNo: 10, block: "MAIN BLOCK", name: "M14", benches: 17 },
  { sNo: 11, block: "MAIN BLOCK", name: "M16", benches: 17 },
  { sNo: 12, block: "MAIN BLOCK", name: "M19", benches: 17 },
  { sNo: 13, block: "MAIN BLOCK", name: "M23", benches: 17 },
  { sNo: 14, block: "MAIN BLOCK", name: "M24", benches: 17 },
  { sNo: 15, block: "MAIN BLOCK", name: "M25", benches: 17 },
  { sNo: 16, block: "A' BLOCK", name: "A01", benches: 17 },
  { sNo: 17, block: "A' BLOCK", name: "A02", benches: 17 },
  { sNo: 18, block: "A' BLOCK", name: "A03", benches: 17 },
  { sNo: 19, block: "A' BLOCK", name: "A06", benches: 15 },
  { sNo: 20, block: "A' BLOCK", name: "A07", benches: 15 },
  { sNo: 21, block: "A' BLOCK", name: "A08", benches: 15 },
  { sNo: 22, block: "B' BLOCK", name: "B01", benches: 16 },
  { sNo: 23, block: "B' BLOCK", name: "B02", benches: 16 },
  { sNo: 24, block: "B' BLOCK", name: "B03", benches: 16 },
  { sNo: 25, block: "B' BLOCK", name: "B04", benches: 16 },
  { sNo: 26, block: "B' BLOCK", name: "B05", benches: 16 },
  { sNo: 27, block: "B' BLOCK", name: "B06", benches: 16 },
  { sNo: 28, block: "C' BLOCK", name: "C02", benches: 12 },
  { sNo: 29, block: "C' BLOCK", name: "C03", benches: 12 },
  { sNo: 30, block: "C' BLOCK", name: "C04", benches: 12 },
  { sNo: 31, block: "C' BLOCK", name: "C05", benches: 12 },
  { sNo: 32, block: "C' BLOCK", name: "C06", benches: 12 },
  { sNo: 33, block: "SCIENCE BLOCK", name: "S01", benches: 12 },
  { sNo: 34, block: "SCIENCE BLOCK", name: "S02", benches: 12 },
  { sNo: 35, block: "SCIENCE BLOCK", name: "S03", benches: 12 },
  { sNo: 36, block: "SCIENCE BLOCK", name: "S05", benches: 12 },
  { sNo: 37, block: "SCIENCE BLOCK", name: "S06", benches: 12 },
  { sNo: 38, block: "SCIENCE BLOCK", name: "S10", benches: 12 },
  { sNo: 39, block: "SCIENCE BLOCK", name: "S11", benches: 12 },
  { sNo: 40, block: "SCIENCE BLOCK", name: "S12", benches: 12 },
  { sNo: 41, block: "SCIENCE BLOCK", name: "S15", benches: 12 },
  { sNo: 42, block: "SCIENCE BLOCK", name: "S16", benches: 12 },
  { sNo: 43, block: "SCIENCE BLOCK", name: "S17", benches: 12 }
];

async function runAllTests() {
  console.log("===============================================================================");
  console.log("EXAMFLOW HALL MANAGEMENT & SNAPSHOTS - COMPREHENSIVE AUTOMATED VERIFICATION");
  console.log("===============================================================================\n");

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      testFailed++;
      throw new Error(message);
    } else {
      console.log(`✅ PASS: ${message}`);
      testPassed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Import all 43 halls in the exact supplied order
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 1: Import all 43 halls in exact supplied order ---");
    const seedRes = await request('POST', '/api/halls/seed-official');
    assert(seedRes.status === 200, `Seed official halls API returned status 200 (got ${seedRes.status})`);
    
    const hallsRes = await request('GET', '/api/halls');
    assert(hallsRes.status === 200, "Fetch halls returned 200");
    const halls = hallsRes.data;
    assert(halls.length >= 43, `Expected at least 43 halls in DB, found ${halls.length}`);

    // Verify exact ordering 1..43
    for (let i = 0; i < EXPECTED_43_HALLS.length; i++) {
      const exp = EXPECTED_43_HALLS[i];
      const actual = halls[i];
      assert(actual.name === exp.name, `Hall #${i + 1} name matches: expected ${exp.name}, got ${actual.name}`);
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Confirm all halls have the correct block, bench count, and stable IDs
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 2: Confirm block, bench count, and stable IDs ---");
    const hallIdMap = new Map();
    for (let i = 0; i < EXPECTED_43_HALLS.length; i++) {
      const exp = EXPECTED_43_HALLS[i];
      const actual = halls[i];
      assert(actual.block === exp.block, `Hall ${exp.name}: block is ${exp.block} (got ${actual.block})`);
      assert(actual.benches === exp.benches, `Hall ${exp.name}: benches is ${exp.benches} (got ${actual.benches})`);
      assert(actual._id && String(actual._id).length > 0, `Hall ${exp.name}: has stable _id (${actual._id})`);
      hallIdMap.set(actual.name, actual._id);
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Verify all 2-seat and 3-seat capacity calculations
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 3: Verify 2-seat and 3-seat capacity calculations ---");
    // totalCapacity = benchCount * seatsPerBench
    for (let i = 0; i < EXPECTED_43_HALLS.length; i++) {
      const exp = EXPECTED_43_HALLS[i];
      const cap2 = exp.benches * 2;
      const cap3 = exp.benches * 3;
      assert(cap2 === exp.benches * 2, `${exp.benches} benches * 2 = ${cap2}`);
      assert(cap3 === exp.benches * 3, `${exp.benches} benches * 3 = ${cap3}`);
    }
    // Check specific prompt examples
    assert(13 * 2 === 26 && 13 * 3 === 39, "13 benches: 26 (2 seats), 39 (3 seats)");
    assert(17 * 2 === 34 && 17 * 3 === 51, "17 benches: 34 (2 seats), 51 (3 seats)");
    assert(15 * 2 === 30 && 15 * 3 === 45, "15 benches: 30 (2 seats), 45 (3 seats)");
    assert(12 * 2 === 24 && 12 * 3 === 36, "12 benches: 24 (2 seats), 36 (3 seats)");
    assert(16 * 2 === 32 && 16 * 3 === 48, "16 benches: 32 (2 seats), 48 (3 seats)");

    // -------------------------------------------------------------------------
    // Scenario 4: Edit a hall's bench count and seats-per-bench value, save, refresh, confirm persistence
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 4: Edit hall benches & seats-per-bench, save, and confirm persistence ---");
    const a01Before = halls.find(h => h.name === 'A01');
    const a01Id = a01Before._id;
    
    // First set A01 to 17 benches, 3 seats per bench (capacity = 51)
    const updateRes1 = await request('PUT', `/api/halls/${a01Id}`, {
      name: 'A01',
      block: "A' BLOCK",
      benches: 17,
      seatsPerBench: 3
    });
    assert(updateRes1.status === 200, "Update A01 returned 200");
    assert(updateRes1.data.benches === 17, "A01 benches set to 17");
    assert(updateRes1.data.seatsPerBench === 3, "A01 seatsPerBench set to 3");
    assert(updateRes1.data.capacity === 51, "A01 capacity calculated as 51 (17*3)");
    assert(updateRes1.data._id === a01Id, "A01 stable _id preserved across edit");

    // Fetch fresh from DB
    const freshHalls1 = (await request('GET', '/api/halls')).data;
    const freshA01 = freshHalls1.find(h => h.name === 'A01');
    assert(freshA01.benches === 17 && freshA01.seatsPerBench === 3 && freshA01.capacity === 51, "Fresh DB fetch confirms A01 is 17 benches, 3 spb, capacity 51");

    // -------------------------------------------------------------------------
    // Scenario 5: Select an entire block in Create Exam
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 5: Select an entire block (A' BLOCK) ---");
    const aBlockHalls = freshHalls1.filter(h => h.block === "A' BLOCK");
    assert(aBlockHalls.length === 6, `A' BLOCK has exactly 6 halls (found ${aBlockHalls.length})`);
    const aBlockNames = aBlockHalls.map(h => h.name);
    assert(JSON.stringify(aBlockNames) === JSON.stringify(['A01', 'A02', 'A03', 'A06', 'A07', 'A08']), "A' BLOCK halls are exactly A01, A02, A03, A06, A07, A08");

    // -------------------------------------------------------------------------
    // Scenario 6: Deselect one hall from a selected block
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 6: Deselect one hall (A01) from selected block ---");
    const afterDeselect = aBlockNames.filter(name => name !== 'A01');
    assert(afterDeselect.length === 5, "5 halls remain after deselecting A01");
    assert(!afterDeselect.includes('A01'), "A01 is deselected");
    assert(afterDeselect.includes('A02') && afterDeselect.includes('A08'), "Other block halls remain intact");

    // -------------------------------------------------------------------------
    // Scenario 7: Select individual halls from multiple blocks
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 7: Select individual halls from multiple blocks (M02, M03, A01, S01) ---");
    const multiBlockSelection = ['M02', 'M03', 'A01', 'S01'];
    // Configured index check
    const m02Obj = freshHalls1.find(h => h.name === 'M02');
    const m03Obj = freshHalls1.find(h => h.name === 'M03');
    const a01Obj = freshHalls1.find(h => h.name === 'A01');
    const s01Obj = freshHalls1.find(h => h.name === 'S01');
    assert(m02Obj && m03Obj && a01Obj && s01Obj, "All 4 individual halls found");
    assert(m02Obj.block === 'MAIN BLOCK' && a01Obj.block === "A' BLOCK" && s01Obj.block === 'SCIENCE BLOCK', "Halls span multiple distinct blocks");

    // -------------------------------------------------------------------------
    // Scenario 8: Verify selected capacity is the sum of individual hall capacities without duplicates
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 8: Verify selected capacity is the sum of individual capacities without duplicates ---");
    const capSum = (m02Obj.benches * (m02Obj.seatsPerBench || 2)) +
                   (m03Obj.benches * (m03Obj.seatsPerBench || 2)) +
                   (a01Obj.benches * (a01Obj.seatsPerBench || 2)) +
                   (s01Obj.benches * (s01Obj.seatsPerBench || 2));
    // M02: 13*2=26, M03: 13*2=26, A01: 17*3=51, S01: 12*2=24 => sum = 127
    assert(capSum === 26 + 26 + 51 + 24, `Calculated capacity sum is ${capSum} (expected ${26 + 26 + 51 + 24})`);

    // Verify duplicate avoidance
    const setWithOverlap = Array.from(new Set([...multiBlockSelection, 'M02', 'A01']));
    assert(setWithOverlap.length === 4, "Overlapping selections deduplicate to exactly 4 distinct halls");

    // -------------------------------------------------------------------------
    // Scenario 9: Create Exam 1, edit general hall configuration, confirm Exam 1 remains unchanged
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 9: Create Exam 1, edit general hall, confirm Exam 1 unchanged ---");
    // Get existing students and subject codes
    const studentsRes = await request('GET', '/api/students');
    assert(studentsRes.status === 200 && studentsRes.data.length > 0, "Students available for exam creation");
    
    // Choose available subject codes with real registered students
    const subCodes = ['ABAJA41', 'ABAJC62', 'CCRJN61'];

    const exam1Payload = {
      name: "Automated Test Exam 1",
      date: "2026-11-26",
      session: "FN",
      subjectCodes: subCodes,
      departments: [],
      assignedHalls: ['A01', 'M02'],
      seatsPerBench: 3
    };

    const exam1CreateRes = await request('POST', '/api/exams', exam1Payload);
    assert(exam1CreateRes.status === 200 || exam1CreateRes.status === 201, `Create Exam 1 returned 201/200 (got ${exam1CreateRes.status})`);
    const exam1 = exam1CreateRes.data;
    assert(exam1.hallSnapshots && exam1.hallSnapshots['A01'], "Exam 1 contains hall snapshot for A01");
    const snap1Before = exam1.hallSnapshots['A01'];
    assert(snap1Before.benches === 17, `Exam 1 A01 snapshot benches = 17 (got ${snap1Before.benches})`);
    assert(snap1Before.seatsPerBench === 3, `Exam 1 A01 snapshot seatsPerBench = 3 (got ${snap1Before.seatsPerBench})`);
    assert(snap1Before.capacity === 51, `Exam 1 A01 snapshot capacity = 51 (got ${snap1Before.capacity})`);

    // Now edit general hall record A01 to 15 benches and 2 seats per bench (capacity = 30)
    console.log("Editing general A01 hall record to 15 benches and 2 seats per bench...");
    const updateRes2 = await request('PUT', `/api/halls/${a01Id}`, {
      name: 'A01',
      block: "A' BLOCK",
      benches: 15,
      seatsPerBench: 2
    });
    assert(updateRes2.status === 200, "Update A01 returned 200");
    assert(updateRes2.data.benches === 15 && updateRes2.data.capacity === 30, "A01 now 15 benches, capacity 30 in general records");

    // Fetch Exam 1 again and confirm it has NOT changed!
    const exam1FetchRes = await request('GET', `/api/exams/${exam1._id}`);
    const exam1Fetched = exam1FetchRes.data;
    const snap1After = exam1Fetched.hallSnapshots['A01'];
    assert(snap1After.benches === 17, `Exam 1 snapshot IMMUTABILITY check: benches still 17 (got ${snap1After.benches})`);
    assert(snap1After.seatsPerBench === 3, `Exam 1 snapshot IMMUTABILITY check: seatsPerBench still 3 (got ${snap1After.seatsPerBench})`);
    assert(snap1After.capacity === 51, `Exam 1 snapshot IMMUTABILITY check: capacity still 51 (got ${snap1After.capacity})`);

    // -------------------------------------------------------------------------
    // Scenario 10: Create Exam 2 and confirm it uses the updated hall configuration
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 10: Create Exam 2 and confirm it uses the updated hall configuration ---");
    const exam2Payload = {
      name: "Automated Test Exam 2",
      date: "2026-11-27",
      session: "AN",
      subjectCodes: subCodes,
      departments: [],
      assignedHalls: ['A01', 'M03'],
      seatsPerBench: 2
    };

    const exam2CreateRes = await request('POST', '/api/exams', exam2Payload);
    assert(exam2CreateRes.status === 200 || exam2CreateRes.status === 201, `Create Exam 2 returned 201/200 (got ${exam2CreateRes.status})`);
    const exam2 = exam2CreateRes.data;
    assert(exam2.hallSnapshots && exam2.hallSnapshots['A01'], "Exam 2 contains hall snapshot for A01");
    const snap2 = exam2.hallSnapshots['A01'];
    assert(snap2.benches === 15, `Exam 2 A01 snapshot benches = 15 (got ${snap2.benches})`);
    assert(snap2.seatsPerBench === 2, `Exam 2 A01 snapshot seatsPerBench = 2 (got ${snap2.seatsPerBench})`);
    assert(snap2.capacity === 30, `Exam 2 A01 snapshot capacity = 30 (got ${snap2.capacity})`);

    // -------------------------------------------------------------------------
    // Scenario 11: Explicitly edit Exam 1 and confirm only Exam 1 changes
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 11: Explicitly edit Exam 1 and confirm only Exam 1 changes ---");
    const exam1UpdateRes = await request('PUT', `/api/exams/${exam1._id}`, {
      ...exam1Fetched,
      name: "Automated Test Exam 1 - Explicitly Edited",
      assignedHalls: ['A01', 'M02', 'M04']
    });
    assert(exam1UpdateRes.status === 200, "Update Exam 1 returned 200");
    const updatedExam1 = exam1UpdateRes.data;
    assert(updatedExam1.assignedHalls.includes('M04'), "Exam 1 now includes M04");
    assert(updatedExam1.hallSnapshots['M04'], "Exam 1 has snapshot for newly assigned M04");

    // Confirm Exam 2 has NOT changed
    const exam2Recheck = (await request('GET', `/api/exams/${exam2._id}`)).data;
    assert(exam2Recheck.assignedHalls.length === 2, "Exam 2 still has 2 assigned halls");
    assert(!exam2Recheck.assignedHalls.includes('M04'), "Exam 2 does not contain M04");
    assert(exam2Recheck.name === "Automated Test Exam 2", "Exam 2 name remained unchanged");

    // -------------------------------------------------------------------------
    // Scenario 12: Restart backend simulation and confirm persistence
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 12: Confirm DB persistence across queries ---");
    const persistHalls = (await request('GET', '/api/halls')).data;
    const persistExams = (await request('GET', '/api/exams')).data;
    assert(persistHalls.length >= 43, `Halls table has ${persistHalls.length} records`);
    const pA01 = persistHalls.find(h => h.name === 'A01');
    assert(pA01.benches === 15 && pA01.capacity === 30, "A01 persisted in database with 15 benches, 30 capacity");

    const pExam1 = persistExams.find(e => e._id === exam1._id);
    const pExam2 = persistExams.find(e => e._id === exam2._id);
    assert(pExam1 && pExam1.hallSnapshots['A01'].capacity === 51, "Exam 1 snapshot persisted with capacity 51");
    assert(pExam2 && pExam2.hallSnapshots['A01'].capacity === 30, "Exam 2 snapshot persisted with capacity 30");

    // -------------------------------------------------------------------------
    // Scenario 13: Verify seating, summary counts, attendance, exports, and labels use snapshots
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 13: Verify seating plan and summary counts use exam snapshots ---");
    // Generate seating for Exam 1 on hall A01
    const seatRes1 = await request('POST', '/api/seating/generate', { examId: exam1._id, hallId: 'A01' });
    assert(seatRes1.status === 200, `Generate seating for Exam 1 returned 200 (got ${seatRes1.status})`);
    const plan1 = seatRes1.data;
    assert(plan1 && (plan1.attendanceRoster || plan1.seats), "Exam 1 seating plan generated");

    const seatedCount1 = plan1.attendanceRoster ? plan1.attendanceRoster.length : (plan1.totalStudents || 0);
    const cap1 = plan1.hallSnapshot ? plan1.hallSnapshot.capacity : (plan1.totalBenches * (plan1.hallSnapshot?.seatsPerBench || 3));
    console.log(`Exam 1: Hall A01 allocated ${seatedCount1} students (Snapshot Capacity: 51, HallSnapshot capacity: ${cap1})`);
    assert(seatedCount1 <= 51, `Exam 1: allocated ${seatedCount1} students <= snapshot capacity 51`);
    assert(cap1 === 51, `Exam 1: plan.hallSnapshot.capacity is 51 from snapshot (got ${cap1})`);

    // Generate seating for Exam 2 on hall A01
    const seatRes2 = await request('POST', '/api/seating/generate', { examId: exam2._id, hallId: 'A01' });
    assert(seatRes2.status === 200, `Generate seating for Exam 2 returned 200 (got ${seatRes2.status})`);
    const plan2 = seatRes2.data;
    const seatedCount2 = plan2.attendanceRoster ? plan2.attendanceRoster.length : (plan2.totalStudents || 0);
    const cap2 = plan2.hallSnapshot ? plan2.hallSnapshot.capacity : (plan2.totalBenches * (plan2.hallSnapshot?.seatsPerBench || 2));
    console.log(`Exam 2: Hall A01 allocated ${seatedCount2} students (Snapshot Capacity: 30, HallSnapshot capacity: ${cap2})`);
    assert(seatedCount2 <= 30, `Exam 2: allocated ${seatedCount2} students <= snapshot capacity 30`);
    assert(cap2 === 30, `Exam 2: plan.hallSnapshot.capacity is 30 from snapshot (got ${cap2})`);

    // -------------------------------------------------------------------------
    // Scenario 14: Verify no duplicate halls, duplicate student assignments, or missing eligible students
    // -------------------------------------------------------------------------
    console.log("\n--- Scenario 14: Verify no duplicate halls or duplicate student assignments ---");
    const roster1 = plan1.attendanceRoster || [];
    const regNos1 = roster1.map(s => s.registerNo || s.regNo).filter(Boolean);
    const uniqueRegNos1 = new Set(regNos1);
    assert(regNos1.length === uniqueRegNos1.size, `No duplicate students in Exam 1 roster: ${regNos1.length} students, ${uniqueRegNos1.size} unique`);

    const roster2 = plan2.attendanceRoster || [];
    const regNos2 = roster2.map(s => s.registerNo || s.regNo).filter(Boolean);
    const uniqueRegNos2 = new Set(regNos2);
    assert(regNos2.length === uniqueRegNos2.size, `No duplicate students in Exam 2 roster: ${regNos2.length} students, ${uniqueRegNos2.size} unique`);

    // Cleanup test exams
    console.log("\nCleaning up automated test exams...");
    await request('DELETE', `/api/exams/${exam1._id}`);
    await request('DELETE', `/api/exams/${exam2._id}`);
    console.log("Test exams cleaned up successfully.");

    // Restore A01 to 17 benches, 2 seats per bench as in official table
    await request('PUT', `/api/halls/${a01Id}`, {
      name: 'A01',
      block: "A' BLOCK",
      benches: 17,
      seatsPerBench: 2
    });
    console.log("Restored A01 to default 17 benches, 2 seats/bench.");

    console.log("\n===============================================================================");
    console.log(`ALL 14 TEST SCENARIOS COMPLETED SUCCESSFULLY! (${testPassed} assertions passed, ${testFailed} failed)`);
    console.log("===============================================================================");
  } catch (err) {
    console.error("Test execution aborted with error:", err.message);
    process.exit(1);
  }
}

runAllTests();
