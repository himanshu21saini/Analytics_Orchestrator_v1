'use client'

import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'

var P = ['#00C8F0','#2B7FE3','#00B4A0','#7B8FF0','#F0A030','#9B7FE3','#10C48A','#E05555']

var ttStyle = {
  background: '#0D1930',
  border: '1px solid rgba(0,200,240,0.2)',
  borderRadius: 8, fontSize: 11, color: '#FFFFFF', padding: '8px 12px',
}
var axStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return String(v || '')
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
      padding: '4px 12px',
      background: 'rgba(0,0,0,0.15)',
      border: '1px solid var(--border)',
      borderRadius: 6,
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>{value}</span>
    </div>
  )
}

export default function TrendExplorer({ metadata, datasetId, onSimulate }) {

  // All KPIs + derived KPIs from metadata — sorted by priority then name
  var kpiOptions = (metadata || []).filter(function(m) {
    return m.type === 'kpi' || m.type === 'derived_kpi'
  }).sort(function(a, b) {
    var order = { high: 0, medium: 1, low: 2 }
    var pa = order[(a.business_priority || '').toLowerCase()] ?? 1
    var pb = order[(b.business_priority || '').toLowerCase()] ?? 1
    if (pa !== pb) return pa - pb
    return (a.display_name || '').localeCompare(b.display_name || '')
  })

  var [selectedField, setSelectedField] = useState(kpiOptions.length ? kpiOptions[0].field_name : '')
  var [cache,         setCache]         = useState({})   // field_name → { data, forecast }
  var [dataState,     setDataState]     = useState('idle')
  var [dataError,     setDataError]     = useState('')

  var selectedMeta = kpiOptions.find(function(m) { return m.field_name === selectedField })
  var cached       = cache[selectedField]

  useEffect(function() {
    if (!selectedField || !datasetId) return
    if (cache[selectedField]) { setDataState('done'); return }

    setDataState('loading')
    setDataError('')

    var acc = (selectedMeta && selectedMeta.accumulation_type) || 'cumulative'

    // Step 1: fetch monthly trend data
    fetch('/api/fetch-trend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: datasetId, fieldName: selectedField, accumulationType: acc, yearsBack: 3 }),
    })
      .then(function(r) { return r.json() })
      .then(function(trendJson) {
        if (trendJson.error) throw new Error(trendJson.error)
        var trendData = trendJson.data || []

        if (trendData.length < 3) {
          setCache(function(p) { var n = Object.assign({}, p); n[selectedField] = { data: trendData, forecast: null }; return n })
          setDataState('done')
          return
        }

        // Step 2: fetch forecast using the trend data
        return fetch('/api/generate-forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesData: trendData, valueKey: 'value', labelKey: 'period', horizonMonths: 3 }),
        })
          .then(function(r) { return r.json() })
          .then(function(fcJson) {
            setCache(function(p) {
              var n = Object.assign({}, p)
              n[selectedField] = { data: trendData, forecast: fcJson.forecasts ? fcJson : null }
              return n
            })
            setDataState('done')
          })
      })
      .catch(function(err) { setDataError(err.message); setDataState('error') })
  }, [selectedField])

  if (!kpiOptions.length) return null

  var trendData = (cached && cached.data) || []
  var forecast  = cached && cached.forecast

  // Merge forecast points into data array for recharts
  var merged = trendData.slice()
  if (forecast && forecast.forecasts) {
    forecast.forecasts.forEach(function(f) {
      merged.push({ period: f.period, value: null, forecast: f.forecast, forecast_low: f.forecast_low, forecast_high: f.forecast_high })
    })
  }

  // Quick stats
  var histVals = trendData.map(function(r) { return parseFloat(r.value) }).filter(function(v) { return !isNaN(v) })
  var latest   = histVals[histVals.length - 1]
  var earliest = histVals[0]
  var totalChg = (earliest && earliest !== 0) ? ((latest - earliest) / Math.abs(earliest) * 100) : null
  var maxVal   = histVals.length ? Math.max.apply(null, histVals) : null

  var unit  = (selectedMeta && selectedMeta.unit) || ''
  var color = P[kpiOptions.indexOf(selectedMeta) % P.length]

  var trendBadge = forecast
    ? (forecast.trend === 'up' ? '↑' : forecast.trend === 'down' ? '↓' : '→') + ' ' + forecast.confidence + ' confidence'
    : null

  // Simulate query — WhatIfDrawer will work in field-adjustment mode
  var simulateQuery = {
    id: selectedField, title: (selectedMeta && selectedMeta.display_name) || selectedField,
    chart_type: 'area', label_key: 'period', value_key: 'value', unit: unit, sql: null,
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 24px 16px', marginBottom: 20,
      position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, ' + color + ', rgba(43,127,227,0.3), transparent)', opacity: 0.6 }} />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>

        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
          Trend Explorer
        </p>

        {/* Dropdown — grouped KPIs + Derived KPIs */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={selectedField}
            onChange={function(e) { setSelectedField(e.target.value) }}
            style={{
              appearance: 'none', padding: '7px 32px 7px 12px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-display)',
              cursor: 'pointer', outline: 'none', letterSpacing: '-0.01em', minWidth: 240,
            }}
          >
            <optgroup label="KPIs">
              {kpiOptions.filter(function(m) { return m.type === 'kpi' }).map(function(m) {
                return <option key={m.field_name} value={m.field_name}>{m.display_name || m.field_name}{m.unit ? ' (' + m.unit + ')' : ''}</option>
              })}
            </optgroup>
            <optgroup label="Derived KPIs">
              {kpiOptions.filter(function(m) { return m.type === 'derived_kpi' }).map(function(m) {
                return <option key={m.field_name} value={m.field_name}>{m.display_name || m.field_name}{m.unit ? ' (' + m.unit + ')' : ''}</option>
              })}
            </optgroup>
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>▾</span>
        </div>

        {dataState === 'loading' && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="spinner" />fetching trend...
          </span>
        )}
        {trendBadge && dataState === 'done' && (
          <span style={{
            fontSize: 9, padding: '3px 8px', borderRadius: 3, fontWeight: 500,
            background: 'rgba(240,160,48,0.1)', color: '#F0A030',
            border: '1px solid rgba(240,160,48,0.25)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0,
          }}>{trendBadge}</span>
        )}

        <div style={{ flex: 1 }} />

        {dataState === 'done' && latest != null && <StatPill label="Latest" value={fmt(latest) + (unit ? ' ' + unit : '')} color={color} />}
        {dataState === 'done' && totalChg != null && (
          <StatPill label="Period Δ" value={(totalChg >= 0 ? '+' : '') + totalChg.toFixed(1) + '%'} color={totalChg >= 0 ? '#10C48A' : '#E05555'} />
        )}
        {dataState === 'done' && maxVal != null && <StatPill label="Peak" value={fmt(maxVal) + (unit ? ' ' + unit : '')} />}

        {onSimulate && dataState === 'done' && trendData.length > 0 && (
          <button
            onClick={function() { onSimulate(simulateQuery) }}
            style={{
              fontSize: 10, padding: '6px 14px', borderRadius: 6, fontWeight: 500,
              background: 'rgba(155,127,227,0.1)', color: '#9B7FE3',
              border: '1px solid rgba(155,127,227,0.3)',
              cursor: 'pointer', transition: 'all var(--transition)',
              fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0,
            }}
            onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.2)' }}
            onMouseLeave={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.1)' }}
          >⟳ Simulate</button>
        )}
      </div>

      {/* Definition */}
      {selectedMeta && selectedMeta.definition && (
        <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.55)', marginBottom: 12, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
          {selectedMeta.definition}
        </p>
      )}

      {/* Error */}
      {dataState === 'error' && (
        <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed rgba(224,85,85,0.3)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: '#E05555', fontFamily: 'var(--font-body)' }}>{dataError}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {dataState === 'loading' && (
        <div style={{ height: 300, display: 'flex', alignItems: 'flex-end', gap: 3, padding: '0 8px' }}>
          {Array.from({ length: 28 }).map(function(_, i) {
            return <div key={i} className="skeleton" style={{ flex: 1, height: (35 + Math.abs(Math.sin(i * 0.5)) * 50) + '%', borderRadius: '2px 2px 0 0' }} />
          })}
        </div>
      )}

      {/* Empty */}
      {dataState === 'done' && trendData.length === 0 && (
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
            No monthly data found for {(selectedMeta && selectedMeta.display_name) || selectedField}
          </p>
        </div>
      )}

      {/* Chart */}
      {dataState === 'done' && trendData.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={merged} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color}    stopOpacity={0.25} />
                <stop offset="100%" stopColor={color}    stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#F0A030" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#F0A030" stopOpacity={0.01} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="1 6" stroke="rgba(56,140,255,0.07)" vertical={false} />
            <XAxis dataKey="period" tick={axStyle} angle={-30} textAnchor="end" interval={Math.max(0, Math.floor(merged.length / 14) - 1)} axisLine={false} tickLine={false} />
            <YAxis tick={axStyle} width={62} tickFormatter={function(v) { return fmt(v) + (unit ? ' ' + unit : '') }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={ttStyle} formatter={function(v, n) {
              if (v === null || v === undefined) return null
              return [fmt(v) + (unit ? ' ' + unit : ''), n]
            }} />

            {forecast && forecast.forecasts && trendData.length > 0 && (
              <ReferenceLine x={trendData[trendData.length - 1].period} stroke="rgba(240,160,48,0.3)" strokeDasharray="3 3"
                label={{ value: 'Forecast →', position: 'insideTopRight', fontSize: 9, fill: '#F0A030', fontFamily: 'var(--font-mono)' }} />
            )}

            <Area type="monotone" dataKey="value" name={(selectedMeta && selectedMeta.display_name) || selectedField}
              stroke={color} strokeWidth={2} fill="url(#trend-fill)"
              dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: color, stroke: 'var(--bg)', strokeWidth: 2 }}
              connectNulls={false} />

            {forecast && forecast.forecasts && (
              <Area type="monotone" dataKey="forecast" name="Forecast"
                stroke="#F0A030" strokeWidth={2} strokeDasharray="6 3" fill="url(#fc-fill)"
                dot={{ r: 3.5, fill: '#F0A030', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={true} />
            )}
            {forecast && forecast.forecasts && (
              <Area type="monotone" dataKey="forecast_high" stroke="#F0A030" strokeWidth={0.5} strokeDasharray="2 5" fill="none" dot={false} activeDot={false} connectNulls legendType="none" />
            )}
            {forecast && forecast.forecasts && (
              <Area type="monotone" dataKey="forecast_low"  stroke="#F0A030" strokeWidth={0.5} strokeDasharray="2 5" fill="none" dot={false} activeDot={false} connectNulls legendType="none" />
            )}
            {forecast && forecast.forecasts && (
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Forecast footer */}
      {forecast && dataState === 'done' && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>Method: {forecast.method || 'linear_regression'}</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>R²: {forecast.r_squared != null ? forecast.r_squared : '—'}</span>
          {forecast.forecasts && forecast.forecasts[0] && (
            <span style={{ fontSize: 10, color: '#F0A030', fontFamily: 'var(--font-mono)' }}>
              Next period: {fmt(forecast.forecasts[0].forecast)}{unit ? ' ' + unit : ''} ({fmt(forecast.forecasts[0].forecast_low)} – {fmt(forecast.forecasts[0].forecast_high)})
            </span>
          )}
        </div>
      )}
    </div>
  )
}
