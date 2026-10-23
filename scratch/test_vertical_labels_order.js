const http = require('http');
let XLSX;
try {
  XLSX = require('./backend/node_modules/xlsx-js-style');
} catch (e) {
  XLSX = require('../backend/node_modules/xlsx-js-style');
}

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
  console.log('--- Testing Vertical (Column-First) Order for Seat Labels ---');

  const examsRes = await getJson('/api/exams');
  const exam = (examsRes.data || []).find(e => e.date && e.session);
  if (!exam) {
    console.log('No exam found. Skipping test.');
    return;
  }

  const targetDate = exam.date.split('T')[0];
  const targetSession = exam.session;
  console.log(`Exam: ${exam.name}, Date: ${targetDate}, Session: ${targetSession}`);

  // 1. Fetch raw sequence from /api/seating/labels/sequence
  const seqRes = await getJson(`/api/seating/labels/sequence?date=${targetDate}&session=${targetSession}`);
  if (seqRes.status !== 200 || !seqRes.data || !Array.isArray(seqRes.data.studentRegNos)) {
    console.error('Failed to get student sequence:', seqRes);
    process.exit(1);
  }

  const studentRegNos = seqRes.data.studentRegNos;
  console.log(`Total students in sequence: ${studentRegNos.length}`);

  // 2. Fetch CSV
  const csvRes = await getText(`/api/seating/labels/download-csv?date=${targetDate}&session=${targetSession}`);
  if (csvRes.status !== 200) {
    console.error('Failed to get CSV:', csvRes);
    process.exit(1);
  }

  const csvLines = csvRes.text.split('\n').filter(Boolean).map(line => line.split(',').map(s => s.trim()));
  console.log(`CSV total rows: ${csvLines.length}`);

  // Verify Page 1 in CSV (first 21 rows):
  // Column 0 should have studentRegNos[0..20]
  // Column 1 should have studentRegNos[21..41]
  // Column 2 should have studentRegNos[42..62]
  // Column 3 should have studentRegNos[63..83]
  console.log('\nVerifying Page 1 Vertical Column Order in CSV:');
  for (let r = 0; r < 21; r++) {
    const row = csvLines[r] || [];
    const expectedCol0 = studentRegNos[0 * 21 + r] || '';
    const expectedCol1 = studentRegNos[1 * 21 + r] || '';
    const expectedCol2 = studentRegNos[2 * 21 + r] || '';
    const expectedCol3 = studentRegNos[3 * 21 + r] || '';

    if (row[0] !== expectedCol0 || row[1] !== expectedCol1 || row[2] !== expectedCol2 || row[3] !== expectedCol3) {
      console.error(`Mismatch at CSV row ${r}:`);
      console.error(`  Expected: [${expectedCol0}, ${expectedCol1}, ${expectedCol2}, ${expectedCol3}]`);
      console.error(`  Got:      [${row[0]}, ${row[1]}, ${row[2]}, ${row[3]}]`);
      process.exit(1);
    }
  }
  console.log('PASSED: Page 1 in CSV has students strictly descending down Column 1, then Column 2, Column 3, Column 4!');

  // Verify Page 2 in CSV if exists (rows 21 to 41)
  if (studentRegNos.length > 84) {
    console.log('\nVerifying Page 2 Vertical Column Order in CSV:');
    for (let r = 0; r < 21; r++) {
      const csvRowIdx = 21 + r;
      if (csvRowIdx >= csvLines.length) break;
      const row = csvLines[csvRowIdx] || [];
      const expectedCol0 = studentRegNos[84 + 0 * 21 + r] || '';
      const expectedCol1 = studentRegNos[84 + 1 * 21 + r] || '';
      const expectedCol2 = studentRegNos[84 + 2 * 21 + r] || '';
      const expectedCol3 = studentRegNos[84 + 3 * 21 + r] || '';

      if (row[0] !== expectedCol0 || row[1] !== expectedCol1 || row[2] !== expectedCol2 || row[3] !== expectedCol3) {
        console.error(`Mismatch at CSV row ${csvRowIdx}:`);
        console.error(`  Expected: [${expectedCol0}, ${expectedCol1}, ${expectedCol2}, ${expectedCol3}]`);
        console.error(`  Got:      [${row[0]}, ${row[1]}, ${row[2]}, ${row[3]}]`);
        process.exit(1);
      }
    }
    console.log('PASSED: Page 2 in CSV correctly continues down Column 1, then Column 2, Column 3, Column 4!');
  }

  // 3. Verify Excel
  console.log('\nVerifying Excel File:');
  const excelRes = await getBuffer(`/api/seating/labels/download-excel?date=${targetDate}&session=${targetSession}`);
  if (excelRes.status !== 200) {
    console.error('Failed to get Excel');
    process.exit(1);
  }

  const wb = XLSX.read(excelRes.buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];

  for (let r = 0; r < 21; r++) {
    const cellA = (ws[XLSX.utils.encode_cell({ r, c: 0 })] || {}).v || '';
    const cellB = (ws[XLSX.utils.encode_cell({ r, c: 1 })] || {}).v || '';
    const cellC = (ws[XLSX.utils.encode_cell({ r, c: 2 })] || {}).v || '';
    const cellD = (ws[XLSX.utils.encode_cell({ r, c: 3 })] || {}).v || '';

    const expectedCol0 = studentRegNos[0 * 21 + r] || '';
    const expectedCol1 = studentRegNos[1 * 21 + r] || '';
    const expectedCol2 = studentRegNos[2 * 21 + r] || '';
    const expectedCol3 = studentRegNos[3 * 21 + r] || '';

    if (cellA !== expectedCol0 || cellB !== expectedCol1 || cellC !== expectedCol2 || cellD !== expectedCol3) {
      console.error(`Excel mismatch at row ${r}:`);
      console.error(`  Expected: [${expectedCol0}, ${expectedCol1}, ${expectedCol2}, ${expectedCol3}]`);
      console.error(`  Got:      [${cellA}, ${cellB}, ${cellC}, ${cellD}]`);
      process.exit(1);
    }
  }
  console.log('PASSED: Excel sheet matches exact vertical column-first order down Column 1, then Column 2, etc.!');

  // 4. Verify PDF export
  console.log('\nVerifying PDF File:');
  const pdfRes = await getBuffer(`/api/seating/labels/download-pdf?date=${targetDate}&session=${targetSession}`);
  if (pdfRes.status !== 200 || pdfRes.buffer.length < 1000) {
    console.error('Failed to get PDF');
    process.exit(1);
  }
  console.log(`PASSED: PDF generated successfully (${pdfRes.buffer.length} bytes).`);

  console.log('\nALL VERTICAL ORDERING TESTS PASSED PERFECTLY!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
