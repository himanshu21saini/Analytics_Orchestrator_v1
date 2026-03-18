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

      // Find benchmark from metadata
      var meta = (metadata || []).find(function(m) { return m.field_name === r.id || r.title.toLowerCase().includes(m.display_name.toLowerCase()) })
      var benchmark = meta && meta.benchmark ? meta.benchmark : null

      return {
        title:        r.title,
        unit:         r.unit || '',
        current:      isNaN(curr) ? null : curr,
        previous:     isNaN(prev) ? null : prev,
        change_pct:   changePct ? parseFloat(changePct) : null,
        benchmark:    benchmark,
        breached:     benchmark && !isNaN(curr) ? (parseFloat(benchmark) < curr ? 'above' : parseFloat(benchmark) > curr ? 'below' : 'at') : null,
      }
    })

  var chartSummary = queryResults
    .filter(function(r) { return r.chart_type !== 'kpi' && !r.error && r.data && r.data.length })
    .map(function(r) {
      var top = r.data.slice(0, 5)
      return { title: r.title, chart_type: r.chart_type, top_rows: top }
    })

  var metaSummary = (metadata || []).map(function(m) {
    return {
      field:      m.field_name,
      display:    m.display_name,
      type:       m.type,
      unit:       m.unit,
      definition: m.definition,
      benchmark:  m.benchmark,
      priority:   m.business_priority,
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
    '## KPI SNAPSHOT',
    JSON.stringify(kpiSummary, null, 2),
    '',
    '## CHART DATA (dimension breakdowns)',
    JSON.stringify(chartSummary, null, 2),
    '',
    '## FIELD METADATA',
    JSON.stringify(metaSummary, null, 2),
    '',
    '## YOUR TASK',
    '',
    'STEP 1 — ANOMALY SCAN',
    'For every KPI: compare current vs previous and vs benchmark.',
    'Flag anything that is:',
    '  - More than 10% worse than prior period',
    '  - Breaching its benchmark',
    '  - Showing an accelerating negative trend (use chart data for context)',
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
        model: 'gpt-4o-mini',
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

    return Response.json({ result: parsed, model: 'gpt-4o-mini' })
  } catch (err) {
    console.error('generate-decisions error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate decisions.' }, { status: 500 })
  }
}
