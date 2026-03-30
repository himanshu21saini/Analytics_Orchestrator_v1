'use client'

import { useState, useMemo } from 'react'

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return '—'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

function FieldRow({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  )
}

function DimFilterRow({ index, filter, dimensions, datasetId, onUpdate, onRemove }) {
  var [options,  setOptions]  = useState([])
  var [loading,  setLoading]  = useState(false)

  var inputStyle = { width: '100%', padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', outline: 'none' }

  async function handleFieldChange(field) {
    onUpdate(index, 'field', field)
    onUpdate(index, 'value', '')
    if (!field || !datasetId) return
    setLoading(true)
    try {
      var res  = await fetch('/api/distinct-values?datasetId=' + datasetId + '&field=' + field)
      var json = await res.json()
      setOptions(json.values || [])
    } catch (e) { setOptions([]) }
    setLoading(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 6, marginBottom: 6 }}>
      <select value={filter.field} onChange={function(e) { handleFieldChange(e.target.value) }} style={inputStyle}>
        <option value="">Select dimension</option>
        {dimensions.map(function(d) {
          return <option key={d.field_name} value={d.field_name}>{d.display_name || d.field_name}</option>
        })}
      </select>
      {loading
        ? <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            <span style={{ fontSize: 11 }}>Loading...</span>
          </div>
        : options.length > 0
          ? <select value={filter.value} onChange={function(e) { onUpdate(index, 'value', e.target.value) }} style={inputStyle}>
              <option value="">Select value</option>
              {options.map(function(v) { return <option key={v} value={v}>{v}</option> })}
            </select>
          : <input type="text" placeholder="Segment value" value={filter.value}
              onChange={function(e) { onUpdate(index, 'value', e.target.value) }}
              style={inputStyle}
            />
      }
      <button onClick={function() { onRemove(index) }}
        style={{ width: 28, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid rgba(224,85,85,0.2)', borderRadius: 'var(--radius-sm)', color: 'var(--red-text)', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>
        ×
      </button>
    </div>
  )
}

export default function CreateTaskModal({ isOpen, onClose, onCreated, prefill, session }) {
  var metadata         = session.metadata         || []
  var periodInfo       = session.periodInfo       || {}
  var timePeriod       = session.timePeriod       || {}
  var queryResults     = session.queryResults     || []

  var allKpis = metadata.filter(function(m) {
    return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N'
  })
  var dimensions = metadata.filter(function(m) {
    return m.type === 'dimension' && m.is_output !== 'N'
  })
  console.log('dimensions:', dimensions, 'metadata length:', metadata.length)

  // Map kpi field_name → current dashboard value
  var kpiValueMap = useMemo(function() {
    var map = {}
    queryResults.forEach(function(r) {
      if (r.chart_type === 'kpi' && r.data && r.data.length) {
        var row    = r.data[0]
        var curKey = r.current_key || r.value_key || 'current_value'
        var val    = parseFloat(row[curKey])
        if (!isNaN(val)) {
  map[r.id] = { value: val, title: r.title }
  // also index by any field_name that the id starts with
  var meta = metadata.find(function(m) { return r.id && r.id.startsWith(m.field_name) })
  if (meta) map[meta.field_name] = { value: val, title: r.title }
}
      }
    })
    return map
  }, [queryResults])

  var [kpiField,    setKpiField]    = useState(prefill && prefill.kpiField ? prefill.kpiField : allKpis.length ? allKpis[0].field_name : '')
  var [dimFilters,  setDimFilters]  = useState(prefill && prefill.dimFilters ? prefill.dimFilters : [{ field: '', value: '' }])
  var [manualValue, setManualValue] = useState('')
  var [note,        setNote]        = useState('')
  var [saving,      setSaving]      = useState(false)
  var [error,       setError]       = useState('')

  var selKpiMeta     = metadata.find(function(m) { return m.field_name === kpiField })
  var dashboardEntry = kpiValueMap[kpiField]
  var prefillValue   = prefill && prefill.value !== undefined ? prefill.value : null

  var resolvedValue = prefillValue !== null
    ? prefillValue
    : dashboardEntry
      ? dashboardEntry.value
      : manualValue.trim() ? parseFloat(manualValue) : null

  var selectStyle = { width: '100%', padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', outline: 'none', cursor: 'pointer' }
  var inputStyle  = { ...selectStyle, cursor: 'text' }

  function handleKpiChange(field) { setKpiField(field); setManualValue('') }
  function handleDimUpdate(idx, key, val) {
    setDimFilters(function(prev) { return prev.map(function(f, i) { return i === idx ? Object.assign({}, f, { [key]: val }) : f }) })
  }
  function handleDimRemove(idx) {
    setDimFilters(function(prev) { return prev.filter(function(_, i) { return i !== idx }) })
  }
  function handleAddDim() {
    setDimFilters(function(prev) { return prev.concat([{ field: '', value: '' }]) })
  }

  async function handleCreate() {
    setError('')
    if (!kpiField) { setError('Please select a KPI to track.'); return }
    var validDims = dimFilters.filter(function(f) { return f.field && f.value.trim() })
    if (!validDims.length) { setError('Add at least one dimension filter to identify the segment.'); return }
    setSaving(true)
    try {
      var createdYear  = timePeriod.year  || new Date().getFullYear()
      var createdMonth = timePeriod.month || new Date().getMonth() + 1
      var res = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId:        session.datasetId,
          metadataSetId:    session.metadataSetId,
          kpiField:         kpiField,
          kpiDisplay:       selKpiMeta ? (selKpiMeta.display_name || kpiField) : kpiField,
          dimensionFilters: validDims,
          yearField:        periodInfo.yf  || timePeriod.yearField  || 'year',
          monthField:       periodInfo.mf  || timePeriod.monthField || 'month',
          createdYear:      createdYear,
          createdMonth:     createdMonth,
          createdValue:     resolvedValue,
          direction:        selKpiMeta ? (selKpiMeta.favorable_direction || 'i') : 'i',
          note:             note.trim() || null,
          mandatoryFilters: session.mandatoryFilters || [],
        }),
      })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create task.')
      onCreated(json.task)
      onClose()
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  if (!isOpen) return null

  var curYear  = timePeriod.year  || new Date().getFullYear()
  var curMonth = timePeriod.month || new Date().getMonth() + 1

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={function(e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="fade-in" style={{ width: '100%', maxWidth: 500, background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>Track KPI Segment</p>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 2 }}>
              Flagging for <span style={{ color: '#F0A030' }}>{MONTH_NAMES[curMonth - 1]} {curYear}</span>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 8px', maxHeight: '65vh', overflowY: 'auto' }}>

          {/* KPI selector */}
          <FieldRow label="KPI to track">
            <select value={kpiField} onChange={function(e) { handleKpiChange(e.target.value) }} style={selectStyle}>
              {allKpis.map(function(k) {
                var hasDash = !!kpiValueMap[k.field_name]
                return <option key={k.field_name} value={k.field_name}>{k.display_name || k.field_name}{hasDash ? ' · on dashboard' : ''}</option>
              })}
            </select>
            {selKpiMeta && (
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 4 }}>
                {selKpiMeta.favorable_direction === 'd' ? 'Lower is better' : 'Higher is better'}
                {selKpiMeta.unit ? ' · ' + selKpiMeta.unit : ''}
              </p>
            )}
          </FieldRow>

          {/* Value at flagging */}
          <FieldRow label="Value at flagging">
            {prefillValue !== null ? (
              <div style={{ padding: '8px 12px', background: 'rgba(240,160,48,0.06)', border: '1px solid rgba(240,160,48,0.2)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#F0A030', fontFamily: 'var(--font-mono)' }}>{fmt(prefillValue)}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>from chart</span>
              </div>
            ) : dashboardEntry ? (
  <div style={{ padding: '8px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{fmt(dashboardEntry.value)}</span>
    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>auto-filled from dashboard</span>
  </div>
            ) : (
              <div>
                <input type="number" placeholder="Enter current value (optional)" value={manualValue}
                  onChange={function(e) { setManualValue(e.target.value) }} style={inputStyle} />
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 4 }}>This KPI has no card on the current dashboard — enter a value manually if known.</p>
              </div>
            )}
          </FieldRow>

          {/* Dimension filters */}
          <FieldRow label="Segment filters">
             {console.log('dimFilters:', dimFilters)}
            {dimFilters.map(function(f, i) {
      return <DimFilterRow key={i} index={i} filter={f} dimensions={dimensions} datasetId={session.datasetId} onUpdate={handleDimUpdate} onRemove={handleDimRemove} />      
      })}
            <button onClick={handleAddDim}
              style={{ fontSize: 10, padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', border: '1px solid var(--accent-border)', background: 'var(--accent-dim)', color: 'var(--text-accent)', transition: 'all var(--transition)', marginTop: 2 }}>
              + Add filter
            </button>
          </FieldRow>

          {/* Note */}
          <FieldRow label="Note (optional)">
            <textarea value={note} onChange={function(e) { setNote(e.target.value) }}
              placeholder="e.g. Revenue variance in Branch 1 is unusually high — monitor for next 3 months"
              rows={2}
              style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
              onFocus={function(e) { e.target.style.borderColor = 'var(--accent-border)' }}
              onBlur={function(e)  { e.target.style.borderColor = 'var(--border)' }}
            />
          </FieldRow>

          {error && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginBottom: 14, fontFamily: 'var(--font-body)' }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px 20px' }}>
          <button onClick={onClose}
            style={{ flex: '0 0 80px', padding: '10px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving}
            style={{ flex: 1, padding: '10px 0', background: saving ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)', border: '1px solid ' + (saving ? 'var(--border)' : 'var(--accent-border)'), borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: saving ? 'var(--text-tertiary)' : 'var(--text-accent)', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {saving ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Creating...</> : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
