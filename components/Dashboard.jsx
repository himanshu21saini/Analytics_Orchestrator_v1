'use client'

import React, { useState, useRef } from 'react'
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts'
import KPICard from './KPICard'
import SummaryPanel from './SummaryPanel'
import DecisionPanel from './DecisionPanel'
import WhatIfDrawer from './WhatIfDrawer'
import TrendExplorer from './TrendExplorer'
import TokenMeter from './TokenMeter'
import CoveragePanel from './CoveragePanel'

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
  background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)', borderRadius: 8,
  fontSize: 11, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  color: '#FFFFFF', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '8px 12px',
}

var axStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }

function ChartCard({ title, insight, children, index, badge, fullWidth, onSimulate }) {
  return (
    <div
      className={'fade-up d' + Math.min(index + 2, 6)}
      style={{
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: '18px 16px 10px', gridColumn: fullWidth ? '1 / -1' : 'auto',
        transition: 'border-color var(--transition), box-shadow var(--transition)',
        position: 'relative', overflow: 'visible', backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={function(e) { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(0,200,240,0.06)' }}
      onMouseLeave={function(e) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />
      <div style={{ position: 'absolute', top: 6, right: 8, width: 10, height: 10, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', borderRadius: '0 3px 0 0', opacity: 0.5 }} />
      <div style={{ position: 'absolute', bottom: 6, left: 8, width: 10, height: 10, borderBottom: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', borderRadius: '0 0 0 3px', opacity: 0.3 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-body)' }}>{title}</p>
          {insight && <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.5)', marginTop: 3, fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>{insight}</p>}
        </div>
        {badge && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 500, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', whiteSpace: 'nowrap', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>{badge}</span>}
        {onSimulate && (
          <button onClick={onSimulate} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, fontWeight: 500, background: 'rgba(155,127,227,0.1)', color: '#9B7FE3', border: '1px solid rgba(155,127,227,0.3)', whiteSpace: 'nowrap', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'all var(--transition)', flexShrink: 0 }}
            onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.2)' }}
            onMouseLeave={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.1)' }}
          >⟳ Simulate</button>
        )}
      </div>
      {children}
    </div>
  )
}

// ── WaterfallChart component ──────────────────────────────────────────────────
// Add this function BEFORE the main component (AskOnlyView or Dashboard)
// It needs access to the metadata prop to look up favorable_direction

function WaterfallChart({ result, metadata }) {
  var [selectedEntity, setSelectedEntity] = useState(null)

  var entityField   = result.entity_field   || 'label'
  var entityList    = result.entity_list    || []
  var targetKpi     = result.target_kpi     || ''
  var depKpis       = result.dependency_kpis || []
  var data          = result.data           || []
  var portfolioAvg  = result.portfolio_avg  || null

  // Default to first entity
  var activeEntity = selectedEntity || entityList[0]

  // Get favorable_direction from metadata for a field
  function getFavorableDir(fieldName) {
    var m = metadata && metadata.find(function(m) { return m.field_name === fieldName })
    return m ? (m.favorable_direction || 'i') : 'i'
  }

  // Get display name from metadata
  function getDisplayName(fieldName) {
    var m = metadata && metadata.find(function(m) { return m.field_name === fieldName })
    return m ? (m.display_name || fieldName) : fieldName
  }

  // Compute waterfall bars for selected entity
  function computeWaterfall() {
    if (!portfolioAvg || !data.length || !activeEntity) return null

    var entityRow = data.find(function(r) { return String(r[entityField]) === String(activeEntity) })
    if (!entityRow) return null

    var targetGap      = (parseFloat(entityRow[targetKpi]) || 0) - (parseFloat(portfolioAvg[targetKpi]) || 0)
    var portfolioTarget = parseFloat(portfolioAvg[targetKpi]) || 0
    var entityTarget    = parseFloat(entityRow[targetKpi])    || 0

    // Compute normalised deviation for each dependency KPI
    var deviations = depKpis.map(function(kpi) {
      var entityVal    = parseFloat(entityRow[kpi])    || 0
      var portfolioVal = parseFloat(portfolioAvg[kpi]) || 0
      if (portfolioVal === 0) return null
      var rawDev    = entityVal - portfolioVal
      var normDevPct = rawDev / Math.abs(portfolioVal)  // as fraction
      return { kpi, rawDev, normDevPct: normDevPct, entityVal, portfolioVal }
    }).filter(Boolean)

    if (!deviations.length) return null

    // Total absolute normalised deviation
    var totalAbsDev = deviations.reduce(function(sum, d) { return sum + Math.abs(d.normDevPct) }, 0)
    if (totalAbsDev === 0) return null

    // Each dep's share of the BFI gap
    var bars = deviations.map(function(d) {
      var share        = Math.abs(d.normDevPct) / totalAbsDev
      var contribution = share * targetGap
      var favDir       = getFavorableDir(d.kpi)
      // Determine if this deviation is unfavourable
      // favDir 'i' = higher is better → negative deviation is bad
      // favDir 'd' = lower is better  → positive deviation is bad
      var isUnfavourable = favDir === 'i' ? d.rawDev < 0 : d.rawDev > 0
      return {
        kpi:          d.kpi,
        display:      getDisplayName(d.kpi),
        contribution: contribution,
        normDevPct:   d.normDevPct,
        entityVal:    d.entityVal,
        portfolioVal: d.portfolioVal,
        isUnfavourable,
      }
    }).sort(function(a, b) { return Math.abs(b.contribution) - Math.abs(a.contribution) })

    return { portfolioTarget, entityTarget, targetGap, bars }
  }

  var waterfall = computeWaterfall()

  if (!portfolioAvg) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Portfolio average data not available for driver analysis.</p>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{result.error || 'No data available.'}</p>
      </div>
    )
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '18px 20px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />

      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-body)' }}>{result.title || 'Driver Analysis'}</p>
        {result.insight && <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.5)', marginTop: 3, fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>{result.insight}</p>}
      </div>

      {/* Entity selector */}
      {entityList.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', alignSelf: 'center', marginRight: 4 }}>Focus on:</span>
          {entityList.map(function(entity) {
            var isActive = String(entity) === String(activeEntity)
            return (
              <button key={entity} onClick={function() { setSelectedEntity(String(entity)) }}
                style={{ padding: '4px 12px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: isActive ? 600 : 400, cursor: 'pointer', fontFamily: 'var(--font-body)', border: '1px solid ' + (isActive ? 'var(--accent-border)' : 'var(--border)'), background: isActive ? 'var(--accent-dim)' : 'transparent', color: isActive ? 'var(--text-accent)' : 'var(--text-secondary)', transition: 'all var(--transition)' }}>
                {entity}
              </button>
            )
          })}
        </div>
      )}

      {/* Waterfall bars */}
      {waterfall ? (
        <div>
          {/* Summary row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>Portfolio Avg</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{waterfall.portfolioTarget.toFixed(2)}</p>
            </div>
            <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 16px' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>{activeEntity}</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: waterfall.targetGap < 0 ? '#E05555' : '#10C48A', fontFamily: 'var(--font-mono)' }}>{waterfall.entityTarget.toFixed(2)}</p>
            </div>
            <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 16px' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 3 }}>Gap</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: waterfall.targetGap < 0 ? '#E05555' : '#10C48A', fontFamily: 'var(--font-mono)' }}>
                {waterfall.targetGap > 0 ? '+' : ''}{waterfall.targetGap.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Contribution bars */}
          <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)', marginBottom: 10 }}>
            Driver Analysis — {getDisplayName(targetKpi)}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {waterfall.bars.map(function(bar) {
              var maxContrib = Math.max.apply(null, waterfall.bars.map(function(b) { return Math.abs(b.contribution) }))
              var barWidth   = maxContrib > 0 ? (Math.abs(bar.contribution) / maxContrib * 100) : 0
              var barColor   = bar.isUnfavourable ? '#E05555' : '#10C48A'
              var barColorA  = bar.isUnfavourable ? 'rgba(224,85,85,0.2)' : 'rgba(16,196,138,0.2)'
              var devSign    = bar.normDevPct > 0 ? '+' : ''
              return (
                <div key={bar.kpi}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', flex: 1 }}>{bar.display}</span>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        {bar.entityVal.toFixed(2)} vs {bar.portfolioVal.toFixed(2)} avg
                        <span style={{ marginLeft: 6, color: bar.isUnfavourable ? '#E05555' : '#10C48A' }}>({devSign}{(bar.normDevPct * 100).toFixed(1)}%)</span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: barColor, fontFamily: 'var(--font-mono)', minWidth: 52, textAlign: 'right' }}>
                        {bar.contribution > 0 ? '+' : ''}{bar.contribution.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: barWidth + '%', background: barColor, opacity: 0.7, borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#E05555' }} />
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Unfavourable deviation</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#10C48A' }} />
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Favourable deviation</span>
            </div>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', textAlign: 'center', padding: '20px 0' }}>
          Could not compute driver analysis — dependency KPI data may be missing.
          {depKpis.length === 0 && ' Add dependencies to the "' + targetKpi + '" field in your metadata to enable this view.'}
        </p>
      )}
    </div>
  )
}


export default function Dashboard({ session }) {
  var questionPanelRef = useRef(null)

  var [summaryState,   setSummaryState]   = useState('idle')
  var [narrative,      setNarrative]      = useState(null)
  var [summaryError,   setSummaryError]   = useState('')
  var [decisionState,  setDecisionState]  = useState('idle')
  var [decisionResult, setDecisionResult] = useState(null)
  var [decisionError,  setDecisionError]  = useState('')
  var [whatifQuery,    setWhatifQuery]    = useState(null)

  var [tokenCalls, setTokenCalls] = useState(function() {
    if (session.initialUsage) {
      return [{ label: 'queries', promptTokens: session.initialUsage.prompt_tokens, completionTokens: session.initialUsage.completion_tokens, model: session.initialUsage.model || 'gpt-4o' }]
    }
    return []
  })

  var [trendDataCache,   setTrendDataCache]   = useState({})
  var [trendSQLCache,    setTrendSQLCache]    = useState({})
  var [questionSQLCache, setQuestionSQLCache] = useState([])

  function handleTrendData(fieldName, data, meta, sql) {
    setTrendDataCache(function(prev) { var next = Object.assign({}, prev); next[fieldName] = { data: data, meta: meta }; return next })
    if (sql) {
      setTrendSQLCache(function(prev) { var next = Object.assign({}, prev); next[fieldName] = { sql: sql, title: (meta && meta.display_name) || fieldName }; return next })
    }
  }

  var queryResults     = session.queryResults     || []
  var metadata         = session.metadata         || []
  var periodInfo       = session.periodInfo       || {}
  var allQueries       = session.queries          || []
  var prefs            = session.preferences      || {}
  var mandatoryFilters = session.mandatoryFilters  || []   // ── NEW

  var kpiResults   = queryResults.filter(function(r) { return r.chart_type === 'kpi' && !r.error && r.data && r.data.length })
  var trendResults = queryResults.filter(function(r) { return (r.chart_type === 'line' || r.chart_type === 'area') && !r.error && r.data && r.data.length })
  var drillResults = queryResults.filter(function(r) { return r.chart_type === 'drilldown' && !r.error && r.data && r.data.length })
  var chartResults = queryResults.filter(function(r) { return r.chart_type !== 'kpi' && r.chart_type !== 'line' && r.chart_type !== 'area' && r.chart_type !== 'drilldown' && !r.error && r.data && r.data.length })
  var failed       = queryResults.filter(function(r) { return !!r.error })

  function buildEnrichedQueryResults() {
    var existingKpiFields = new Set(queryResults.filter(function(r) { return r.chart_type === 'kpi' }).map(function(r) { return r.id }))
    var syntheticResults  = []
    Object.keys(trendDataCache).forEach(function(field) {
      var entry = trendDataCache[field]; var meta = entry.meta || {}; var data = entry.data || []
      if (!data.length) return
      var sorted    = data.slice().sort(function(a, b) { return String(a.period || '').localeCompare(String(b.period || '')) })
      var latest    = sorted[sorted.length - 1]
      var latestVal = parseFloat((latest && latest.value) || 0)
      var yearAgoIdx = sorted.length >= 13 ? sorted.length - 13 : 0
      var yearAgoVal = parseFloat((sorted[yearAgoIdx] && sorted[yearAgoIdx].value) || 0)
      if (!existingKpiFields.has(field)) {
        syntheticResults.push({ id: 'trend_kpi_' + field, title: meta.display_name || field, chart_type: 'kpi', current_key: 'current_value', comparison_key: 'comparison_value', value_key: 'current_value', unit: meta.unit || '', data: [{ current_value: latestVal, comparison_value: yearAgoVal }], error: null, _from_trend: true })
      }
      syntheticResults.push({ id: 'trend_series_' + field, title: (meta.display_name || field) + ' monthly trend', chart_type: 'area', label_key: 'period', value_key: 'value', unit: meta.unit || '', data: sorted.slice(-24), error: null })
    })
    return queryResults.concat(syntheticResults)
  }

  var visibleKpis = kpiResults.slice(0, 8)

  async function handleGenerateSummary() {
    setSummaryState('loading'); setNarrative(null); setSummaryError('')
    try {
      var enriched = buildEnrichedQueryResults()
      var res  = await fetch('/api/generate-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queryResults: enriched, metadata, periodInfo }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed.')
      setNarrative(json.result.narrative); setSummaryState('done')
      if (json.usage) setTokenCalls(function(prev) { return prev.concat([{ label: 'summary', promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, model: json.usage.model || 'gpt-4o-mini' }]) })
    } catch (err) { setSummaryError(err.message); setSummaryState('error') }
  }

  function handlePrint() { window.print() }

  function handleScrollToQuestion() {
    if (questionPanelRef.current) {
      questionPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(function() { var input = questionPanelRef.current && questionPanelRef.current.querySelector('textarea'); if (input) input.focus() }, 500)
    }
  }

  async function handleGenerateDecisions() {
    setDecisionState('loading'); setDecisionResult(null); setDecisionError('')
    try {
      var enriched = buildEnrichedQueryResults()
      var res  = await fetch('/api/generate-decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queryResults: enriched, metadata, periodInfo }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed.')
      setDecisionResult(json.result); setDecisionState('done')
      if (json.usage) setTokenCalls(function(prev) { return prev.concat([{ label: 'decisions', promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, model: json.usage.model || 'gpt-4o' }]) })
    } catch (err) { setDecisionError(err.message); setDecisionState('error') }
  }

  function getInsight(resultId) { var q = allQueries.find(function(q) { return q.id === resultId }); return q ? q.insight : null }

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
    var insight  = getInsight(result.id)
    var ct       = result.chart_type

    var fullQuery     = allQueries.find(function(q) { return q.id === result.id }) || result
    var simulateQuery = Object.assign({}, fullQuery, { label_key: result.label_key, value_key: result.value_key, current_key: result.current_key, comparison_key: result.comparison_key, unit: result.unit, chart_type: result.chart_type })
    function onSimulate() { setWhatifQuery(simulateQuery) }
    if (ct === 'portfolio_avg') return null
    
    if (ct === 'bar') {
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} badge={badge} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 36, right: 16, left: 0, bottom: 52 }} barGap={2}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey={labelKey} tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 10, paddingBottom: 4, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080', top: 0 }} />
              {hasComp && (
                <Bar dataKey={cmpKey} name={periodInfo.cmpLabel || 'Prior period'} fill={colorC} stroke={color} strokeWidth={0.5} radius={[2,2,0,0]} maxBarSize={22}>
                  <LabelList dataKey={cmpKey} position="top" formatter={fmt} style={{ fontSize: 8, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }} />
                </Bar>
              )}
              <Bar dataKey={curKey} name={periodInfo.viewLabel || 'Current period'} fill={colorA} stroke={color} strokeWidth={0.5} radius={[2,2,0,0]} maxBarSize={hasComp ? 22 : 40}>
                <LabelList dataKey={curKey} position="top" formatter={fmt} style={{ fontSize: 8, fill: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    if (ct === 'stacked_bar') {
      var seriesKeys = result.series_keys || Object.keys(data[0] || {}).filter(function(k) { return k !== labelKey })
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 36, right: 16, left: 0, bottom: 52 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey={labelKey} tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 10, paddingBottom: 4, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080', top: 0 }} />
              {seriesKeys.map(function(sk, si) {
                var isLast = si === seriesKeys.length - 1
                return (
                  <Bar key={sk} dataKey={sk} stackId="a" fill={PA[si % PA.length]} stroke={P[si % P.length]} strokeWidth={0.5} maxBarSize={44}>
                    {isLast && <LabelList dataKey={sk} position="top" formatter={fmt} style={{ fontSize: 8, fill: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }} />}
                  </Bar>
                )
              })}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    if (ct === 'pie' || ct === 'donut') {
      var innerR = ct === 'donut' ? 55 : 0
      var pieLabelKey = labelKey; var pieValueKey = valueKey
      if (data.length > 0) {
        var firstRow = data[0]; var keys = Object.keys(firstRow)
        if (!firstRow[pieLabelKey]) { pieLabelKey = keys.find(function(k) { var v = firstRow[k]; return typeof v === 'string' && v.length > 0 && isNaN(parseFloat(v)) }) || keys[0] }
        if (firstRow[pieValueKey] === undefined || firstRow[pieValueKey] === null) { pieValueKey = keys.find(function(k) { return k !== pieLabelKey && !isNaN(parseFloat(firstRow[k])) }) || keys[1] }
      }
      var pieData = data.map(function(r) { var row = Object.assign({}, r); row[pieValueKey] = parseFloat(row[pieValueKey]) || 0; return row }).filter(function(r) { return r[pieValueKey] > 0 && r[pieLabelKey] })
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} onSimulate={onSimulate}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <Pie data={pieData} cx="50%" cy="45%" innerRadius={innerR} outerRadius={100} dataKey={pieValueKey} nameKey={pieLabelKey} paddingAngle={ct === 'donut' ? 2 : 1} strokeWidth={0} label={function(entry) { return (entry.percent * 100).toFixed(1) + '%' }} labelLine={{ stroke: 'var(--text-tertiary)', strokeWidth: 0.5 }}>
                {pieData.map(function(entry, i) { return <Cell key={i} fill={PA[i % PA.length]} stroke={P[i % P.length]} strokeWidth={0.5} /> })}
              </Pie>
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
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
                return (<div style={ttStyle}><p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-accent)' }}>{d[labelKey] || d.label || ''}</p><p style={{ fontSize: 11, color: '#8BB4D8' }}>{xKey}: {fmt(d[xKey])}</p><p style={{ fontSize: 11, color: '#8BB4D8' }}>{yKey}: {fmt(d[yKey])}</p></div>)
              }} />
              <Scatter data={data} fill={color} opacity={0.85}>
                <LabelList dataKey={labelKey} position="top" style={{ fontSize: 8, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
      )
    }

    if (ct === 'line' || ct === 'area') {
      var ChartComponent = ct === 'area' ? AreaChart : LineChart
      var DataComponent  = ct === 'area' ? Area : Line
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx}>
          <ResponsiveContainer width="100%" height={260}>
            <ChartComponent data={data} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey={labelKey} tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
              <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
              <DataComponent type="monotone" dataKey={valueKey} stroke={color} strokeWidth={1.5} fill={ct === 'area' ? colorA : undefined} dot={false} activeDot={{ r: 4, fill: color }} />
            </ChartComponent>
          </ResponsiveContainer>
        </ChartCard>
      )
    }
if (ct === 'table' || (ct === 'bar' && data.length > 15) || ct === 'multi_line') {
      var cols = data.length > 0 ? Object.keys(data[0]) : []
      return (
        <ChartCard key={result.id} title={result.title} insight={insight} index={idx} onSimulate={onSimulate}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {cols.map(function(col) {
                    return <th key={col} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' }}>{col}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {data.map(function(row, i) {
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {cols.map(function(col) {
                        var v = row[col]
                        var isNum = v !== null && v !== undefined && !isNaN(parseFloat(v)) && col !== labelKey
                        return <td key={col} style={{ padding: '7px 10px', color: isNum ? 'var(--text-accent)' : 'var(--text-primary)', textAlign: isNum ? 'right' : 'left', fontFamily: isNum ? 'var(--font-mono)' : 'var(--font-body)', fontSize: 11 }}>{isNum ? fmt(v) : String(v ?? '')}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )
    }
if (ct === 'waterfall') {
  return <WaterfallChart key={result.id} result={result} metadata={metadata} />
}
  
    return null
  }

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '28px 28px 80px' }}>

      {periodInfo.viewLabel && (
        <div className="fade-in" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{periodInfo.viewLabel}</h2>
              <p style={{ fontSize: 12, color: 'var(--text-accent)', marginTop: 4, fontFamily: 'var(--font-body)', letterSpacing: '0.06em' }}>
                {periodInfo.cmpLabel}
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {visibleKpis.length} indicators
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {trendResults.length} trends
                <span style={{ color: 'var(--text-tertiary)', margin: '0 8px' }}>·</span>
                {chartResults.length} charts
                {session.userContext && session.userContext.filters && session.userContext.filters.map(function(f, i) {
                  return <span key={i} style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{f.display || (f.field + ' ' + f.operator + ' ' + f.value)}</span>
                })}
                {session.userContext && session.userContext.kpi_focus && session.userContext.kpi_focus.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(16,196,138,0.1)', border: '1px solid rgba(16,196,138,0.3)', color: '#10C48A', fontFamily: 'var(--font-mono)' }}>
                    Focus: {session.userContext.kpi_focus.slice(0,2).join(', ')}{session.userContext.kpi_focus.length > 2 ? ' +' + (session.userContext.kpi_focus.length - 2) : ''}
                  </span>
                )}
                {/* ── Mandatory filter chips ── */}
                {mandatoryFilters && mandatoryFilters.map(function(f, i) {
                  return (
                    <span key={'mf_' + i} style={{ marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(240,160,48,0.1)', border: '1px solid rgba(240,160,48,0.3)', color: '#F0A030', fontFamily: 'var(--font-mono)' }}>
                      {f.display_name || f.field}: {f.value}
                    </span>
                  )
                })}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {prefs.summary !== false && (
                <button onClick={handleGenerateSummary} disabled={summaryState === 'loading'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: summaryState === 'loading' ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)', border: '1px solid ' + (summaryState === 'loading' ? 'var(--border)' : 'var(--accent-border)'), borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: summaryState === 'loading' ? 'var(--text-tertiary)' : 'var(--text-accent)', cursor: summaryState === 'loading' ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', transition: 'all var(--transition)', boxShadow: summaryState === 'loading' ? 'none' : '0 0 16px rgba(0,200,240,0.08)' }}>
                  {summaryState === 'loading' ? <><span className="spinner" /> Composing...</> : <>{summaryState === 'done' ? 'Regenerate Summary' : 'Generate Summary'}</>}
                </button>
              )}
              {prefs.decisions !== false && (
                <button onClick={handleGenerateDecisions} disabled={decisionState === 'loading'} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: decisionState === 'loading' ? 'transparent' : 'linear-gradient(135deg, rgba(123,143,240,0.18) 0%, rgba(83,74,183,0.12) 100%)', border: '1px solid ' + (decisionState === 'loading' ? 'var(--border)' : 'rgba(123,143,240,0.4)'), borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: decisionState === 'loading' ? 'var(--text-tertiary)' : '#7B8FF0', cursor: decisionState === 'loading' ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', transition: 'all var(--transition)', boxShadow: decisionState === 'loading' ? 'none' : '0 0 16px rgba(123,143,240,0.1)' }}>
                  {decisionState === 'loading' ? <><span className="spinner" /> Analysing...</> : <>{decisionState === 'done' ? 'Refresh Decisions' : 'Generate Decisions'}</>}
                </button>
              )}
              <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
              <button onClick={handlePrint} title="Print / Save as PDF" className="prism-print-hide" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid rgba(0,180,160,0.25)', borderRadius: 'var(--radius-md)', color: '#00B4A0', cursor: 'pointer', transition: 'all var(--transition)', flexShrink: 0, padding: 0 }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(0,180,160,0.1)'; e.currentTarget.style.borderColor = 'rgba(0,180,160,0.5)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(0,180,160,0.15)' }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.borderColor = 'rgba(0,180,160,0.25)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 5V2h8v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 9H1.5A.5.5 0 0 1 1 8.5v-3A.5.5 0 0 1 1.5 5h11a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="3" y="8" width="8" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="11" cy="7" r="0.6" fill="currentColor"/>
                </svg>
              </button>
              <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
              <button onClick={handleScrollToQuestion} title="Ask a question about your data" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'linear-gradient(135deg, rgba(155,127,227,0.14) 0%, rgba(103,74,183,0.1) 100%)', border: '1px solid rgba(155,127,227,0.35)', borderRadius: 'var(--radius-md)', color: '#B8A0F0', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'all var(--transition)', flexShrink: 0 }}
                onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(155,127,227,0.22)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(155,127,227,0.15)' }}
                onMouseLeave={function(e) { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(155,127,227,0.14) 0%, rgba(103,74,183,0.1) 100%)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <circle cx="6" cy="9" r="0.6" fill="currentColor"/>
                </svg>
                Ask
              </button>
            </div>
          </div>

          {tokenCalls.length > 0 && (
            <div className="prism-print-hide" style={{ marginTop: 10 }}>
              <TokenMeter calls={tokenCalls} />
            </div>
          )}
        </div>
      )}

      {prefs.decisions !== false && decisionState !== 'idle' && <DecisionPanel result={decisionResult} state={decisionState} error={decisionError} />}
      {prefs.summary !== false && summaryState !== 'idle' && <SummaryPanel narrative={narrative} state={summaryState} error={summaryError} />}

      <div style={{ height: '1px', background: 'linear-gradient(90deg, var(--accent), rgba(43,127,227,0.3), transparent)', opacity: 0.3, marginBottom: 24 }} />

      {visibleKpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 20 }}>
          {visibleKpis.map(function(r, i) {
            var row = r.data[0] || {}; var curKey = r.current_key || r.value_key || 'current_value'; var cmpKey = r.comparison_key || 'comparison_value'
            var meta = metadata.find(function(m) { return m.field_name === r.id }) 
        || metadata.find(function(m) { return r.id && r.id.startsWith(m.field_name) })
        || metadata.find(function(m) { return m.display_name && (r.title || '').toLowerCase() === m.display_name.toLowerCase() })
var favDir = meta && meta.favorable_direction ? meta.favorable_direction : 'i'
          return <KPICard key={r.id} title={r.title} value={row[curKey]} unit={r.unit} comparisonValue={row[cmpKey]} compLabel={periodInfo.cmpLabel} index={i} favorableDirection={favDir} />
          })}
        </div>
      )}

      {(trendResults.length > 0 || chartResults.length > 0) && <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), rgba(43,127,227,0.2), transparent)', opacity: 0.15, marginBottom: 20 }} />}

      {prefs.forecast !== false && (metadata || []).some(function(m) { return m.type === 'kpi' || m.type === 'derived_kpi' }) && (
        <TrendExplorer metadata={metadata} datasetId={session.datasetId} timePeriod={session.timePeriod} onSimulate={function(q) { setWhatifQuery(q) }} onTrendData={handleTrendData} />
      )}

      {drillResults.map(function(result, idx) { return <DrillDownChart key={result.id} result={result} idx={idx} periodInfo={periodInfo} /> })}

      {chartResults.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {chartResults.map(function(result, idx) { return renderChart(result, idx) })}
        </div>
      )}

      {failed.length > 0 && (
        <div style={{ background: 'var(--amber-light)', border: '1px solid rgba(240,160,48,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: 'var(--amber-text)', marginBottom: 4, fontFamily: 'var(--font-body)' }}>{failed.length} {failed.length === 1 ? 'query' : 'queries'} could not execute</p>
          {failed.map(function(r) { return <p key={r.id} style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.title}: {r.error}</p> })}
        </div>
      )}

      {prefs.queryInspector !== false && (
        <QueryInspector
          queries={allQueries} periodInfo={periodInfo} trendSQLs={trendSQLCache}
          questionPanelRef={questionPanelRef} datasetId={session.datasetId}
          metadata={metadata} userContext={session.userContext}
          onTokens={function(u) { setTokenCalls(function(prev) { return prev.concat([{ label: 'question', promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, model: u.model || 'gpt-4o' }]) }) }}
          renderChart={renderChart}
          questionSQLs={questionSQLCache}
          onQuestionQueries={function(qs) { setQuestionSQLCache(function(prev) { return prev.concat(qs) }) }}
        />
      )}

      {/* ── Question Panel ── */}
      <QuestionPanel
        panelRef={questionPanelRef}
        datasetId={session.datasetId}
        metadata={metadata}
        periodInfo={periodInfo}
        userContext={session.userContext}
        mandatoryFilters={mandatoryFilters}
        onTokens={function(u) { setTokenCalls(function(prev) { return prev.concat([{ label: 'question', promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, model: u.model || 'gpt-4o' }]) }) }}
        renderChart={renderChart}
        onQuestionQueries={function(qs) { setQuestionSQLCache(function(prev) { return prev.concat(qs) }) }}
      />

      {prefs.coveragePanel !== false && <CoveragePanel coverageData={session.coverageData} />}

      <WhatIfDrawer query={whatifQuery || {}} metadata={metadata} isOpen={!!whatifQuery} onClose={function() { setWhatifQuery(null) }} />
    </div>
  )
}

// ── QueryInspector ────────────────────────────────────────────────────────────

function QueryInspector({ queries, periodInfo, trendSQLs, questionPanelRef, datasetId, metadata, userContext, onTokens, renderChart, questionSQLs, onQuestionQueries }) {
  var [open, setOpen] = useState(false)
  var [expandedId, setExpandedId] = useState(null)
  var trendEntries = Object.keys(trendSQLs || {}).map(function(k) { return Object.assign({ id: 'trend_' + k }, trendSQLs[k]) })
  var total = (queries ? queries.length : 0) + trendEntries.length + (questionSQLs ? questionSQLs.length : 0)
  if (!total) return null
  var typeColor = { kpi: '#00C8F0', bar: '#10C48A', line: '#2B7FE3', area: '#2B7FE3', pie: '#9B7FE3', donut: '#9B7FE3', stacked_bar: '#10C48A', scatter: '#F0A030', trend: '#F0A030' }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16, background: 'var(--surface)', backdropFilter: 'blur(8px)' }}>
      <button onClick={function() { setOpen(function(v) { return !v }) }} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Query Inspector</span>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 2, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)' }}>{total}</span>
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
          {(queries || []).map(function(q, idx) {
            var isExpanded = expandedId === q.id; var tc = typeColor[q.chart_type] || '#8BB4D8'
            return (
              <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <button onClick={function() { setExpandedId(isExpanded ? null : q.id) }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer' }}>
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

          {trendEntries.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', padding: '4px 0 2px' }}>Trend Explorer queries</div>
              {trendEntries.map(function(q) {
                var isExpanded = expandedId === q.id
                return (
                  <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button onClick={function() { setExpandedId(isExpanded ? null : q.id) }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer' }}>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 2, flexShrink: 0, background: 'transparent', color: '#F0A030', border: '1px solid rgba(240,160,48,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>trend</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, textAlign: 'left', fontFamily: 'var(--font-body)' }}>{q.title}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'var(--transition)', flexShrink: 0 }}>▾</span>
                    </button>
                    {isExpanded && (
                      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.7, color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                          {(q.sql || '').replace(/\s+(SELECT|FROM|WHERE|AND|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN)\s+/gi, function(m) { return '\n' + m.trim() + ' ' })}
                        </pre>
                        <CopyButton text={q.sql} />
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {questionSQLs && questionSQLs.length > 0 && (
            <>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', padding: '4px 0 2px' }}>Ask a Question queries</div>
              {questionSQLs.map(function(q) {
                var isExpanded = expandedId === q.id
                return (
                  <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button onClick={function() { setExpandedId(isExpanded ? null : q.id) }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', border: 'none', cursor: 'pointer' }}>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 2, flexShrink: 0, background: 'transparent', color: '#B8A0F0', border: '1px solid rgba(155,127,227,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>ask</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, textAlign: 'left', fontFamily: 'var(--font-body)' }}>{q.title}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'var(--transition)', flexShrink: 0 }}>▾</span>
                    </button>
                    {isExpanded && (
                      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: 1.7, color: 'var(--text-secondary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                          {(q.sql || '').replace(/\s+(SELECT|FROM|WHERE|AND|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN)\s+/gi, function(m) { return '\n' + m.trim() + ' ' })}
                        </pre>
                        <CopyButton text={q.sql} />
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
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

// ── DrillDownChart ────────────────────────────────────────────────────────────

function DrillDownChart({ result, idx, periodInfo }) {
  var [selected, setSelected] = useState(null)
  var raw = result.data || []; var labelKey = result.label_key || 'label'; var slotKey = result.slot_key || 'slot'
  var slotSortKey = result.slot_sort_key || slotKey; var valueKey = result.current_key || 'current_value'
  var entityDisp = result.entity_display || 'Branch'; var slotDisp = result.slot_display || 'Time Slot'; var metricDisp = result.metric_display || 'Score'

  var branchMap = {}
  raw.forEach(function(row) {
    var branch = row[labelKey]; if (!branch) return
    if (!branchMap[branch]) branchMap[branch] = { label: branch, total: 0, count: 0 }
    branchMap[branch].total += parseFloat(row[valueKey]) || 0; branchMap[branch].count += 1
  })
  var branches = Object.values(branchMap).map(function(b) { return { label: b.label, avg: b.count ? b.total / b.count : 0 } }).sort(function(a, b) { return b.avg - a.avg })

  var slotRows = []
  if (selected) {
    slotRows = raw.filter(function(r) { return r[labelKey] === selected })
      .map(function(r) { return { slot: r[slotKey], sort: r[slotSortKey], value: parseFloat(r[valueKey]) || 0 } })
      .sort(function(a, b) { var na = parseInt(a.sort); var nb = parseInt(b.sort); if (!isNaN(na) && !isNaN(nb)) return na - nb; return String(a.slot).localeCompare(String(b.slot)) })
  }

  function scoreColor(v) { if (v >= 14) return '#E05555'; if (v >= 12) return '#F0A030'; if (v >= 10) return '#00C8F0'; return '#3D6080' }
  var maxAvg = branches.length ? branches[0].avg : 1
  var ddTtStyle = { background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)', borderRadius: 8, fontSize: 11, color: '#FFFFFF', padding: '8px 12px', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }
  var ddAxStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }
  function fmtDD(v) { var n = parseFloat(v); if (isNaN(n)) return '—'; return n.toFixed(1) }

  return (
    <div className={'fade-up d' + Math.min(idx + 2, 6)} style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 12, overflow: 'hidden', transition: 'border-color var(--transition)' }}>
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />
      <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-body)', marginBottom: 2 }}>{result.title}</p>
          <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.5)', fontFamily: 'var(--font-body)' }}>{selected ? entityDisp + ' selected: ' + selected + ' — showing ' + slotDisp.toLowerCase() + ' breakdown' : 'Click any ' + entityDisp.toLowerCase() + ' to drill into its ' + slotDisp.toLowerCase() + ' pattern'}</p>
        </div>
        {selected && <button onClick={function() { setSelected(null) }} style={{ fontSize: 10, padding: '4px 10px', cursor: 'pointer', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0 }}>← All {entityDisp}s</button>}
      </div>
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {branches.map(function(b) {
            var isSelected = selected === b.label; var barPct = maxAvg > 0 ? (b.avg / maxAvg) * 100 : 0; var color = scoreColor(b.avg)
            return (
              <div key={b.label} onClick={function() { setSelected(isSelected ? null : b.label) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: isSelected ? 'rgba(0,200,240,0.06)' : 'transparent', border: '1px solid ' + (isSelected ? 'var(--accent-border)' : 'transparent'), transition: 'all var(--transition)' }}
                onMouseEnter={function(e) { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                onMouseLeave={function(e) { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 11, color: isSelected ? 'var(--text-accent)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)', width: 80, flexShrink: 0, fontWeight: isSelected ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: barPct + '%', height: '100%', background: color, borderRadius: 4, opacity: selected && !isSelected ? 0.35 : 0.85, transition: 'width 0.4s ease, opacity var(--transition)' }} />
                </div>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: color, width: 36, textAlign: 'right', flexShrink: 0, fontWeight: 600 }}>{fmtDD(b.avg)}</span>
                <span style={{ fontSize: 11, color: isSelected ? 'var(--text-accent)' : 'var(--text-tertiary)', flexShrink: 0 }}>{isSelected ? '▾' : '▸'}</span>
              </div>
            )
          })}
        </div>
      </div>
      {selected && slotRows.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px 16px', background: 'rgba(0,200,240,0.02)' }}>
          <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-accent)', fontFamily: 'var(--font-body)', marginBottom: 12 }}>{selected} — {metricDisp} by {slotDisp}</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={slotRows} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
              <XAxis dataKey="slot" tick={ddAxStyle} angle={-40} textAnchor="end" interval={Math.max(0, Math.floor(slotRows.length / 8) - 1)} axisLine={false} tickLine={false} />
              <YAxis tick={ddAxStyle} width={40} tickFormatter={fmtDD} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ddTtStyle} formatter={function(v) { return [fmtDD(v), metricDisp] }} labelFormatter={function(l) { return slotDisp + ': ' + l }} />
              <Line type="monotone" dataKey="value" name={metricDisp} stroke="var(--accent)" strokeWidth={1.5}
                dot={function(props) { var cx = props.cx; var cy = props.cy; var val = props.payload.value; return <circle key={props.key || cx + '-' + cy} cx={cx} cy={cy} r={3} fill={scoreColor(val)} stroke="none" /> }}
                activeDot={{ r: 5, fill: 'var(--accent)' }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            {(function() {
              var vals = slotRows.map(function(r) { return r.value })
              var avg  = vals.reduce(function(a,b){return a+b},0) / (vals.length||1)
              var peak = slotRows.reduce(function(a,b){return b.value>a.value?b:a}, slotRows[0])
              var low  = slotRows.reduce(function(a,b){return b.value<a.value?b:a}, slotRows[0])
              return [
                { label: 'Avg', val: fmtDD(avg), color: 'var(--text-secondary)' },
                { label: 'Peak slot', val: peak ? peak.slot + ' (' + fmtDD(peak.value) + ')' : '—', color: '#E05555' },
                { label: 'Lowest slot', val: low ? low.slot + ' (' + fmtDD(low.value) + ')' : '—', color: '#10C48A' },
              ].map(function(s) {
                return (
                  <div key={s.label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: s.color, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{s.val}</span>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

// ── QuestionPanel ─────────────────────────────────────────────────────────────

var QuestionPanel = function QuestionPanel(props) {
  var ref               = props.panelRef
  var datasetId         = props.datasetId
  var metadata          = props.metadata          || []
  var periodInfo        = props.periodInfo        || {}
  var userContext       = props.userContext        || null
  var mandatoryFilters  = props.mandatoryFilters   || []   // ── NEW
  var onTokens          = props.onTokens          || function() {}
  var renderChart       = props.renderChart       || function() { return null }
  var onQuestionQueries = props.onQuestionQueries || function() {}

  var [question,         setQuestion]         = useState('')
  var [loading,          setLoading]          = useState(false)
  var [error,            setError]            = useState('')
  var [answers,          setAnswers]          = useState([])
  var [expandedAnswerId, setExpandedAnswerId] = useState(null)

  async function handleAsk() {
    var q = question.trim()
    if (!q || loading) return
    setLoading(true); setError('')

    try {
      var res = await fetch('/api/ask-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:        q,
          datasetId:       datasetId,
          metadata:        metadata,
          periodInfo:      periodInfo,
          userContext:     userContext,
          mandatoryFilters: mandatoryFilters,   // ── NEW
        }),
      })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Question failed.')
      if (json.usage) onTokens(json.usage)

      var newId = Date.now()

      setAnswers(function(prev) {
        return [{
          id: newId, question: q, periodUsed: json.periodUsed,
          queries: json.queries || [], narrative: json.narrative, dependentFields: json.dependentFields || [],
        }].concat(prev)
      })

      setExpandedAnswerId(newId)

      if (json.queries) {
        var qs = json.queries
          .filter(function(qItem) { return qItem.sql })
          .map(function(qItem, i) { return { id: qItem.id + '_' + newId + '_' + i, title: qItem.title, sql: qItem.sql } })
        if (qs.length) onQuestionQueries(qs)
      }

      setQuestion('')
    } catch(err) { setError(err.message) }
    setLoading(false)
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk() }

  return (
    <div ref={ref} style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, rgba(155,127,227,0.2), rgba(103,74,183,0.1))', border: '1px solid rgba(155,127,227,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="#B8A0F0" strokeWidth="1.3"/>
            <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" stroke="#B8A0F0" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="6" cy="9" r="0.6" fill="#B8A0F0"/>
          </svg>
        </div>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Ask a Question</p>
          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 1 }}>Ask anything about your data · Context from setup always applies · ⌘↵ to submit</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <textarea value={question} onChange={function(e) { setQuestion(e.target.value) }} onKeyDown={handleKeyDown}
          placeholder="Ask any question about your data — e.g. which segment performed best last month, or what is driving the decline in a KPI?"
          rows={2}
          style={{ flex: 1, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', lineHeight: 1.5, resize: 'vertical', outline: 'none', transition: 'border-color var(--transition)' }}
          onFocus={function(e) { e.target.style.borderColor = 'rgba(155,127,227,0.5)' }}
          onBlur={function(e)  { e.target.style.borderColor = 'var(--border)' }}
        />
        <button onClick={handleAsk} disabled={!question.trim() || loading}
          style={{ padding: '0 20px', background: !question.trim() || loading ? 'transparent' : 'linear-gradient(135deg, rgba(155,127,227,0.2) 0%, rgba(103,74,183,0.14) 100%)', border: '1px solid ' + (!question.trim() || loading ? 'var(--border)' : 'rgba(155,127,227,0.4)'), borderRadius: 'var(--radius-md)', color: !question.trim() || loading ? 'var(--text-tertiary)' : '#B8A0F0', cursor: !question.trim() || loading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7, transition: 'all var(--transition)', flexShrink: 0, alignSelf: 'stretch' }}>
          {loading ? <><span className="spinner" style={{ borderTopColor: '#B8A0F0', borderColor: 'var(--border)', width: 12, height: 12, borderWidth: 1.5 }} /> Thinking...</> : 'Ask'}
        </button>
      </div>

      {error && <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginBottom: 12, fontFamily: 'var(--font-body)' }}>{error}</p>}

      {answers.map(function(ans) {
        var isExpanded = expandedAnswerId === ans.id
        return (
          <div key={ans.id} className="fade-in" style={{ marginTop: 20, background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid rgba(155,127,227,0.2)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(155,127,227,0.5), transparent)' }} />
            <div onClick={function() { setExpandedAnswerId(isExpanded ? null : ans.id) }} style={{ padding: '14px 20px 12px', borderBottom: isExpanded ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, flexShrink: 0, marginTop: 2, background: 'rgba(155,127,227,0.12)', color: '#B8A0F0', border: '1px solid rgba(155,127,227,0.25)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Q</span>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.5, flex: 1 }}>{ans.question}</p>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 2 }}>{ans.periodUsed}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2, display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)' }}>▾</span>
              </div>
            </div>

            {isExpanded && (
              <>
                {ans.queries.filter(function(q) { return !q.error && q.data && q.data.length }).length > 0 && (
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: ans.queries.filter(function(q){ return !q.error && q.data && q.data.length }).length === 1 ? '1fr' : '1fr 1fr', gap: 12 }}>
                      {ans.queries.filter(function(q) { return !q.error && q.data && q.data.length }).map(function(q, i) { return renderChart(q, i) })}
                    </div>
                  </div>
                )}
                {ans.queries.filter(function(q) { return !!q.error }).map(function(q, i) {
                  return <div key={i} style={{ padding: '8px 20px', background: 'rgba(224,85,85,0.04)', borderBottom: '1px solid rgba(224,85,85,0.1)' }}><p style={{ fontSize: 10, color: 'var(--red-text)', fontFamily: 'var(--font-mono)' }}>{q.title}: {q.error}</p></div>
                })}
                {ans.narrative && (
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ marginBottom: 14 }}>
                      <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#B8A0F0', fontFamily: 'var(--font-body)', marginBottom: 6 }}>Answer</p>
                      <p style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.7 }}>{ans.narrative.answer}</p>
                    </div>
                    {ans.narrative.key_findings && ans.narrative.key_findings.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 6 }}>Key Findings</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {ans.narrative.key_findings.map(function(f, i) {
                            return <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ color: '#B8A0F0', flexShrink: 0, marginTop: 1 }}>·</span><p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>{f}</p></div>
                          })}
                        </div>
                      </div>
                    )}
                    {ans.narrative.drivers && (
                      <div style={{ background: 'rgba(155,127,227,0.06)', border: '1px solid rgba(155,127,227,0.15)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 14 }}>
                        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#B8A0F0', fontFamily: 'var(--font-body)', marginBottom: 5 }}>What's Driving This</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>{ans.narrative.drivers}</p>
                      </div>
                    )}
                    {ans.narrative.investigate && ans.narrative.investigate.length > 0 && (
                      <div style={{ background: 'rgba(240,160,48,0.05)', border: '1px solid rgba(240,160,48,0.15)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: ans.narrative.data_limitation ? 12 : 0 }}>
                        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#F0A030', fontFamily: 'var(--font-body)', marginBottom: 6 }}>Investigate Further</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {ans.narrative.investigate.map(function(item, i) {
                            return <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ color: '#F0A030', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10, marginTop: 1 }}>{i+1}.</span><p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>{item}</p></div>
                          })}
                        </div>
                      </div>
                    )}
                    {ans.narrative.data_limitation && <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontStyle: 'italic', marginTop: 8 }}>Note: {ans.narrative.data_limitation}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}

      {answers.length === 0 && !loading && (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>Ask any question about your data above — period context from your setup applies automatically.</p>
        </div>
      )}
    </div>
  )
}
