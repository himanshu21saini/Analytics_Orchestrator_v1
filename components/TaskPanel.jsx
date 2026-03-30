'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Dot,
} from 'recharts'

var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return '—'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

function periodLabel(year, month) {
  return MONTH_NAMES[(month - 1)] + ' ' + String(year).slice(2)
}

function TrendBadge({ trend }) {
  if (!trend) return null
  var status = trend.status
  var color  = status === 'improved'  ? '#10C48A'
             : status === 'worsened'  ? '#E05555'
             : 'var(--text-tertiary)'
  var bg     = status === 'improved'  ? 'rgba(16,196,138,0.1)'
             : status === 'worsened'  ? 'rgba(224,85,85,0.1)'
             : 'rgba(255,255,255,0.04)'
  var border = status === 'improved'  ? 'rgba(16,196,138,0.3)'
             : status === 'worsened'  ? 'rgba(224,85,85,0.3)'
             : 'rgba(255,255,255,0.08)'
  var label  = status === 'improved'  ? '↑ Improved'
             : status === 'worsened'  ? '↓ Worsened'
             : '→ No change'
  var pct = trend.delta_pct !== null ? ' (' + (trend.delta_pct > 0 ? '+' : '') + trend.delta_pct + '%)' : ''
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: bg, border: '1px solid ' + border, color: color, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {label}{pct}
    </span>
  )
}

function TaskRow({ task, mandatoryFilters, onStatusChange, onDelete }) {
  var [expanded,    setExpanded]    = useState(false)
  var [loadingHist, setLoadingHist] = useState(false)
  var [series,      setSeries]      = useState(null)
  var [trend,       setTrend]       = useState(null)
  var [histError,   setHistError]   = useState('')
  var [updating,    setUpdating]    = useState(false)

  var dimFilters = []
  try {
    dimFilters = typeof task.dimension_filters === 'string'
      ? JSON.parse(task.dimension_filters)
      : (task.dimension_filters || [])
  } catch (e) { dimFilters = [] }

  async function loadHistory() {
    if (series) return  // already loaded
    setLoadingHist(true); setHistError('')
    try {
      var mfParam = encodeURIComponent(JSON.stringify(mandatoryFilters || []))
      var res     = await fetch('/api/tasks/' + task.id + '/history?mandatoryFilters=' + mfParam)
      var json    = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load history.')
      setSeries(json.series || [])
      setTrend(json.trend || null)
    } catch (e) { setHistError(e.message) }
    setLoadingHist(false)
  }

  function handleExpand() {
    var next = !expanded
    setExpanded(next)
    if (next) loadHistory()
  }

  async function handleToggleStatus() {
    setUpdating(true)
    var nextStatus = task.status === 'active' ? 'resolved' : 'active'
    try {
      var res  = await fetch('/api/tasks/' + task.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onStatusChange(task.id, nextStatus)
    } catch (e) { console.error(e.message) }
    setUpdating(false)
  }

  async function handleDelete() {
    if (!window.confirm('Delete this task?')) return
    try {
      await fetch('/api/tasks/' + task.id, { method: 'DELETE' })
      onDelete(task.id)
    } catch (e) { console.error(e.message) }
  }

  var isResolved    = task.status === 'resolved'
  var creationLabel = periodLabel(task.created_year, task.created_month)
  var creationPeriod = task.created_year + '-' + (task.created_month < 10 ? '0' + task.created_month : task.created_month)

  var ttStyle = {
    background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)', borderRadius: 8,
    fontSize: 11, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    color: '#FFFFFF', padding: '8px 12px',
  }
  var axStyle = { fontSize: 9, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }

  // Custom dot — highlight creation month
  function CustomDot(props) {
    var { cx, cy, payload } = props
    if (!payload) return null
    if (payload.is_creation) {
      return <circle cx={cx} cy={cy} r={5} fill="#F0A030" stroke="#0D1930" strokeWidth={1.5} />
    }
    return <circle cx={cx} cy={cy} r={2.5} fill="var(--accent)" strokeWidth={0} />
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', opacity: isResolved ? 0.65 : 1, transition: 'opacity var(--transition)' }}>

      {/* ── Row header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-2)', cursor: 'pointer' }}
        onClick={handleExpand}
      >
        {/* Status dot */}
        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isResolved ? 'var(--text-tertiary)' : '#10C48A', boxShadow: isResolved ? 'none' : '0 0 5px #10C48A' }} />

        {/* KPI + dims */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>{task.kpi_display}</span>
            {dimFilters.map(function(f, i) {
              return (
                <span key={i} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 99, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                  {f.field}: {f.value}
                </span>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
              Flagged: <span style={{ color: '#F0A030' }}>{creationLabel}</span>
              {task.created_value !== null && task.created_value !== undefined
                ? <span style={{ marginLeft: 4 }}>· {fmt(task.created_value)}</span>
                : null
              }
            </span>
            {trend && <TrendBadge trend={trend} />}
          </div>
        </div>

        {/* Status badge */}
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, flexShrink: 0, background: isResolved ? 'rgba(255,255,255,0.04)' : 'rgba(16,196,138,0.1)', border: '1px solid ' + (isResolved ? 'var(--border)' : 'rgba(16,196,138,0.3)'), color: isResolved ? 'var(--text-tertiary)' : '#10C48A', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {task.status}
        </span>

        {/* Expand chevron */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, transition: 'transform var(--transition)', transform: expanded ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l4 4 4-4" stroke="var(--text-tertiary)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>

          {/* Note */}
          {task.note && (
            <div style={{ marginBottom: 14, padding: '8px 12px', background: 'rgba(240,160,48,0.06)', border: '1px solid rgba(240,160,48,0.2)', borderRadius: 'var(--radius-sm)' }}>
              <p style={{ fontSize: 11, color: '#F0A030', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 6 }}>Note</span>
                {task.note}
              </p>
            </div>
          )}

          {/* History chart */}
          {loadingHist && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0' }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Loading history...</span>
            </div>
          )}

          {histError && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', fontFamily: 'var(--font-body)' }}>{histError}</p>
          )}

          {series && series.length > 0 && (
            <>
              {/* Trend summary */}
              {trend && (
                <div style={{ display: 'flex', gap: 20, marginBottom: 14, padding: '10px 14px', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-sm)' }}>
                  <div>
                    <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>At flagging ({creationLabel})</p>
                    <p style={{ fontSize: 16, fontWeight: 600, color: '#F0A030', fontFamily: 'var(--font-mono)' }}>{fmt(trend.creation_value)}</p>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div>
                    <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>Latest</p>
                    <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmt(trend.latest_value)}</p>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div>
                    <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>Change</p>
                    <TrendBadge trend={trend} />
                  </div>
                </div>
              )}

              {/* Line chart */}
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
                  <XAxis dataKey="period" tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
                  <YAxis tick={axStyle} width={48} tickFormatter={fmt} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={ttStyle} formatter={function(v) { return [fmt(v), task.kpi_display] }} labelFormatter={function(l) { return 'Period: ' + l }} />
                  <ReferenceLine x={creationPeriod} stroke="#F0A030" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: 'Flagged', position: 'top', fontSize: 9, fill: '#F0A030', fontFamily: 'var(--font-mono)' }} />
                  <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={1.5} dot={<CustomDot />} activeDot={{ r: 4, fill: 'var(--accent)' }} />
                </LineChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F0A030' }} />
                  <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Flagged month</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Monthly value</span>
                </div>
              </div>
            </>
          )}

          {series && series.length === 0 && !loadingHist && (
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', textAlign: 'center', padding: '16px 0' }}>No data found for this segment.</p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={handleToggleStatus} disabled={updating}
              style={{ fontSize: 10, padding: '4px 12px', borderRadius: 'var(--radius-sm)', cursor: updating ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', border: '1px solid ' + (isResolved ? 'rgba(16,196,138,0.3)' : 'var(--border)'), background: isResolved ? 'rgba(16,196,138,0.08)' : 'transparent', color: isResolved ? '#10C48A' : 'var(--text-secondary)', transition: 'all var(--transition)' }}
            >
              {updating ? 'Updating...' : isResolved ? '↩ Reopen' : '✓ Mark Resolved'}
            </button>
            <button
              onClick={handleDelete}
              style={{ fontSize: 10, padding: '4px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', border: '1px solid rgba(224,85,85,0.2)', background: 'transparent', color: 'var(--red-text)', transition: 'all var(--transition)' }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main TaskPanel ─────────────────────────────────────────────────────────────

export default function TaskPanel({ session, alwaysOpen }) {
  var datasetId       = session.datasetId
  var mandatoryFilters = session.mandatoryFilters || []

  var [tasks,        setTasks]        = useState([])
  var [loading,      setLoading]      = useState(true)
  var [error,        setError]        = useState('')
  var [open, setOpen] = useState(alwaysOpen || false)
  var [showResolved, setShowResolved] = useState(false)

  useEffect(function() { loadTasks() }, [datasetId])

  async function loadTasks() {
    setLoading(true); setError('')
    try {
      var res  = await fetch('/api/tasks?datasetId=' + datasetId)
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load tasks.')
      setTasks(json.tasks || [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  function handleStatusChange(id, newStatus) {
    setTasks(function(prev) {
      return prev.map(function(t) { return t.id === id ? Object.assign({}, t, { status: newStatus }) : t })
    })
  }

  function handleDelete(id) {
    setTasks(function(prev) { return prev.filter(function(t) { return t.id !== id }) })
  }

  var activeTasks   = tasks.filter(function(t) { return t.status === 'active' })
  var resolvedTasks = tasks.filter(function(t) { return t.status === 'resolved' })
  var visibleTasks  = showResolved ? tasks : activeTasks

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16, background: 'var(--surface)', backdropFilter: 'blur(8px)' }}>

      {/* ── Panel header ── */}
      <button
        onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Track KPI</span>
          {activeTasks.length > 0 && (
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 2, background: 'rgba(16,196,138,0.1)', color: '#10C48A', border: '1px solid rgba(16,196,138,0.3)', fontFamily: 'var(--font-mono)' }}>{activeTasks.length} active</span>
          )}
          {resolvedTasks.length > 0 && (
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 2, background: 'var(--surface-3)', color: 'var(--text-tertiary)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)' }}>{resolvedTasks.length} resolved</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'var(--transition)' }}>▾</span>
      </button>

      {/* ── Panel body ── */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Loading tasks...</span>
            </div>
          )}

          {error && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginBottom: 10, fontFamily: 'var(--font-body)' }}>{error}</p>
          )}

          {!loading && tasks.length === 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', textAlign: 'center', padding: '16px 0', lineHeight: 1.6 }}>
              No tracking tasks yet. Use the <span style={{ color: 'var(--text-accent)' }}>Track</span> button on any chart bar to flag a segment for monitoring.
            </p>
          )}

          {!loading && tasks.length > 0 && (
            <>
              {/* Show resolved toggle */}
              {resolvedTasks.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button
                    onClick={function() { setShowResolved(function(v) { return !v }) }}
                    style={{ fontSize: 10, padding: '3px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', border: '1px solid var(--border)', background: showResolved ? 'var(--surface-3)' : 'transparent', color: 'var(--text-tertiary)', transition: 'all var(--transition)' }}
                  >
                    {showResolved ? 'Hide resolved' : 'Show resolved (' + resolvedTasks.length + ')'}
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleTasks.map(function(task) {
                  return (
                    <TaskRow
                      key={task.id}
                      task={task}
                      mandatoryFilters={mandatoryFilters}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
