import { query } from '../../../lib/db'

// ── ask-question API ──────────────────────────────────────────────────────────
// Handles free-flowing question input from the dashboard question panel.
// Three internal steps:
//   1. Parse time period from question (or fall back to dashboard period)
//   2. Generate targeted SQL queries via GPT-4o
//   3. Execute queries, then generate a narrative answer
//
// Context filters from setup ALWAYS apply — they cannot be overridden by questions.

var MONTHS_MAP = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
}

// ── Parse a time reference from free text ─────────────────────────────────────
// Returns { year, month, label } if found, null otherwise.
// Handles: "Feb 2026", "Feb'26", "January 2025", "Q1 2026", "last 3 months"
function parseTimeFromQuestion(question) {
  var q = question.toLowerCase()

  // Pattern: month name + year e.g. "feb 2026" or "feb'26"
  var monthYearRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)['\s]+(\d{2,4})/i
  var m1 = q.match(monthYearRe)
  if (m1) {
    var monthNum = MONTHS_MAP[m1[1].toLowerCase()]
    var yr = parseInt(m1[2]); if (yr < 100) yr += 2000
    return { year: yr, month: monthNum, label: m1[1] + ' ' + yr, type: 'month' }
  }

  // Pattern: Q1/Q2/Q3/Q4 + year
  var qtrRe = /\bq([1-4])\s*'?(\d{2,4})/i
  var m2 = q.match(qtrRe)
  if (m2) {
    var qtr  = parseInt(m2[1])
    var yr   = parseInt(m2[2]); if (yr < 100) yr += 2000
    var mMin = (qtr - 1) * 3 + 1
    var mMax = qtr * 3
    return { year: yr, monthMin: mMin, monthMax: mMax, label: 'Q' + qtr + ' ' + yr, type: 'quarter' }
  }
  // Pattern: "last N months"
  var lastNRe = /last\s+(\d+)\s+months?/i
  var m3 = q.match(lastNRe)
  if (m3) {
    var n = parseInt(m3[1])
    var toDate   = new Date()
    var fromDate = new Date(toDate.getFullYear(), toDate.getMonth() - n + 1, 1)
    return {
      type:       'range',
      fromYear:   fromDate.getFullYear(),
      fromMonth:  fromDate.getMonth() + 1,
      toYear:     toDate.getFullYear(),
      toMonth:    toDate.getMonth() + 1,
      label:      'Last ' + n + ' months',
    }
  }
  return null
}

// ── Build period SQL conditions from parsed time or dashboard periodInfo ───────
function buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf) {
  // If a specific time was found in the question, use it
  if (parsedTime) {
    var y = "(data->>'"+yf+"')::integer = " + parsedTime.year
    if (parsedTime.type === 'month') {
      var m = "(data->>'"+mf+"')::integer = " + parsedTime.month
      return { cond: y + ' AND ' + m, label: parsedTime.label }
    }
    if (parsedTime.type === 'quarter') {
      var m = "(data->>'"+mf+"')::integer >= " + parsedTime.monthMin + " AND (data->>'"+mf+"')::integer <= " + parsedTime.monthMax
      return { cond: y + ' AND ' + m, label: parsedTime.label }
    }
    // AFTER the existing 'month' and 'quarter' blocks:
if (parsedTime.type === 'range') {
  var cond =
    "((data->>'"+yf+"')::integer > " + parsedTime.fromYear +
    " OR ((data->>'"+yf+"')::integer = " + parsedTime.fromYear +
    " AND (data->>'"+mf+"')::integer >= " + parsedTime.fromMonth + "))" +
    " AND ((data->>'"+yf+"')::integer < " + parsedTime.toYear +
    " OR ((data->>'"+yf+"')::integer = " + parsedTime.toYear +
    " AND (data->>'"+mf+"')::integer <= " + parsedTime.toMonth + "))"
  return { cond: cond, label: parsedTime.label }
}
  }

  // Fall back to dashboard current period
  return {
    cond:  periodInfo.curCond || ("(data->>'"+yf+"')::integer = " + (periodInfo.curYear || new Date().getFullYear())),
    label: periodInfo.viewLabel || 'current period',
  }
}

export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY not set.' }, { status: 500 })

  var body
  try { body = await request.json() } catch(e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var question      = body.question       // free text question from user
  var datasetId     = body.datasetId
  var metadata      = body.metadata       || []
  var periodInfo    = body.periodInfo     || {}
  var userContext   = body.userContext    || null  // setup context — always applied

  if (!question || !datasetId) {
    return Response.json({ error: 'question and datasetId are required.' }, { status: 400 })
  }

  // ── Build context filter SQL (always applied — setup context supersedes) ────
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(f) {
      if (f.operator === 'equals' || f.operator === '=') {
        return " AND data->>'"+f.field+"' = '"+f.value+"'"
      }
      if (f.operator === 'not_equals' || f.operator === '!=') {
        return " AND data->>'"+f.field+"' != '"+f.value+"'"
      }
      return " AND data->>'"+f.field+"' "+f.operator+" '"+f.value+"'"
    }).join('')
  }
  var CF = contextFilterSQL  // always appended to every WHERE clause

  // ── Detect time reference in question ────────────────────────────────────────
  var parsedTime  = parseTimeFromQuestion(question)
  var yf          = periodInfo.yf || 'year'
  var mf          = periodInfo.mf || 'month'
  var periodConds = buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf)

  // ── Build compact metadata summary for the prompt ────────────────────────────
  var metaSummary = metadata
    .filter(function(m) { return m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:              m.field_name,
  display:            m.display_name,
  type:               m.type,
  unit:               m.unit || '',
  definition:         m.definition || '',
  aggregation:        m.aggregation || '',
  accumulation:       m.accumulation_type || '',
  business_priority:  m.business_priority || '',
  favorable_direction: m.favorable_direction || '',
      }
    })

  var contextNote = userContext && userContext.explanation
    ? '\n\nSETUP CONTEXT (always applies to all queries): ' + userContext.explanation
    + (CF ? '\nSQL filter always appended: ' + CF : '')
    : (CF ? '\n\nCONTEXT FILTER (always appended to all queries): ' + CF : '')

  // ── Step 1: Generate SQL queries for the question ─────────────────────────────
  var queryGenPrompt = [
    '## TASK',
    'Generate 1 to 3 SQL queries to answer this question from a business intelligence dashboard.',
    '',
    '## QUESTION',
    question,
    '',
    '## TIME PERIOD',
    'Period label: ' + periodConds.label,
    'Period SQL condition: ' + periodConds.cond,
    'Year field in data: ' + yf,
    'Month field in data: ' + mf,
    contextNote,
    '',
    '## DATABASE',
    'Table: dataset_rows',
    'Data column: JSONB — access with data->>\'field_name\'',
    'Always include: WHERE dataset_id = ' + datasetId,
    'Always append context filter to every query WHERE clause: ' + (CF || '(none)'),
    '',
    '## FIELD CATALOGUE',
    JSON.stringify(metaSummary, null, 2),
    '',
    '## FIELD PRIORITY',
'Each field in the catalogue has a business_priority (high/medium/low) and favorable_direction (i=increase good, d=decrease good).',
'When the question is ambiguous about which KPI to use, prefer fields with business_priority = "high".',
'When writing the insight field, frame changes correctly using favorable_direction — a rising cost (d) is bad, a rising revenue (i) is good.',
'',
    '## SQL RULES',
    '1. All field access: data->>\'field_name\' (exact case from catalogue)',
    '2. Numeric cast: COALESCE((data->>\'field\')::numeric, 0)',
    '3. Every query must include WHERE dataset_id = ' + datasetId + ' AND ' + periodConds.cond + (CF ? CF : ''),
    '3b. When using subqueries, ALWAYS alias every JSONB extraction in the inner SELECT (e.g. data->>\'branch_name\' AS branch_name). The outer query must reference the alias (branch_name), never re-access data->>\'field\' from a subquery result — the data column does not exist in subquery scope.',
    '4. Use the aggregation from the field catalogue (SUM for cumulative, AVG for point_in_time)',
    '5. For ranking queries: ORDER BY value DESC LIMIT 10',
    '6. For trend queries: GROUP BY year_field, month_field ORDER BY period ASC',
    '7. Always alias the main value column as "current_value" and the label column as "label"',
    '8. For trend/time series: alias as "period" and "value"',
    '',
    '## OUTPUT FORMAT — JSON only',
    '{',
    '  "queries": [',
    '    {',
    '      "id": "q1",',
    '      "title": "short descriptive title",',
    '      "chart_type": "bar|line|area|pie|donut|scatter|kpi",',
    '      "sql": "SELECT ...",',
    '      "label_key": "label",',
    '      "value_key": "current_value",',
    '      "current_key": "current_value",',
    '      "unit": "",',
    '      "insight": "one sentence explaining what this chart shows"',
    '    }',
    '  ],',
    '  "dependent_fields": ["field1", "field2"],',
    '  "period_used": "' + periodConds.label + '"',
    '}',
  ].join('\n')

  var queryGenRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a senior BI SQL engineer. Return only valid JSON. Generate precise SQL queries that answer the specific question asked. Never fabricate field names — use only fields from the catalogue.' },
        { role: 'user', content: queryGenPrompt },
      ],
    }),
  })

  var queryGenJson = await queryGenRes.json()
  if (!queryGenRes.ok) {
    var em = queryGenJson.error && queryGenJson.error.message ? queryGenJson.error.message : 'Query generation failed.'
    return Response.json({ error: em }, { status: 500 })
  }

  var queryGenContent = queryGenJson.choices[0].message.content
  var queryGenParsed
  try {
    queryGenParsed = JSON.parse(queryGenContent.replace(/```json|```/g, '').trim())
  } catch(e) {
    return Response.json({ error: 'Could not parse query generation response.' }, { status: 500 })
  }

  var queries        = queryGenParsed.queries || []
  var dependentFields = queryGenParsed.dependent_fields || []
  var periodUsed     = queryGenParsed.period_used || periodConds.label

  if (!queries.length) {
    return Response.json({ error: 'No queries generated. The question may reference fields not in the dataset.' }, { status: 400 })
  }

  // ── Step 2: Execute the queries ───────────────────────────────────────────────
  var queryResults = []
  for (var i = 0; i < queries.length; i++) {
    var q = queries[i]
    try {
      var rows = await query(q.sql)
      queryResults.push(Object.assign({}, q, { data: rows, error: null }))
    } catch(err) {
      console.error('ask-question query error:', err.message, '\nSQL:', q.sql)
      queryResults.push(Object.assign({}, q, { data: [], error: err.message }))
    }
  }

  // ── Step 3: Generate narrative answer ─────────────────────────────────────────
  var successfulResults = queryResults.filter(function(r) { return !r.error && r.data && r.data.length })
  var failedResults     = queryResults.filter(function(r) { return !!r.error || !r.data || !r.data.length })

  // Compact data summary — don't send raw rows, send key insights
  var dataSummary = successfulResults.map(function(r) {
    var rows = r.data.slice(0, 20)
    var valKey = r.current_key || r.value_key || 'current_value'
    var lblKey = r.label_key || 'label'

    // Compute top/bottom/average from results
    var numericRows = rows.filter(function(row) { return !isNaN(parseFloat(row[valKey])) })
    var avg = numericRows.length
      ? numericRows.reduce(function(s,row){ return s + parseFloat(row[valKey]) },0) / numericRows.length
      : null

    return {
      title:       r.title,
      chart_type:  r.chart_type,
      row_count:   r.data.length,
      top_rows:    rows.slice(0, 10),
      average:     avg !== null ? parseFloat(avg.toFixed(2)) : null,
    }
  })

  var narrativePrompt = [
    '## TASK',
    'Answer the following business intelligence question based on the actual query results provided.',
    'Be specific — reference actual numbers, segment names, and dates from the data.',
    'Identify what is driving the pattern and what the user should investigate further.',
    '',
    '## QUESTION',
    question,
    '',
    '## PERIOD ANALYSED',
    periodUsed,
    contextNote,
    '',
    '## QUERY RESULTS',
    JSON.stringify(dataSummary, null, 2),
    failedResults.length ? '\n## QUERIES THAT RETURNED NO DATA\n' + failedResults.map(function(r){ return r.title + (r.error ? ': ' + r.error : ': no rows') }).join('\n') : '',
    '',
    '## FIELD CONTEXT',
    'Dependent fields considered: ' + dependentFields.join(', '),
    '',
    '## OUTPUT FORMAT — JSON only',
    '{',
    '  "answer": "2-4 sentence direct answer to the question with specific numbers",',
    '  "key_findings": ["finding 1 with specific value", "finding 2", "finding 3"],',
    '  "drivers": "1-2 sentences on what appears to be driving the pattern (infer from data + domain knowledge)",',
    '  "investigate": ["specific thing to check 1", "specific thing to check 2", "specific thing to check 3"],',
    '  "data_limitation": "brief note if data was insufficient to fully answer, else empty string"',
    '}',
  ].join('\n')

  var narrativeRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a senior banking BI analyst. Answer questions precisely using only the data provided. Never fabricate numbers. If the data is insufficient, say so clearly.' },
        { role: 'user', content: narrativePrompt },
      ],
    }),
  })

  var narrativeJson = await narrativeRes.json()
  var narrative = null
  if (narrativeRes.ok) {
    try {
      narrative = JSON.parse(narrativeJson.choices[0].message.content.replace(/```json|```/g, '').trim())
    } catch(e) { narrative = null }
  }

  // Token tracking
  var usage = {
    prompt_tokens:     (queryGenJson.usage?.prompt_tokens || 0) + (narrativeJson.usage?.prompt_tokens || 0),
    completion_tokens: (queryGenJson.usage?.completion_tokens || 0) + (narrativeJson.usage?.completion_tokens || 0),
    model: 'gpt-4o',
  }

  return Response.json({
    question,
    periodUsed,
    queries:      queryResults,
    narrative,
    dependentFields,
    usage,
  })
}
