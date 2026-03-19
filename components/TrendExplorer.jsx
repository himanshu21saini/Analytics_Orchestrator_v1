'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

var MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
var QUARTERS = ['Q1','Q2','Q3','Q4']
var P = ['#00C8F0','#2B7FE3','#00B4A0','#7B8FF0','#F0A030','#9B7FE3','#10C48A','#E05555']

var ttStyle = {
  background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)',
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
      padding: '4px 12px', background: 'rgba(0,0,0,0.15)',
      border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>{value}</span>
    </div>
  )
}

function buildTrendSQL(datasetId, fieldName, agg) {
  var curYear = new Date().getFullYear()
  var minYear = curYear - 3
  return [
    'SELECT',
    "  CONCAT(data->>'year', '-', LPAD(CAST((data->>'month')::integer AS TEXT), 2, '0')) AS period,",
    '  ' + agg + "(COALESCE((data->>'" + fieldName + "')::numeric, 0)) AS value",
    'FROM dataset_rows',
    'WHERE dataset_id = ' + datasetId,
    "  AND (data->>'year')::integer >= " + minYear,
    "  AND (data->>'month') IS NOT NULL",
    "  AND (data->>'year') IS NOT NULL",
    "GROUP BY data->>'year', data->>'month'",
    'ORDER BY period ASC',
  ].join('\n')
}

// ── Index raw {period:'YYYY-MM', value} data by year+month ───────────────────
function indexByYearMonth(rawData) {
  var idx = {}
  ;(rawData || []).forEach(function(row) {
    var parts = String(row.period || '').split('-')
    if (parts.length < 2) return
    var y = parseInt(parts[0]); var m = parseInt(parts[1])
    if (!isNaN(y) && !isNaN(m)) idx[y + '-' + m] = parseFloat(row.value)
  })
  return idx
}

// ── MONTHLY view: Jan–Dec two-line + forecast appended after cutoff ──────────
function buildMonthlyData(rawData, forecast, timePeriod) {
  var curYear     = timePeriod && timePeriod.year  ? parseInt(timePeriod.year)  : new Date().getFullYear()
  var cmpYear     = curYear - 1
  var cutoffMonth = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12

  var byYM = indexByYearMonth(rawData)

  // Build base 12-month array
  var rows = MONTHS.map(function(name, i) {
    var m = i + 1
    return {
      label:    name,
      curYear:  m <= cutoffMonth ? (byYM[curYear + '-' + m] !== undefined ? byYM[curYear + '-' + m] : null) : null,
      cmpYear:  byYM[cmpYear + '-' + m] !== undefined ? byYM[cmpYear + '-' + m] : null,
      forecast: null,
      fc_low:   null,
      fc_high:  null,
    }
  })

  // Append forecast points — they come AFTER the cutoff month
  // Each forecast has a period like '2024-07'; slot into the right month row
  // or append a new row if it extends beyond December
  if (forecast && forecast.forecasts) {
    forecast.forecasts.forEach(function(f) {
      var parts = String(f.period || '').split('-')
      if (parts.length < 2) return
      var fy = parseInt(parts[0])
      var fm = parseInt(parts[1])
      if (isNaN(fy) || isNaN(fm)) return

      // Only show forecasts for current year months beyond cutoff
      if (fy === curYear && fm > cutoffMonth && fm <= 12) {
        rows[fm - 1].forecast = f.forecast
        rows[fm - 1].fc_low   = f.forecast_low
        rows[fm - 1].fc_high  = f.forecast_high
      } else if (fy === curYear + 1 || (fy === curYear && fm > 12)) {
        // Next year forecast months — append as extra rows
        rows.push({
          label:    MONTHS[(fm - 1) % 12] + ' ' + fy,
          curYear:  null,
          cmpYear:  null,
          forecast: f.forecast,
          fc_low:   f.forecast_low,
          fc_high:  f.forecast_high,
        })
      }
    })
  }

  return rows
}

// ── QUARTERLY view: Q1–Q4 two-line + forecast ────────────────────────────────
// Always a line chart, just with 4 points instead of 12.
function buildQuarterlyData(rawData, forecast, timePeriod, accumType) {
  var curYear  = timePeriod && timePeriod.year  ? parseInt(timePeriod.year)  : new Date().getFullYear()
  var cmpYear  = curYear - 1
  var selMonth = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12
  var cutoffQ  = Math.ceil(selMonth / 3)

  var byYM = indexByYearMonth(rawData)

  function quarterVal(year, qIdx) {
    var months = [qIdx * 3 + 1, qIdx * 3 + 2, qIdx * 3 + 3]
    var vals   = months.map(function(m) { return byYM[year + '-' + m] }).filter(function(v) { return v !== undefined && !isNaN(v) })
    if (!vals.length) return null
    return accumType === 'point_in_time'
      ? vals.reduce(function(a, b) { return a + b }, 0) / vals.length
      : vals.reduce(function(a, b) { return a + b }, 0)
  }

  var rows = QUARTERS.map(function(name, qi) {
    var qNum = qi + 1
    return {
      label:    name,
      curYear:  qNum <= cutoffQ ? quarterVal(curYear, qi) : null,
      cmpYear:  quarterVal(cmpYear, qi),
      forecast: null,
      fc_low:   null,
      fc_high:  null,
    }
  })

  // Slot quarterly forecast points
  if (forecast && forecast.forecasts) {
    forecast.forecasts.forEach(function(f) {
      // forecast period for quarterly series is like '2024-Q3'
      var parts = String(f.period || '').split('-Q')
      if (parts.length < 2) {
        // fallback: monthly period — compute quarter
        var mParts = String(f.period || '').split('-')
        if (mParts.length < 2) return
        var fy = parseInt(mParts[0]); var fm = parseInt(mParts[1])
        if (isNaN(fy) || isNaN(fm)) return
        if (fy !== curYear) return
        var qi = Math.ceil(fm / 3) - 1
        if (qi >= 0 && qi < 4 && rows[qi].forecast === null) {
          rows[qi].forecast = f.forecast
          rows[qi].fc_low   = f.forecast_low
          rows[qi].fc_high  = f.forecast_high
        }
        return
      }
      var qy = parseInt(parts[0]); var qq = parseInt(parts[1])
      if (isNaN(qy) || isNaN(qq)) return
      if (qy === curYear && qq > cutoffQ && qq <= 4) {
        rows[qq - 1].forecast = f.forecast
        rows[qq - 1].fc_low   = f.forecast_low
        rows[qq - 1].fc_high  = f.forecast_high
      }
    })
  }

  return rows
}

export default function TrendExplorer({ metadata, datasetId, timePeriod, onSimulate, onTrendData }) {

  var isQTD = timePeriod && timePeriod.viewType === 'QTD'

  var kpiOptions = (metadata || []).filter(function(m) {
    return m.type === 'kpi' || m.type === 'derived_kpi'
  }).sort(function(a, b) {
    var order = { high: 0, medium: 1, low: 2 }
    var paVal = order[(a.business_priority || '').toLowerCase()]
    var pbVal = order[(b.business_priority || '').toLowerCase()]
    var pa = paVal !== undefined ? paVal : 1
    var pb = pbVal !== undefined ? pbVal : 1
    if (pa !== pb) return pa - pb
    return (a.display_name || '').localeCompare(b.display_name || '')
  })

  var [selectedField, setSelectedField] = useState(kpiOptions.length ? kpiOptions[0].field_name : '')
  var [cache,         setCache]         = useState({})
  var [dataState,     setDataState]     = useState('idle')
  var [dataError,     setDataError]     = useState('')
  var [prefetchDone,  setPrefetchDone]  = useState(false)

  var selectedMeta = kpiOptions.find(function(m) { return m.field_name === selectedField })
  var cached       = cache[selectedField]

  // ── Background pre-fetch all KPIs on mount ────────────────────────────────
  useEffect(function() {
    if (!datasetId || !onTrendData || prefetchDone || !kpiOptions.length) return
    setPrefetchDone(true)
    kpiOptions.forEach(function(meta) {
      var field = meta.field_name
      var acc   = meta.accumulation_type || 'cumulative'
      fetch('/api/fetch-trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: datasetId, fieldName: field, accumulationType: acc, yearsBack: 3 }),
      })
        .then(function(r) { return r.json() })
        .then(function(j) {
          if (j.error || !j.data) return
          var agg = j.agg || (acc === 'point_in_time' ? 'AVG' : 'SUM')
          setCache(function(p) {
            if (p[field]) return p
            var n = Object.assign({}, p)
            n[field] = { data: j.data, forecast: null, sql: buildTrendSQL(datasetId, field, agg) }
            return n
          })
          onTrendData(field, j.data, meta)
        })
        .catch(function() {})
    })
  }, [datasetId])

  // ── Selected KPI: data + forecast ────────────────────────────────────────
  useEffect(function() {
    if (!selectedField || !datasetId) return
    var acc = (selectedMeta && selectedMeta.accumulation_type) || 'cumulative'

    // Already fully cached
    if (cached && cached.data && cached.forecast !== null && cached.forecast !== undefined) {
      setDataState('done'); return
    }

    // Data cached, need forecast
    if (cached && cached.data && cached.data.length >= 3 && cached.forecast === null) {
      setDataState('loading')
      // For QTD: aggregate to quarterly series before sending to forecast API
      var seriesForFc = isQTD
        ? buildQuarterlySeriesForForecast(cached.data, timePeriod)
        : cached.data
      fetch('/api/generate-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesData: seriesForFc, valueKey: 'value', labelKey: 'period', horizonMonths: isQTD ? 2 : 3 }),
      })
        .then(function(r) { return r.json() })
        .then(function(fcJson) {
          setCache(function(p) {
            var n = Object.assign({}, p)
            n[selectedField] = Object.assign({}, p[selectedField], { forecast: fcJson.forecasts ? fcJson : null })
            return n
          })
          setDataState('done')
        })
        .catch(function() { setDataState('done') })
      return
    }

    // Full fetch
    setDataState('loading'); setDataError('')
    fetch('/api/fetch-trend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: datasetId, fieldName: selectedField, accumulationType: acc, yearsBack: 3 }),
    })
      .then(function(r) { return r.json() })
      .then(function(trendJson) {
        if (trendJson.error) throw new Error(trendJson.error)
        var trendData = trendJson.data || []
        var agg = trendJson.agg || (acc === 'point_in_time' ? 'AVG' : 'SUM')
        var sql = buildTrendSQL(datasetId, selectedField, agg)
        if (onTrendData) onTrendData(selectedField, trendData, selectedMeta)
        if (trendData.length < 3) {
          setCache(function(p) { var n = Object.assign({}, p); n[selectedField] = { data: trendData, forecast: null, sql: sql }; return n })
          setDataState('done'); return
        }
        var seriesForFc = isQTD ? buildQuarterlySeriesForForecast(trendData, timePeriod) : trendData
        return fetch('/api/generate-forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesData: seriesForFc, valueKey: 'value', labelKey: 'period', horizonMonths: isQTD ? 2 : 3 }),
        })
          .then(function(r) { return r.json() })
          .then(function(fcJson) {
            setCache(function(p) { var n = Object.assign({}, p); n[selectedField] = { data: trendData, forecast: fcJson.forecasts ? fcJson : null, sql: sql }; return n })
            setDataState('done')
          })
      })
      .catch(function(err) { setDataError(err.message); setDataState('error') })
  }, [selectedField])

  if (!kpiOptions.length) return null

  var trendData = (cached && cached.data) || []
  var forecast  = cached && cached.forecast
  var cachedSQL = cached && cached.sql
  var accType   = (selectedMeta && selectedMeta.accumulation_type) || 'cumulative'

  // Build chart data — monthly or quarterly depending on viewType
  var chartData = isQTD
    ? buildQuarterlyData(trendData, forecast, timePeriod, accType)
    : buildMonthlyData(trendData, forecast, timePeriod)

  var curYear  = timePeriod ? parseInt(timePeriod.year) : new Date().getFullYear()
  var curYearLabel = String(curYear)
  var cmpYearLabel = String(curYear - 1)

  // Stats from current period data
  var curVals  = chartData.map(function(r) { return r.curYear }).filter(function(v) { return v !== null && !isNaN(v) })
  var latest   = curVals[curVals.length - 1]
  var earliest = curVals[0]
  var totalChg = (earliest && earliest !== 0) ? ((latest - earliest) / Math.abs(earliest) * 100) : null
  var maxVal   = curVals.length ? Math.max.apply(null, curVals) : null

  // Check if there are any forecast values in the chart data
  var hasForecast = chartData.some(function(r) { return r.forecast !== null && r.forecast !== undefined })

  var unit  = (selectedMeta && selectedMeta.unit) || ''
  var color = P[kpiOptions.indexOf(selectedMeta) % P.length]
  var colorFc = '#F0A030'

  var trendBadge = forecast
    ? (forecast.trend === 'up' ? '↑' : forecast.trend === 'down' ? '↓' : '→') + ' ' + forecast.confidence + ' confidence'
    : null

  var simulateQuery = {
    id: selectedField, title: (selectedMeta && selectedMeta.display_name) || selectedField,
    chart_type: 'area', label_key: 'period', value_key: 'value', unit: unit, sql: cachedSQL || null,
  }

  var xLabel = isQTD ? 'Quarter' : 'Month'
  var periodLabel = isQTD ? 'QTD' : (timePeriod && timePeriod.viewType) || 'YTD'

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 24px 16px', marginBottom: 20,
      position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, ' + color + ', rgba(43,127,227,0.3), transparent)', opacity: 0.6 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
          Trend Explorer
        </p>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
          {periodLabel}
        </span>

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
            <span className="spinner" />loading...
          </span>
        )}
        {trendBadge && dataState === 'done' && (
          <span style={{
            fontSize: 9, padding: '3px 8px', borderRadius: 3, fontWeight: 500,
            background: 'rgba(240,160,48,0.1)', color: colorFc,
            border: '1px solid rgba(240,160,48,0.25)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0,
          }}>{trendBadge}</span>
        )}

        <div style={{ flex: 1 }} />

        {dataState === 'done' && latest != null && <StatPill label={'Latest ' + xLabel} value={fmt(latest) + (unit ? ' ' + unit : '')} color={color} />}
        {dataState === 'done' && totalChg != null && (
          <StatPill label={periodLabel + ' Δ'} value={(totalChg >= 0 ? '+' : '') + totalChg.toFixed(1) + '%'} color={totalChg >= 0 ? '#10C48A' : '#E05555'} />
        )}
        {dataState === 'done' && maxVal != null && <StatPill label="Peak" value={fmt(maxVal) + (unit ? ' ' + unit : '')} />}

        {onSimulate && dataState === 'done' && trendData.length > 0 && cachedSQL && (
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

      {selectedMeta && selectedMeta.definition && (
        <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.55)', marginBottom: 12, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
          {selectedMeta.definition}
        </p>
      )}

      {dataState === 'error' && (
        <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed rgba(224,85,85,0.3)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: '#E05555', fontFamily: 'var(--font-body)' }}>{dataError}</p>
        </div>
      )}
      {dataState === 'loading' && (
        <div style={{ height: 300, display: 'flex', alignItems: 'flex-end', gap: 3, padding: '0 8px' }}>
          {Array.from({ length: isQTD ? 4 : 12 }).map(function(_, i) {
            return <div key={i} className="skeleton" style={{ flex: 1, height: (35 + Math.abs(Math.sin(i * 0.5)) * 50) + '%', borderRadius: '2px 2px 0 0' }} />
          })}
        </div>
      )}
      {dataState === 'done' && trendData.length === 0 && (
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
            No data found for {(selectedMeta && selectedMeta.display_name) || selectedField}
          </p>
        </div>
      )}

      {/* ── Line Chart — works for YTD, MTD, and QTD ───────────────── */}
      {dataState === 'done' && trendData.length > 0 && (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="1 6" stroke="rgba(56,140,255,0.07)" vertical={false} />
            <XAxis dataKey="label" tick={axStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axStyle} width={62} tickFormatter={function(v) { return fmt(v) + (unit ? ' ' + unit : '') }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={ttStyle} formatter={function(v, n) {
              if (v === null || v === undefined) return null
              return [fmt(v) + (unit ? ' ' + unit : ''), n]
            }} />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} />
            {/* Comparison year/period — dashed, muted */}
            <Line type="monotone" dataKey="cmpYear" name={cmpYearLabel}
              stroke={color} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45}
              dot={{ r: 2, fill: color, strokeWidth: 0, fillOpacity: 0.45 }}
              activeDot={{ r: 4 }} connectNulls={false} />
            {/* Current year/period — solid */}
            <Line type="monotone" dataKey="curYear" name={curYearLabel}
              stroke={color} strokeWidth={2.5}
              dot={{ r: 3, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: color, stroke: 'var(--bg)', strokeWidth: 2 }}
              connectNulls={false} />
            {/* Forecast — amber dashed, connects from last actual point */}
            {hasForecast && (
              <Line type="monotone" dataKey="forecast" name="Forecast"
                stroke={colorFc} strokeWidth={2} strokeDasharray="6 3"
                dot={{ r: 3.5, fill: colorFc, strokeWidth: 0 }}
                activeDot={{ r: 5 }} connectNulls={true} />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Forecast footer */}
      {forecast && dataState === 'done' && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            Forecast: {forecast.method || 'linear_regression'} · R² {forecast.r_squared != null ? forecast.r_squared : '—'}
          </span>
          {forecast.forecasts && forecast.forecasts[0] && (
            <span style={{ fontSize: 10, color: colorFc, fontFamily: 'var(--font-mono)' }}>
              Next {isQTD ? 'quarter' : 'month'}: {fmt(forecast.forecasts[0].forecast)}{unit ? ' ' + unit : ''}
              {' '}({fmt(forecast.forecasts[0].forecast_low)} – {fmt(forecast.forecasts[0].forecast_high)})
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build quarterly series for the forecast API from monthly raw data
function buildQuarterlySeriesForForecast(rawData, timePeriod) {
  var byYM = indexByYearMonth(rawData)
  var result = []
  // Get all unique years in the data
  var years = []
  Object.keys(byYM).forEach(function(key) {
    var y = parseInt(key.split('-')[0])
    if (years.indexOf(y) === -1) years.push(y)
  })
  years.sort()
  years.forEach(function(year) {
    for (var q = 1; q <= 4; q++) {
      var months = [(q-1)*3+1, (q-1)*3+2, (q-1)*3+3]
      var vals   = months.map(function(m) { return byYM[year + '-' + m] }).filter(function(v) { return v !== undefined && !isNaN(v) })
      if (vals.length) {
        result.push({ period: year + '-Q' + q, value: vals.reduce(function(a, b) { return a + b }, 0) })
      }
    }
  })
  return result
}
