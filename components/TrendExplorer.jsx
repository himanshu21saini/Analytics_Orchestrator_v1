'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

var MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
var QUARTERS = ['Q1','Q2','Q3','Q4']
var P = ['#00C8F0','#2B7FE3','#00B4A0','#7B8FF0','#F0A030','#9B7FE3','#10C48A','#E05555']

// Convert a fiscal month (1–12) to a calendar month name
function fiscalMonthName(fm, fiscalStartMonth) {
  var calMonth = ((fiscalStartMonth - 1 + fm - 1) % 12) + 1
  return MONTHS[calMonth - 1]
}

// Build a short X-axis label given a FISCAL YEAR number and fiscal month.
// e.g. fiscalYear=2026, fm=1, start=11 → 'Nov-25'
//      fiscalYear=2026, fm=3, start=11 → 'Jan-26'
//      fiscalYear=2025, fm=6, start=11 → 'Apr-25'
function fiscalMonthLabel(fiscalYear, fm, fiscalStartMonth) {
  var calMonth = ((fiscalStartMonth - 1 + fm - 1) % 12) + 1
  // If calMonth >= fiscalStartMonth, it belongs to the calendar year BEFORE fiscal year
  // e.g. FY2026, FM1=Nov: calMonth=11 >= start=11 → calYear = 2026-1 = 2025
  // e.g. FY2026, FM3=Jan: calMonth=1  <  start=11 → calYear = 2026
  var calYear = calMonth >= fiscalStartMonth ? fiscalYear - 1 : fiscalYear
  return MONTHS[calMonth - 1] + '-' + String(calYear).slice(2)
}

var ttStyle = {
  background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)',
  borderRadius: 8, fontSize: 11, color: '#FFFFFF', padding: '8px 12px',
}
var axStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }
var COLOR_FC = '#F0A030'

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

function ModeButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 5, fontSize: 10, fontWeight: 500,
        fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', cursor: 'pointer',
        transition: 'all 0.15s',
        background: active ? 'rgba(0,200,240,0.15)' : 'transparent',
        border: '1px solid ' + (active ? 'var(--accent-border)' : 'var(--border)'),
        color: active ? 'var(--text-accent)' : 'var(--text-tertiary)',
      }}
    >{label}</button>
  )
}

function buildTrendSQL(datasetId, fieldName, agg, yf, mf, distField) {
  yf = yf || 'year'; mf = mf || 'month'
  var curYear = new Date().getFullYear()
  var minYear = curYear - 3
  var valueExpr = distField
    ? "COUNT(DISTINCT data->>'" + distField + "')"
    : agg + "(COALESCE((data->>'" + fieldName + "')::numeric, 0))"
  return [
    'SELECT',
    "  CONCAT(data->>'" + yf + "', '-', LPAD(CAST((data->>'" + mf + "')::integer AS TEXT), 2, '0')) AS period,",
    '  ' + valueExpr + ' AS value',
    'FROM dataset_rows',
    'WHERE dataset_id = ' + datasetId,
    "  AND (data->>'" + yf + "')::integer >= " + minYear,
    "  AND (data->>'" + mf + "') IS NOT NULL",
    "  AND (data->>'" + yf + "') IS NOT NULL",
    "GROUP BY data->>'" + yf + "', data->>'" + mf + "'",
    'ORDER BY period ASC',
  ].join('\n')
}

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

function buildComparisonData(rawData, timePeriod, accType, fiscalCtx) {
  var calYear     = timePeriod && timePeriod.year  ? parseInt(timePeriod.year)  : new Date().getFullYear()
  var calMonth    = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12
  var isQTD       = timePeriod && timePeriod.viewType === 'QTD'
  var fiscal      = fiscalCtx && fiscalCtx.fiscal
  var fsm         = (fiscalCtx && fiscalCtx.fiscalStartMonth) || 11
  var byYM        = indexByYearMonth(rawData)

  // Translate as-of calendar date to fiscal coordinates
  var cutoffFM = fiscal ? ((calMonth - fsm + 12) % 12) + 1 : calMonth
  var curYear  = fiscal
    ? (calMonth >= fsm ? calYear + 1 : calYear)
    : calYear
  var cmpYear  = curYear - 1

  if (isQTD) {
    var cutoffQ = Math.ceil(cutoffFM / 3)
    return QUARTERS.map(function(name, qi) {
      var qNum   = qi + 1
      var months = [qi*3+1, qi*3+2, qi*3+3]
      function qVal(year) {
        var vals = months.map(function(m) { return byYM[year+'-'+m] }).filter(function(v) { return v !== undefined && !isNaN(v) })
        if (!vals.length) return null
        return accType === 'point_in_time'
          ? vals.reduce(function(a,b){return a+b},0) / vals.length
          : vals.reduce(function(a,b){return a+b},0)
      }
      var label = fiscal
        ? ('FQ' + qNum + ' (' + fiscalMonthName(qi*3+1, fsm) + '–' + fiscalMonthName(Math.min(qi*3+3,12), fsm) + ')')
        : name
      return { label, curYear: qNum <= cutoffQ ? qVal(curYear) : null, cmpYear: qVal(cmpYear) }
    })
  }

  return Array.from({ length: 12 }, function(_, i) {
    var fm = i + 1
    // Fiscal: just show month name (Nov, Dec, Jan...) — no year suffix to avoid confusion
    // Calendar: show month name as-is (Jan, Feb...)
    var label = fiscal ? fiscalMonthName(fm, fsm) : MONTHS[i]
    return {
      label,
      curYear: fm <= cutoffFM ? (byYM[curYear+'-'+fm] !== undefined ? byYM[curYear+'-'+fm] : null) : null,
      cmpYear: byYM[cmpYear+'-'+fm] !== undefined ? byYM[cmpYear+'-'+fm] : null,
    }
  })
}

function buildForecastData(rawData, forecast, timePeriod, fiscalCtx) {
  var calYear     = timePeriod && timePeriod.year  ? parseInt(timePeriod.year)  : new Date().getFullYear()
  var calMonth    = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12
  var isQTD       = timePeriod && timePeriod.viewType === 'QTD'
  var fiscal      = fiscalCtx && fiscalCtx.fiscal
  var fsm         = (fiscalCtx && fiscalCtx.fiscalStartMonth) || 11

  var cutoffFM = fiscal ? ((calMonth - fsm + 12) % 12) + 1 : calMonth
  var curFY    = fiscal ? (calMonth >= fsm ? calYear + 1 : calYear) : calYear

  var actual = (rawData || [])
    .filter(function(row) {
      var parts = String(row.period || '').split('-')
      if (parts.length < 2) return false
      var y = parseInt(parts[0]); var m = parseInt(parts[1])
      if (isNaN(y) || isNaN(m)) return false
      if (isQTD) return y === curFY && Math.ceil(m / 3) <= Math.ceil(cutoffFM / 3)
      return y === curFY && m <= cutoffFM
    })
    .map(function(row) {
      var parts = String(row.period || '').split('-')
      var fm = parseInt(parts[1])
      var label = isQTD
        ? ('Q' + Math.ceil(fm / 3))
        : fiscal
          ? fiscalMonthLabel(curFY, fm, fsm)
          : (MONTHS[fm - 1] + '-' + String(curFY).slice(2))
      return { label, actual: parseFloat(row.value), forecast: null, fc_low: null, fc_high: null }
    })

  if (isQTD) {
    var qMap = {}
    actual.forEach(function(row) {
      if (!qMap[row.label]) qMap[row.label] = { sum: 0 }
      qMap[row.label].sum += row.actual
    })
    actual = QUARTERS
      .filter(function(q) { return qMap[q] })
      .map(function(q) { return { label: q, actual: qMap[q].sum, forecast: null, fc_low: null, fc_high: null } })
  }

  if (forecast && forecast.forecasts && forecast.forecasts.length > 0) {
    forecast.forecasts.forEach(function(f, i) {
      var label
      if (isQTD) {
        var lastQ = actual.length > 0 ? parseInt(actual[actual.length - 1].label.replace('Q','')) : 0
        label = 'Q' + (lastQ + i + 1)
      } else {
        var parts = String(f.period || '').split('-')
        var fy2 = parseInt(parts[0]); var fm2 = parseInt(parts[1])
        label = fiscal
          ? fiscalMonthLabel(fy2, fm2, fsm)
          : (!isNaN(fm2) ? (MONTHS[fm2 - 1] + '-' + String(fy2).slice(2)) : f.period)
      }
      actual.push({ label, actual: null, forecast: f.forecast, fc_low: f.forecast_low, fc_high: f.forecast_high })
    })
  }

  return actual
}

export default function TrendExplorer({ metadata, datasetId, timePeriod, onSimulate, onTrendData }) {

  var isQTD = timePeriod && timePeriod.viewType === 'QTD'
  var yf    = (timePeriod && timePeriod.yearField)  || 'year'
  var mf    = (timePeriod && timePeriod.monthField) || 'month'

  var kpiOptions = (metadata || []).filter(function(m) {
    return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N'
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
  var [chartMode,     setChartMode]     = useState('comparison')
  var [cache,         setCache]         = useState({})
  var [dataState,     setDataState]     = useState('idle')
  var [dataError,     setDataError]     = useState('')
  var [prefetchDone,  setPrefetchDone]  = useState(false)

  // Cache key includes yf/mf so fiscal vs report calendar changes force a re-fetch
  function cacheKey(field) { return field + '|' + yf + '|' + mf }

  var selectedMeta = kpiOptions.find(function(m) { return m.field_name === selectedField })
  var cached       = cache[cacheKey(selectedField)]

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
        body: JSON.stringify({ datasetId: datasetId, fieldName: field, accumulationType: acc, yearsBack: 3, yearField: yf, monthField: mf, calculationLogic: meta.calculation_logic || '', dependencies: meta.dependencies || '' }),
      })
        .then(function(r) { return r.json() })
        .then(function(j) {
          if (j.error || !j.data) return
          var agg = j.agg || (acc === 'point_in_time' ? 'AVG' : 'SUM')
          var isCD = /distinct/i.test(meta.calculation_logic || '')
          var distField = isCD ? (meta.dependencies || '') : null
          var sql = buildTrendSQL(datasetId, field, agg, yf, mf, distField)
          setCache(function(p) {
            if (p[cacheKey(field)]) return p
            var n = Object.assign({}, p)
            n[cacheKey(field)] = { data: j.data, forecast: null, sql: sql,
              fiscal: j.fiscal, fiscalStartMonth: j.fiscalStartMonth }
            return n
          })
          onTrendData(field, j.data, meta, sql)
        })
        .catch(function() {})
    })
  }, [datasetId])

  // ── Fetch forecast when user switches to forecast mode ───────────────────
  // Only triggers when chartMode === 'forecast' and forecast not yet fetched
  useEffect(function() {
    if (!selectedField || !datasetId) return
    var acc = (selectedMeta && selectedMeta.accumulation_type) || 'cumulative'

    // In comparison mode: just need raw data — prefetch handles it
    if (chartMode === 'comparison') {
      if (cached && cached.data) { setDataState('done'); return }
      // No data yet — full fetch
      setDataState('loading'); setDataError('')
      fetch('/api/fetch-trend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: datasetId, fieldName: selectedField, accumulationType: acc, yearsBack: 3, yearField: yf, monthField: mf, calculationLogic: (selectedMeta && selectedMeta.calculation_logic) || '', dependencies: (selectedMeta && selectedMeta.dependencies) || '' }),
      })
        .then(function(r) { return r.json() })
        .then(function(j) {
          if (j.error) throw new Error(j.error)
          var agg = j.agg || (acc === 'point_in_time' ? 'AVG' : 'SUM')
          var isCD2 = /distinct/i.test((selectedMeta && selectedMeta.calculation_logic) || '')
          var df2   = isCD2 ? ((selectedMeta && selectedMeta.dependencies) || '') : null
          if (onTrendData) onTrendData(selectedField, j.data || [], selectedMeta)
          setCache(function(p) { var n = Object.assign({}, p); n[cacheKey(selectedField)] = { data: j.data || [], forecast: null, sql: buildTrendSQL(datasetId, selectedField, agg, yf, mf, df2),
            fiscal: j.fiscal, fiscalStartMonth: j.fiscalStartMonth }; return n })
          setDataState('done')
        })
        .catch(function(err) { setDataError(err.message); setDataState('error') })
      return
    }

    // Forecast mode: need both data and forecast
    // Case 1: already have forecast
    if (cached && cached.data && cached.forecast && cached.forecast !== false && cached.forecast !== null) {
      setDataState('done'); return
    }

    // Helper: filter raw data to current year up to cutoff, for accurate forecast projection
    function currentYearSeries(data) {
      var cy = timePeriod && timePeriod.year ? parseInt(timePeriod.year) : new Date().getFullYear()
      var cm = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12
      return (data || []).filter(function(row) {
        var parts = String(row.period || '').split('-')
        if (parts.length < 2) return false
        var y = parseInt(parts[0]); var m = parseInt(parts[1])
        return !isNaN(y) && !isNaN(m) && y === cy && m <= cm
      })
    }

    // Case 2: have data, need forecast
    if (cached && cached.data && cached.data.length >= 3) {
      setDataState('loading')
      var curYearData = currentYearSeries(cached.data)
      var seriesForFc = isQTD ? buildQtrSeriesForFc(curYearData.length >= 3 ? curYearData : cached.data) : (curYearData.length >= 3 ? curYearData : cached.data)
      fetch('/api/generate-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesData: seriesForFc, valueKey: 'value', labelKey: 'period', horizonMonths: isQTD ? 2 : 3 }),
      })
        .then(function(r) { return r.json() })
        .then(function(fcJson) {
          var fcResult = (fcJson && fcJson.forecasts && fcJson.forecasts.length > 0) ? fcJson : false
          setCache(function(p) {
            var n = Object.assign({}, p)
            n[cacheKey(selectedField)] = Object.assign({}, p[cacheKey(selectedField)], { forecast: fcResult })
            return n
          })
          setDataState('done')
        })
        .catch(function() { setDataState('done') })
      return
    }
    // Case 3: no data at all — full fetch then forecast
    setDataState('loading'); setDataError('')
    fetch('/api/fetch-trend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: datasetId, fieldName: selectedField, accumulationType: acc, yearsBack: 3, yearField: yf, monthField: mf, calculationLogic: (selectedMeta && selectedMeta.calculation_logic) || '', dependencies: (selectedMeta && selectedMeta.dependencies) || '' }),
    })
      .then(function(r) { return r.json() })
      .then(function(j) {
        if (j.error) throw new Error(j.error)
        var trendData = j.data || []
        var agg = j.agg || (acc === 'point_in_time' ? 'AVG' : 'SUM')
        var isCD3 = /distinct/i.test((selectedMeta && selectedMeta.calculation_logic) || '')
        var df3   = isCD3 ? ((selectedMeta && selectedMeta.dependencies) || '') : null
        if (onTrendData) onTrendData(selectedField, trendData, selectedMeta)
        if (trendData.length < 3) {
          setCache(function(p) { var n = Object.assign({}, p); n[cacheKey(selectedField)] = { data: trendData, forecast: false, sql: buildTrendSQL(datasetId, selectedField, agg, yf, mf, df3),
            fiscal: j.fiscal, fiscalStartMonth: j.fiscalStartMonth }; return n })
          setDataState('done'); return
        }
        var seriesForFc = isQTD ? buildQtrSeriesForFc(trendData) : trendData
        var curYearOnly = (trendData || []).filter(function(row) {
          var parts = String(row.period || '').split('-')
          if (parts.length < 2) return false
          var y = parseInt(parts[0]); var m = parseInt(parts[1])
          var cy = timePeriod && timePeriod.year ? parseInt(timePeriod.year) : new Date().getFullYear()
          var cm = timePeriod && timePeriod.month ? parseInt(timePeriod.month) : 12
          return !isNaN(y) && !isNaN(m) && y === cy && m <= cm
        })
        seriesForFc = isQTD
          ? buildQtrSeriesForFc(curYearOnly.length >= 3 ? curYearOnly : trendData)
          : (curYearOnly.length >= 3 ? curYearOnly : trendData)
        return fetch('/api/generate-forecast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seriesData: seriesForFc, valueKey: 'value', labelKey: 'period', horizonMonths: isQTD ? 2 : 3 }),
        })
          .then(function(r) { return r.json() })
          .then(function(fcJson) {
            var fcResult = (fcJson && fcJson.forecasts && fcJson.forecasts.length > 0) ? fcJson : false
            setCache(function(p) { var n = Object.assign({}, p); n[cacheKey(selectedField)] = { data: trendData, forecast: fcResult, sql: buildTrendSQL(datasetId, selectedField, agg, yf, mf, df3),
              fiscal: j.fiscal, fiscalStartMonth: j.fiscalStartMonth }; return n })
            setDataState('done')
          })
      })
      .catch(function(err) { setDataError(err.message); setDataState('error') })
  }, [selectedField, chartMode])

  if (!kpiOptions.length) return null

  var trendData = (cached && cached.data) || []
  var forecast  = (cached && cached.forecast && cached.forecast !== false) ? cached.forecast : null
  var cachedSQL = cached && cached.sql
  var accType   = (selectedMeta && selectedMeta.accumulation_type) || 'cumulative'

  // Derive fiscal directly from the yearField — don't rely on cached.fiscal
  // which may not be set if the pre-fetch hasn't completed yet
  var fiscalCtx = {
    fiscal:           /fiscal/i.test(yf),
    fiscalStartMonth: (cached && cached.fiscalStartMonth) || 11,
  }

  var curYear   = timePeriod ? parseInt(timePeriod.year) : new Date().getFullYear()
  var unit      = (selectedMeta && selectedMeta.unit) || ''
  var color     = P[kpiOptions.indexOf(selectedMeta) % P.length]
  var periodLabel = isQTD ? 'QTD' : (timePeriod && timePeriod.viewType) || 'YTD'

  // Fiscal-aware legend labels
  var isFiscal = fiscalCtx && fiscalCtx.fiscal
  var fsm = (fiscalCtx && fiscalCtx.fiscalStartMonth) || 11
  var calMonth = timePeriod ? parseInt(timePeriod.month) : 12
  var fiscalCurYear = isFiscal
    ? (calMonth >= fsm ? curYear + 1 : curYear)
    : curYear
  var curYearLabel = isFiscal ? 'FY' + fiscalCurYear       : String(curYear)
  var cmpYearLabel = isFiscal ? 'FY' + (fiscalCurYear - 1) : String(curYear - 1)

  // Build chart data based on mode
  var chartData = chartMode === 'forecast'
    ? buildForecastData(trendData, forecast, timePeriod, fiscalCtx)
    : buildComparisonData(trendData, timePeriod, accType, fiscalCtx)

  // Stats always from actual data
  var actualVals = chartMode === 'forecast'
    ? chartData.map(function(r) { return r.actual }).filter(function(v) { return v !== null && !isNaN(v) })
    : chartData.map(function(r) { return r.curYear }).filter(function(v) { return v !== null && !isNaN(v) })
  var latest   = actualVals[actualVals.length - 1]
  var earliest = actualVals[0]
  var totalChg = (earliest && earliest !== 0) ? ((latest - earliest) / Math.abs(earliest) * 100) : null
  var maxVal   = actualVals.length ? Math.max.apply(null, actualVals) : null

  var hasForecast = chartMode === 'forecast' && chartData.some(function(r) { return r.forecast !== null && r.forecast !== undefined })

  var trendBadge = forecast
    ? (forecast.trend === 'up' ? '↑' : forecast.trend === 'down' ? '↓' : '→') + ' ' + forecast.confidence + ' conf.'
    : null

  var simulateQuery = {
    id: selectedField, title: (selectedMeta && selectedMeta.display_name) || selectedField,
    chart_type: 'area', label_key: 'period', value_key: 'value', unit: unit, sql: cachedSQL || null,
  }

  var isLoading = dataState === 'loading'
  var isError   = dataState === 'error'
  var isEmpty   = dataState === 'done' && !trendData.length

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 24px 16px', marginBottom: 20,
      position: 'relative', overflow: 'hidden', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, ' + color + ', rgba(43,127,227,0.3), transparent)', opacity: 0.6 }} />

      {/* ── Header row ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>

        {/* Section label + period badge */}
        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
          Trend Explorer
        </p>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0 }}>
          {periodLabel}
        </span>

        {/* KPI selector */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <select
            value={selectedField}
            onChange={function(e) { setSelectedField(e.target.value); setDataState('idle') }}
            style={{
              appearance: 'none', padding: '7px 32px 7px 12px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-display)',
              cursor: 'pointer', outline: 'none', letterSpacing: '-0.01em', minWidth: 220,
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

        {/* Mode toggle buttons */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <ModeButton label="Comparison" active={chartMode === 'comparison'} onClick={function() { setChartMode('comparison') }} />
          <ModeButton label="Forecast"   active={chartMode === 'forecast'}   onClick={function() { setChartMode('forecast') }} />
        </div>

        {/* Loading / forecast badge */}
        {isLoading && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="spinner" />{chartMode === 'forecast' ? 'computing forecast...' : 'loading...'}
          </span>
        )}
        {!isLoading && chartMode === 'forecast' && trendBadge && (
          <span style={{
            fontSize: 9, padding: '3px 8px', borderRadius: 3, fontWeight: 500,
            background: 'rgba(240,160,48,0.1)', color: COLOR_FC,
            border: '1px solid rgba(240,160,48,0.25)',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0,
          }}>{trendBadge}</span>
        )}
        {!isLoading && chartMode === 'forecast' && forecast === null && !isLoading && trendData.length >= 3 && dataState === 'done' && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>no forecast available</span>
        )}

        <div style={{ flex: 1 }} />

        {/* Stats */}
        {latest != null && <StatPill label="Latest" value={fmt(latest) + (unit ? ' ' + unit : '')} color={color} />}
        {totalChg != null && (
          <StatPill label={periodLabel + ' Δ'} value={(totalChg >= 0 ? '+' : '') + totalChg.toFixed(1) + '%'} color={totalChg >= 0 ? '#10C48A' : '#E05555'} />
        )}
        {maxVal != null && <StatPill label="Peak" value={fmt(maxVal) + (unit ? ' ' + unit : '')} />}

        {/* Simulate button */}
        {onSimulate && trendData.length > 0 && cachedSQL && (
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

      {/* States */}
      {isError && (
        <div style={{ padding: '24px', textAlign: 'center', border: '1px dashed rgba(224,85,85,0.3)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: '#E05555', fontFamily: 'var(--font-body)' }}>{dataError}</p>
        </div>
      )}
      {isLoading && (
        <div style={{ height: 300, display: 'flex', alignItems: 'flex-end', gap: 3, padding: '0 8px' }}>
          {Array.from({ length: isQTD ? 4 : 12 }).map(function(_, i) {
            return <div key={i} className="skeleton" style={{ flex: 1, height: (35 + Math.abs(Math.sin(i * 0.5)) * 50) + '%', borderRadius: '2px 2px 0 0' }} />
          })}
        </div>
      )}
      {isEmpty && (
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
            No data found for {(selectedMeta && selectedMeta.display_name) || selectedField}
          </p>
        </div>
      )}

      {/* ── Chart ──────────────────────────────────────────────────── */}
      {!isLoading && !isError && !isEmpty && trendData.length > 0 && (
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

            {/* COMPARISON MODE: two year lines */}
            {chartMode === 'comparison' && (
              <Line type="monotone" dataKey="cmpYear" name={cmpYearLabel}
                stroke={color} strokeWidth={1.5} strokeDasharray="5 3" strokeOpacity={0.45}
                dot={{ r: 2, fill: color, strokeWidth: 0, fillOpacity: 0.45 }}
                activeDot={{ r: 4 }} connectNulls={false} />
            )}
            {chartMode === 'comparison' && (
              <Line type="monotone" dataKey="curYear" name={curYearLabel}
                stroke={color} strokeWidth={2.5}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: color, stroke: 'var(--bg)', strokeWidth: 2 }}
                connectNulls={false} />
            )}

            {/* FORECAST MODE: actual + forecast + confidence band */}
            {chartMode === 'forecast' && (
              <Line type="monotone" dataKey="actual" name={String(curYear) + ' actual'}
                stroke={color} strokeWidth={2.5}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: color, stroke: 'var(--bg)', strokeWidth: 2 }}
                connectNulls={false} />
            )}
            {chartMode === 'forecast' && hasForecast && (
              <Line type="monotone" dataKey="forecast" name="Forecast"
                stroke={COLOR_FC} strokeWidth={2} strokeDasharray="6 3"
                dot={{ r: 3.5, fill: COLOR_FC, strokeWidth: 0 }}
                activeDot={{ r: 5 }} connectNulls={true} />
            )}
            {/* Confidence band — upper and lower bounds, very faint */}
            {chartMode === 'forecast' && hasForecast && (
              <Line type="monotone" dataKey="fc_high" name="Upper bound"
                stroke={COLOR_FC} strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.4}
                dot={false} activeDot={false} connectNulls={true} legendType="none" />
            )}
            {chartMode === 'forecast' && hasForecast && (
              <Line type="monotone" dataKey="fc_low" name="Lower bound"
                stroke={COLOR_FC} strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.4}
                dot={false} activeDot={false} connectNulls={true} legendType="none" />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Forecast footer */}
      {chartMode === 'forecast' && forecast && dataState === 'done' && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {forecast.method || 'linear_regression'} · R² {forecast.r_squared != null ? forecast.r_squared : '—'}
          </span>
          {forecast.forecasts && forecast.forecasts[0] && (
            <span style={{ fontSize: 10, color: COLOR_FC, fontFamily: 'var(--font-mono)' }}>
              Next {isQTD ? 'quarter' : 'month'}: {fmt(forecast.forecasts[0].forecast)}{unit ? ' ' + unit : ''}
              {' '}({fmt(forecast.forecasts[0].forecast_low)} – {fmt(forecast.forecasts[0].forecast_high)})
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Aggregate monthly data to quarterly for forecast API ─────────────────────
function buildQtrSeriesForFc(rawData) {
  var byYM = {}
  ;(rawData || []).forEach(function(row) {
    var parts = String(row.period || '').split('-')
    if (parts.length < 2) return
    var y = parseInt(parts[0]); var m = parseInt(parts[1])
    if (!isNaN(y) && !isNaN(m)) byYM[y+'-'+m] = parseFloat(row.value)
  })
  var years = []
  Object.keys(byYM).forEach(function(k) {
    var y = parseInt(k.split('-')[0])
    if (years.indexOf(y) === -1) years.push(y)
  })
  years.sort()
  var result = []
  years.forEach(function(year) {
    for (var q = 1; q <= 4; q++) {
      var months = [(q-1)*3+1, (q-1)*3+2, (q-1)*3+3]
      var vals   = months.map(function(m) { return byYM[year+'-'+m] }).filter(function(v) { return v !== undefined && !isNaN(v) })
      if (vals.length) result.push({ period: year+'-Q'+q, value: vals.reduce(function(a,b){return a+b},0) })
    }
  })
  return result
}
