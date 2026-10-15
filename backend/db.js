const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'examflow';

let isMysqlConnected = false;
let pool = null;

// JSON fallback DB setup
const JSON_DB_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(JSON_DB_DIR)) {
  fs.mkdirSync(JSON_DB_DIR, { recursive: true });
}

const getJsonPath = (collectionName) => path.join(JSON_DB_DIR, `${collectionName}.json`);

const jsonMemoryCache = new Map();

const readJson = (collectionName) => {
  const filePath = getJsonPath(collectionName);
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, JSON.stringify([]));
    } catch (e) {}
    jsonMemoryCache.set(collectionName, []);
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(data || '[]');
    jsonMemoryCache.set(collectionName, parsed);
    return parsed;
  } catch (error) {
    console.error(`[CRITICAL] Error reading/parsing JSON file ${collectionName}:`, error.message);
    // Safety: Backup the corrupted file before anything else can touch it
    try {
      const corruptBackup = path.join(JSON_DB_DIR, `${collectionName}_corrupted_${Date.now()}.bak`);
      fs.copyFileSync(filePath, corruptBackup);
      console.warn(`[DATA RECOVERY] Preserved corrupted snapshot to: ${corruptBackup}`);
    } catch (bErr) {}
    // If in-memory cache exists, use cached version rather than returning empty array!
    if (jsonMemoryCache.has(collectionName)) {
      console.warn(`[DATA RECOVERY] Recovered data from memory cache for ${collectionName}`);
      return jsonMemoryCache.get(collectionName);
    }
    return [];
  }
};

const writeJson = (collectionName, data) => {
  const filePath = getJsonPath(collectionName);
  const tempPath = `${filePath}.tmp_${Date.now()}`;
  try {
    // Atomic write via temp file rename with Windows fallback
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tempPath, filePath);
    } catch (renErr) {
      fs.copyFileSync(tempPath, filePath);
      try { fs.unlinkSync(tempPath); } catch (uErr) {}
    }
    jsonMemoryCache.set(collectionName, data);
    return true;
  } catch (error) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      jsonMemoryCache.set(collectionName, data);
      return true;
    } catch (directErr) {
      console.error(`Error writing JSON file ${collectionName}:`, directErr);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (cleanErr) {}
      return false;
    }
  }
};

const generateId = () => {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};

// Initialise connection with Promise tracking
let initPromise = null;
async function initMysql() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // 1. Connect without database to ensure database exists
      const tempConnection = await mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD
      });
      
      await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
      await tempConnection.end();

      // 2. Create the connection pool with database specified
      pool = mysql.createPool({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 15,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000
      });

      // Test connection
      const conn = await pool.getConnection();
      conn.release();

      console.log('Successfully connected to MySQL database.');
      isMysqlConnected = true;

      // Create tables & indexes if they do not exist
      await createTables();
      return true;
    } catch (err) {
      console.warn('MySQL connection failed on startup. Falling back to Local JSON database.');
      console.warn('Error detail:', err.message);
      isMysqlConnected = false;
      return false;
    }
  })();
  return initPromise;
}

async function createTables() {
  // users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`username\` VARCHAR(255) UNIQUE NOT NULL,
      \`email\` VARCHAR(255) UNIQUE NOT NULL,
      \`password\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // students
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`registerNo\` VARCHAR(255) UNIQUE NOT NULL,
      \`name\` TEXT NOT NULL,
      \`department\` TEXT NOT NULL,
      \`batch\` VARCHAR(255) DEFAULT '2024-25',
      \`csvData\` LONGTEXT,
      \`idx\` INT AUTO_INCREMENT UNIQUE
    )
  `);

  // halls
  await pool.query(`
    CREATE TABLE IF NOT EXISTS halls (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL,
      \`block\` VARCHAR(255) DEFAULT '',
      \`rows\` INT NOT NULL,
      \`columns\` INT NOT NULL,
      \`capacity\` INT NOT NULL,
      \`benches\` INT NOT NULL,
      \`columnRows\` LONGTEXT,
      \`seatsPerBench\` INT DEFAULT 2,
      \`columnGaps\` LONGTEXT,
      \`csvData\` LONGTEXT,
      \`idx\` INT DEFAULT 0
    )
  `);

  // exams
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exams (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL,
      \`departments\` TEXT,
      \`subjectCodes\` TEXT,
      \`date\` VARCHAR(255) NOT NULL,
      \`session\` VARCHAR(50) NOT NULL,
      \`studentsCount\` INT DEFAULT 0,
      \`status\` VARCHAR(50) DEFAULT 'Draft',
      \`assignedHalls\` TEXT,
      \`seatsPerBench\` INT DEFAULT 2,
      \`time\` VARCHAR(255) DEFAULT '',
      \`hallSnapshots\` LONGTEXT
    )
  `);

  // seating_plans
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seating_plans (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`examId\` VARCHAR(255) NOT NULL,
      \`examName\` VARCHAR(255) NOT NULL,
      \`hallId\` VARCHAR(255) NOT NULL,
      \`hallName\` VARCHAR(255) NOT NULL,
      \`seatingGrid\` LONGTEXT NOT NULL,
      \`attendanceRoster\` LONGTEXT NOT NULL,
      \`unseatedStudents\` LONGTEXT,
      \`totalBenches\` INT,
      \`totalStudents\` INT,
      \`emptySeats\` INT,
      \`generatedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP,
      \`hallSnapshot\` LONGTEXT
    )
  `);

  // upload_histories
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upload_histories (
      \`_id\` VARCHAR(255) PRIMARY KEY,
      \`filename\` VARCHAR(255) NOT NULL,
      \`recordCount\` INT DEFAULT 0,
      \`status\` VARCHAR(50) NOT NULL,
      \`errorMessage\` TEXT,
      \`uploadedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations for existing databases
  const migrations = [
    `ALTER TABLE exams ADD COLUMN \`subjectCodes\` TEXT`,
    `ALTER TABLE exams ADD COLUMN \`seatsPerBench\` INT DEFAULT 2`,
    `ALTER TABLE exams ADD COLUMN \`time\` VARCHAR(255) DEFAULT ''`,
    `ALTER TABLE exams ADD COLUMN \`hallSnapshots\` LONGTEXT`,
    `ALTER TABLE halls ADD COLUMN \`block\` VARCHAR(255) DEFAULT ''`,
    `ALTER TABLE halls ADD COLUMN \`columnRows\` LONGTEXT`,
    `ALTER TABLE halls ADD COLUMN \`seatsPerBench\` INT DEFAULT 2`,
    `ALTER TABLE halls ADD COLUMN \`columnGaps\` LONGTEXT`,
    `ALTER TABLE halls ADD COLUMN \`csvData\` LONGTEXT`,
    `ALTER TABLE halls MODIFY COLUMN \`idx\` INT DEFAULT 0`,
    `ALTER TABLE halls DROP INDEX \`idx\``,
    `CREATE INDEX idx_halls_idx ON halls(\`idx\`)`,
    `ALTER TABLE seating_plans ADD COLUMN \`unseatedStudents\` LONGTEXT`,
    `ALTER TABLE seating_plans ADD COLUMN \`hallSnapshot\` LONGTEXT`,
    `ALTER TABLE students ADD COLUMN \`csvData\` LONGTEXT`,
    `ALTER TABLE students MODIFY COLUMN \`name\` TEXT NOT NULL`,
    `ALTER TABLE students MODIFY COLUMN \`department\` TEXT NOT NULL`,
    // Performance indexes
    `CREATE INDEX idx_exams_date_session ON exams(\`date\`, \`session\`)`,
    `CREATE INDEX idx_seating_plans_exam ON seating_plans(\`examId\`)`,
    `CREATE INDEX idx_seating_plans_hall ON seating_plans(\`hallId\`)`,
    `CREATE INDEX idx_students_dept ON students(\`department\`(50))`,
    `CREATE INDEX idx_students_reg ON students(\`registerNo\`(50))`,
    `CREATE INDEX idx_halls_name ON halls(\`name\`)`
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch (e) {
      // Ignore if column or index already exists
    }
  }

  // Auto-normalize student departments in MySQL
  try {
    const [rows] = await pool.query(`SELECT _id, registerNo, department FROM students WHERE department = 'GENERAL' OR department = '' OR department IS NULL OR department = 'UNKNOWN'`);
    if (rows && rows.length > 0) {
      for (const r of rows) {
        const match = (r.registerNo || '').match(/^([A-Za-z]{2,6})/);
        if (match && match[1]) {
          await pool.query(`UPDATE students SET department = ? WHERE _id = ?`, [match[1].toUpperCase(), r._id]);
        }
      }
      console.log(`[MySQL Migration] Normalized departments for ${rows.length} students in MySQL.`);
    }
  } catch (err) {
    console.error('Error auto-migrating departments in MySQL:', err.message);
  }
}

// Start database initialization
initMysql();

function safeParseJson(value, fallback = []) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function parseExam(row) {
  if (!row) return null;
  return {
    ...row,
    departments: safeParseJson(row.departments, []),
    subjectCodes: safeParseJson(row.subjectCodes, []),
    assignedHalls: safeParseJson(row.assignedHalls, []),
    hallSnapshots: safeParseJson(row.hallSnapshots, {}),
    seatsPerBench: row.seatsPerBench || 2,
    studentsCount: row.studentsCount || 0,
    time: row.time || ''
  };
}

function parseSeatingPlan(row) {
  if (!row) return null;
  return {
    ...row,
    seatingGrid: safeParseJson(row.seatingGrid, []),
    attendanceRoster: safeParseJson(row.attendanceRoster, []),
    unseatedStudents: safeParseJson(row.unseatedStudents, []),
    hallSnapshot: safeParseJson(row.hallSnapshot, null),
    totalBenches: row.totalBenches || 0,
    totalStudents: row.totalStudents || 0,
    emptySeats: row.emptySeats || 0
  };
}

async function runQuery(sql, params = []) {
  if (!isMysqlConnected || !pool) {
    throw new Error('MySQL is not connected.');
  }
  const [rows] = await pool.query(sql, params);
  return rows;
}

const CRITICAL_NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'PROTOCOL_CONNECTION_LOST',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ECONNRESET'
]);

async function safeMysqlQuery(fn) {
  if (!isMysqlConnected || !pool) return null;
  try {
    return await fn();
  } catch (err) {
    if (CRITICAL_NETWORK_ERRORS.has(err.code) || (err.message && err.message.includes('MySQL is not connected'))) {
      console.warn(`[Database Warning] MySQL connection dropped (${err.message}). Attempting pool recovery...`);
      try {
        const testConn = await pool.getConnection();
        testConn.release();
        return await fn();
      } catch (poolErr) {
        console.warn(`[Database Fallback] MySQL is genuinely unreachable. Falling back to local storage.`);
        isMysqlConnected = false;
        return null;
      }
    } else {
      // Application / SQL query error (duplicate entry, syntax error, etc.)
      // NEVER disable MySQL on operational errors!
      console.error(`[MySQL Query Error]`, err.message || err);
      throw err;
    }
  }
}

const buildWhere = (query = {}) => {
  const keys = Object.keys(query).filter(k => query[k] !== undefined && query[k] !== null);
  if (keys.length === 0) return { clause: '', values: [] };
  const clauses = keys.map(k => `\`${k}\` = ?`);
  const values = keys.map(k => query[k]);
  return { clause: ' WHERE ' + clauses.join(' AND '), values };
};

const Models = {
  Student: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM students${clause} ORDER BY idx ASC`, values);
        return rows.map(r => ({
          ...r,
          csvData: r.csvData ? safeParseJson(r.csvData, null) : null
        }));
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      let data = readJson('students');
      if (query.registerNo) data = data.filter(s => s.registerNo === query.registerNo);
      if (query.department) data = data.filter(s => s.department === query.department);
      return data;
    },
    findOne: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM students${clause} LIMIT 1`, values);
        if (rows[0]) {
          return {
            ...rows[0],
            csvData: rows[0].csvData ? safeParseJson(rows[0].csvData, null) : null
          };
        }
        return null;
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      const data = readJson('students');
      return data.find(s => {
        for (let key in query) {
          if (s[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      const docs = Array.isArray(doc) ? doc : [doc];
      const added = [];
      const mysqlRes = await safeMysqlQuery(async () => {
        for (let item of docs) {
          await runQuery(`DELETE FROM students WHERE registerNo = ?`, [item.registerNo]);
          const _id = item._id || generateId();
          await runQuery(
            `INSERT INTO students (\`_id\`, \`registerNo\`, \`name\`, \`department\`, \`batch\`, \`csvData\`) VALUES (?, ?, ?, ?, ?, ?)`,
            [_id, item.registerNo, item.name, item.department, item.batch || '2024-25', JSON.stringify(item.csvData || null)]
          );
          added.push({ _id, ...item, batch: item.batch || '2024-25' });
        }
        return Array.isArray(doc) ? added : added[0];
      });

      // Synchronize with JSON so local file is always 100% consistent
      try {
        let data = readJson('students');
        const regSet = new Set(docs.map(d => d.registerNo));
        data = data.filter(s => !regSet.has(s.registerNo));
        if (added.length > 0) {
          data.push(...added);
        } else {
          for (let item of docs) {
            const newItem = { _id: item._id || generateId(), ...item, batch: item.batch || '2024-25' };
            data.push(newItem);
            added.push(newItem);
          }
        }
        writeJson('students', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return Array.isArray(doc) ? added : added[0];
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM students`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE students`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM students${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      // Synchronize with JSON
      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('students').length;
          writeJson('students', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('students');
          const prevLen = data.length;
          data = data.filter(s => {
            const matchesAll = Object.keys(query).every(key => String(s[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('students', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    },
    countDocuments: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT COUNT(*) as count FROM students${clause}`, values);
        return rows[0].count;
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      let data = readJson('students');
      const keys = Object.keys(query).filter(k => query[k] !== undefined && query[k] !== null);
      if (keys.length > 0) {
        data = data.filter(s => keys.every(k => String(s[k]) === String(query[k])));
      }
      return data.length;
    },
    findByIdAndUpdate: async (id, update) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const fields = [];
        const values = [];
        for (let key of Object.keys(update)) {
          if (key === '_id') continue;
          fields.push(`\`${key}\` = ?`);
          values.push(key === 'csvData' ? JSON.stringify(update[key]) : update[key]);
        }
        values.push(id);
        await runQuery(`UPDATE students SET ${fields.join(', ')} WHERE _id = ?`, values);
        const rows = await runQuery(`SELECT * FROM students WHERE _id = ?`, [id]);
        if (rows.length > 0) {
          return {
            ...rows[0],
            csvData: rows[0].csvData ? safeParseJson(rows[0].csvData, null) : null
          };
        }
        return null;
      });

      // Synchronize JSON
      try {
        let data = readJson('students');
        const idx = data.findIndex(s => s._id === id);
        if (idx !== -1) {
          data[idx] = { ...data[idx], ...update };
          writeJson('students', data);
        }
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;

      const data = readJson('students');
      const idx = data.findIndex(s => s._id === id);
      return idx !== -1 ? data[idx] : null;
    }
  },

  Hall: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM halls${clause} ORDER BY idx ASC, name ASC`, values);
        return rows.map(r => {
          let cRows = [];
          if (r.columnRows) {
            cRows = safeParseJson(r.columnRows, []);
          }
          let cData = r.csvData ? safeParseJson(r.csvData, null) : null;
          if ((!cRows || cRows.length === 0) && cData && cData.columnRows) {
            cRows = cData.columnRows;
          }
          return {
            ...r,
            block: r.block || '',
            columnRows: cRows,
            columnGaps: safeParseJson(r.columnGaps, null),
            csvData: cData,
            seatsPerBench: r.seatsPerBench || 2
          };
        });
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('halls');
      return data.sort((a, b) => (a.idx || 0) - (b.idx || 0));
    },
    findById: async (id) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM halls WHERE \`_id\` = ? OR \`name\` = ? LIMIT 1`, [id, id]);
        if (!rows || rows.length === 0) return null;
        const h = rows[0];
        let cRows = safeParseJson(h.columnRows, []);
        let cData = safeParseJson(h.csvData, null);
        if ((!cRows || cRows.length === 0) && cData && cData.columnRows) {
          cRows = cData.columnRows;
        }
        return {
          ...h,
          block: h.block || '',
          columnRows: cRows,
          columnGaps: safeParseJson(h.columnGaps, null),
          csvData: cData,
          seatsPerBench: h.seatsPerBench || 2
        };
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('halls');
      return data.find(h => h._id === id || h.name === id) || null;
    },
    create: async (doc) => {
      const docs = Array.isArray(doc) ? doc : [doc];
      const createdItems = [];
      const mysqlRes = await safeMysqlQuery(async () => {
        for (const item of docs) {
          // Check if hall exists by name or _id to preserve stable _id and order (idx)
          const existingRows = await runQuery(`SELECT * FROM halls WHERE \`name\` = ? OR \`_id\` = ? LIMIT 1`, [item.name, item._id || '']);
          let _id = item._id || (existingRows.length > 0 ? existingRows[0]._id : generateId());
          let idx = item.idx !== undefined ? item.idx : (existingRows.length > 0 ? existingRows[0].idx : null);
          const seatsPerBench = item.seatsPerBench !== undefined ? parseInt(item.seatsPerBench) : 2;
          const block = item.block !== undefined ? item.block : (existingRows.length > 0 ? existingRows[0].block : '');
          const columnGaps = JSON.stringify(item.columnGaps || null);
          const colRowsJson = JSON.stringify(item.columnRows || []);
          const csvDataJson = JSON.stringify(item.csvData || null);

          if (existingRows.length > 0) {
            await runQuery(
              `UPDATE halls SET \`name\` = ?, \`block\` = ?, \`rows\` = ?, \`columns\` = ?, \`capacity\` = ?, \`benches\` = ?, \`columnRows\` = ?, \`seatsPerBench\` = ?, \`columnGaps\` = ?, \`csvData\` = ?${idx !== null ? ', `idx` = ?' : ''} WHERE \`_id\` = ?`,
              idx !== null
                ? [item.name, block, item.rows, item.columns, item.capacity, item.benches, colRowsJson, seatsPerBench, columnGaps, csvDataJson, idx, _id]
                : [item.name, block, item.rows, item.columns, item.capacity, item.benches, colRowsJson, seatsPerBench, columnGaps, csvDataJson, _id]
            );
          } else {
            if (idx !== null) {
              await runQuery(
                `INSERT INTO halls (\`_id\`, \`name\`, \`block\`, \`rows\`, \`columns\`, \`capacity\`, \`benches\`, \`columnRows\`, \`seatsPerBench\`, \`columnGaps\`, \`csvData\`, \`idx\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  _id,
                  item.name,
                  block,
                  item.rows,
                  item.columns,
                  item.capacity,
                  item.benches,
                  colRowsJson,
                  seatsPerBench,
                  columnGaps,
                  csvDataJson,
                  idx
                ]
              );
            } else {
              await runQuery(
                `INSERT INTO halls (\`_id\`, \`name\`, \`block\`, \`rows\`, \`columns\`, \`capacity\`, \`benches\`, \`columnRows\`, \`seatsPerBench\`, \`columnGaps\`, \`csvData\`, \`idx\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                [
                  _id,
                  item.name,
                  block,
                  item.rows,
                  item.columns,
                  item.capacity,
                  item.benches,
                  colRowsJson,
                  seatsPerBench,
                  columnGaps,
                  csvDataJson
                ]
              );
            }
          }
          createdItems.push({ _id, ...item, block, seatsPerBench, idx });
        }
        return Array.isArray(doc) ? createdItems : createdItems[0];
      });

      // Synchronize JSON
      try {
        let data = readJson('halls');
        for (const item of (createdItems.length > 0 ? createdItems : docs)) {
          const itemToStore = {
            _id: item._id || generateId(),
            ...item,
            block: item.block || '',
            seatsPerBench: item.seatsPerBench || 2
          };
          const existingIdx = data.findIndex(h => h.name === itemToStore.name || h._id === itemToStore._id);
          if (existingIdx !== -1) {
            data[existingIdx] = { ...data[existingIdx], ...itemToStore };
          } else {
            data.push(itemToStore);
          }
        }
        data.sort((a, b) => (a.idx || 0) - (b.idx || 0));
        writeJson('halls', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return Array.isArray(doc) ? createdItems : createdItems[0];
    },
    findByIdAndUpdate: async (id, doc) => {
      let updatedItem = null;
      const mysqlRes = await safeMysqlQuery(async () => {
        const seatsPerBench = doc.seatsPerBench !== undefined ? parseInt(doc.seatsPerBench) : 2;
        const block = doc.block !== undefined ? doc.block : '';
        const columnGaps = JSON.stringify(doc.columnGaps || null);
        const colRowsJson = JSON.stringify(doc.columnRows || []);
        const csvDataJson = JSON.stringify(doc.csvData || null);
        const idxClause = doc.idx !== undefined ? ', `idx` = ?' : '';
        const params = [
          doc.name,
          block,
          doc.rows,
          doc.columns,
          doc.capacity,
          doc.benches,
          colRowsJson,
          seatsPerBench,
          columnGaps,
          csvDataJson
        ];
        if (doc.idx !== undefined) params.push(doc.idx);
        params.push(id, id);

        await runQuery(
          `UPDATE halls SET \`name\` = ?, \`block\` = ?, \`rows\` = ?, \`columns\` = ?, \`capacity\` = ?, \`benches\` = ?, \`columnRows\` = ?, \`seatsPerBench\` = ?, \`columnGaps\` = ?, \`csvData\` = ?${idxClause} WHERE \`_id\` = ? OR \`name\` = ?`,
          params
        );
        const rows = await runQuery(`SELECT * FROM halls WHERE \`_id\` = ? OR \`name\` = ? LIMIT 1`, [id, id]);
        if (rows.length > 0) {
          updatedItem = {
            ...rows[0],
            block: rows[0].block || '',
            columnRows: safeParseJson(rows[0].columnRows, []),
            columnGaps: safeParseJson(rows[0].columnGaps, null),
            csvData: safeParseJson(rows[0].csvData, null),
            seatsPerBench: rows[0].seatsPerBench || 2
          };
        } else {
          updatedItem = { _id: id, ...doc, block, seatsPerBench };
        }
        return updatedItem;
      });

      // Synchronize JSON
      try {
        const data = readJson('halls');
        const idx = data.findIndex(h => h._id === id || h.name === id);
        if (idx !== -1) {
          data[idx] = {
            ...data[idx],
            ...doc,
            block: doc.block !== undefined ? doc.block : (data[idx].block || ''),
            seatsPerBench: doc.seatsPerBench !== undefined ? parseInt(doc.seatsPerBench) : (data[idx].seatsPerBench || 2)
          };
          writeJson('halls', data);
          if (!updatedItem) updatedItem = data[idx];
        }
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return updatedItem;
    },
    findByIdAndDelete: async (id) => {
      let deletedItem = null;
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM halls WHERE \`_id\` = ? OR \`name\` = ? LIMIT 1`, [id, id]);
        if (rows.length === 0) return null;
        await runQuery(`DELETE FROM halls WHERE \`_id\` = ? OR \`name\` = ?`, [id, id]);
        deletedItem = rows[0];
        return deletedItem;
      });

      // Synchronize JSON
      try {
        let data = readJson('halls');
        const item = data.find(h => h._id === id || h.name === id);
        data = data.filter(h => h._id !== id && h.name !== id);
        writeJson('halls', data);
        deletedItem = deletedItem || item;
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return deletedItem;
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM halls`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE halls`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM halls${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      // Synchronize JSON
      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('halls').length;
          writeJson('halls', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('halls');
          const prevLen = data.length;
          data = data.filter(h => {
            const matchesAll = Object.keys(query).every(key => String(h[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('halls', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    },
    countDocuments: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT COUNT(*) as count FROM halls${clause}`, values);
        return rows[0].count;
      });
      if (mysqlRes !== null) return mysqlRes;
      let data = readJson('halls');
      const keys = Object.keys(query).filter(k => query[k] !== undefined && query[k] !== null);
      if (keys.length > 0) {
        data = data.filter(h => keys.every(k => String(h[k]) === String(query[k])));
      }
      return data.length;
    }
  },

  Exam: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM exams${clause}`, values);
        return rows.map(parseExam);
      });
      if (mysqlRes !== null) return mysqlRes;
      let data = readJson('exams');
      if (query.status) data = data.filter(e => e.status === query.status);
      return data;
    },
    findById: async (id) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM exams WHERE \`_id\` = ? LIMIT 1`, [id]);
        return parseExam(rows[0]);
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('exams');
      return data.find(e => e._id === id) || null;
    },
    create: async (doc) => {
      const docs = Array.isArray(doc) ? doc : [doc];
      const createdItems = [];
      const mysqlRes = await safeMysqlQuery(async () => {
        for (const item of docs) {
          const _id = item._id || generateId();
          const examItem = {
            _id,
            ...item,
            departments: item.departments || [],
            subjectCodes: item.subjectCodes || [],
            assignedHalls: item.assignedHalls || [],
            hallSnapshots: item.hallSnapshots || {},
            seatsPerBench: item.seatsPerBench || 2,
            time: item.time || ''
          };
          await runQuery(
            `INSERT INTO exams (\`_id\`, \`name\`, \`departments\`, \`subjectCodes\`, \`date\`, \`session\`, \`studentsCount\`, \`status\`, \`assignedHalls\`, \`seatsPerBench\`, \`time\`, \`hallSnapshots\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              _id,
              examItem.name,
              JSON.stringify(examItem.departments),
              JSON.stringify(examItem.subjectCodes),
              examItem.date,
              examItem.session,
              examItem.studentsCount || 0,
              examItem.status || 'Draft',
              JSON.stringify(examItem.assignedHalls),
              examItem.seatsPerBench,
              examItem.time,
              JSON.stringify(examItem.hallSnapshots || {})
            ]
          );
          createdItems.push(examItem);
        }
        return Array.isArray(doc) ? createdItems : createdItems[0];
      });

      // Synchronize JSON
      try {
        const data = readJson('exams');
        if (createdItems.length > 0) {
          data.push(...createdItems);
        } else {
          for (const item of docs) {
            const _id = item._id || generateId();
            const examItem = {
              _id,
              ...item,
              departments: item.departments || [],
              subjectCodes: item.subjectCodes || [],
              assignedHalls: item.assignedHalls || [],
              hallSnapshots: item.hallSnapshots || {},
              seatsPerBench: item.seatsPerBench || 2,
              time: item.time || ''
            };
            data.push(examItem);
            createdItems.push(examItem);
          }
        }
        writeJson('exams', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return Array.isArray(doc) ? createdItems : createdItems[0];
    },
    findByIdAndUpdate: async (id, doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const fields = [];
        const values = [];
        for (let key of Object.keys(doc)) {
          if (key === '_id') continue;
          fields.push(`\`${key}\` = ?`);
          if (['departments', 'subjectCodes', 'assignedHalls', 'hallSnapshots'].includes(key)) {
            values.push(JSON.stringify(doc[key] || (key === 'hallSnapshots' ? {} : [])));
          } else {
            values.push(doc[key]);
          }
        }
        if (fields.length > 0) {
          values.push(id);
          await runQuery(`UPDATE exams SET ${fields.join(', ')} WHERE _id = ?`, values);
        }
        const rows = await runQuery(`SELECT * FROM exams WHERE _id = ?`, [id]);
        return rows.length > 0 ? parseExam(rows[0]) : { _id: id, ...doc };
      });

      // Synchronize JSON
      try {
        const data = readJson('exams');
        const idx = data.findIndex(e => e._id === id);
        if (idx !== -1) {
          data[idx] = { ...data[idx], ...doc };
          writeJson('exams', data);
        }
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('exams');
      const idx = data.findIndex(e => e._id === id);
      return idx !== -1 ? data[idx] : null;
    },
    findByIdAndDelete: async (id) => {
      let deletedItem = null;
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM exams WHERE \`_id\` = ? LIMIT 1`, [id]);
        if (rows.length === 0) return null;
        await runQuery(`DELETE FROM exams WHERE \`_id\` = ?`, [id]);
        deletedItem = parseExam(rows[0]);
        return deletedItem;
      });

      // Synchronize JSON
      try {
        let data = readJson('exams');
        const item = data.find(e => e._id === id);
        data = data.filter(e => e._id !== id);
        writeJson('exams', data);
        deletedItem = deletedItem || item;
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return deletedItem;
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM exams`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE exams`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM exams${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      // Synchronize JSON
      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('exams').length;
          writeJson('exams', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('exams');
          const prevLen = data.length;
          data = data.filter(e => {
            const matchesAll = Object.keys(query).every(key => String(e[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('exams', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    },
    countDocuments: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT COUNT(*) as count FROM exams${clause}`, values);
        return rows[0].count;
      });
      if (mysqlRes !== null) return mysqlRes;
      let data = readJson('exams');
      const keys = Object.keys(query).filter(k => query[k] !== undefined && query[k] !== null);
      if (keys.length > 0) {
        data = data.filter(e => keys.every(k => String(e[k]) === String(query[k])));
      }
      return data.length;
    }
  },

  SeatingPlan: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM seating_plans${clause}`, values);
        return rows.map(parseSeatingPlan);
      });
      if (mysqlRes !== null) return mysqlRes;
      let data = readJson('seating_plans');
      if (query.examId) data = data.filter(p => p.examId === query.examId);
      if (query.hallId) data = data.filter(p => p.hallId === query.hallId);
      return data;
    },
    findOne: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM seating_plans${clause} LIMIT 1`, values);
        return parseSeatingPlan(rows[0]);
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('seating_plans');
      return data.find(p => {
        for (let key in query) {
          if (p[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      const docs = Array.isArray(doc) ? doc : [doc];
      const createdItems = [];
      const mysqlRes = await safeMysqlQuery(async () => {
        for (const item of docs) {
          const _id = item._id || generateId();
          const generatedAt = item.generatedAt ? new Date(item.generatedAt) : new Date();
          const planItem = {
            _id,
            ...item,
            examName: item.examName || item.name || 'Exam',
            hallName: item.hallName || 'Hall',
            seatingGrid: item.seatingGrid || [],
            attendanceRoster: item.attendanceRoster || [],
            unseatedStudents: item.unseatedStudents || [],
            hallSnapshot: item.hallSnapshot || null,
            totalBenches: item.totalBenches || 0,
            totalStudents: item.totalStudents || 0,
            emptySeats: item.emptySeats || 0,
            generatedAt
          };
          await runQuery(`DELETE FROM seating_plans WHERE examId = ? AND hallId = ?`, [planItem.examId, planItem.hallId]);
          await runQuery(
            `INSERT INTO seating_plans (\`_id\`, \`examId\`, \`examName\`, \`hallId\`, \`hallName\`, \`seatingGrid\`, \`attendanceRoster\`, \`unseatedStudents\`, \`totalBenches\`, \`totalStudents\`, \`emptySeats\`, \`generatedAt\`, \`hallSnapshot\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              _id,
              planItem.examId,
              planItem.examName,
              planItem.hallId,
              planItem.hallName,
              JSON.stringify(planItem.seatingGrid),
              JSON.stringify(planItem.attendanceRoster),
              JSON.stringify(planItem.unseatedStudents),
              planItem.totalBenches,
              planItem.totalStudents,
              planItem.emptySeats,
              generatedAt,
              JSON.stringify(planItem.hallSnapshot || null)
            ]
          );
          createdItems.push(planItem);
        }
        return Array.isArray(doc) ? createdItems : createdItems[0];
      });

      // Synchronize JSON
      try {
        let data = readJson('seating_plans');
        for (const item of (createdItems.length > 0 ? createdItems : docs)) {
          data = data.filter(p => !(p.examId === item.examId && p.hallId === item.hallId));
          const planItem = item._id ? item : { ...item, _id: generateId(), generatedAt: new Date() };
          data.push(planItem);
          if (createdItems.length === 0) createdItems.push(planItem);
        }
        writeJson('seating_plans', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return Array.isArray(doc) ? createdItems : createdItems[0];
    },
    findByIdAndUpdate: async (id, update) => {
      let updatedItem = null;
      const mysqlRes = await safeMysqlQuery(async () => {
        const fields = [];
        const values = [];
        for (let key of Object.keys(update)) {
          if (key === '_id') continue;
          fields.push(`\`${key}\` = ?`);
          if (['seatingGrid', 'attendanceRoster', 'unseatedStudents', 'hallSnapshot'].includes(key)) {
            values.push(JSON.stringify(update[key]));
          } else {
            values.push(update[key]);
          }
        }
        values.push(id);
        await runQuery(`UPDATE seating_plans SET ${fields.join(', ')} WHERE _id = ?`, values);
        const rows = await runQuery(`SELECT * FROM seating_plans WHERE _id = ?`, [id]);
        return rows.length > 0 ? parseSeatingPlan(rows[0]) : null;
      });

      // Synchronize JSON
      try {
        const data = readJson('seating_plans');
        const idx = data.findIndex(p => p._id === id);
        if (idx !== -1) {
          data[idx] = { ...data[idx], ...update };
          writeJson('seating_plans', data);
          updatedItem = data[idx];
        }
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return updatedItem;
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM seating_plans`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE seating_plans`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM seating_plans${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      // Synchronize JSON
      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('seating_plans').length;
          writeJson('seating_plans', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('seating_plans');
          const prevLen = data.length;
          data = data.filter(p => {
            const matchesAll = Object.keys(query).every(key => String(p[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('seating_plans', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    }
  },

  UploadHistory: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        return await runQuery(`SELECT * FROM upload_histories${clause} ORDER BY uploadedAt DESC`, values);
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('upload_history');
      return data.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    },
    create: async (doc) => {
      const _id = doc._id || generateId();
      const uploadedAt = doc.uploadedAt ? new Date(doc.uploadedAt) : new Date();
      const item = { _id, ...doc, uploadedAt };
      const mysqlRes = await safeMysqlQuery(async () => {
        await runQuery(
          `INSERT INTO upload_histories (\`_id\`, \`filename\`, \`recordCount\`, \`status\`, \`errorMessage\`, \`uploadedAt\`) VALUES (?, ?, ?, ?, ?, ?)`,
          [_id, doc.filename, doc.recordCount || 0, doc.status, doc.errorMessage || '', uploadedAt]
        );
        return item;
      });

      // Synchronize JSON
      try {
        const data = readJson('upload_history');
        data.push(item);
        writeJson('upload_history', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return item;
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM upload_histories`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE upload_histories`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM upload_histories${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('upload_history').length;
          writeJson('upload_history', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('upload_history');
          const prevLen = data.length;
          data = data.filter(item => {
            const matchesAll = Object.keys(query).every(key => String(item[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('upload_history', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    }
  },

  User: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        return await runQuery(`SELECT * FROM users${clause}`, values);
      });
      if (mysqlRes !== null) return mysqlRes;
      let data = readJson('users');
      if (query.email) data = data.filter(u => u.email === query.email);
      if (query.username) data = data.filter(u => u.username === query.username);
      return data;
    },
    findOne: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM users${clause} LIMIT 1`, values);
        return rows[0] || null;
      });
      if (mysqlRes !== null) return mysqlRes;
      const data = readJson('users');
      return data.find(u => {
        for (let key in query) {
          if (u[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      const docs = Array.isArray(doc) ? doc : [doc];
      const createdItems = [];
      const mysqlRes = await safeMysqlQuery(async () => {
        for (const item of docs) {
          const _id = item._id || generateId();
          const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
          const userItem = { _id, ...item, createdAt };
          await runQuery(
            `INSERT INTO users (\`_id\`, \`username\`, \`email\`, \`password\`, \`createdAt\`) VALUES (?, ?, ?, ?, ?)`,
            [_id, userItem.username, userItem.email, userItem.password, createdAt]
          );
          createdItems.push(userItem);
        }
        return Array.isArray(doc) ? createdItems : createdItems[0];
      });

      // Synchronize JSON
      try {
        const data = readJson('users');
        if (createdItems.length > 0) {
          data.push(...createdItems);
        } else {
          for (const item of docs) {
            const _id = item._id || generateId();
            const createdAt = item.createdAt ? new Date(item.createdAt) : new Date();
            const userItem = { _id, ...item, createdAt };
            data.push(userItem);
            createdItems.push(userItem);
          }
        }
        writeJson('users', data);
      } catch (e) {}

      if (mysqlRes !== null) return mysqlRes;
      return Array.isArray(doc) ? createdItems : createdItems[0];
    },
    deleteMany: async (query = {}) => {
      let delCount = 0;
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          const rows = await runQuery(`SELECT COUNT(*) as count FROM users`);
          const count = rows && rows[0] ? rows[0].count : 0;
          await runQuery(`TRUNCATE TABLE users`);
          return { deletedCount: count };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM users${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) delCount = mysqlRes.deletedCount;

      try {
        if (Object.keys(query).length === 0) {
          const prevLen = readJson('users').length;
          writeJson('users', []);
          delCount = delCount || prevLen;
        } else {
          let data = readJson('users');
          const prevLen = data.length;
          data = data.filter(u => {
            const matchesAll = Object.keys(query).every(key => String(u[key]) === String(query[key]));
            return !matchesAll;
          });
          writeJson('users', data);
          delCount = delCount || (prevLen - data.length);
        }
      } catch (e) {}

      return mysqlRes !== null ? mysqlRes : { deletedCount: delCount };
    }
  }
};

module.exports = {
  dbStatus: () => ({
    connected: isMysqlConnected,
    mode: isMysqlConnected ? 'MySQL' : 'Local JSON'
  }),
  Models,
  initMysql
};
