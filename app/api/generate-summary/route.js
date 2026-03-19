export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY is not set in Vercel environment variables.' }, { status: 500 })
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

  var kpiResults = queryResults
    .filter(function(r) { return r.chart_type === 'kpi' && !r.error && r.data && r.data.length })
    .map(function(r) {
      var row    = r.data[0] || {}
      var curKey = r.current_key || r.value_key || 'current_value'
      var cmpKey = r.comparison_key || 'comparison_value'
      var curr   = parseFloat(row[curKey])
      var prev   = parseFloat(row[cmpKey])
      var chg    = (!isNaN(curr) && !isNaN(prev) && prev !== 0)
        ? (((curr - prev) / Math.abs(prev)) * 100).toFixed(1) : null
      return { title: r.title, unit: r.unit || '', current: isNaN(curr) ? null : curr, previous: isNaN(prev) ? null : prev, change_pct: chg ? parseFloat(chg) : null }
    })

  // Compute trend trajectory for area/line results (from Trend Explorer)
  var trendResults = queryResults
    .filter(function(r) { return (r.chart_type === 'area' || r.chart_type === 'line') && !r.error && r.data && r.data.length >= 3 })
    .map(function(r) {
      var sorted = r.data.slice().sort(function(a, b) { return String(a.period || a.label || '').localeCompare(String(b.period || b.label || '')) })
      var vals   = sorted.map(function(row) { return parseFloat(row.value || row.current_value || 0) }).filter(function(v) { return !isNaN(v) })
      if (vals.length < 3) return null
      var latest = vals[vals.length - 1]
      var first  = vals[0]
      var overallChg = first !== 0 ? ((latest - first) / Math.abs(first) * 100).toFixed(1) : null
      return {
        title:     r.title,
        unit:      r.unit || '',
        periods:   vals.length,
        latest:    latest,
        overall_change_pct: overallChg ? parseFloat(overallChg) : null,
        direction: latest > first ? 'up' : latest < first ? 'down' : 'flat',
        recent_values: vals.slice(-6), // last 6 months for context
      }
    })
    .filter(Boolean)

  var chartResults = queryResults
    .filter(function(r) { return r.chart_type !== 'kpi' && r.chart_type !== 'area' && r.chart_type !== 'line' && !r.error && r.data && r.data.length })
    .map(function(r) { return { title: r.title, chart_type: r.chart_type, data: r.data.slice(0, 20) } })

  var metaSummary = (metadata || []).map(function(m) {
    return {
      field:            m.field_name,
      display:          m.display_name,
      type:             m.type,
      unit:             m.unit,
      definition:       m.definition,
      benchmark:        m.benchmark,
      accumulation_type: m.accumulation_type,
    }
  })

  var periodContext = ''
  if (periodInfo.viewLabel || periodInfo.cmpLabel) {
    periodContext = '\n\nTIME PERIOD CONTEXT:\nCurrent period: ' + (periodInfo.viewLabel || 'Not specified') + '\nComparison period: ' + (periodInfo.cmpLabel || 'Not specified') + '\nMake sure to mention these specific time periods in your narrative.'
  }

  var trendSection = trendResults.length
    ? '\n\nTREND TRAJECTORIES (from Trend Explorer — multi-period history):\n' + JSON.stringify(trendResults, null, 2)
    : ''

  var prompt = 'You are an expert BI analyst and executive business narrator for a banking dashboard.\n\n'
    + 'Below are actual query results from a live banking dashboard, along with field metadata.'
    + periodContext
    + '\n\nKPI SNAPSHOT (point-in-time):\n'
    + JSON.stringify(kpiResults, null, 2)
    + trendSection
    + '\n\nCHART DATA (dimension breakdowns):\n'
    + JSON.stringify(chartResults, null, 2)
    + '\n\nMETADATA:\n'
    + JSON.stringify(metaSummary, null, 2)
    + '\n\nRULES:\n'
    + '1. Use ONLY the data provided. Do not fabricate numbers.\n'
    + '2. Always mention the specific time period (' + (periodInfo.viewLabel || '') + ') and comparison (' + (periodInfo.cmpLabel || '') + ') at the start.\n'
    + '3. Use metadata to correctly interpret field names and units.\n'
    + '4. Compare values against benchmarks where available.\n'
    + '5. If trend trajectories are provided, reference them in key_highlights and closing_insight — mention direction and whether any KPI is accelerating.\n'
    + '6. Return a JSON object only — no markdown, no explanation.\n\n'
    + 'Return this exact JSON structure:\n'
    + '{\n'
    + '  "kpis": [\n'
    + '    {\n'
    + '      "title": "Total Revenue",\n'
    + '      "value": "4.2M",\n'
    + '      "unit": "USD",\n'
    + '      "trend": "up",\n'
    + '      "change": "+12% vs prior period",\n'
    + '      "color": "green"\n'
    + '    }\n'
    + '  ],\n'
    + '  "narrative": {\n'
    + '    "overall_performance": "One headline sentence mentioning the exact time period and comparison.",\n'
    + '    "key_highlights": ["Highlight 1 with actual numbers", "Highlight 2", "Highlight 3"],\n'
    + '    "areas_of_attention": ["Concern 1 with context", "Concern 2 if applicable"],\n'
    + '    "closing_insight": "One forward-looking sentence referencing the trend observed."\n'
    + '  }\n'
    + '}\n\n'
    + 'trend options: up, down, neutral\n'
    + 'color options: green, red, amber, blue\n'
    + 'Generate KPI cards only for kpi and derived_kpi type fields.\n'
    + 'Keep values formatted compactly (4.2M not 4200000).\n'
    + 'Include actual numbers from the query results in the narrative — be specific.'

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a banking BI analyst. Return only valid JSON. Always reference the exact time period and comparison period provided. Use real numbers from the data.' },
          { role: 'user', content: prompt },
        ],
      }),
    })

    var json = await response.json()
    if (!response.ok) {
      console.error('OpenAI error:', JSON.stringify(json))
      throw new Error((json.error && json.error.message) ? json.error.message : 'OpenAI API error ' + response.status)
    }

    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (!content) throw new Error('Empty response from OpenAI')

    var cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim()
    var parsed
    try { parsed = JSON.parse(cleaned) } catch (e) {
      throw new Error('Could not parse JSON: ' + cleaned.slice(0, 200))
    }

    var usage = json.usage || {}
    return Response.json({ result: parsed, model: 'gpt-4o-mini', usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o-mini' } })
  } catch (err) {
    console.error('generate-summary error:', err)
    return Response.json({ error: err.message || 'Failed to generate summary.' }, { status: 500 })
  }
}
