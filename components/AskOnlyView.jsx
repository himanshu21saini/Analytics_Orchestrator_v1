'use client'

import { useState, useRef } from 'react'

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return String(v || '')
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

var ttStyle = {
  background: '#0D1930', border: '1px solid rgba(0,200,240,0.2)',
  borderRadius: 8, fontSize: 11, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  color: '#FFFFFF', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '8px 12px',
}

var P  = ['#00C8F0','#2B7FE3','#00B4A0','#7B8FF0','#F0A030','#9B7FE3','#10C48A','#E05555']
var PA = ['rgba(0,200,240,0.5)','rgba(43,127,227,0.5)','rgba(0,180,160,0.5)','rgba(123,143,240,0.5)','rgba(240,160,48,0.5)','rgba(155,127,227,0.5)','rgba(16,196,138,0.5)','rgba(224,85,85,0.5)']

import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'

var axStyle = { fontSize: 10, fill: '#3D6080', fontFamily: "'JetBrains Mono', monospace" }

function ChartCard({ title, insight, children, index }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '18px 16px 10px', position: 'relative', overflow: 'visible',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'var(--font-body)' }}>{title}</p>
        {insight && <p style={{ fontSize: 11, color: 'rgba(56,180,220,0.5)', marginTop: 3, fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>{insight}</p>}
      </div>
      {children}
    </div>
  )
}


function QueryInspector({ queries }) {
  var [open, setOpen] = useState(false)
  var [copied, setCopied] = useState(null)

  function copySQL(sql, id) {
    navigator.clipboard.writeText(sql)
    setCopied(id)
    setTimeout(function() { setCopied(null) }, 1500)
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ padding: '8px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: open ? 'rgba(0,0,0,0.1)' : 'transparent' }}>
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>SQL Inspector</span>
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--surface-3)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{queries.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)' }}>▾</span>
      </div>
      {open && (
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queries.map(function(q) {
            return (
              <div key={q.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>{q.title}</span>
                  <button onClick={function() { copySQL(q.sql, q.id) }}
                    style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: copied === q.id ? '#10C48A' : 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                    {copied === q.id ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre style={{ margin: 0, padding: '10px 12px', fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, overflowX: 'auto', background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {q.sql}
                </pre>
                {q.error && <p style={{ margin: 0, padding: '6px 12px', fontSize: 10, color: 'var(--red-text)', background: 'rgba(224,85,85,0.06)', fontFamily: 'var(--font-mono)' }}>Error: {q.error}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
// ── Main AskOnlyView ──────────────────────────────────────────────────────────

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


export default function AskOnlyView({ session }) {
  var datasetId        = session.datasetId
  var metadata         = session.metadata         || []
  var periodInfo       = session.periodInfo       || {}
  var userContext      = session.userContext       || null
  var mandatoryFilters = session.mandatoryFilters  || []

  var [question,         setQuestion]         = useState('')
  var [loading,          setLoading]          = useState(false)
  var [error,            setError]            = useState('')
  var [answers,          setAnswers]          = useState([])
  var [expandedAnswerId, setExpandedAnswerId] = useState(null)
  var [totalTokens,      setTotalTokens]      = useState({ prompt: 0, completion: 0 })

  function renderChart(result, idx) {
  
  var ct       = result.chart_type
  var labelKey = result.label_key    || 'label'
  var curKey   = result.current_key  || result.value_key || 'current_value'
  var valueKey = result.value_key    || 'value'
  var data     = result.data || []
  var color    = P[idx % P.length]
  var colorA   = PA[idx % PA.length]
  var insight  = result.insight
    
if (ct === 'portfolio_avg') return null
if (ct === 'waterfall') return <WaterfallChart key={result.id} result={result} metadata={metadata} />
 
  if (ct === 'bar') {
    return (
      <ChartCard key={result.id} title={result.title} insight={insight} index={idx}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 52 }}>
            <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
            <XAxis dataKey={labelKey} tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
            <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
            <Bar dataKey={curKey} fill={colorA} stroke={color} strokeWidth={0.5} radius={[2,2,0,0]} maxBarSize={40}>
              <LabelList dataKey={curKey} position="top" formatter={fmt} style={{ fontSize: 8, fill: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    )
  }

  if (ct === 'line' || ct === 'area') {
    var ChartComp = ct === 'area' ? AreaChart : LineChart
    var DataComp  = ct === 'area' ? Area : Line
    var lKey      = result.label_key || 'period'
    var vKey      = result.value_key || 'value'
    return (
      <ChartCard key={result.id} title={result.title} insight={insight} index={idx}>
        <ResponsiveContainer width="100%" height={260}>
          <ChartComp data={data} margin={{ top: 10, right: 16, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="1 4" stroke="rgba(56,140,255,0.08)" vertical={false} />
            <XAxis dataKey={lKey} tick={axStyle} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
            <YAxis tick={axStyle} width={52} tickFormatter={fmt} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
            <DataComp type="monotone" dataKey={vKey} stroke={color} strokeWidth={1.5} fill={ct === 'area' ? colorA : undefined} dot={false} activeDot={{ r: 4, fill: color }} />
          </ChartComp>
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
      <ChartCard key={result.id} title={result.title} insight={insight} index={idx}>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="45%" innerRadius={innerR} outerRadius={90} dataKey={pieValueKey} nameKey={pieLabelKey} paddingAngle={ct === 'donut' ? 2 : 1} strokeWidth={0} label={function(entry) { return (entry.percent * 100).toFixed(1) + '%' }} labelLine={{ stroke: 'var(--text-tertiary)', strokeWidth: 0.5 }}>
              {pieData.map(function(entry, i) { return <Cell key={i} fill={PA[i % PA.length]} stroke={P[i % P.length]} strokeWidth={0.5} /> })}
            </Pie>
            <Tooltip contentStyle={ttStyle} formatter={function(v, n) { return [fmt(v) + (result.unit ? ' ' + result.unit : ''), n] }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'Plus Jakarta Sans', system-ui", color: '#3D6080' }} iconSize={6} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    )
  }

  if (ct === 'table' || (data.length > 15 && ct === 'bar') || ct === 'multi_line') {
    var cols = data.length > 0 ? Object.keys(data[0]) : []
    return (
      <ChartCard key={result.id} title={result.title} insight={result.insight}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr>
                {cols.map(function(col) {
                  return <th key={col} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{col}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {data.map(function(row, i) {
                return (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    {cols.map(function(col) {
                      var v = row[col]
                      var isNum = !isNaN(parseFloat(v)) && col !== labelKey
                      return <td key={col} style={{ padding: '7px 10px', color: isNum ? 'var(--text-accent)' : 'var(--text-primary)', textAlign: isNum ? 'right' : 'left', fontFamily: isNum ? 'var(--font-mono)' : 'var(--font-body)', fontSize: 11 }}>{isNum ? fmt(v) : v}</td>
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

  async function handleAsk() {
    var q = question.trim()
    if (!q || loading) return
    setLoading(true); setError('')
    try {
      var res = await fetch('/api/ask-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ question: q, datasetId, metadata, periodInfo, userContext, mandatoryFilters, metadataSetId: session.metadataSetId, timePeriod: session.timePeriod }),
      })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Question failed.')

      if (json.usage) {
        setTotalTokens(function(prev) {
          return {
            prompt:     prev.prompt     + (json.usage.prompt_tokens     || 0),
            completion: prev.completion + (json.usage.completion_tokens || 0),
          }
        })
      }

      var newId = Date.now()
      setAnswers(function(prev) {
        return [{
          id: newId, question: q, periodUsed: json.periodUsed,
          queries: json.queries || [], narrative: json.narrative,
          dependentFields: json.dependentFields || [],
        }].concat(prev)
      })
      setExpandedAnswerId(newId)
      setQuestion('')
    } catch(err) { setError(err.message) }
    setLoading(false)
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAsk() }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 28px 80px' }}>

      {/* ── Header ── */}
      <div className="fade-in" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(155,127,227,0.2), rgba(103,74,183,0.1))', border: '1px solid rgba(155,127,227,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="#B8A0F0" strokeWidth="1.3"/>
              <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" stroke="#B8A0F0" strokeWidth="1.3" strokeLinecap="round"/>
              <circle cx="6" cy="9" r="0.6" fill="#B8A0F0"/>
            </svg>
          </div>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Ask Your Data</h2>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 2 }}>
              {periodInfo.viewLabel && <span style={{ color: 'var(--text-accent)', marginRight: 8 }}>{periodInfo.viewLabel}</span>}
              Ask any question · Context from setup always applies · ⌘↵ to submit
            </p>
          </div>
        </div>

        {/* Active filters display */}
        {(mandatoryFilters.length > 0 || (userContext && userContext.filters && userContext.filters.length > 0)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {mandatoryFilters.map(function(f, i) {
              return <span key={'mf_'+i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(240,160,48,0.1)', border: '1px solid rgba(240,160,48,0.3)', color: '#F0A030', fontFamily: 'var(--font-mono)' }}>{f.display_name || f.field}: {f.value}</span>
            })}
            {userContext && userContext.filters && userContext.filters.map(function(f, i) {
              return <span key={'cf_'+i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{f.display || (f.field + ' ' + f.operator + ' ' + f.value)}</span>
            })}
          </div>
        )}

        {/* Token counter */}
        {(totalTokens.prompt > 0 || totalTokens.completion > 0) && (
          <div style={{ marginTop: 10, display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              Tokens used: <span style={{ color: 'var(--text-accent)' }}>{(totalTokens.prompt + totalTokens.completion).toLocaleString()}</span>
              <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>({totalTokens.prompt.toLocaleString()} prompt · {totalTokens.completion.toLocaleString()} completion)</span>
            </span>
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={question}
            onChange={function(e) { setQuestion(e.target.value) }}
            onKeyDown={handleKeyDown}
            placeholder="Ask any question about your data — e.g. which segment performed best last month, or what is driving the decline in a KPI?"
            rows={3}
            style={{
              flex: 1, padding: '12px 16px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'var(--font-body)', lineHeight: 1.5,
              resize: 'vertical', outline: 'none',
              transition: 'border-color var(--transition)',
            }}
            onFocus={function(e) { e.target.style.borderColor = 'rgba(155,127,227,0.5)' }}
            onBlur={function(e)  { e.target.style.borderColor = 'var(--border)' }}
          />
          <button
            onClick={handleAsk}
            disabled={!question.trim() || loading}
            style={{
              padding: '0 24px', flexShrink: 0, alignSelf: 'stretch',
              background: !question.trim() || loading
                ? 'transparent'
                : 'linear-gradient(135deg, rgba(155,127,227,0.2) 0%, rgba(103,74,183,0.14) 100%)',
              border: '1px solid ' + (!question.trim() || loading ? 'var(--border)' : 'rgba(155,127,227,0.4)'),
              borderRadius: 'var(--radius-md)',
              color: !question.trim() || loading ? 'var(--text-tertiary)' : '#B8A0F0',
              cursor: !question.trim() || loading ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-display)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all var(--transition)',
            }}
          >
            {loading
              ? <><span className="spinner" style={{ borderTopColor: '#B8A0F0', borderColor: 'var(--border)', width: 14, height: 14, borderWidth: 1.5 }} /> Thinking...</>
              : <>
                  <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <circle cx="6" cy="9" r="0.6" fill="currentColor"/>
                  </svg>
                  Ask
                </>
            }
          </button>
        </div>
        {error && (
          <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginTop: 8, fontFamily: 'var(--font-body)' }}>
            {error}
          </p>
        )}
      </div>

      {/* ── Empty state ── */}
      {answers.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(155,127,227,0.08)', border: '1px solid rgba(155,127,227,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="#B8A0F0" strokeWidth="1.3" opacity="0.5"/>
              <path d="M4.5 4.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.5-1.5 2.5" stroke="#B8A0F0" strokeWidth="1.3" strokeLinecap="round" opacity="0.5"/>
              <circle cx="6" cy="9" r="0.6" fill="#B8A0F0" opacity="0.5"/>
            </svg>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', marginBottom: 8 }}>Ask anything about your data</p>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
            No dashboard generated — every token goes directly to answering your question. Period context and filters from setup always apply.
          </p>
        </div>
      )}

      {/* ── Answer blocks ── */}
      {answers.map(function(ans) {
        var isExpanded = expandedAnswerId === ans.id
        return (
          <div key={ans.id} className="fade-in" style={{ marginBottom: 16, background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid rgba(155,127,227,0.2)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(155,127,227,0.5), transparent)' }} />

            {/* Question header — clickable */}
            <div onClick={function() { setExpandedAnswerId(isExpanded ? null : ans.id) }}
              style={{ padding: '14px 20px 12px', borderBottom: isExpanded ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, flexShrink: 0, marginTop: 2, background: 'rgba(155,127,227,0.12)', color: '#B8A0F0', border: '1px solid rgba(155,127,227,0.25)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Q</span>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-body)', lineHeight: 1.5, flex: 1 }}>{ans.question}</p>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 2 }}>{ans.periodUsed}</span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2, display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)' }}>▾</span>
              </div>
            </div>

            {isExpanded && (
              <>
                {/* Charts */}
                {ans.queries.filter(function(q) { return !q.error && q.data && q.data.length }).length > 0 && (
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: ans.queries.filter(function(q){ return !q.error && q.data && q.data.length }).length === 1 ? '1fr' : '1fr 1fr', gap: 12 }}>
                      {ans.queries.filter(function(q) { return !q.error && q.data && q.data.length }).map(function(q, i) { return renderChart(q, i) })}
                    </div>
                  </div>
                )}

                {/* Failed queries */}
                {ans.queries.filter(function(q) { return !!q.error }).map(function(q, i) {
                  return <div key={i} style={{ padding: '8px 20px', background: 'rgba(224,85,85,0.04)', borderBottom: '1px solid rgba(224,85,85,0.1)' }}><p style={{ fontSize: 10, color: 'var(--red-text)', fontFamily: 'var(--font-mono)' }}>{q.title}: {q.error}</p></div>
                })}
                 {/* Query Inspector */}
                {ans.queries && ans.queries.length > 0 && (
                  <QueryInspector queries={ans.queries} />
                )}
                {/* Narrative */}
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
                    {ans.narrative.data_limitation && (
                      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontStyle: 'italic', marginTop: 8 }}>Note: {ans.narrative.data_limitation}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
