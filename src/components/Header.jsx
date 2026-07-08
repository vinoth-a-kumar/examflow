import React, { useState } from 'react';
import { HelpCircle, X, Info } from 'lucide-react';

function Header({ collegeDetails }) {
  const [isOpen, setIsOpen] = useState(false);

  const academicYear = collegeDetails?.academicYear || '2026-27';

  return (
    <>
      <header className="header" style={{ justifyContent: 'flex-end' }}>
        <div className="header-actions">
          <span className="header-year">Academic Year {academicYear}</span>
          
          <button 
            className="header-btn" 
            title="Help Support"
            onClick={() => setIsOpen(true)}
          >
            <HelpCircle size={20} />
          </button>
        </div>
      </header>

      {isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            maxWidth: '500px',
            width: '100%',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'fadeIn 0.2s ease'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <h3 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '18px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0
              }}>Help & Support</h3>
              <button 
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '400px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <Info size={20} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Seating Rules Guide</h4>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Students are seated in columns (behind each other) by department. The system fills assigned halls sequentially based on the order in which they were selected.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'flex-end',
              backgroundColor: 'var(--bg-app)'
            }}>
              <button 
                className="btn-primary" 
                onClick={() => setIsOpen(false)}
                style={{ padding: '6px 16px', fontSize: '13px' }}
              >
                Close Help
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Header;
