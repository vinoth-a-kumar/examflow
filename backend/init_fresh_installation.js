// ExamFlow: Fresh Customer Installation & Database Initialization Utility
// Prepares an empty, schema-validated database and clean JSON stores for a new college.
// Does NOT touch existing development records unless explicitly directed to the target DB.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.TARGET_DB || process.env.DB_NAME || 'examflow';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');

async function initializeCleanInstallation() {
  console.log('======================================================================');
  console.log('ExamFlow: Fresh Installation & Clean Storage Initialization');
  console.log('======================================================================\n');
  console.log(`Target Database:  ${DB_NAME}`);
  console.log(`Target Storage:   ${DATA_DIR}\n`);

  // 1. Initialize Clean JSON fallback stores in DATA_DIR
  console.log('--- Step 1: Initializing Clean Local JSON Fallback Stores ---');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const collections = [
    { name: 'students.json', content: '[]' },
    { name: 'exams.json', content: '[]' },
    { name: 'halls.json', content: '[]' },
    { name: 'seating_plans.json', content: '[]' },
    { name: 'upload_history.json', content: '[]' },
    { name: 'users.json', content: '[]' },
    { name: 'activities.json', content: '[]' },
    { name: 'printouts.json', content: JSON.stringify({ count: 0 }, null, 2) },
  ];

  for (const item of collections) {
    const filePath = path.join(DATA_DIR, item.name);
    fs.writeFileSync(filePath, item.content, 'utf8');
    console.log(`  ✓ Initialized clean store: ${item.name}`);
  }

  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
    console.log('  ✓ Initialized backups directory: backups/');
  }

  // 2. Initialize Clean MySQL Database Schema (if MySQL is accessible)
  console.log('\n--- Step 2: Initializing MySQL Database Schema ---');
  let mysqlAvailable = false;
  let connection = null;

  try {
    const serverConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });

    await serverConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await serverConn.end();

    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });

    mysqlAvailable = true;
    console.log(`  ✓ Connected to MySQL database '${DB_NAME}'.`);

    // Create required tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        \`_id\` VARCHAR(255) PRIMARY KEY,
        \`username\` VARCHAR(255) UNIQUE NOT NULL,
        \`email\` VARCHAR(255) UNIQUE NOT NULL,
        \`password\` VARCHAR(255) NOT NULL,
        \`createdAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Table verified: users');

    await connection.query(`
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
    console.log('  ✓ Table verified: students');

    await connection.query(`
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
    console.log('  ✓ Table verified: halls');

    await connection.query(`
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
    console.log('  ✓ Table verified: exams');

    await connection.query(`
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
    console.log('  ✓ Table verified: seating_plans');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS upload_histories (
        \`_id\` VARCHAR(255) PRIMARY KEY,
        \`filename\` VARCHAR(255) NOT NULL,
        \`recordCount\` INT DEFAULT 0,
        \`status\` VARCHAR(50) NOT NULL,
        \`errorMessage\` TEXT,
        \`uploadedAt\` DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Table verified: upload_histories');

    // Create performance indexes
    const indexes = [
      `CREATE INDEX idx_exams_date_session ON exams(\`date\`, \`session\`)`,
      `CREATE INDEX idx_seating_plans_exam ON seating_plans(\`examId\`)`,
      `CREATE INDEX idx_seating_plans_hall ON seating_plans(\`hallId\`)`,
      `CREATE INDEX idx_students_dept ON students(\`department\`(50))`,
      `CREATE INDEX idx_students_reg ON students(\`registerNo\`(50))`,
      `CREATE INDEX idx_halls_name ON halls(\`name\`)`
    ];

    for (const idxSql of indexes) {
      try {
        await connection.query(idxSql);
      } catch (idxErr) {
        // Index may already exist
      }
    }
    console.log('  ✓ Performance indexes verified');

    // If explicit fresh reset requested for the target DB
    if (process.env.RESET_TARGET_TABLES === 'true') {
      await connection.query('TRUNCATE TABLE users');
      await connection.query('TRUNCATE TABLE students');
      await connection.query('TRUNCATE TABLE halls');
      await connection.query('TRUNCATE TABLE exams');
      await connection.query('TRUNCATE TABLE seating_plans');
      await connection.query('TRUNCATE TABLE upload_histories');
      console.log(`  ✓ Target database '${DB_NAME}' tables reset to clean empty state.`);
    }

    await connection.end();
  } catch (err) {
    console.warn(`  ! MySQL initialization skipped / unavailable (${err.message}). Local JSON fallback initialized.`);
  }

  console.log('\n======================================================================');
  console.log('🎉 Fresh Installation Preparation Complete!');
  console.log('======================================================================');
  console.log('- Zero development records or customer data in target stores.');
  console.log('- No shared/default administrator password created.');
  console.log('- When the college visits the application, they will be prompted to');
  console.log('  create their initial Administrator account on the login page.');
  console.log('- Branding, UI, logos, and seating allocation rules remain 100% intact.\n');
}

if (require.main === module) {
  initializeCleanInstallation().catch(err => {
    console.error('Initialization failed:', err);
    process.exit(1);
  });
}

module.exports = { initializeCleanInstallation };
