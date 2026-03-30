'use client'

import { useState } from 'react'
import TaskPanel from './TaskPanel'
import CreateTaskModal from './CreateTaskModal'

export default function TaskTracker({ session, onBack }) {
  var [modalOpen,   setModalOpen]   = useState(false)
  var [refreshKey,  setRefreshKey]  = useState(0)

  function handleCreated() {
    setRefreshKey(function(n) { return n + 1 })
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 28px 80px' }}>

      {/* ── Page header ── */}
      <div className="fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <button onClick={onBack}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-body)', padding: 0, transition: 'color var(--transition)' }}
              onMouseEnter={function(e) { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={function(e) { e.currentTarget.style.color = 'var(--text-tertiary)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M9 6H1M4 3L1 6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to Dashboard
            </button>
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>KPI Tracker</h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', marginTop: 4 }}>
            Monitor flagged segments over time · Dataset {session.datasetId}
          </p>
        </div>

        {/* Track new KPI button */}
        <button onClick={function() { setModalOpen(true) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-accent)', cursor: 'pointer', fontFamily: 'var(--font-display)', transition: 'all var(--transition)', boxShadow: '0 0 16px rgba(0,200,240,0.06)' }}
          onMouseEnter={function(e) { e.currentTarget.style.boxShadow = '0 0 24px rgba(0,200,240,0.12)' }}
          onMouseLeave={function(e) { e.currentTarget.style.boxShadow = '0 0 16px rgba(0,200,240,0.06)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Track New KPI
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'linear-gradient(90deg, var(--accent), rgba(43,127,227,0.3), transparent)', opacity: 0.3, marginBottom: 24 }} />

      {/* ── Task list — always expanded, no collapse ── */}
      <TaskPanel
        key={refreshKey}
        session={session}
        alwaysOpen={true}
      />

      {/* ── Create task modal ── */}
      <CreateTaskModal
        isOpen={modalOpen}
        onClose={function() { setModalOpen(false) }}
        onCreated={handleCreated}
        prefill={null}
        session={session}
      />
    </div>
  )
}
