import { query } from '../../../lib/db'

var MONTHS_MAP = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
}

function parseTimeFromQuestion(question) {
  var q = question.toLowerCase()
  var m1 = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)['\s]+(\d{2,4})/i)
  if (m1) { var monthNum = MONTHS_MAP[m1[1].toLowerCase()]; var yr = parseInt(m1[2]); if (yr < 100) yr += 2000; return { year: yr, month: monthNum, label: m1[1] + ' ' + yr, type: 'month' } }
  var m2 = q.match(/\bq([1-4])\s*'?(\d{2,4})/i)
  if (m2) { var qtr = parseInt(m2[1]); var yr2 = parseInt(m2[2]); if (yr2 < 100) yr2 += 2000; var mMin = (qtr-1)*3+1; var mMax = qtr*3; return { year: yr2, monthMin: mMin, monthMax: mMax, label: 'Q'+qtr+' '+yr2, type: 'quarter' } }
  var m3 = q.match(/last\s+(\d+)\s+months?/i)
  if (m3) { var n = parseInt(m3[1]); var toD = new Date(); var fromD = new Date(toD.getFullYear(), toD.getMonth() - n + 1, 1); return { type: 'range', fromYear: fromD.getFullYear(), fromMonth: fromD.getMonth()+1, toYear: toD.getFullYear(), toMonth: toD.getMonth()+1, label: 'Last ' + n + ' months' } }
  return null
}

function buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf) {
  if (parsedTime) {
    if (parsedTime.type === 'month') {
      return { cond: yf + ' = ' + parsedTime.year + ' AND ' + mf + ' = ' + parsedTime.month, label: parsedTime.label }
    }
    if (parsedTime.type === 'quarter') {
      return { cond: yf + ' = ' + parsedTime.year + ' AND ' + mf + ' >= ' + parsedTime.monthMin + ' AND ' + mf + ' <= ' + parsedTime.monthMax, label: parsedTime.label }
    }
    if (parsedTime.type === 'range') {
      var cond = '(' + yf + ' > ' + parsedTime.fromYear + ' OR (' + yf + ' = ' + parsedTime.fromYear + ' AND ' + mf + ' >= ' + parsedTime.fromMonth + '))' +
        ' AND (' + yf + ' < ' + parsedTime.toYear + ' OR (' + yf + ' = ' + parsedTime.toYear + ' AND ' + mf + ' <= ' + parsedTime.toMonth + '))'
      return { cond: cond, label: parsedTime.label }
    }
  }
  return {
    cond:  periodInfo.curCond || (yf + ' = ' + (periodInfo.curYear || new Date().getFullYear())),
    label: periodInfo.viewLabel || 'current period',
  }
}

export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY not set.' }, { status: 500 })
  var body
  try { body = await request.json() } catch(e) { return Response.json({ error: 'Invalid request body.' }, { status: 400 }) }

  var question         = body.question
  var datasetId        = body.datasetId
  var metadata         = body.metadata         || []
  var periodInfo       = body.periodInfo        || {}
  var userContext      = body.userContext       || null
  var mandatoryFilters = body.mandatoryFilters  || []

  if (!question || !datasetId) return Response.json({ error: 'question and datasetId are required.' }, { status: 400 })

  var tbl = 'ds_' + datasetId

  // Context filters — direct column comparison
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(f) {
      var op = (f.operator === 'equals' || f.operator === '=') ? '=' : (f.operator === 'not_equals' || f.operator === '!=') ? '!=' : f.operator
      return " AND " + f.field + " " + op + " '" + String(f.value || '').replace(/'/g, "''") + "'"
    }).join('')
  }
  // Mandatory filters
  var mandatoryFilterSQL = mandatoryFilters.length ? mandatoryFilters.map(function(f) { return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'" }).join('') : ''
  var CF = contextFilterSQL + mandatoryFilterSQL

  var parsedTime  = parseTimeFromQuestion(question)
  var yf          = periodInfo.yf || 'report_year'
  var mf          = periodInfo.mf || 'report_month'
  var periodConds = buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf)

  // Field catalogue — only is_output != N fields
  var metaSummary = metadata
    .filter(function(m) { return m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:               m.field_name,
        display:             m.display_name,
        type:                m.type,
        unit:                m.unit || '',
        definition:          m.definition || '',
        aggregation:         m.aggregation || '',
        accumulation:        m.accumulation_type || '',
        business_priority:   m.business_priority || '',
        favorable_direction: m.favorable_direction || '',
        date_format:         m.date_format || '',
        calculation_logic:   m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined,
      }
    })

  var contextNote = userContext && userContext.explanation
    ? '\nSETUP CONTEXT: ' + userContext.explanation + (CF ? '\nSQL filter: ' + CF : '')
    : (CF ? '\nCONTEXT FILTER (appended to all queries): ' + CF : '')

  var mandatoryNote = mandatoryFilters.length
    ? '\nMANDATORY FILTERS (always apply — already in CF): ' + mandatoryFilters.map(function(f) { return (f.display_name || f.field) + ' = "' + f.value + '"' }).join(', ')
    : ''

  // ── Step 1: Generate SQL ──────────────────────────────────────────────────
  var queryGenPrompt = [
    '## TASK',
    'Generate 1-4 SQL queries to answer this question from a BI dashboard.',
    '',
    '## QUESTION',
    question,
    '',
    '## DATABASE',
    'Table: ' + tbl + ' (real typed SQL columns — NOT JSONB)',
    'Access fields directly: SELECT branch_name, SUM(revenue) FROM ' + tbl,
    'NO data->>\'\' syntax. NO ::numeric casting on numeric columns.',
    '',
    '## TIME PERIOD',
    'Year column: ' + yf + ' | Month column: ' + mf,
    'Period label: ' + periodConds.label,
    'Period SQL condition: ' + periodConds.cond,
    contextNote,
    mandatoryNote,
    '',
    '## FIELD CATALOGUE',
    JSON.stringify(metaSummary, null, 2),
    '',
    '## FIELD PRIORITY',
    'Prefer fields with business_priority = "high" when question is ambiguous.',
    'Use favorable_direction when framing the narrative: "i" = increase good, "d" = decrease good.',
    '',
    '## SQL RULES',
    '1. All field access is direct column name — SELECT branch_name, SUM(revenue). NO data->>\'\' syntax ever.',
    '2. Numeric columns are already NUMERIC — no ::numeric casting needed.',
    '3. Every query must include WHERE ' + periodConds.cond + CF,
    '4. Use aggregation from catalogue (SUM for cumulative, AVG for point_in_time).',
    '5. For ranking: ORDER BY value DESC LIMIT 10.',
   '6. For trend (line/area): alias the time column as "period" and the metric as "value".',
    '   Time label format: CONCAT(' + yf + ", \'-\', LPAD(CAST(" + mf + ' AS TEXT), 2, \'0\')) AS period',
    '7. For bar/kpi: alias main value as "current_value", label as "label".',
    '8. Date columns stored as TEXT in M/D/YY format. Use safe_date(column_name) for date operations.',
    '   Weekday: TO_CHAR(safe_date(transaction_date), \'Day\'). DOW number: EXTRACT(DOW FROM safe_date(transaction_date)).',
    '9. When grouping by derived label (e.g. TO_CHAR(safe_date(...)...)) and ordering by different derivation,',
    '   compute both in a subquery and reference aliases in outer query.',
    '10. For "why"/"what caused" questions: generate 3-4 queries — primary trend, dimensional breakdown, peer comparison.',
    '11. Derived KPIs: if calculation_logic is provided, use that formula directly. E.g. SUM(revenue)/NULLIF(SUM(client_count),0).',
    '12. When results span multiple dimensions (region + branch), concatenate: branch_region || \' — \' || branch_name AS label.',
    '13. When outer query selects from subquery with pre-aggregated columns, do NOT apply another aggregate on them.',
    '14. For trend/weekly charts use chart_type "line" or "area". Weekly label: TO_CHAR(safe_date(date_col), \'IYYY-"W"IW\') AS period.',
    '15. Entity name in question (e.g. "branch_01") is a VALUE to filter on: WHERE branch_name = \'branch_01\'.',
    '',
    '## OUTPUT — JSON only',
    '{"queries":[{"id":"q1","title":"title","chart_type":"bar|line|area|pie|donut|scatter|kpi","sql":"SELECT ...","label_key":"label","value_key":"current_value","current_key":"current_value","unit":"","insight":"one sentence"}],"dependent_fields":[],"period_used":"' + periodConds.label + '"}',
  ].join('\n')

  var queryGenRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2000, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Senior BI SQL engineer. Return only valid JSON. Table: ' + tbl + '. Direct column access — no JSONB.' }, { role: 'user', content: queryGenPrompt }] }),
  })
  var queryGenJson = await queryGenRes.json()
  if (!queryGenRes.ok) return Response.json({ error: (queryGenJson.error && queryGenJson.error.message) || 'Query generation failed.' }, { status: 500 })

  var queryGenParsed
  try { queryGenParsed = JSON.parse(queryGenJson.choices[0].message.content.replace(/```json|```/g, '').trim()) } catch(e) { return Response.json({ error: 'Could not parse query generation response.' }, { status: 500 }) }

  var queries         = queryGenParsed.queries || []
  var dependentFields = queryGenParsed.dependent_fields || []
  var periodUsed      = queryGenParsed.period_used || periodConds.label

  if (!queries.length) return Response.json({ error: 'No queries generated. The question may reference fields not in the dataset.' }, { status: 400 })

  // ── Step 2: Execute queries ───────────────────────────────────────────────
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

  // ── Step 3: Generate narrative ────────────────────────────────────────────
  var successfulResults = queryResults.filter(function(r) { return !r.error && r.data && r.data.length })
  var failedResults     = queryResults.filter(function(r) { return !!r.error || !r.data || !r.data.length })

  var dataSummary = successfulResults.map(function(r) {
    var rows = r.data.slice(0, 20); var valKey = r.current_key || r.value_key || 'current_value'
    var numericRows = rows.filter(function(row) { return !isNaN(parseFloat(row[valKey])) })
    var avg = numericRows.length ? numericRows.reduce(function(s, row) { return s + parseFloat(row[valKey]) }, 0) / numericRows.length : null
    return { title: r.title, chart_type: r.chart_type, row_count: r.data.length, top_rows: rows.slice(0, 10), average: avg !== null ? parseFloat(avg.toFixed(2)) : null }
  })

  var narrativePrompt = [
    '## TASK',
    'Answer this BI question using only the query results provided. Be specific — use actual numbers and segment names.',
    'For causal questions (why/what led to), frame findings as correlations: "data suggests", "a likely contributor is".',
    '',
    '## QUESTION', question,
    '## PERIOD', periodUsed, contextNote, mandatoryNote,
    '## QUERY RESULTS', JSON.stringify(dataSummary, null, 2),
    failedResults.length ? '\n## NO DATA: ' + failedResults.map(function(r) { return r.title + (r.error ? ': ' + r.error : ': no rows') }).join(', ') : '',
    '## FIELD CONTEXT', 'Dependent fields: ' + dependentFields.join(', '),
    '',
    '## OUTPUT — JSON only',
    '{"answer":"2-4 sentence answer with specific numbers","key_findings":["finding 1","finding 2"],"drivers":"1-2 sentences on what drives the pattern","investigate":["thing to check 1","thing to check 2"],"data_limitation":"note if data insufficient, else empty string"}',
  ].join('\n')

  var narrativeRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1000, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Senior banking BI analyst. Answer precisely using only the data provided. Never fabricate numbers.' }, { role: 'user', content: narrativePrompt }] }),
  })
  var narrativeJson = await narrativeRes.json()
  var narrative = null
  if (narrativeRes.ok) { try { narrative = JSON.parse(narrativeJson.choices[0].message.content.replace(/```json|```/g, '').trim()) } catch(e) { narrative = null } }

  var usage = {
    prompt_tokens:     (queryGenJson.usage?.prompt_tokens || 0) + (narrativeJson.usage?.prompt_tokens || 0),
    completion_tokens: (queryGenJson.usage?.completion_tokens || 0) + (narrativeJson.usage?.completion_tokens || 0),
    model: 'gpt-4o',
  }

  return Response.json({ question, periodUsed, queries: queryResults, narrative, dependentFields, usage })
}
