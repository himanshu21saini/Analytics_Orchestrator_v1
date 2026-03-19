'use client'

import { useState } from 'react'
import {
  BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import KPICard from './KPICard'
import SummaryPanel from './SummaryPanel'
import DecisionPanel from './DecisionPanel'
import WhatIfDrawer from './WhatIfDrawer'
import TrendExplorer from './TrendExplorer'
import TokenMeter from './TokenMeter'

// ESSEX-inspired teal/blue palette
var P  = ['#00C8F0','#2B7FE3','#00B4A0','#7B8FF0','#F0A030','#9B7FE3','#10C48A','#E05555']
var PA = ['rgba(0,200,240,0.5)','rgba(43,127,227,0.5)','rgba(0,180,160,0.5)','rgba(123,143,240,0.5)','rgba(240,160,48,0.5)','rgba(155,127,227,0.5)','rgba(16,196,138,0.5)','rgba(224,85,85,0.5)']
var PC = ['rgba(0,200,240,0.12)','rgba(43,127,227,0.12)','rgba(0,180,160,0.12)','rgba(123,143,240,0.12)']

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return String(v || '')
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

var ttStyle = {
  background: '#0D1930',
  border: '1px solid rgba(0,200,240,0.2)',
  borderRadius: 8,
  fontSize: 11,
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  color: '#FFFFFF',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  padding: '8px 12px',
}

var axStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }

function ChartCard({ title, insight, children, index, badge, fullWidth, onSimulate }) {
  return (
    <div
      className={'fade-up d' + Math.min(index + 2, 6)}
      style={{
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 16px 10px',
        gridColumn: fullWidth ? '1 / -1' : 'auto',
        transition: 'border-color var(--transition), box-shadow var(--transition)',
        position: 'relative', overflow: 'hidden',
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={function(e) {
        e.currentTarget.style.borderColor = 'var(--accent-border)'
        e.currentTarget.style.boxShadow = '0 0 24px rgba(0,200,240,0.06)'
      }}
      onMouseLeave={function(e) {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Top teal accent */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />
      {/* Corner brackets */}
      <div style={{ position: 'absolute', top: 6, right: 8, width: 10, height: 10, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', borderRadius: '0 3px 0 0', opacity: 0.5 }} />
      <div style={{ position: 'absolute', bottom: 6, left: 8, width: 10, height: 10, borderBottom: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', borderRadius: '0 0 0 3px', opacity: 0.3 }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-body)' }}>
            {title}
          </p>
          {insight && (
            <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.5)', marginTop: 3, fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>
              {insight}
            </p>
          )}
        </div>
        {badge && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 500, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', whiteSpace: 'nowrap', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
            {badge}
          </span>
        )}
        {onSimulate && (
          <button
            onClick={onSimulate}
            style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 3, fontWeight: 500,
              background: 'rgba(155,127,227,0.1)', color: '#9B7FE3',
              border: '1px solid rgba(155,127,227,0.3)',
              whiteSpace: 'nowrap', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)',
              cursor: 'pointer', transition: 'all var(--transition)', flexShrink: 0,
            }}
            onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.2)' }}
            onMouseLeave={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.1)' }}
          >
            ⟳ Simulate
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard({ session }) {
  var [summaryState, setSummaryState] = useState('idle')
  var [narrative,    setNarrative]    = useState(null)
  var [summaryError, setSummaryError] = useState('')

  var [decisionState, setDecisionState] = useState('idle')
  var [decisionResult, setDecisionResult] = useState(null)
  var [decisionError,  setDecisionError]  = useState('')

  var [whatifQuery, setWhatifQuery] = useState(null)

  var [tokenCalls, setTokenCalls] = useState(function() {
    // Seed with generate-queries usage that already ran in SetupScreen
    if (session.initialUsage) {
      return [{ label: 'queries', promptTokens: session.initialUsage.prompt_tokens, completionTokens: session.initialUsage.completion_tokens, model: session.initialUsage.model || 'gpt-4o' }]
    }
    return []
  })

  // Accumulates trend data fetched by TrendExplorer so Generate Report/Decisions
  // can include it. Shape: { [field_name]: { data: [...], meta: {...} } }
  var [trendDataCache, setTrendDataCache] = useState({})

  function handleTrendData(fieldName, data, meta) {
    setTrendDataCache(function(prev) {
      var next = Object.assign({}, prev)
      next[fieldName] = { data: data, meta: meta }
      return next
    })
  }

  var queryResults = session.queryResults || []
  var metadata     = session.metadata     || []
  var periodInfo   = session.periodInfo   || {}
  var allQueries   = session.queries      || []

  var kpiResults   = queryResults.filter(function(r) { return r.chart_type === 'kpi' && !r.error && r.data && r.data.length })
  var trendResults = queryResults.filter(function(r) { return (r.chart_type === 'line' || r.chart_type === 'area') && !r.error && r.data && r.data.length })
  var chartResults = queryResults.filter(function(r) { return r.chart_type !== 'kpi' && r.chart_type !== 'line' && r.chart_type !== 'area' && !r.error && r.data && r.data.length })
  var failed       = queryResults.filter(function(r) { return !!r.error })

  // Build enriched payload for LLM calls.
  // Converts each cached trend series into BOTH:
  //   1. A synthetic 'kpi' result — so generate-decisions can read it as a KPI
  //      with current_value (latest data point) and comparison_value (year-ago point)
  //   2. A synthetic 'area' result — so generate-summary sees the full time series
  // This ensures trend data appears in health scores, decisions, AND narratives.
  function buildEnrichedQueryResults() {
    var existingKpiFields = new Set(
      queryResults
        .filter(function(r) { return r.chart_type === 'kpi' })
        .map(function(r) { return r.id })
    )

    var syntheticResults = []

    Object.keys(trendDataCache).forEach(function(field) {
      var entry    = trendDataCache[field]
      var meta     = entry.meta || {}
      var data     = entry.data || []
      if (!data.length) return

      // Sort chronologically
      var sorted = data.slice().sort(function(a, b) {
        return String(a.period || '').localeCompare(String(b.period || ''))
      })

      var latest   = sorted[sorted.length - 1]
      var latestVal = parseFloat((latest && latest.value) || 0)

      // Find year-ago point (12 periods back) for comparison
      var yearAgoIdx = sorted.length >= 13 ? sorted.length - 13 : 0
      var yearAgo    = sorted[yearAgoIdx]
      var yearAgoVal = parseFloat((yearAgo && yearAgo.value) || 0)

      // 1. Synthetic KPI card result — only add if not already present as a real KPI
      if (!existingKpiFields.has(field)) {
        syntheticResults.push({
          id:              'trend_kpi_' + field,
          title:           meta.display_name || field,
          chart_type:      'kpi',
          current_key:     'current_value',
          comparison_key:  'comparison_value',
          value_key:       'current_value',
          unit:            meta.unit || '',
          data:            [{ current_value: latestVal, comparison_value: yearAgoVal }],
          error:           null,
          _from_trend:     true,
        })
      }

      // 2. Trend series result — always add so the LLM sees trajectory
      syntheticResults.push({
        id:         'trend_series_' + field,
        title:      (meta.display_name || field) + ' monthly trend',
        chart_type: 'area',
        label_key:  'period',
        value_key:  'value',
        unit:       meta.unit || '',
        data:       sorted.slice(-24), // last 24 months max — keeps payload lean
        error:      null,
      })
    })

    return queryResults.concat(syntheticResults)
  }

  // Max 8 KPI cards (4 per row × 2 rows)
  var visibleKpis = kpiResults.slice(0, 8)

  async function handleGenerateSummary() {
    setSummaryState('loading'); setNarrative(null); setSummaryError('')
    try {
      var enriched = buildEnrichedQueryResults()
      var res = await fetch('/api/generate-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queryResults: enriched, metadata, periodInfo }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed.')
      setNarrative(json.result.narrative); setSummaryState('done')
      if (json.usage) {
        setTokenCalls(function(prev) { return prev.concat([{ label: 'summary', promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, model: json.usage.model || 'gpt-4o-mini' }]) })
      }
    } catch (err) { setSummaryError(err.message); setSummaryState('error') }
  }

  async function handleGenerateDecisions() {
    setDecisionState('loading'); setDecisionResult(null); setDecisionError('')
    try {
      var enriched = buildEnrichedQueryResults()
      var res = await fetch('/api/generate-decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queryResults: enriched, metadata, periodInfo }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed.')
      setDecisionResult(json.result); setDecisionState('done')
      if (json.usage) {
        setTokenCalls(function(prev) { return prev.concat([{ label: 'decisions', promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, model: json.usage.model || 'gpt-4o' }]) })
      }
    } catch (err) { setDecisionError(err.message); setDecisionState('error') }
  }

  function getInsight(resultId) {
    var q = allQueries.find(function(q) { return q.id === resultId })
    return q ? q.insight : null
  }

  function renderChart(result, idx) {
    var labelKey = result.label_key    || 'label'
    var curKey   = result.current_key  || result.value_key || 'current_value'
    var cmpKey   = result.comparison_key
    var valueKey = result.value_key    || 'value'
    var data     = result.data || []
    var hasComp  = cmpKey && data.some(function(r) { return r[cmpKey] != null })
    var color    = P[idx % P.length]
    var colorA   = PA[idx % PA.length]
    var colorC   = PC[idx % PC.length]
    var badge    = hasComp && periodInfo.cmpLabel ? periodInfo.cmpLabel : null
    var isFirst  = idx === 0
    var insight  = getInsight(result.id)
    var ct       = result.chart_type

    // Find the full query object (has .sql) for the what-if simulator
    var fullQuery = allQueries.find(function(q) { return q.id === result.id }) || result
    var simulateQuery = Object.assign({}, fullQuery, {
      label_key:      result.label_key,
      value_key:      result.value_key,
      current_key:    result.current_key,
      comparison_key: result.comparison_key,
      unit:           result.unit,
      chart_type:     result.chart_type,
    })
    function onSimulate() { setWhatifQuery(simulateQuery) }

    if (ct === 'bar') {
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} badge={badge} fullWidth={isFirst} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 28 }} barGap={2}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey={labelKey} tick={axStyle} angle={-30} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
              <Bar dataKey={curKey} name={periodInfo.viewLabel || 'Current'} fill={colorA} stroke={color} strokeWidth={0.5} radius={[2,2,0,0]} maxBarSize={hasComp ? 22 : 40} />
              {hasComp && <Bar dataKey={cmpKey} name={periodInfo.cmpLabel || 'Prior'} fill={colorC} stroke={color} strokeWidth={0.5} radius={[2,2,0,0]} maxBarSize={22} />}
              {hasComp && <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} />}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    if (ct === 'stacked_bar') {
      var seriesKeys = result.series_keys || Object.keys(data[0] || {}).filter(function(k) { return k !== labelKey })
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} fullWidth={isFirst} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 28 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey={labelKey} tick={axStyle} angle={-30} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} />
              {seriesKeys.map(function(sk, si) { return <Bar key={sk} dataKey={sk} stackId="a" fill={PA[si % PA.length]} stroke={P[si % P.length]} strokeWidth={0.5} maxBarSize={44} /> })}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    // line and area chart types are rendered by TrendExplorer above the chart grid

    if (ct === 'pie' || ct === 'donut') {
      var innerR = ct === 'donut' ? 48 : 0
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} cx="50%" cy="44%" innerRadius={innerR} outerRadius={82} dataKey={valueKey} nameKey={labelKey} paddingAngle={ct === 'donut' ? 2 : 1} strokeWidth={0}>
                {data.map(function(entry, i) { return <Cell key={i} fill={PA[i % PA.length]} stroke={P[i % P.length]} strokeWidth={0.5} /> })}
              </Pie>
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v), n] }} />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} iconSize={6} formatter={function(v) { return v && v.length > 18 ? v.slice(0,16) + '...' : v }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    if (ct === 'scatter') {
      var xKey = result.x_key || 'x_value'; var yKey = result.y_key || 'y_value'
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" />
              <XAxis dataKey={xKey} type="number" tick={axStyle} tickFormatter={fmt} axisLine={false} tickLine={false} name={xKey} />
              <YAxis dataKey={yKey} type="number" tick={axStyle} tickFormatter={fmt} width={52} axisLine={false} tickLine={false} name={yKey} />
              <ZAxis range={[30,30]} />
              <Tooltip contentStyle={ttStyle} content={function(props) {
                if (!props.active || !props.payload || !props.payload.length) return null
                var d = props.payload[0] && props.payload[0].payload; if (!d) return null
                return (
                  <div style={ttStyle}>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-accent)' }}>{d[labelKey] || d.label || ''}</p>
                    <p style={{ fontSize: 11, color: '#8BB4D8' }}>{xKey}: {fmt(d[xKey])}</p>
                    <p style={{ fontSize: 11, color: '#8BB4D8' }}>{yKey}: {fmt(d[yKey])}</p>
                  </div>
                )
              }} />
              <Scatter data={data} fill={color} opacity={0.85} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }
    return null
  }

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 28px 80px' }}>

      {/* ── Period Banner ─────────────────────────────────────────── */}
      {periodInfo.viewLabel && (
        <div className="fade-in" style={{ marginBottom: 24 }}>

          {/* Top row: title + buttons */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {periodInfo.viewLabel}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-accent)', marginTop: 4, fontFamily: 'var(--font-body)', letterSpacing: '0.06em' }}>
                {periodInfo.cmpLabel}
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {visibleKpis.length} indicators
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {trendResults.length} trends
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {chartResults.length} charts
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={handleGenerateDecisions}
                disabled={decisionState === 'loading'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                  background: decisionState === 'loading' ? 'transparent' : 'linear-gradient(135deg, rgba(123,143,240,0.18) 0%, rgba(83,74,183,0.12) 100%)',
                  border: '1px solid ' + (decisionState === 'loading' ? 'var(--border)' : 'rgba(123,143,240,0.4)'),
                  borderRadius: 'var(--radius-md)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: decisionState === 'loading' ? 'var(--text-tertiary)' : '#7B8FF0',
                  cursor: decisionState === 'loading' ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
                  boxShadow: decisionState === 'loading' ? 'none' : '0 0 16px rgba(123,143,240,0.1)',
                }}
              >
                {decisionState === 'loading'
                  ? <><span className="spinner" /> Analysing...</>
                  : <>{decisionState === 'done' ? 'Refresh Decisions' : 'Generate Decisions'}</>
                }
              </button>

              <button
                onClick={handleGenerateSummary}
                disabled={summaryState === 'loading'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                  background: summaryState === 'loading' ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
                  border: '1px solid ' + (summaryState === 'loading' ? 'var(--border)' : 'var(--accent-border)'),
                  borderRadius: 'var(--radius-md)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: summaryState === 'loading' ? 'var(--text-tertiary)' : 'var(--text-accent)',
                  cursor: summaryState === 'loading' ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
                  boxShadow: summaryState === 'loading' ? 'none' : '0 0 16px rgba(0,200,240,0.08)',
                }}
              >
                {summaryState === 'loading'
                  ? <><span className="spinner" /> Composing...</>
                  : <>{summaryState === 'done' ? 'Regenerate Report' : 'Generate Report'}</>
                }
              </button>
            </div>
          </div>

          {/* Token meter — always visible once dashboard loads (queries usage seeded from SetupScreen) */}
          {tokenCalls.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <TokenMeter calls={tokenCalls} />
            </div>
          )}
        </div>
      )}

      {/* Teal divider */}
      <div style={{ height: '1px', background: 'linear-gradient(90deg, var(--accent), rgba(43,127,227,0.3), transparent)', opacity: 0.3, marginBottom: 24 }} />

      {/* ── KPI Cards (max 4 per row, 2 rows = 8 max) ────────────── */}
      {visibleKpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 20 }}>
          {visibleKpis.map(function(r, i) {
            var row    = r.data[0] || {}
            var curKey = r.current_key  || r.value_key || 'current_value'
            var cmpKey = r.comparison_key || 'comparison_value'
            return <KPICard key={r.id} title={r.title} value={row[curKey]} unit={r.unit} comparisonValue={row[cmpKey]} compLabel={periodInfo.cmpLabel} index={i} />
          })}
        </div>
      )}

      {/* Divider */}
      {(trendResults.length > 0 || chartResults.length > 0) && (
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), rgba(43,127,227,0.2), transparent)', opacity: 0.15, marginBottom: 20 }} />
      )}

      {/* ── Trend Explorer (full width, single interactive chart) ─── */}
      {(metadata || []).some(function(m) { return m.type === 'kpi' || m.type === 'derived_kpi' }) && (
        <TrendExplorer
          metadata={metadata}
          datasetId={session.datasetId}
          timePeriod={session.timePeriod}
          onSimulate={function(q) { setWhatifQuery(q) }}
          onTrendData={handleTrendData}
        />
      )}

      {/* ── Charts ────────────────────────────────────────────────── */}
      {chartResults.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {chartResults.map(function(result, idx) { return renderChart(result, idx) })}
        </div>
      )}

      {/* ── Failed ───────────────────────────────────────────────── */}
      {failed.length > 0 && (
        <div style={{ background: 'var(--amber-light)', border: '1px solid rgba(240,160,48,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: 'var(--amber-text)', marginBottom: 4, fontFamily: 'var(--font-body)' }}>
            {failed.length} {failed.length === 1 ? 'query' : 'queries'} could not execute
          </p>
          {failed.map(function(r) { return <p key={r.id} style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.title}: {r.error}</p> })}
        </div>
      )}

      {/* ── Query Inspector ──────────────────────────────────────── */}
      <QueryInspector queries={allQueries} periodInfo={periodInfo} />

      {/* ── Decision Intelligence ─────────────────────────────────── */}
      {decisionState !== 'idle' && <DecisionPanel result={decisionResult} state={decisionState} error={decisionError} />}

      {/* ── Summary ──────────────────────────────────────────────── */}
      {summaryState !== 'idle' && <SummaryPanel narrative={narrative} state={summaryState} error={summaryError} />}

      {/* ── What-if Drawer ───────────────────────────────────────── */}
      <WhatIfDrawer
        query={whatifQuery || {}}
        metadata={metadata}
        isOpen={!!whatifQuery}
        onClose={function() { setWhatifQuery(null) }}
      />
    </div>
  )
}

function QueryInspector({ queries, periodInfo }) {
  var [open, setOpen] = useState(false); var [expandedId, setExpandedId] = useState(null)
  if (!queries || !queries.length) return null
  var typeColor = { kpi: '#00C8F0', bar: '#10C48A', line: '#2B7FE3', area: '#2B7FE3', pie: '#9B7FE3', donut: '#9B7FE3', stacked_bar: '#10C48A', scatter: '#F0A030' }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16, background: 'var(--surface)', backdropFilter: 'blur(8px)' }}>
      <button onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Query Inspector</span>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 2, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)' }}>{queries.length}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'var(--transition)' }}>▾</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {periodInfo.viewLabel && (
            <div style={{ padding: '7px 12px', borderRadius: 3, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', fontSize: 11, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', marginBottom: 4 }}>
              {periodInfo.viewLabel} · {periodInfo.cmpLabel}
            </div>
          )}
          {queries.map(function(q, idx) {
            var isExpanded = expandedId === q.id; var tc = typeColor[q.chart_type] || '#8BB4D8'
            return (
              <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <button onClick={function() { setExpandedId(isExpanded ? null : q.id) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer' }}>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 2, flexShrink: 0, background: 'transparent', color: tc, border: '1px solid ' + tc + '40', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>{q.chart_type}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, textAlign: 'left', fontFamily: 'var(--font-body)' }}>{idx + 1}. {q.title}</span>
                  {q.unit && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{q.unit}</span>}
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'var(--transition)', flexShrink: 0 }}>▾</span>
                </button>
                {isExpanded && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    {q.insight && <p style={{ fontSize: 11, color: 'var(--text-accent)', fontFamily: 'var(--font-body)', marginBottom: 10, opacity: 0.8 }}>{q.insight}</p>}
                    <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                      {q.current_key    && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>current: {q.current_key}</span>}
                      {q.comparison_key && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>comparison: {q.comparison_key}</span>}
                      {q.label_key      && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>label: {q.label_key}</span>}
                    </div>
                    <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.7, color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                      {(q.sql || '').replace(/\s+(SELECT|FROM|WHERE|AND|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN)\s+/gi, function(m) { return '\n' + m.trim() + ' ' })}
                    </pre>
                    <CopyButton text={q.sql} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CopyButton({ text }) {
  var [copied, setCopied] = useState(false)
  return (
    <button onClick={function() { navigator.clipboard.writeText(text || '').then(function() { setCopied(true); setTimeout(function() { setCopied(false) }, 2000) }) }}
      style={{ marginTop: 8, fontSize: 10, padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 2, background: copied ? 'var(--accent-dim)' : 'transparent', color: copied ? 'var(--text-accent)' : 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', transition: 'all var(--transition)' }}>
      {copied ? '✓ Copied' : 'Copy SQL'}
    </button>
  )
}
