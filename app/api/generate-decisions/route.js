export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })
  }

  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var queryResults = body.queryResults
  var metadata     = body.metadata
  var periodInfo   = body.periodInfo || {}

  if (!queryResults || !queryResults.length) {
    return Response.json({ error: 'No query results provided.' }, { status: 400 })
  }

  // Build a compact, data-rich summary for the LLM
  var kpiSummary = queryResults
    .filter(function(r) { return r.chart_type === 'kpi' && !r.error && r.data && r.data.length })
    .map(function(r) {
      var row     = r.data[0] || {}
      var curKey  = r.current_key  || r.value_key || 'current_value'
      var cmpKey  = r.comparison_key || 'comparison_value'
      var curr    = parseFloat(row[curKey])
      var prev    = parseFloat(row[cmpKey])
      var changePct = (!isNaN(curr) && !isNaN(prev) && prev !== 0)
        ? (((curr - prev) / Math.abs(prev)) * 100).toFixed(1)
        : null

      // Find benchmark from metadata — match on field_name extracted from synthetic id
      var fieldName = r.id.replace('trend_kpi_', '')
      var meta = (metadata || []).find(function(m) {
        return m.field_name === fieldName ||
               m.field_name === r.id ||
               r.title.toLowerCase().includes((m.display_name || '').toLowerCase())
      })
      var benchmark = meta && meta.benchmark ? meta.benchmark : null

      return {
        title:        r.title,
        unit:         r.unit || '',
        current:      isNaN(curr) ? null : curr,
        previous:     isNaN(prev) ? null : prev,
        change_pct:   changePct ? parseFloat(changePct) : null,
        benchmark:    benchmark,
        breached:     benchmark && !isNaN(curr) ? (parseFloat(benchmark) < curr ? 'above' : parseFloat(benchmark) > curr ? 'below' : 'at') : null,
        source:       r._from_trend ? 'trend_explorer' : 'dashboard',
      }
    })

  // For trend series: compute direction + acceleration instead of dumping raw rows
  var trendSummary = queryResults
    .filter(function(r) { return (r.chart_type === 'area' || r.chart_type === 'line') && !r.error && r.data && r.data.length >= 3 })
    .map(function(r) {
      var vals = r.data
        .slice()
        .sort(function(a, b) { return String(a.period || a.label || '').localeCompare(String(b.period || b.label || '')) })
        .map(function(row) { return parseFloat(row.value || row.current_value || 0) })
        .filter(function(v) { return !isNaN(v) })

      if (vals.length < 3) return null

      var latest   = vals[vals.length - 1]
      var prev3avg = (vals[vals.length - 4] + vals[vals.length - 3] + vals[vals.length - 2]) / 3
      var first    = vals[0]
      var overallChg = first !== 0 ? ((latest - first) / Math.abs(first) * 100).toFixed(1) : null
      var recentChg  = prev3avg !== 0 ? ((latest - prev3avg) / Math.abs(prev3avg) * 100).toFixed(1) : null

      // Detect acceleration: is recent trend steeper than overall trend?
      var midpoint   = vals[Math.floor(vals.length / 2)]
      var firstHalf  = midpoint !== 0 ? ((midpoint - first) / Math.abs(first) * 100) : 0
      var secondHalf = midpoint !== 0 ? ((latest - midpoint) / Math.abs(midpoint) * 100) : 0
      var accelerating = Math.abs(secondHalf) > Math.abs(firstHalf) * 1.2

      return {
        title:          r.title,
        unit:           r.unit || '',
        periods:        r.data.length,
        latest_value:   latest,
        overall_change_pct: overallChg ? parseFloat(overallChg) : null,
        recent_3m_change_pct: recentChg ? parseFloat(recentChg) : null,
        direction:      latest > first ? 'up' : latest < first ? 'down' : 'flat',
        accelerating:   accelerating,
        peak:           Math.max.apply(null, vals),
        trough:         Math.min.apply(null, vals),
      }
    })
    .filter(Boolean)

  var chartSummary = queryResults
    .filter(function(r) { return r.chart_type !== 'kpi' && r.chart_type !== 'area' && r.chart_type !== 'line' && !r.error && r.data && r.data.length })
    .map(function(r) {
      var top = r.data.slice(0, 5)
      return { title: r.title, chart_type: r.chart_type, top_rows: top }
    })

  var metaSummary = (metadata || [])
    .filter(function(m) { return m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:               m.field_name,
        display:             m.display_name,
        type:                m.type,
        unit:                m.unit,
        definition:          m.definition,
        benchmark:           m.benchmark,
        priority:            m.business_priority,
        favorable_direction: m.favorable_direction || 'i',
      }
    })

  var systemMsg = [
    'You are a senior banking decision intelligence analyst.',
    'Your job is NOT to narrate what happened — the reporting system already does that.',
    'Your job is to identify what MATTERS and tell the executive exactly what to DO.',
    'Be specific. Be prioritised. Be direct. Reference exact numbers.',
    'Return ONLY valid JSON. No markdown. No preamble.',
  ].join(' ')

  var prompt = [
    '## CONTEXT',
    'Period: ' + (periodInfo.viewLabel || 'current') + ' vs ' + (periodInfo.cmpLabel || 'prior'),
    '',
    '## KPI SNAPSHOT (point-in-time values)',
    JSON.stringify(kpiSummary, null, 2),
    '',
    '## TREND ANALYSIS (multi-period trajectory from Trend Explorer)',
    trendSummary.length
      ? JSON.stringify(trendSummary, null, 2)
      : '(no trend data available — user has not opened Trend Explorer yet)',
    '',
    '## CHART DATA (dimension breakdowns)',
    JSON.stringify(chartSummary, null, 2),
    '',
    '## FIELD METADATA',
    JSON.stringify(metaSummary, null, 2),
    '',
    '## YOUR TASK',
    '',
    '## FAVORABLE DIRECTION RULE',
    'Each KPI in the metadata has favorable_direction: "i" = increase is good, "d" = decrease is good.',
    'Apply this when assessing whether a change is positive or negative:',
    '  - favorable_direction="i": rising value = good, falling value = bad (e.g. Revenue, NII, Customers)',
    '  - favorable_direction="d": falling value = good, rising value = bad (e.g. NPA Ratio, Cost-to-Income, Expenses)',
    'NEVER flag an improving trend as a risk. ALWAYS use favorable_direction to determine what is "worse".',
    '',
    'STEP 1 — ANOMALY SCAN',
    'For every KPI: compare current vs previous and vs benchmark.',
    'Use favorable_direction from metadata to determine if a change is good or bad.',
    'Flag anything that is:',
    '  - More than 10% WORSE than prior period (apply favorable_direction to determine worse)',
    '  - Breaching its benchmark in the wrong direction',
    '  - Showing an accelerating unfavorable trend',
    '  - Showing a long-run deterioration in the unfavorable direction',
    '',
    'STEP 2 — DECISION RECOMMENDATIONS',
    'For each significant signal, produce ONE clear decision card.',
    'A decision card must answer: What is the problem? What should I do? Why? What happens if I ignore it?',
    'Rank by urgency (1 = most urgent). Max 5 decisions.',
    '',
    'STEP 3 — WHAT-IF PREVIEW',
    'For the top 2 most urgent decisions, generate one what-if scenario each.',
    'A what-if scenario asks: "If we take this action, what metric moves and by how much?"',
    'Be concrete — e.g. "Reducing NPA in North by 0.5% would improve provisioning by ~12M".',
    '',
    'STEP 4 — HEALTH SCORE',
    'Give an overall portfolio health score from 0-100.',
    'Break it down into sub-scores for: profitability, risk, growth, efficiency (each 0-100).',
    'Explain each sub-score in one short sentence.',
    '',
    '## OUTPUT FORMAT — JSON ONLY',
    '{',
    '  "health": {',
    '    "overall": 72,',
    '    "profitability": { "score": 80, "label": "Revenue on track, margins under slight pressure" },',
    '    "risk": { "score": 55, "label": "NPA ratio breaching benchmark in 2 regions" },',
    '    "growth": { "score": 75, "label": "Loan book expanding ahead of target" },',
    '    "efficiency": { "score": 68, "label": "Cost-to-income slightly elevated vs prior year" }',
    '  },',
    '  "decisions": [',
    '    {',
    '      "priority": 1,',
    '      "signal": "NPA ratio in North region: 4.8% vs 3.5% benchmark",',
    '      "urgency": "high",',
    '      "recommended_action": "Initiate credit review for top 20 NPA accounts in North region",',
    '      "rationale": "NPA has risen 37% YoY and breaches the 3.5% benchmark; if unchecked, provisioning requirements will increase by estimated 15-20%",',
    '      "impact_if_ignored": "Additional provisioning of ~$8M by Q3; possible regulatory flagging",',
    '      "owner_hint": "Risk / Credit team",',
    '      "confidence": "high"',
    '    }',
    '  ],',
    '  "whatif_scenarios": [',
    '    {',
    '      "decision_priority": 1,',
    '      "scenario": "If NPA in North is reduced from 4.8% to 3.5%",',
    '      "projected_impact": "Provisioning requirement drops by ~$8M; ROE improves by ~0.4 percentage points",',
    '      "effort": "medium",',
    '      "timeframe": "2-3 quarters"',
    '    }',
    '  ]',
    '}',
    '',
    'urgency options: high, medium, low',
    'confidence options: high, medium, low',
    'effort options: low, medium, high',
    'Generate ONLY decisions supported by the data. Do not fabricate metrics.',
  ].join('\n')

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 3000,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: prompt },
        ],
      }),
    })

    var json = await response.json()
    if (!response.ok) {
      throw new Error((json.error && json.error.message) ? json.error.message : 'OpenAI error ' + response.status)
    }

    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (!content) throw new Error('Empty response from OpenAI')

    var cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim()
    var parsed
    try { parsed = JSON.parse(cleaned) } catch (e) {
      throw new Error('Could not parse JSON: ' + cleaned.slice(0, 300))
    }

    // Ensure decisions are sorted by priority
    if (parsed.decisions && Array.isArray(parsed.decisions)) {
      parsed.decisions.sort(function(a, b) { return (a.priority || 99) - (b.priority || 99) })
    }

    var usage = json.usage || {}
    return Response.json({ result: parsed, model: 'gpt-4o', usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o' } })
  } catch (err) {
    console.error('generate-decisions error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate decisions.' }, { status: 500 })
  }
}
