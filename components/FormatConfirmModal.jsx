'use client'

import { useState } from 'react'

// Roles a column can be assigned to
var ROLES = [
  { value: 'value',      label: 'Value (numeric)' },
  { value: 'hierarchy',  label: 'Hierarchy level' },
  { value: 'dimension',  label: 'Dimension (filter)' },
  { value: 'time',       label: 'Time' },
  { value: 'ignore',     label: 'Ignore' },
]

export default function FormatConfirmModal({ datasetId, datasetName, allColumns, detectedFormat, onClose, onConfirm }) {

  // ── Build initial column → role mapping from heuristic ──────────────────
  function buildInitialAssignments() {
    var a = {}
    allColumns.forEach(function(c) { a[c] = 'ignore' })
    if (detectedFormat.valueColumn) a[detectedFormat.valueColumn] = 'value'
    ;(detectedFormat.hierarchyColumns || []).forEach(function(c) { a[c] = 'hierarchy' })
    ;(detectedFormat.dimensionColumns || []).forEach(function(c) { a[c] = 'dimension' })
    ;(detectedFormat.timeColumns      || []).forEach(function(c) { a[c] = 'time' })
    return a
  }

  var [format,      setFormat]      = useState(detectedFormat.format || 'long_hierarchical')
  var [assignments, setAssignments] = useState(buildInitialAssignments())
  var [hierOrder,   setHierOrder]   = useState(detectedFormat.hierarchyColumns || [])
  var [saving,      setSaving]      = useState(false)
  var [error,       setError]       = useState('')

  // ── Hierarchy column ordering helpers ───────────────────────────────────
  function moveHierUp(col) {
    var i = hierOrder.indexOf(col); if (i <= 0) return
    var next = hierOrder.slice()
    next[i - 1] = col; next[i] = hierOrder[i - 1]
    setHierOrder(next)
  }
  function moveHierDown(col) {
    var i = hierOrder.indexOf(col); if (i < 0 || i >= hierOrder.length - 1) return
    var next = hierOrder.slice()
    next[i + 1] = col; next[i] = hierOrder[i + 1]
    setHierOrder(next)
  }

  // ── Sync hierOrder when assignments change ──────────────────────────────
  function handleRoleChange(col, newRole) {
    var next = Object.assign({}, assignments); next[col] = newRole
    setAssignments(next)
    var newHier = Object.keys(next).filter(function(k) { return next[k] === 'hierarchy' })
    // Preserve previous order for cols that stayed; append new ones at end
    var ordered = hierOrder.filter(function(c) { return newHier.indexOf(c) !== -1 })
    newHier.forEach(function(c) { if (ordered.indexOf(c) === -1) ordered.push(c) })
    setHierOrder(ordered)
  }

  // ── Validation ──────────────────────────────────────────────────────────
  function validate() {
    if (format === 'wide') return null  // wide format needs no role validation
    var values     = Object.keys(assignments).filter(function(k) { return assignments[k] === 'value' })
    var hierarchy  = Object.keys(assignments).filter(function(k) { return assignments[k] === 'hierarchy' })
    if (values.length !== 1)    return 'Long format requires exactly one Value column. You selected ' + values.length + '.'
    if (hierarchy.length < 2)   return 'Long format requires at least 2 hierarchy levels. You selected ' + hierarchy.length + '.'
    return null
  }

  async function handleConfirm() {
    var err = validate()
    if (err) { setError(err); return }
    setError(''); setSaving(true)
    var payload
    if (format === 'wide') {
      payload = { format: 'wide', valueColumn: null, hierarchyColumns: [], dimensionColumns: [], timeColumns: [], confidence: 'user_confirmed' }
    } else {
      payload = {
        format: 'long_hierarchical',
        valueColumn:      Object.keys(assignments).find(function(k) { return assignments[k] === 'value' }),
        hierarchyColumns: hierOrder,
        dimensionColumns: Object.keys(assignments).filter(function(k) { return assignments[k] === 'dimension' }),
        timeColumns:      Object.keys(assignments).filter(function(k) { return assignments[k] === 'time' }),
        confidence:       'user_confirmed',
      }
    }
    try {
      var res = await fetch('/api/upload-dataset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-format', datasetId: datasetId, datasetFormat: payload }),
      })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to save format')
      onConfirm(payload)
    } catch(err) { setError(err.message); setSaving(false) }
  }

  // ── Styles (matching SetupScreen aesthetic) ─────────────────────────────
  var overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }
  var modalStyle   = { width: '100%', maxWidth: 640, maxHeight: '85vh', background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }
  var headerStyle  = { padding: '20px 24px 14px', borderBottom: '1px solid var(--border)' }
  var bodyStyle    = { padding: '18px 24px', overflowY: 'auto', flex: 1 }
  var footerStyle  = { padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }
  var labelStyle   = { fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6, fontFamily: 'var(--font-body)' }
  var selectStyle  = { padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'var(--font-body)', outline: 'none', cursor: 'pointer' }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Top accent bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.5 }} />

        {/* ── Header ── */}
        <div style={headerStyle}>
          <p style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Confirm dataset format</p>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.005em', marginBottom: 4 }}>{datasetName}</h2>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
            PRISM detected this as <strong style={{ color: 'var(--text-accent)' }}>{detectedFormat.format === 'long_hierarchical' ? 'Long Hierarchical' : 'Wide'}</strong> format. Confirm or adjust below.
          </p>
        </div>

        {/* ── Body ── */}
        <div style={bodyStyle}>

          {/* Format toggle */}
          <div style={{ marginBottom: 18 }}>
            <p style={labelStyle}>Format</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { value: 'long_hierarchical', label: 'Long Hierarchical' },
                { value: 'wide',              label: 'Wide' },
              ].map(function(opt) {
                var active = format === opt.value
                return (
                  <button key={opt.value} onClick={function() { setFormat(opt.value); setError('') }} style={{
                    padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', letterSpacing: '0.04em',
                    border: '1px solid ' + (active ? 'var(--accent-border)' : 'var(--border)'),
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
                    transition: 'all var(--transition)',
                  }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {format === 'wide' ? (
            <div style={{ padding: '14px 16px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 12, color: 'var(--text-accent)', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>
                Wide format selected. PRISM will treat each column as a separate KPI/dimension — no further configuration needed here. You can continue with the existing metadata flow.
              </p>
            </div>
          ) : (
            <>
              {/* Column role assignment */}
              <div style={{ marginBottom: 18 }}>
                <p style={labelStyle}>Assign roles to columns</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allColumns.map(function(col) {
                    return (
                      <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                        <code style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{col}</code>
                        <select value={assignments[col]} onChange={function(e) { handleRoleChange(col, e.target.value) }} style={selectStyle}>
                          {ROLES.map(function(r) { return <option key={r.value} value={r.value}>{r.label}</option> })}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Hierarchy ordering */}
              {hierOrder.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p style={labelStyle}>Hierarchy order (parent → child)</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {hierOrder.map(function(col, idx) {
                      return (
                        <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}>
                          <span style={{ fontSize: 10, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', minWidth: 20 }}>L{idx + 1}</span>
                          <code style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{col}</code>
                          <button onClick={function() { moveHierUp(col) }} disabled={idx === 0} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: idx === 0 ? 'var(--text-tertiary)' : 'var(--text-secondary)', fontSize: 10, padding: '2px 6px', cursor: idx === 0 ? 'not-allowed' : 'pointer' }}>↑</button>
                          <button onClick={function() { moveHierDown(col) }} disabled={idx === hierOrder.length - 1} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: idx === hierOrder.length - 1 ? 'var(--text-tertiary)' : 'var(--text-secondary)', fontSize: 10, padding: '2px 6px', cursor: idx === hierOrder.length - 1 ? 'not-allowed' : 'pointer' }}>↓</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginTop: 12, fontFamily: 'var(--font-body)' }}>
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={footerStyle}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            fontSize: 11, color: 'var(--text-secondary)', cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-display)', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={saving} style={{
            padding: '8px 18px',
            background: saving ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
            border: '1px solid ' + (saving ? 'var(--border)' : 'var(--accent-border)'),
            borderRadius: 'var(--radius-md)', fontSize: 11,
            color: saving ? 'var(--text-tertiary)' : 'var(--text-accent)',
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {saving ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving</> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
