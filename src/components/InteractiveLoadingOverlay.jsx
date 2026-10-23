import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, X, Sparkles } from 'lucide-react';

/**
 * InteractiveLoadingOverlay
 * A modern, interactive glassmorphic loading overlay with animated progress,
 * glowing spinners, step checklist, and seamless completion feedback.
 */
export default function InteractiveLoadingOverlay({
  isOpen,
  title = "Processing Data",
  subtitle = "Please wait while the system processes your request...",
  steps = [],
  activeStep = null, // if provided, manually controlled step index
  progress = null,   // if provided, manually controlled 0-100 percentage
  isSuccess = false,
  successMessage = "Process completed successfully!",
  errorMessage = null,
  onDismissError = null,
  icon: CustomIcon = null
}) {
  const [internalStep, setInternalStep] = useState(0);
  const [internalProgress, setInternalProgress] = useState(15);

  const defaultSteps = [
    "Reading & parsing data payload...",
    "Validating constraints & relationships...",
    "Synchronizing with database & calculating layouts...",
    "Finalizing records & rendering view..."
  ];

  const actualSteps = steps && steps.length > 0 ? steps : defaultSteps;

  // Auto-progress simulation while request is in flight
  useEffect(() => {
    if (!isOpen) {
      setInternalStep(0);
      setInternalProgress(15);
      return;
    }

    if (errorMessage) {
      return;
    }

    if (isSuccess) {
      setInternalStep(actualSteps.length - 1);
      setInternalProgress(100);
      return;
    }

    // Auto advance step and progress smoothly
    const interval = setInterval(() => {
      setInternalProgress(prev => {
        if (prev < 40) return prev + 12;
        if (prev < 70) return prev + 8;
        if (prev < 90) return prev + 4;
        if (prev < 96) return prev + 1;
        return prev;
      });

      setInternalStep(prev => {
        if (prev < actualSteps.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 650);

    return () => clearInterval(interval);
  }, [isOpen, isSuccess, errorMessage, actualSteps.length]);

  if (!isOpen) return null;

  const currentStep = activeStep !== null ? activeStep : internalStep;
  const currentProgress = isSuccess ? 100 : (progress !== null ? progress : internalProgress);

  return (
    <div className="interactive-loading-overlay" role="dialog" aria-modal="true">
      <div className="interactive-loading-card">
        {/* Glow backdrop ring & circular spinner */}
        <div className="interactive-spinner-wrapper">
          <div className="interactive-glow-ring" />
          {errorMessage ? (
            <div style={{
              width: '78px',
              height: '78px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '2px solid rgba(239, 68, 68, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444'
            }}>
              <AlertCircle size={38} />
            </div>
          ) : isSuccess ? (
            <div style={{
              width: '78px',
              height: '78px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '2px solid rgba(16, 185, 129, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981'
            }}>
              <CheckCircle2 size={38} />
            </div>
          ) : (
            <>
              <div className="interactive-spinner-circle" />
              <div className="interactive-spinner-icon">
                {CustomIcon ? <CustomIcon size={30} /> : <Sparkles size={28} />}
              </div>
            </>
          )}
        </div>

        {/* Title & Subtitle */}
        <h3 style={{
          fontSize: '20px',
          fontWeight: 700,
          color: '#ffffff',
          marginBottom: '8px',
          letterSpacing: '-0.3px',
          fontFamily: 'var(--font-display, inherit)'
        }}>
          {errorMessage ? "Operation Failed" : isSuccess ? (successMessage || "Completed!") : title}
        </h3>

        <p style={{
          fontSize: '13.5px',
          color: errorMessage ? '#fca5a5' : 'rgba(203, 213, 225, 0.85)',
          lineHeight: '1.5',
          maxWidth: '420px',
          marginBottom: '6px'
        }}>
          {errorMessage ? errorMessage : isSuccess ? "View is refreshing with latest records..." : subtitle}
        </p>

        {/* Error Dismiss Button */}
        {errorMessage && onDismissError && (
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={onDismissError}
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 600,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                cursor: 'pointer'
              }}
            >
              <X size={15} /> Dismiss
            </button>
          </div>
        )}

        {/* Progress bar and step indicators (hidden if error) */}
        {!errorMessage && (
          <>
            <div className="interactive-progress-track">
              <div 
                className="interactive-progress-fill" 
                style={{ 
                  width: `${currentProgress}%`,
                  background: isSuccess 
                    ? 'linear-gradient(90deg, #10b981, #059669)' 
                    : undefined
                }} 
              />
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
              fontSize: '11.5px',
              color: 'rgba(148, 163, 184, 0.75)',
              fontWeight: 600,
              marginBottom: '14px'
            }}>
              <span>{isSuccess ? "100% Complete" : `Progress: ${Math.min(99, Math.round(currentProgress))}%`}</span>
              <span>{isSuccess ? "Synced" : "Live Processing"}</span>
            </div>

            {/* Steps Checklist */}
            <div className="interactive-steps-container">
              {actualSteps.map((stepText, idx) => {
                const isStepCompleted = isSuccess || idx < currentStep;
                const isStepActive = !isSuccess && idx === currentStep;

                let rowClass = "interactive-step-row";
                if (isStepCompleted) rowClass += " completed";
                else if (isStepActive) rowClass += " active";
                else rowClass += " pending";

                return (
                  <div key={idx} className={rowClass}>
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      {isStepCompleted ? (
                        <CheckCircle2 size={16} color="#10b981" />
                      ) : isStepActive ? (
                        <Loader2 size={16} className="btn-spinner" color="#818cf8" />
                      ) : (
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          border: '1.5px solid rgba(148, 163, 184, 0.4)'
                        }} />
                      )}
                    </div>
                    <span style={{ flex: 1 }}>{stepText}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
