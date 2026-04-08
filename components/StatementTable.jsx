'use client'

import { useState, useEffect } from 'react'

// Number formatting that preserves sign as stored in data
function fmt(v) {
  if (v === null || v === undefined || isNaN(parseFloat(v))) return '—'
  var n = parseFloat(v)
  var abs = Math.abs(n)
  var sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

function fmtDelta(cur, cmp, favDir) {
  if (cur === null || cmp === null || cur === undefined || cmp === undefined || isNaN(cur) || isNaN(cmp) || cmp === 0) {
    return { text: '—', color: 'var(--text-tertiary)' }
  }
  var pct = ((cur - cmp) / Math.abs(cmp)) * 100
  var isPositive = pct >= 0
  // Color by favorability — i means up=good, d means down=good
  var isFavorable = favDir === 'd' ? !isPositive : isPositive
  var color = isFavorable ? '#10C48A' : '#E05555'
  return {
    text: (isPositive ? '+' : '') + pct.toFixed(1) + '%',
    color: color,
  }
}

export default function StatementTable({ session }) {
  var [values,    setValues]    = useState({})  // { node_path: { current_value, comparison_value, ... } }
  var [loading,   setLoading]   = useState(true)
  var [error,     setError]     = useState('')

  var hierarchyNodes   = session.hierarchyNodes   || []
  var datasetId        = session.datasetId
  var metadataSetId    = session.metadataSetId
  var timePeriod       = session.timePeriod
  var mandatoryFilters = session.mandatoryFilters || []
  var periodInfo       = session.periodInfo || {}

  // L1 nodes only for Stage 1
  var l1Nodes = hierarchyNodes.filter(function(n) { return n.level === 1 })

  useEffect(function() {
    if (!l1Nodes.length || !datasetId || !metadataSetId) { setLoading(false); return }
    setLoading(true); setError('')
    fetch('/api/statement-values', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datasetId:        datasetId,
        metadataSetId:    metadataSetId,
        nodePaths:        l1Nodes.map(function(n) { return n.node_path }),
        timePeriod:       timePeriod,
        mandatoryFilters: mandatoryFilters,
        dimensionFilters: [],
      }),
    })
      .then(function(r) { return r.json() })
      .then(function(j) {
        if (j.error) throw new Error(j.error)
        setValues(j.values || {})
        setLoading(false)
      })
      .catch(function(err) {
        setError(err.message)
        setLoading(false)
      })
  }, [datasetId, metadataSetId])

  if (!hierarchyNodes.length) {
    return null
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 24px 16px', marginBottom: 20,
      position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent), rgba(43,127,227,0.3), transparent)', opacity: 0.6 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
          Statement View
        </p>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)' }}>
          {l1Nodes.length} top-level lines
        </span>
        {loading && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="spinner" /> loading values...
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '14px', textAlign: 'center', border: '1px dashed rgba(224,85,85,0.3)', borderRadius: 8, marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: '#E05555', fontFamily: 'var(--font-body)' }}>{error}</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && l1Nodes.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-body)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left',  padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Line Item</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{periodInfo.viewLabel || 'Current'}</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{periodInfo.cmpLabel ? periodInfo.cmpLabel.replace(/^vs /, '') : 'Comparison'}</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {l1Nodes.map(function(node) {
              var v = values[node.node_path] || {}
              var cur = v.current_value
              var cmp = v.comparison_value
              var favDir = v.favorable_direction || node.favorable_direction
              var delta = fmtDelta(cur, cmp, favDir)
              return (
                <tr key={node.node_path} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '10px', color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
                    {node.display_name || node.node_name}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(cur)}{node.unit ? ' ' + node.unit : ''}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(cmp)}{node.unit ? ' ' + node.unit : ''}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', color: delta.color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {delta.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
