// Calls LLM to parse a free-text user context string into:
//   1. filters      — dimension WHERE conditions (existing)
//   2. kpi_focus    — KPI priority reordering (existing)
//   3. intent       — analytical objective: ranking, drilldown, distribution, temporal (NEW)
//
// All three are additive — existing consumers of filters/kpi_focus are unchanged.
// intent is a new field that generate-queries optionally uses to add bonus queries.

export async function POST(request) {
  var body
  try { body = await request.json() } catch(e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var contextText = (body.contextText || '').trim()
  var metadata    = body.metadata || []
  var apiKey      = process.env.OPENAI_API_KEY

  if (!contextText) {
    return Response.json({ filters: [], kpi_focus: [], explanation: '', intent: null })
  }
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })
  }

  // Build compact field catalogues for the LLM
  var dimensions = metadata
    .filter(function(m) { return m.type === 'dimension' && m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:   m.field_name,
        display: m.display_name,
        sample:  m.sample_values,
        definition: m.definition || '',
      }
    })

  var kpis = metadata
    .filter(function(m) { return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:       m.field_name,
        display:     m.display_name,
        definition:  m.definition || '',
        type:        m.type,
        favorable:   m.favorable_direction || 'i',
      }
    })

  // Identify which dimensions are time/sequence dimensions so intent reasoning is better
  var timeDims = metadata.filter(function(m) {
    return m.is_output !== 'N' && (
      m.type === 'dimension' &&
      /interval|time|hour|slot|period|day|date/i.test(m.field_name)
    )
  }).map(function(m) { return m.field_name })

  var entityDims = metadata.filter(function(m) {
    return m.is_output !== 'N' && m.type === 'dimension' &&
      /branch|store|region|market|location|team|segment|product/i.test(m.field_name)
  }).map(function(m) { return m.field_name })

  var prompt = [
    'You are a BI dashboard assistant. A user has described their analytical goal in plain English.',
    'Your job is to extract THREE things from their input:',
    '',
    '─────────────────────────────────────────────────────────',
    '1. FILTERS  — dimension filters to apply to ALL queries',
    '   e.g. "West region" → { field: "branch_region", operator: "=", value: "West" }',
    '',
    '2. KPI_FOCUS — which KPIs to prioritise in the dashboard',
    '   Reason from KPI definitions — do NOT just do string matching.',
    '   "focus on stress" should identify bfi_2_score and any stress-related scores.',
    '',
    '3. INTENT — the analytical QUESTION the user wants answered.',
    '   This is the most important new addition. Classify the intent as one of:',
    '',
    '   a) "ranking"',
    '      User wants to know WHICH entities rank highest/lowest on a metric.',
    '      e.g. "which branches have the highest stress"',
    '      e.g. "show me worst performing regions"',
    '      → Extract: primary_entity (the thing being ranked), primary_metric (the KPI to rank by),',
    '        direction ("desc" for highest-first, "asc" for lowest-first), top_n (default 10)',
    '',
    '   b) "ranking_with_drilldown"',
    '      User wants ranking PLUS a deeper look into a sub-dimension for the top results.',
    '      e.g. "which branches have high stress, and show me when it peaks during the day"',
    '      e.g. "top stressed branches broken down by time interval"',
    '      → Extract everything in "ranking" PLUS:',
    '        drilldown_dimension (the sub-dimension to drill into, e.g. interval_sort_order)',
    '        drilldown_display (human label for drilldown, e.g. "Time Interval")',
    '',
    '   c) "distribution"',
    '      User wants to see how values spread across categories (not ranked order).',
    '      e.g. "show me how branches are distributed by stress type"',
    '      e.g. "what percentage of intervals are Very High stress"',
    '      → Extract: distribution_dimension (the categorical field), distribution_metric (KPI)',
    '',
    '   d) "temporal"',
    '      User wants to find peaks or patterns OVER TIME or across time slots.',
    '      e.g. "when does stress peak during the day"',
    '      e.g. "busiest intervals across all branches"',
    '      → Extract: time_dimension (e.g. interval_sort_order, report_day),',
    '        temporal_metric (the KPI to analyse over time)',
    '',
    '   e) null — standard dashboard, no specific analytical intent detected.',
    '',
    '─────────────────────────────────────────────────────────',
    '',
    '## USER INPUT',
    contextText,
    '',
    '## AVAILABLE DIMENSIONS',
    JSON.stringify(dimensions),
    '',
    '## TIME/SEQUENCE DIMENSIONS (useful for drilldown and temporal intents)',
    timeDims.join(', ') || 'none detected',
    '',
    '## ENTITY DIMENSIONS (useful for ranking intents)',
    entityDims.join(', ') || 'none detected',
    '',
    '## AVAILABLE KPIs',
    JSON.stringify(kpis),
    '',
    'Return ONLY valid JSON with this exact structure:',
    '{',
    '  "filters": [',
    '    { "field": "branch_region", "operator": "=", "value": "East", "display": "branch_region = East" }',
    '  ],',
    '  "kpi_focus": ["bfi_2_score", "total_txn_time_sec"],',
    '  "explanation": "One sentence: what was extracted and why",',
    '  "intent": {',
    '    "type": "ranking | ranking_with_drilldown | distribution | temporal | null",',
    '    "summary": "One sentence describing the analytical question in plain English",',
    '',
    '    // For ranking and ranking_with_drilldown:',
    '    "primary_entity": "branch_name",',
    '    "primary_entity_display": "Branch",',
    '    "primary_metric": "bfi_2_score",',
    '    "primary_metric_display": "BFI 2 Score",',
    '    "direction": "desc",',
    '    "top_n": 10,',
    '',
    '    // For ranking_with_drilldown only:',
    '    "drilldown_dimension": "interval_sort_order",',
    '    "drilldown_display": "Time Interval",',
    '    "drilldown_label_field": "interval",',
    '',
    '    // For distribution:',
    '    "distribution_dimension": "Stress Type",',
    '    "distribution_metric": "bfi_2_score",',
    '',
    '    // For temporal:',
    '    "time_dimension": "interval_sort_order",',
    '    "time_label_field": "interval",',
    '    "temporal_metric": "bfi_2_score"',
    '  }',
    '}',
    '',
    'Rules:',
    '- filters: only use field names from the AVAILABLE DIMENSIONS list',
    '- kpi_focus: only use field names from the AVAILABLE KPIs list',
    '- intent.type must be exactly one of: ranking, ranking_with_drilldown, distribution, temporal, null',
    '- If no filter can be confidently extracted, return filters: []',
    '- If no KPI focus, return kpi_focus: []',
    '- If no clear analytical intent, return intent: null',
    '- operator must be one of: =, !=, >, <, IN',
    '- For intent null, omit all intent sub-fields (just { "type": null })',
    '- Return ONLY JSON, no markdown',
  ].join('\n')

  try {
    // Try Anthropic first, fall back to OpenAI
    var parsed
    var anthropicKey = process.env.ANTHROPIC_API_KEY
    var usedModel = ''

    if (anthropicKey) {
      var res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        var aj = await res.json()
        var content = aj.content && aj.content[0] && aj.content[0].text
        parsed = JSON.parse(content.replace(/```json|```/g, '').trim())
        usedModel = 'claude-sonnet-4-20250514'
      }
    }

    if (!parsed) {
      var ores = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 800,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Return only valid JSON matching the schema exactly.' },
            { role: 'user',   content: prompt },
          ],
        }),
      })
      var oj = await ores.json()
      var ocontent = oj.choices && oj.choices[0] && oj.choices[0].message && oj.choices[0].message.content
      parsed = JSON.parse(ocontent.replace(/```json|```/g, '').trim())
      usedModel = 'gpt-4o'
    }

    // Normalise intent — if type is 'null' string or missing, set to null
    var intent = parsed.intent || null
    if (intent && (!intent.type || intent.type === 'null')) intent = null

    console.log('=== extract-context intent:', intent ? intent.type : 'none', '| model:', usedModel)

    return Response.json({
      filters:     parsed.filters     || [],
      kpi_focus:   parsed.kpi_focus   || [],
      explanation: parsed.explanation || '',
      intent,
    })
  } catch(err) {
    console.error('extract-context error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
