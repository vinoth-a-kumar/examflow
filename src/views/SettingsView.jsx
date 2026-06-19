import React, { useState } from 'react';
import { Sparkles, Trash2, Database, ShieldAlert, CheckCircle2 } from 'lucide-react';

function SettingsView({ dbStatus, onClearAll, refreshData }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');

  const handleGenerateTestData = async () => {
    setIsGenerating(true);
    setGenerateMsg('Generating test data...');

    try {
      // 1. Create Halls
      setGenerateMsg('Creating default halls...');
      const hallsData = [
        { name: 'Hall A', rows: 8, columns: 5 },
        { name: 'Hall B', rows: 10, columns: 5 },
        { name: 'Hall C', rows: 6, columns: 5 },
        { name: 'Main Auditorium', rows: 15, columns: 10 }
      ];

      for (let hall of hallsData) {
        await fetch('http://localhost:5000/api/halls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hall)
        });
      }

      // 2. Upload Student Data
      setGenerateMsg('Importing sample student rosters (CSE, IT, ECE)...');
      let csvLines = ["Register No,Name,Department"];
      
      // Generate 60 CSE students
      for (let i = 1; i <= 60; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Smith', 'Patel', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez'];
        const firstNames = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Elizabeth', 'William', 'Linda'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024CSE${idStr},${randomName},CSE`);
      }

      // Generate 50 IT students
      for (let i = 1; i <= 50; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Chen', 'Singh', 'Wang', 'Kim', 'Ali', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia'];
        const firstNames = ['David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024IT${idStr},${randomName},IT`);
      }

      // Generate 30 ECE students
      for (let i = 1; i <= 30; i++) {
        const idStr = String(i).padStart(3, '0');
        const names = ['Taylor', 'Thomas', 'White', 'Harris', 'Martin', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young'];
        const firstNames = ['Christopher', 'Nancy', 'Daniel', 'Lisa', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra'];
        const randomName = firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' + names[Math.floor(Math.random() * names.length)];
        csvLines.push(`2024ECE${idStr},${randomName},ECE`);
      }

      const csvText = csvLines.join('\n');
      
      const uploadResp = await fetch('http://localhost:5000/api/students/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, filename: 'sample_students_roster.csv' })
      });
      await uploadResp.json();

      // 3. Create Exams
      setGenerateMsg('Scheduling sample examinations...');
      const examsData = [
        {
          name: 'Data Structures',
          departments: ['CSE', 'IT'],
          date: '2026-06-25',
          session: 'FN',
          assignedHalls: ['Hall A', 'Hall B']
        },
        {
          name: 'Operating Systems',
          departments: ['CSE'],
          date: '2026-06-26',
          session: 'AN',
          assignedHalls: ['Hall A']
        },
        {
          name: 'Database Management',
          departments: ['IT', 'ECE'],
          date: '2026-06-28',
          session: 'FN',
          assignedHalls: ['Hall C', 'Main Auditorium']
        }
      ];

      for (let exam of examsData) {
        await fetch('http://localhost:5000/api/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(exam)
        });
      }

      setGenerateMsg('Data generated successfully!');
      alert('Default test data has been seeded successfully. You can now explore the Dashboard, Hall Management, Exam Management, and Seating Plan tabs!');
      refreshData();
    } catch (err) {
      console.error(err);
      setGenerateMsg('Error generating test data.');
      alert('Failed to generate test data.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-intro">
        <h2>Settings</h2>
        <p>Configure and manage system details, data backups, and environment status.</p>
      </div>

      <div className="sections-grid" style={{ gridTemplateColumns: '1fr' }}>
        
        {/* Connection status card */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Environment Status</h3>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '10px 0' }}>
            <Database size={32} style={{ color: dbStatus.connected ? 'var(--color-success)' : 'var(--text-muted)' }} />
            <div>
              <h4 style={{ fontWeight: 700, fontSize: '15px' }}>Database Connection Mode</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Current database adapter running mode: 
                <span className={`status-pill ${dbStatus.connected ? 'success' : 'warning'}`} style={{ marginLeft: '8px', fontWeight: 'bold' }}>
                  {dbStatus.mode} Mode
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Test Data Seeder card */}
        <div className="card-container">
          <div className="card-title-bar">
            <h3>Mock Data Engine</h3>
          </div>

          <div className="seed-box">
            <h4>Quick Data Seeder</h4>
            <p>
              Instantly populate your application with sample student records, exam schedules, and halls configuration. 
              This matches the layouts in the dashboard templates and allows you to test the seating arrangement generator immediately.
            </p>
            <div className="seed-buttons">
              <button 
                className="btn-primary" 
                onClick={handleGenerateTestData}
                disabled={isGenerating}
                style={{ gap: '6px' }}
              >
                <Sparkles size={16} />
                <span>{isGenerating ? "Seeding..." : "Seed Default Data"}</span>
              </button>
            </div>
            {generateMsg && (
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> {generateMsg}
              </span>
            )}
          </div>
        </div>

        {/* Danger Zone card */}
        <div className="card-container" style={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <div className="card-title-bar" style={{ borderColor: 'rgba(239, 68, 68, 0.1)' }}>
            <h3 style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={20} />
              <span>Danger Zone</span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 700 }}>Reset Entire Application</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Permanently delete all students database, configured halls, registered exams, and generated seating plans.
              </p>
            </div>
            
            <button 
              className="btn-danger" 
              onClick={onClearAll}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Trash2 size={14} />
              <span>Reset Database</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsView;
