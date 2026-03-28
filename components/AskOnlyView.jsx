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

function renderChart(result, idx) {
  var ct       = result.chart_type
  var labelKey = result.label_key    || 'label'
  var curKey   = result.current_key  || result.value_key || 'current_value'
  var valueKey = result.value_key    || 'value'
  var data     = result.data || []
  var color    = P[idx % P.length]
  var colorA   = PA[idx % PA.length]
  var insight  = result.insight

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

  return null
}

// ── Main AskOnlyView ──────────────────────────────────────────────────────────

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

  async function handleAsk() {
    var q = question.trim()
    if (!q || loading) return
    setLoading(true); setError('')
    try {
      var res = await fetch('/api/ask-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, datasetId, metadata, periodInfo, userContext, mandatoryFilters }),
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
