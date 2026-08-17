const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'examflow';

let isMysqlConnected = false;
let pool = null;

// JSON fallback DB setup
const JSON_DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(JSON_DB_DIR)) {
  fs.mkdirSync(JSON_DB_DIR, { recursive: true });
}

const getJsonPath = (collectionName) => path.join(JSON_DB_DIR, `${collectionName}.json`);

const readJson = (collectionName) => {
  const filePath = getJsonPath(collectionName);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]));
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error(`Error reading JSON file ${collectionName}:`, error);
    return [];
  }
};

const writeJson = (collectionName, data) => {
  const filePath = getJsonPath(collectionName);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing JSON file ${collectionName}:`, error);
    return false;
  }
};

const generateId = () => {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
};



// Initialise connection
async function initMysql() {
  try {
    // 1. Try to connect to MySQL server without database first to ensure database exists
    const tempConnection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });
    
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await tempConnection.end();

    // 2. Create the connection pool with the database specified
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test connection
    const conn = await pool.getConnection();
    conn.release();

    console.log('Successfully connected to MySQL.');
    isMysqlConnected = true;

    // Create tables if they do not exist
    await createTables();
  } catch (err) {
    console.warn('MySQL connection failed. Falling back to Local JSON database.');
    console.warn('Error detail:', err.message);
    isMysqlConnected = false;
  }
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
      \`rows\` INT NOT NULL,
      \`columns\` INT NOT NULL,
      \`capacity\` INT NOT NULL,
      \`benches\` INT NOT NULL,
      \`csvData\` LONGTEXT,
      \`idx\` INT AUTO_INCREMENT UNIQUE
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
      \`seatsPerBench\` INT DEFAULT 2
    )
  `);

  // Migration: add subjectCodes column if missing
  try {
    await pool.query(`ALTER TABLE exams ADD COLUMN \`subjectCodes\` TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Migration: add seatsPerBench column if missing
  try {
    await pool.query(`ALTER TABLE exams ADD COLUMN \`seatsPerBench\` INT DEFAULT 2`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Migration: add time column if missing to exams
  try {
    await pool.query(`ALTER TABLE exams ADD COLUMN \`time\` VARCHAR(255) DEFAULT ''`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Migration: add idx column if missing to halls
  try {
    await pool.query(`ALTER TABLE halls ADD COLUMN \`idx\` INT AUTO_INCREMENT UNIQUE`);
  } catch (err) {
    // Ignore error if column already exists
  }

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
      \`generatedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate existing databases
  try {
    await pool.query(`ALTER TABLE seating_plans ADD COLUMN \`unseatedStudents\` LONGTEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  try {
    await pool.query(`ALTER TABLE students ADD COLUMN \`csvData\` LONGTEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  try {
    await pool.query(`ALTER TABLE students ADD COLUMN \`idx\` INT AUTO_INCREMENT UNIQUE`);
  } catch (err) {
    // Ignore error if column already exists
  }

  try {
    await pool.query(`ALTER TABLE halls ADD COLUMN \`csvData\` LONGTEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Widen columns that may overflow on large Excel imports
  try {
    await pool.query(`ALTER TABLE students MODIFY COLUMN \`name\` TEXT NOT NULL`);
  } catch (err) {
    // Ignore
  }
  try {
    await pool.query(`ALTER TABLE students MODIFY COLUMN \`department\` TEXT NOT NULL`);
  } catch (err) {
    // Ignore
  }

  // upload_history
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
    console.error('Error auto-migrating departments in MySQL:', err);
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

async function safeMysqlQuery(fn) {
  if (!isMysqlConnected || !pool) return null;
  try {
    return await fn();
  } catch (err) {
    const isNetworkOrDbError = (err.code && (
      err.code.startsWith('ER_') ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'PROTOCOL_CONNECTION_LOST' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'EHOSTUNREACH'
    )) || (err.message && (err.message.includes('MySQL is not connected') || err.message.includes('pool')));

    if (isNetworkOrDbError) {
      console.warn(`[Database Fallback] Genuine MySQL database error (${err.message}). Falling back to Local JSON storage.`);
      isMysqlConnected = false;
      return null;
    } else {
      console.error(`[Application Error in MySQL operation]`, err);
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
          csvData: r.csvData ? JSON.parse(r.csvData) : null
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
            csvData: rows[0].csvData ? JSON.parse(rows[0].csvData) : null
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
      const mysqlRes = await safeMysqlQuery(async () => {
        const docs = Array.isArray(doc) ? doc : [doc];
        const added = [];
        for (let item of docs) {
          await runQuery(`DELETE FROM students WHERE registerNo = ?`, [item.registerNo]);
          const _id = generateId();
          await runQuery(
            `INSERT INTO students (\`_id\`, \`registerNo\`, \`name\`, \`department\`, \`batch\`, \`csvData\`) VALUES (?, ?, ?, ?, ?, ?)`,
            [_id, item.registerNo, item.name, item.department, item.batch || '2024-25', JSON.stringify(item.csvData || null)]
          );
          added.push({ _id, ...item, batch: item.batch || '2024-25' });
        }
        return Array.isArray(doc) ? added : added[0];
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      const docs = Array.isArray(doc) ? doc : [doc];
      let data = readJson('students');
      const added = [];
      for (let item of docs) {
        data = data.filter(s => s.registerNo !== item.registerNo);
        const newItem = { _id: generateId(), ...item };
        data.push(newItem);
        added.push(newItem);
      }
      writeJson('students', data);
      return Array.isArray(doc) ? added : added[0];
    },
    deleteMany: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          await runQuery(`TRUNCATE TABLE students`);
          return { deletedCount: 0 };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM students${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      if (Object.keys(query).length === 0) {
        writeJson('students', []);
        return { deletedCount: 0 };
      }
      let data = readJson('students');
      const prevLen = data.length;
      data = data.filter(s => {
        for (let key in query) {
          if (s[key] === query[key]) return false;
        }
        return true;
      });
      writeJson('students', data);
      return { deletedCount: prevLen - data.length };
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
      if (query.department) data = data.filter(s => s.department === query.department);
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
            csvData: rows[0].csvData ? JSON.parse(rows[0].csvData) : null
          };
        }
        return null;
      });
      if (mysqlRes !== null) return mysqlRes;

      // Fallback
      let data = readJson('students');
      const idx = data.findIndex(s => s._id === id);
      if (idx !== -1) {
        data[idx] = { ...data[idx], ...update };
        writeJson('students', data);
        return data[idx];
      }
      return null;
    }
  },

  Hall: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT * FROM halls${clause} ORDER BY idx ASC`, values);
        return rows.map(r => {
          let cRows = [];
          if (r.columnRows) {
            try { cRows = typeof r.columnRows === 'string' ? JSON.parse(r.columnRows) : r.columnRows; } catch(e){}
          }
          let cData = r.csvData ? (typeof r.csvData === 'string' ? JSON.parse(r.csvData) : r.csvData) : null;
          if ((!cRows || cRows.length === 0) && cData && cData.columnRows) {
            cRows = cData.columnRows;
          }
          return {
            ...r,
            columnRows: cRows,
            csvData: cData
          };
        });
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      return readJson('halls');
    },
    findById: async (id) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM halls WHERE \`_id\` = ? OR \`name\` = ? LIMIT 1`, [id, id]);
        if (!rows || rows.length === 0) return null;
        const h = rows[0];
        if (h && h.csvData && typeof h.csvData === 'string') {
          try { h.csvData = JSON.parse(h.csvData); } catch (e) {}
        }
        if (h && h.columnRows && typeof h.columnRows === 'string') {
          try { h.columnRows = JSON.parse(h.columnRows); } catch (e) {}
        }
        if (h && (!h.columnRows || h.columnRows.length === 0) && h.csvData && h.csvData.columnRows) {
          h.columnRows = h.csvData.columnRows;
        }
        return h;
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('halls');
      return data.find(h => h._id === id || h.name === id) || null;
    },
    create: async (doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        await runQuery(`DELETE FROM halls WHERE name = ?`, [doc.name]);
        const _id = generateId();
        await runQuery(
          `INSERT INTO halls (\`_id\`, \`name\`, \`rows\`, \`columns\`, \`capacity\`, \`benches\`, \`columnRows\`, \`csvData\`, \`idx\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [_id, doc.name, doc.rows, doc.columns, doc.capacity, doc.benches, JSON.stringify(doc.columnRows || []), JSON.stringify(doc.csvData || null)]
        );
        return { _id, ...doc };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      let data = readJson('halls');
      data = data.filter(h => h.name !== doc.name);
      const newItem = { _id: generateId(), ...doc };
      data.push(newItem);
      writeJson('halls', data);
      return newItem;
    },
    findByIdAndUpdate: async (id, doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        try {
          await runQuery(`ALTER TABLE halls ADD COLUMN \`columnRows\` LONGTEXT`);
        } catch (e) {}
        await runQuery(
          `UPDATE halls SET \`name\` = ?, \`rows\` = ?, \`columns\` = ?, \`capacity\` = ?, \`benches\` = ?, \`columnRows\` = ?, \`csvData\` = ? WHERE \`_id\` = ? OR \`name\` = ?`,
          [doc.name, doc.rows, doc.columns, doc.capacity, doc.benches, JSON.stringify(doc.columnRows || []), JSON.stringify(doc.csvData || null), id, id]
        );
        return { _id: id, ...doc };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('halls');
      const idx = data.findIndex(h => h._id === id || h.name === id);
      if (idx !== -1) {
        data[idx] = { ...data[idx], ...doc };
        writeJson('halls', data);
        return data[idx];
      }
      return null;
    },
    findByIdAndDelete: async (id) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM halls WHERE \`_id\` = ? LIMIT 1`, [id]);
        if (rows.length === 0) return null;
        await runQuery(`DELETE FROM halls WHERE \`_id\` = ?`, [id]);
        return rows[0];
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      let data = readJson('halls');
      const item = data.find(h => h._id === id);
      data = data.filter(h => h._id !== id);
      writeJson('halls', data);
      return item || null;
    },
    deleteMany: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        if (Object.keys(query).length === 0) {
          await runQuery(`TRUNCATE TABLE halls`);
          return { deletedCount: 0 };
        }
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM halls${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      if (Object.keys(query).length === 0) {
        writeJson('halls', []);
        return { deletedCount: 0 };
      }
      let data = readJson('halls');
      const prevLen = data.length;
      data = data.filter(h => {
        for (let key in query) {
          if (h[key] === query[key]) return false;
        }
        return true;
      });
      writeJson('halls', data);
      return { deletedCount: prevLen - data.length };
    },
    countDocuments: async () => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT COUNT(*) as count FROM halls`);
        return rows[0].count;
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      return readJson('halls').length;
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
      // Fallback
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
      // Fallback
      const data = readJson('exams');
      return data.find(e => e._id === id) || null;
    },
    create: async (doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const _id = generateId();
        await runQuery(
          `INSERT INTO exams (\`_id\`, \`name\`, \`departments\`, \`subjectCodes\`, \`date\`, \`session\`, \`studentsCount\`, \`status\`, \`assignedHalls\`, \`seatsPerBench\`, \`time\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            _id,
            doc.name,
            JSON.stringify(doc.departments || []),
            JSON.stringify(doc.subjectCodes || []),
            doc.date,
            doc.session,
            doc.studentsCount || 0,
            doc.status || 'Draft',
            JSON.stringify(doc.assignedHalls || []),
            doc.seatsPerBench || 2,
            doc.time || ''
          ]
        );
        return { _id, ...doc, departments: doc.departments || [], subjectCodes: doc.subjectCodes || [], assignedHalls: doc.assignedHalls || [], seatsPerBench: doc.seatsPerBench || 2, time: doc.time || '' };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('exams');
      const newItem = { _id: generateId(), ...doc };
      data.push(newItem);
      writeJson('exams', data);
      return newItem;
    },
    findByIdAndUpdate: async (id, doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        await runQuery(
          `UPDATE exams SET \`name\` = ?, \`departments\` = ?, \`subjectCodes\` = ?, \`date\` = ?, \`session\` = ?, \`studentsCount\` = ?, \`assignedHalls\` = ?, \`seatsPerBench\` = ?, \`time\` = ? WHERE \`_id\` = ?`,
          [
            doc.name,
            JSON.stringify(doc.departments || []),
            JSON.stringify(doc.subjectCodes || []),
            doc.date,
            doc.session,
            doc.studentsCount || 0,
            JSON.stringify(doc.assignedHalls || []),
            doc.seatsPerBench || 2,
            doc.time || '',
            id
          ]
        );
        return { _id: id, ...doc };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('exams');
      const idx = data.findIndex(e => e._id === id);
      if (idx !== -1) {
        data[idx] = { ...data[idx], ...doc };
        writeJson('exams', data);
        return data[idx];
      }
      return null;
    },
    findByIdAndDelete: async (id) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const rows = await runQuery(`SELECT * FROM exams WHERE \`_id\` = ? LIMIT 1`, [id]);
        if (rows.length === 0) return null;
        await runQuery(`DELETE FROM exams WHERE \`_id\` = ?`, [id]);
        return parseExam(rows[0]);
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      let data = readJson('exams');
      const item = data.find(e => e._id === id);
      data = data.filter(e => e._id !== id);
      writeJson('exams', data);
      return item || null;
    },
    countDocuments: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const rows = await runQuery(`SELECT COUNT(*) as count FROM exams${clause}`, values);
        return rows[0].count;
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      let data = readJson('exams');
      if (query.status) data = data.filter(e => e.status === query.status);
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
      // Fallback
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
      // Fallback
      const data = readJson('seating_plans');
      return data.find(p => {
        for (let key in query) {
          if (p[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        await runQuery(`DELETE FROM seating_plans WHERE examId = ? AND hallId = ?`, [doc.examId, doc.hallId]);
        const _id = generateId();
        const generatedAt = new Date();
        await runQuery(
          `INSERT INTO seating_plans (\`_id\`, \`examId\`, \`examName\`, \`hallId\`, \`hallName\`, \`seatingGrid\`, \`attendanceRoster\`, \`unseatedStudents\`, \`totalBenches\`, \`totalStudents\`, \`emptySeats\`, \`generatedAt\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            _id,
            doc.examId,
            doc.examName || doc.name || 'Exam',
            doc.hallId,
            doc.hallName || 'Hall',
            JSON.stringify(doc.seatingGrid || []),
            JSON.stringify(doc.attendanceRoster || []),
            JSON.stringify(doc.unseatedStudents || []),
            doc.totalBenches || 0,
            doc.totalStudents || 0,
            doc.emptySeats || 0,
            generatedAt
          ]
        );
        return { _id, ...doc, generatedAt };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('seating_plans');
      const filteredData = data.filter(p => !(p.examId === doc.examId && p.hallId === doc.hallId));
      const newItem = { _id: generateId(), ...doc, generatedAt: new Date() };
      filteredData.push(newItem);
      writeJson('seating_plans', filteredData);
      return newItem;
    },
    deleteMany: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM seating_plans${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      if (Object.keys(query).length === 0) {
        writeJson('seating_plans', []);
        return { deletedCount: 0 };
      }
      let data = readJson('seating_plans');
      const prevLen = data.length;
      data = data.filter(p => {
        for (let key in query) {
          if (p[key] === query[key]) return false;
        }
        return true;
      });
      writeJson('seating_plans', data);
      return { deletedCount: prevLen - data.length };
    }
  },

  UploadHistory: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        return await runQuery(`SELECT * FROM upload_histories${clause} ORDER BY uploadedAt DESC`, values);
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('upload_history');
      return data.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    },
    create: async (doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const _id = generateId();
        const uploadedAt = new Date();
        await runQuery(
          `INSERT INTO upload_histories (\`_id\`, \`filename\`, \`recordCount\`, \`status\`, \`errorMessage\`, \`uploadedAt\`) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            _id,
            doc.filename,
            doc.recordCount || 0,
            doc.status,
            doc.errorMessage || '',
            uploadedAt
          ]
        );
        return { _id, ...doc, uploadedAt };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('upload_history');
      const newItem = { _id: generateId(), ...doc, uploadedAt: new Date() };
      data.push(newItem);
      writeJson('upload_history', data);
      return newItem;
    },
    deleteMany: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM upload_histories${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      if (Object.keys(query).length === 0) {
        writeJson('upload_history', []);
        return { deletedCount: 0 };
      }
      return { deletedCount: 0 };
    }
  },

  User: {
    find: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        return await runQuery(`SELECT * FROM users${clause}`, values);
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
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
      // Fallback
      const data = readJson('users');
      return data.find(u => {
        for (let key in query) {
          if (u[key] !== query[key]) return false;
        }
        return true;
      }) || null;
    },
    create: async (doc) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const _id = generateId();
        const createdAt = new Date();
        await runQuery(
          `INSERT INTO users (\`_id\`, \`username\`, \`email\`, \`password\`, \`createdAt\`) VALUES (?, ?, ?, ?, ?)`,
          [_id, doc.username, doc.email, doc.password, createdAt]
        );
        return { _id, ...doc, createdAt };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      const data = readJson('users');
      const newItem = { _id: generateId(), ...doc, createdAt: new Date() };
      data.push(newItem);
      writeJson('users', data);
      return newItem;
    },
    deleteMany: async (query = {}) => {
      const mysqlRes = await safeMysqlQuery(async () => {
        const { clause, values } = buildWhere(query);
        const res = await runQuery(`DELETE FROM users${clause}`, values);
        return { deletedCount: res.affectedRows };
      });
      if (mysqlRes !== null) return mysqlRes;
      // Fallback
      if (Object.keys(query).length === 0) {
        writeJson('users', []);
        return { deletedCount: 0 };
      }
      return { deletedCount: 0 };
    }
  }
};

module.exports = {
  dbStatus: () => ({
    connected: isMysqlConnected,
    mode: isMysqlConnected ? 'MySQL' : 'Local JSON'
  }),
  Models
};
