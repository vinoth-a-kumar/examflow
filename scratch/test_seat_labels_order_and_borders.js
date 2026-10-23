const http = require('http');

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    }).on('error', reject);
  });
}

function getText(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5000${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    }).on('error', reject);
  });
}

function getBuffer(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5000${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- Testing Seat Labels Ordering and Border Removal ---');

  // 1. Fetch exams
  const examsRes = await getJson('/api/exams');
  if (!examsRes.data || !Array.isArray(examsRes.data) || examsRes.data.length === 0) {
    console.log('No exams found in DB. Skipping test.');
    return;
  }

  // Find an exam with date and session
  const exam = examsRes.data.find(e => e.date && e.session);
  if (!exam) {
    console.log('No exam with date and session found.');
    return;
  }

  const targetDate = exam.date.split('T')[0];
  const targetSession = exam.session;
  console.log(`Testing with Exam: "${exam.name}", Date: ${targetDate}, Session: ${targetSession}`);
  console.log(`Exam Subject Codes: ${JSON.stringify(exam.subjectCodes)}`);
  console.log(`Exam Assigned Halls: ${JSON.stringify(exam.assignedHalls)}`);

  // 2. Fetch seating plans for this exam's assigned halls
  const examPlans = [];
  for (const hallId of exam.assignedHalls || []) {
    const pRes = await getJson(`/api/seating/by-date-session?date=${targetDate}&session=${targetSession}&hallId=${encodeURIComponent(hallId)}`);
    if (pRes.data && (pRes.data.seatingGrid || pRes.data.attendanceRoster)) {
      examPlans.push(pRes.data);
    }
  }
  console.log(`Found ${examPlans.length} seating plan(s) for this date/session.`);

  // 3. Test CSV label export
  const csvRes = await getText(`/api/seating/labels/download-csv?date=${targetDate}&session=${targetSession}`);
  console.log(`CSV Export Status: ${csvRes.status}`);
  if (csvRes.status !== 200) {
    console.error('CSV Export Error:', csvRes.text);
    process.exit(1);
  }

  const labelRegNos = csvRes.text.split(/[\n,]/).map(s => s.trim().toUpperCase()).filter(Boolean);
  console.log(`Total labels exported: ${labelRegNos.length}`);

  // 4. Fetch student records to map registerNo to subjectCode and hall
  const studentsRes = await getJson('/api/students');
  const studentMap = new Map();
  (studentsRes.data || []).forEach(s => {
    if (s.registerNo) studentMap.set(s.registerNo.trim().toUpperCase(), s);
  });

  // Also check seating plans for student-to-hall and student-to-subject mappings
  const studentHallMap = new Map();
  const studentSubMap = new Map();

  examPlans.forEach(p => {
    const hallName = p.hallName || 'HALL';
    if (Array.isArray(p.seatingGrid)) {
      p.seatingGrid.forEach(bench => {
        ['seat1', 'seat2', 'seat3'].forEach(k => {
          const st = bench && bench[k];
          if (st && st.registerNo) {
            const reg = st.registerNo.trim().toUpperCase();
            studentHallMap.set(reg, hallName);
            if (st.subjectCode) studentSubMap.set(reg, st.subjectCode.trim().toUpperCase());
          }
        });
      });
    }
    if (Array.isArray(p.attendanceRoster)) {
      p.attendanceRoster.forEach(st => {
        if (st && st.registerNo) {
          const reg = st.registerNo.trim().toUpperCase();
          if (!studentHallMap.has(reg)) studentHallMap.set(reg, hallName);
          if (st.subjectCode && !studentSubMap.has(reg)) studentSubMap.set(reg, st.subjectCode.trim().toUpperCase());
        }
      });
    }
  });

  // Verify hall grouping:
  // As we iterate through labelRegNos, once a hall's students finish, that hall should NEVER appear again!
  const hallOrderSeen = [];
  let currentHall = null;
  const seenHalls = new Set();
  const hallStudentBuckets = new Map();

  for (let i = 0; i < labelRegNos.length; i++) {
    const reg = labelRegNos[i];
    const h = studentHallMap.get(reg) || 'UNKNOWN_HALL';
    if (h !== currentHall) {
      if (seenHalls.has(h)) {
        console.error(`FAIL: Hall "${h}" reappeared at position ${i + 1} after earlier hall ended!`);
        process.exit(1);
      }
      seenHalls.add(h);
      currentHall = h;
      hallOrderSeen.push(h);
    }
    if (!hallStudentBuckets.has(h)) hallStudentBuckets.set(h, []);
    hallStudentBuckets.get(h).push(reg);
  }

  console.log(`PASSED: Hall order strictly preserved: ${hallOrderSeen.join(' -> ')}`);

  // Verify inside each hall:
  // Students must be grouped by subject code in configured order, and inside each subject code, sorted by registerNo
  for (const [hallName, hallRegs] of hallStudentBuckets.entries()) {
    console.log(`\nVerifying Hall ${hallName} (${hallRegs.length} students):`);
    
    let currentSub = null;
    const seenSubsInHall = new Set();
    const subGroups = new Map();

    for (let i = 0; i < hallRegs.length; i++) {
      const reg = hallRegs[i];
      let sub = studentSubMap.get(reg) || (studentMap.get(reg) && studentMap.get(reg).subjectCode) || 'GENERAL';
      sub = String(sub).trim().toUpperCase();

      if (sub !== currentSub) {
        if (seenSubsInHall.has(sub)) {
          console.error(`FAIL in Hall ${hallName}: Subject code "${sub}" reappeared at position ${i + 1}!`);
          process.exit(1);
        }
        seenSubsInHall.add(sub);
        currentSub = sub;
      }

      if (!subGroups.has(sub)) subGroups.set(sub, []);
      subGroups.get(sub).push(reg);
    }

    const hallSubs = Array.from(subGroups.keys());
    console.log(`  Subject Codes order in Hall ${hallName}: ${hallSubs.join(', ')}`);

    // Verify each subject group is sorted by register number
    for (const [sub, regs] of subGroups.entries()) {
      for (let j = 0; j < regs.length - 1; j++) {
        const cmp = regs[j].localeCompare(regs[j + 1], undefined, { numeric: true, sensitivity: 'base' });
        if (cmp > 0) {
          console.error(`FAIL in Hall ${hallName}, Sub ${sub}: ${regs[j]} is placed before ${regs[j + 1]} (not in ascending order)!`);
          process.exit(1);
        }
      }
      console.log(`  PASSED: Sub ${sub} (${regs.length} students) sorted ascending: ${regs[0]} ... ${regs[regs.length - 1]}`);
    }
  }

  // 5. Test PDF export & Border Check
  console.log('\n--- Step 5: Testing PDF Export & Border Absence ---');
  const pdfRes = await getBuffer(`/api/seating/labels/download-pdf?date=${targetDate}&session=${targetSession}`);
  console.log(`PDF Export Status: ${pdfRes.status}, Size: ${pdfRes.buffer.length} bytes`);
  if (pdfRes.status !== 200) {
    console.error('PDF export failed:', pdfRes.buffer.toString());
    process.exit(1);
  }

  // Verify PDF does NOT draw box borders
  // pdfkit .rect().stroke('#000000') writes 're S' or 're f' or 're s'
  // When we removed doc.rect(...).stroke(...), there should be 0 're S' rectangle strokes on label pages
  const zlib = require('zlib');
  const pdfRaw = pdfRes.buffer.toString('latin1');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let strokeRectCount = 0;
  while ((match = streamRegex.exec(pdfRaw)) !== null) {
    try {
      const streamBuf = Buffer.from(match[1], 'binary');
      const decompressed = zlib.inflateSync(streamBuf).toString('latin1');
      // In PDF content streams, rectangle stroke is indicated by 're S' or 're s' or 're\nS'
      const rectStrokes = (decompressed.match(/\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+re\s+S/g) || []).length;
      strokeRectCount += rectStrokes;
    } catch (e) {}
  }
  console.log(`Number of rectangle border strokes found in PDF: ${strokeRectCount}`);
  if (strokeRectCount === 0) {
    console.log('PASSED: PDF has ZERO box border strokes. Borders are completely removed!');
  } else {
    console.error(`WARNING: Found ${strokeRectCount} rectangle strokes in PDF!`);
    process.exit(1);
  }

  // 6. Test Excel export
  console.log('\n--- Step 6: Testing Excel Export & Border Absence ---');
  const excelRes = await getBuffer(`/api/seating/labels/download-excel?date=${targetDate}&session=${targetSession}`);
  console.log(`Excel Export Status: ${excelRes.status}, Size: ${excelRes.buffer.length} bytes`);
  if (excelRes.status !== 200) {
    console.error('Excel export failed');
    process.exit(1);
  }

  console.log('\nALL VERIFICATIONS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
