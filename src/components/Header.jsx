import React, { useState } from 'react';
import { HelpCircle, X, Info, Menu } from 'lucide-react';

function Header({ collegeDetails, isMobileSidebarOpen, onToggleMobileSidebar }) {
  const [isOpen, setIsOpen] = useState(false);

  const academicYear = collegeDetails?.academicYear || '2026-27';
  const rawName = collegeDetails?.name || "Rajapalayam Rajus' College";
  const collegeName = (rawName.includes('Rajapalym') || rawName.includes('Rajapalaym'))
    ? "Rajapalayam Rajus' College"
    : rawName;
  const collegeLogo = collegeDetails?.logo || '';

  return (
    <>
      <header className="header">
        <div className="header-mobile-brand">
          <button 
            className="mobile-hamburger-btn"
            onClick={onToggleMobileSidebar}
            aria-label="Toggle Navigation Menu"
            title="Toggle Menu"
          >
            {isMobileSidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          
          <div className="mobile-brand-title">
            {collegeLogo ? (
              <img 
                src={collegeLogo.startsWith('data:') ? collegeLogo : process.env.PUBLIC_URL + collegeLogo} 
                alt="Logo" 
                className="mobile-brand-logo"
              />
            ) : (
              <div className="mobile-brand-initial">{collegeName.charAt(0)}</div>
            )}
            <span className="mobile-brand-name">{collegeName}</span>
          </div>
        </div>

        <div className="header-actions">
          <span className="header-year">Academic Year {academicYear}</span>
          
          <button 
            className="header-btn" 
            title="About ExamFlow"
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
            maxWidth: '480px',
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
              }}>About ExamFlow</h3>
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
            <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(79,70,229,0.12), rgba(139,92,246,0.08))',
                  border: '1px solid rgba(79,70,229,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-primary)',
                  flexShrink: 0
                }}>
                  <Info size={22} />
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
                    ExamFlow
                  </h4>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px 0', fontWeight: 500 }}>
                    A Smart Solution for Examination Planning
                  </p>

                  <div style={{
                    fontSize: '12.5px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    background: 'var(--bg-app)',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    marginBottom: '14px'
                  }}>
                    <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '4px', fontSize: '12px' }}>
                      Application Overview:
                    </strong>
                    ExamFlow is designed to simplify examination planning, hall management, student allocation, and seating arrangement workflows.
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--bg-app)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '12.5px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Application:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>ExamFlow</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--bg-app)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '12.5px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Developer:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Vinothkumar</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--bg-app)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '12.5px'
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Version:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>v1.2.0</span>
                    </div>
                  </div>

                  <div style={{
                    marginTop: '14px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    fontWeight: 500
                  }}>
                    © 2026 Vinothkumar. All rights reserved.
                  </div>
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
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Header;
