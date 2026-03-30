import { query } from '../../../lib/db'

var MONTHS_MAP = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
}

// ── Detect two-pass type ─────────────────────────────────────────────────────
// Returns 'performance', 'analytical', or false
function getTwoPassType(question) {
  var q = question.toLowerCase()

  var hasCausal = /\bwhy\b/.test(q) ||
    /what (caused|drove|led to|contributed|impacted)/.test(q) ||
    /root cause/.test(q) ||
    /what.{0,20}(behind|driving|reason)/.test(q) ||
    /underperform(ed|ing)?/.test(q) ||
    /overperform(ed|ing)?/.test(q)

  if (!hasCausal) return false

  // Performance type: comparing entities vs portfolio average
  var isPerformance = /underperform(ed|ing)?/.test(q) ||
    /overperform(ed|ing)?/.test(q) ||
    (/\bwhy\b/.test(q) && /best|worst|top|bottom|highest|lowest|most|least/.test(q) &&
     !/range|spread|variance|fluctuation|single day|per day|in a day/.test(q))

  if (isPerformance) return 'performance'

  // Analytical type: specific metric, range, pattern + why
  return 'analytical'
}

function isTwoPassQuestion(question) { return !!getTwoPassType(question) }

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
    if (parsedTime.type === 'month') return { cond: yf + ' = ' + parsedTime.year + ' AND ' + mf + ' = ' + parsedTime.month, label: parsedTime.label }
    if (parsedTime.type === 'quarter') return { cond: yf + ' = ' + parsedTime.year + ' AND ' + mf + ' >= ' + parsedTime.monthMin + ' AND ' + mf + ' <= ' + parsedTime.monthMax, label: parsedTime.label }
    if (parsedTime.type === 'range') {
      var cond = '(' + yf + ' > ' + parsedTime.fromYear + ' OR (' + yf + ' = ' + parsedTime.fromYear + ' AND ' + mf + ' >= ' + parsedTime.fromMonth + '))' +
        ' AND (' + yf + ' < ' + parsedTime.toYear + ' OR (' + yf + ' = ' + parsedTime.toYear + ' AND ' + mf + ' <= ' + parsedTime.toMonth + '))'
      return { cond: cond, label: parsedTime.label }
    }
  }
  return { cond: periodInfo.curCond || (yf + ' = ' + (periodInfo.curYear || new Date().getFullYear())), label: periodInfo.viewLabel || 'current period' }
}

// ── Build shared prompt sections ──────────────────────────────────────────────
function buildPromptBase(tbl, yf, mf, periodConds, CF, contextNote, mandatoryNote, metaSummary) {
  return [
    '## DATABASE',
    'Table: ' + tbl + ' (real typed SQL columns — NOT JSONB)',
    'Access fields directly. NO data->>\'\' syntax. NO ::numeric casting.',
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
    '## SQL RULES',
    '1. All field access is direct column name. NO data->>\'\' syntax ever.',
    '2. Numeric columns are already NUMERIC — no ::numeric casting needed.',
    '2b. For columns with data_type "Integer" or "Float", NEVER filter with string values like "yes","true","Y","active". Use numeric: 1 for true/active, 0 for false/inactive.',
    '3. Every query must include WHERE ' + periodConds.cond + CF,
    '4. Use aggregation from catalogue (SUM for cumulative, AVG for point_in_time).',
    '5. For ranking: ORDER BY value DESC LIMIT 10.',
    '6. For trend (line/area): alias time as "period" using CONCAT(' + yf + ", '-', LPAD(CAST(" + mf + " AS TEXT), 2, '0')), alias metric as \"value\".",
    '7. For bar/kpi: alias main value as "current_value", label as "label".',
    '8. Date columns stored as TEXT in M/D/YY format. Use safe_date(column_name) for date operations.',
    '   Weekday: TO_CHAR(safe_date(col), \'Day\'). DOW: EXTRACT(DOW FROM safe_date(col)).',
    '9. When grouping by derived label and ordering by different derivation, use a subquery.',
    '   CORRECT: SELECT label, dow, avg_val FROM (SELECT TO_CHAR(safe_date(col),\'Day\') AS label, EXTRACT(DOW FROM safe_date(col)) AS dow, AVG(metric) AS avg_val FROM tbl GROUP BY label, dow) sub ORDER BY dow',
    '10. Derived KPIs: use calculation_logic formula directly if provided.',
    '11. When results span multiple dimensions, concatenate: dim1 || \' — \' || dim2 AS label.',
    '12. Do NOT re-aggregate pre-aggregated subquery columns.',
    '13. For trend/weekly: use chart_type "line" or "area". Weekly: TO_CHAR(safe_date(col), \'YYYY-"W"WW\') AS period.',
    '14. Entity name in question is a VALUE to filter on, not a field name.',
    '15. Window functions (OVER/PARTITION BY) NOT allowed in HAVING. Wrap in subquery.',
    '    CORRECT: SELECT label, val FROM (SELECT dim AS label, window_fn() AS val FROM tbl GROUP BY dim) sub WHERE val > threshold',
    '16. For percentage threshold questions, use conditional aggregation — never correlated subqueries.',
    '    CORRECT: SELECT label, pct FROM (SELECT dim AS label, 100.0 * SUM(CASE WHEN condition THEN 1 ELSE 0 END) / COUNT(*) AS pct FROM tbl WHERE period GROUP BY dim) sub WHERE pct >= threshold',
    '    Also applies to percentage threshold questions — never use correlated subqueries for per-entity totals.',
    '17. For "historical comparison of top N entities", filter trend query to those top N using a subquery.',
    '    WHERE entity_col IN (SELECT entity_col FROM tbl WHERE period GROUP BY entity_col ORDER BY AGG(metric) DESC LIMIT N)',
    '18. For multi-series trend queries with more than 5 series, use chart_type "table".',
    '    Also use chart_type "table" for ranked lists with multiple columns.',
    '19. For weekly trends, use calendar week: TO_CHAR(safe_date(col), \'YYYY-"W"WW\') NOT ISO week (IYYY/IW).',
    '20. ONLY use field names from the field catalogue. NEVER invent fields not listed there.',
    '    If question uses vague terms like "underperformed", map to the most relevant high-priority KPI from catalogue.',
    '23. For "which entity" singular questions, use LIMIT 1 not LIMIT 10.',
'    For range/spread questions, generate two queries:',
'    Q1: identify the entity (LIMIT 1)',  
'    Q2: show the detail breakdown (date, max, min, range) for that entity using a subquery to reference Q1 result',
  ].join('\n')
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

  // Context + mandatory filters
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(f) {
      var op = (f.operator === 'equals' || f.operator === '=') ? '=' : (f.operator === 'not_equals' || f.operator === '!=') ? '!=' : f.operator
      return ' AND ' + f.field + ' ' + op + " '" + String(f.value || '').replace(/'/g, "''") + "'"
    }).join('')
  }
  var mandatoryFilterSQL = mandatoryFilters.length ? mandatoryFilters.map(function(f) { return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'" }).join('') : ''
  var CF = contextFilterSQL + mandatoryFilterSQL

  var parsedTime  = parseTimeFromQuestion(question)
  var yf          = periodInfo.yf || 'report_year'
  var mf          = periodInfo.mf || 'report_month'
  var periodConds = buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf)

  var metaSummary = metadata
    .filter(function(m) { return m.is_output !== 'N' })
    .map(function(m) {
      return {
        field:               m.field_name,
        display:             m.display_name,
        type:                m.type,
        data_type:           m.data_type || '',
        unit:                m.unit || '',
        definition:          m.definition || '',
        aggregation:         m.aggregation || '',
        accumulation:        m.accumulation_type || '',
        business_priority:   m.business_priority || '',
        favorable_direction: m.favorable_direction || '',
        calculation_logic:   m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined,
        dependencies:        m.dependencies ? m.dependencies : undefined,
      }
    })

  var contextNote    = userContext && userContext.explanation ? '\nSETUP CONTEXT: ' + userContext.explanation + (CF ? '\nSQL filter: ' + CF : '') : (CF ? '\nCONTEXT FILTER: ' + CF : '')
  var mandatoryNote  = mandatoryFilters.length ? '\nMANDATORY FILTERS (always apply): ' + mandatoryFilters.map(function(f) { return (f.display_name || f.field) + ' = "' + f.value + '"' }).join(', ') : ''
  var promptBase     = buildPromptBase(tbl, yf, mf, periodConds, CF, contextNote, mandatoryNote, metaSummary)
  var totalUsage     = { prompt_tokens: 0, completion_tokens: 0 }

  // ── HELPER: call OpenAI ───────────────────────────────────────────────────
  async function callOpenAI(systemMsg, userMsg, maxTokens) {
    var res  = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: maxTokens || 2000, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }] }),
    })
    var json = await res.json()
    if (!res.ok) throw new Error((json.error && json.error.message) || 'OpenAI error ' + res.status)
    totalUsage.prompt_tokens     += json.usage?.prompt_tokens     || 0
    totalUsage.completion_tokens += json.usage?.completion_tokens || 0
    return JSON.parse(json.choices[0].message.content.replace(/```json|```/g, '').trim())
  }

  // ── HELPER: execute queries ───────────────────────────────────────────────
  async function executeQueries(queries) {
    var results = []
    for (var i = 0; i < queries.length; i++) {
      var q = queries[i]
      if (q.chart_type === 'waterfall') { results.push(Object.assign({}, q, { data: q.data || [], error: null })); continue }
      try {
        var rows = await query(q.sql)
        results.push(Object.assign({}, q, { data: rows, error: null }))
      } catch(err) {
        console.error('ask-question query error:', err.message, '\nSQL:', q.sql)
        results.push(Object.assign({}, q, { data: [], error: err.message }))
      }
    }
    return results
  }

    // ── TWO-PASS FLOW ─────────────────────────────────────────────────────────
  var twoPassType = getTwoPassType(question)
  if (twoPassType) {

    // ── Pass 1 ────────────────────────────────────────────────────────────────
    var targetKpi, entityField, pass1Query, pass1Results, periodUsed

    if (twoPassType === 'performance') {
    // ── PERFORMANCE: deterministic SQL, no LLM ──────────────────────────────
    // Step 1 — select performance KPI from metadata
    targetKpi = (function() {
      var primary = metadata.find(function(m) {
        return m.is_output !== 'N' && m.definition && m.definition.toUpperCase().includes('PRIMARY PERFORMANCE INDICATOR')
      })
      if (primary) return primary.field_name
      var highP = metadata.filter(function(m) {
        return m.is_output !== 'N' && (m.type === 'kpi' || m.type === 'derived_kpi') && (m.business_priority || '').toLowerCase() === 'high'
      })
      if (highP.length) return highP[0].field_name
      var anyK = metadata.find(function(m) { return m.is_output !== 'N' && (m.type === 'kpi' || m.type === 'derived_kpi') })
      return anyK ? anyK.field_name : null
    })()

    // Step 2 — select entity dimension from metadata
    entityField = (function() {
      var dims = metadata.filter(function(m) {
        return m.is_output !== 'N' && m.type === 'dimension' &&
          !/year|month|day|date|sort|order|current_|duration|interval/i.test(m.field_name)
      })
      var high = dims.find(function(m) { return (m.business_priority || '').toLowerCase() === 'high' })
      return high ? high.field_name : (dims[0] ? dims[0].field_name : null)
    })()

    if (!targetKpi || !entityField) {
      return Response.json({
        question, error: null,
        queries: [{ id: 'pass1_error', title: 'Setup Error', chart_type: 'error', data: [], error: 'Could not identify performance KPI or entity dimension from metadata. Make sure your primary KPI has "PRIMARY PERFORMANCE INDICATOR" in its definition.' }],
        narrative: null, periodUsed: periodConds.label,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    var kpiMeta   = metadata.find(function(m) { return m.field_name === targetKpi })
    var favDir    = kpiMeta ? (kpiMeta.favorable_direction || 'i') : 'i'
    var kpiUnit   = kpiMeta ? (kpiMeta.unit || '') : ''
    var kpiDisplay = kpiMeta ? (kpiMeta.display_name || targetKpi) : targetKpi
    periodUsed = periodConds.label

    // Step 3 — detect over vs underperformance from question
    var isOver = /overperform|best|top|highest|outperform/i.test(question)
    // For 'i' (higher=better): underperform = below avg (HAVING < avg), overperform = above avg (HAVING > avg)
    // For 'd' (lower=better):  underperform = above avg (HAVING > avg), overperform = below avg (HAVING < avg)
    var havingOp = (favDir === 'i' && !isOver) || (favDir === 'd' && isOver) ? '<' : '>'
    var orderDir = havingOp === '<' ? 'ASC' : 'DESC'

    // Step 4 — build Pass 1 SQL deterministically
    var pass1SQL = [
      'SELECT ' + entityField + ' AS label, AVG(' + targetKpi + ') AS current_value',
      'FROM ' + tbl,
      'WHERE ' + periodConds.cond + CF,
      'AND ' + entityField + ' IS NOT NULL',
      'GROUP BY ' + entityField,
      'HAVING AVG(' + targetKpi + ') ' + havingOp + ' (',
      '  SELECT AVG(' + targetKpi + ') FROM ' + tbl + ' WHERE ' + periodConds.cond + CF,
      ')',
      'ORDER BY current_value ' + orderDir,
    ].join(' ')

    pass1Query = {
      id: 'pass1_ranking',
      title: (isOver ? 'Outperforming' : 'Underperforming') + ' Entities by ' + kpiDisplay,
      chart_type: 'bar',
      sql: pass1SQL,
      label_key: 'label',
      value_key: 'current_value',
      current_key: 'current_value',
      unit: kpiUnit,
      insight: 'Entities ' + (havingOp === '<' ? 'below' : 'above') + ' portfolio average ' + kpiDisplay,
    }

    pass1Results = []
    try {
      pass1Results = await query(pass1SQL)
    } catch(err) {
      return Response.json({
        question, error: null,
        queries: [Object.assign({}, pass1Query, { data: [], error: 'Pass 1 SQL error: ' + err.message })],
        narrative: null, periodUsed,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    if (!pass1Results || !pass1Results.length) {
      return Response.json({
        question, error: null,
        queries: [Object.assign({}, pass1Query, { data: [], error: 'No entities found ' + (havingOp === '<' ? 'below' : 'above') + ' portfolio average for ' + kpiDisplay + ' in ' + periodUsed + '.' })],
        narrative: null, periodUsed,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    } else {
    // ── ANALYTICAL: LLM-driven Pass 1 ───────────────────────────────────────
    periodUsed = periodConds.label
    var analyticalPass1Prompt = [
      '## CRITICAL — LABEL COLUMN',
      'Use a SINGLE raw dimension column as label — NEVER concatenate. Label values will be used in WHERE IN filter.',
      '',
      '## TASK',
      'Generate ONE SQL query that identifies the specific entities relevant to this question.',
      'The question asks for a specific analytical ranking (range, variance, pattern, etc) — not a simple vs-average comparison.',
      'Write the exact SQL needed to answer the first part of the question (identification/ranking only).',
      '',
      '## QUESTION', question,
      '',
      promptBase,
      '',
      '## OUTPUT — JSON only',
      '{"query":{"id":"pass1_ranking","title":"...","chart_type":"bar","sql":"SELECT ...","label_key":"label","value_key":"current_value","current_key":"current_value","unit":"","insight":"..."},"target_kpi":"field_name","entity_field":"field_name","period_used":"' + periodConds.label + '"}',
    ].join('\n')

    var analyticalPass1Parsed
    try {
      analyticalPass1Parsed = await callOpenAI(
        'Senior BI SQL engineer. Return only valid JSON. Table: ' + tbl + '. ONLY use fields from the catalogue.',
        analyticalPass1Prompt, 800
      )
    } catch(err) {
      return Response.json({
        question, error: null,
        queries: [{ id: 'pass1_error', title: 'Analysis Failed', chart_type: 'error', data: [], error: 'Could not identify entities. Try rephrasing your question.' }],
        narrative: null, periodUsed: periodConds.label,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    pass1Query  = analyticalPass1Parsed.query
    targetKpi   = analyticalPass1Parsed.target_kpi   || ''
    entityField = analyticalPass1Parsed.entity_field || 'label'
    periodUsed  = analyticalPass1Parsed.period_used  || periodConds.label

    try {
      pass1Results = await query(pass1Query.sql)
    } catch(err) {
      return Response.json({
        question, error: null,
        queries: [Object.assign({}, pass1Query, { data: [], error: 'Pass 1 SQL error: ' + err.message })],
        narrative: null, periodUsed,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    if (!pass1Results || !pass1Results.length) {
      return Response.json({
        question, error: null,
        queries: [Object.assign({}, pass1Query, { data: [], error: 'No results found for ' + periodUsed + '.' })],
        narrative: null, periodUsed,
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }
    } // end else analytical

    // Extract entity list from Pass 1 results
    var entityList = pass1Results.map(function(r) { return r[pass1Query.label_key || 'label'] || r['label'] }).filter(Boolean)

    // Find target KPI dependencies from metadata
    var targetKpiMeta   = metadata.find(function(m) { return m.field_name === targetKpi })
    var dependencyKpis  = []
    if (targetKpiMeta && targetKpiMeta.dependencies) {
      var depNames = targetKpiMeta.dependencies.split(',').map(function(d) { return d.trim() }).filter(Boolean)
      dependencyKpis = depNames.filter(function(d) {
        var m = metadata.find(function(m) { return m.field_name === d })
        return m && (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N'
      })
    }

    // ── Pass 2: Causal analysis ──────────────────────────────────────────────
    var entityListStr   = entityList.map(function(e) { return "'" + String(e).replace(/'/g, "''") + "'" }).join(', ')
    var depKpisStr      = dependencyKpis.length ? dependencyKpis.join(', ') : 'none found — use other high-priority KPIs from catalogue'
    var pass1ResultsStr = JSON.stringify(pass1Results.slice(0, 10), null, 2)

    var pass2Prompt = [
      '## TASK',
      'This is Pass 2 of a two-pass analysis. Pass 1 has already identified the key entities.',
      'Now generate causal/why queries to explain WHY these entities performed the way they did.',
      '',
      '## ORIGINAL QUESTION',
      question,
      '',
      '## PASS 1 RESULTS (already executed — do not re-run this)',
      'Target KPI: ' + targetKpi,
      'Entity field: ' + entityField,
      'Identified entities: ' + entityList.join(', '),
      'Pass 1 data: ' + pass1ResultsStr,
      '',
      '## DEPENDENCY KPIs FOR ' + targetKpi,
      depKpisStr,
      '',
      promptBase,
      '',
      '## PASS 2 INSTRUCTIONS',
      'Generate exactly 2 queries:',
      '',
      'QUERY 1 — Waterfall data query:',
      'Fetch the target KPI AND all dependency KPIs for the identified entities only.',
      'WHERE ' + entityField + ' IN (' + entityListStr + ')',
      'GROUP BY ' + entityField,
      'IMPORTANT: Use AVG for ALL KPI columns — this is a per-entity behavioural comparison that normalises for different numbers of intervals per entity.',
      'Use chart_type: "waterfall"',
      'Include these extra fields in the query response:',
      '  entity_field: "' + entityField + '"',
      '  entity_list: ' + JSON.stringify(entityList),
      '  target_kpi: "' + targetKpi + '"',
      '  dependency_kpis: ' + JSON.stringify(dependencyKpis),
      '',
      'QUERY 2 — Portfolio average query:',
      'SELECT AVG of the target KPI and all dependency KPIs across ALL entities for the same period.',
      'This must be a completely standalone SELECT with no GROUP BY and no entity filter.',
      'Do NOT use UNION with Query 1. Do NOT include any entity identifier column.',
      'IMPORTANT: Use AVG for ALL KPI columns — same as Query 1.',
      'Use chart_type: "portfolio_avg" and id: "portfolio_avg".',
      'CORRECT: SELECT AVG(' + targetKpi + ') AS ' + targetKpi + ' FROM ' + tbl + ' WHERE ' + periodConds.cond + CF,
      'WRONG: UNION SELECT \'Portfolio Average\' AS ' + entityField + ' — never mix entity labels with averages',
      '',
      '## PASS 2 OUTPUT — JSON only',
      '{"queries":[{"id":"waterfall_data","title":"...","chart_type":"waterfall","sql":"SELECT ...","entity_field":"' + entityField + '","entity_list":' + JSON.stringify(entityList) + ',"target_kpi":"' + targetKpi + '","dependency_kpis":' + JSON.stringify(dependencyKpis) + ',"label_key":"' + entityField + '","unit":"","insight":"..."},{"id":"portfolio_avg","title":"Portfolio Average","chart_type":"portfolio_avg","sql":"SELECT AVG(...) ...","unit":"","insight":""}],"period_used":"' + periodUsed + '"}',
    ].join('\n')

    var pass2Parsed
    try {
      pass2Parsed = await callOpenAI(
        'Senior BI SQL engineer. Return only valid JSON. Table: ' + tbl + '. ONLY use fields from the catalogue.',
        pass2Prompt,
        1500
      )
    } catch(err) {
      // Pass 2 failed — return Pass 1 results only with a note
      var pass1QueryResult = Object.assign({}, pass1Query, { data: pass1Results, error: null })
      return Response.json({
        question, periodUsed,
        queries: [pass1QueryResult],
        narrative: { answer: 'Identified the entities but could not complete causal analysis. ' + err.message, key_findings: [], drivers: '', investigate: [], data_limitation: 'Causal analysis failed — try asking more specifically.' },
        usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
      })
    }

    var pass2Queries = pass2Parsed.queries || []
    periodUsed       = pass2Parsed.period_used || periodUsed

    // Execute Pass 2 queries
    var waterfallQuery    = pass2Queries.find(function(q) { return q.chart_type === 'waterfall' })
    var portfolioAvgQuery = pass2Queries.find(function(q) { return q.chart_type === 'portfolio_avg' || q.id === 'portfolio_avg' })

    var waterfallData    = []
    var portfolioAvgData = []
    var waterfallError   = null

    if (waterfallQuery) {
      try { waterfallData = await query(waterfallQuery.sql) } catch(err) { waterfallError = err.message }
    }
    if (portfolioAvgQuery) {
      try { portfolioAvgData = await query(portfolioAvgQuery.sql) } catch(err) { console.warn('Portfolio avg query failed:', err.message) }
    }

    // Combine all results
    var allQueryResults = []

    // Pass 1 ranking query (shown as bar chart)
    allQueryResults.push(Object.assign({}, pass1Query, { data: pass1Results, error: null }))

    // Waterfall query with data + portfolio avg embedded
    if (waterfallQuery) {
      allQueryResults.push(Object.assign({}, waterfallQuery, {
        data:          waterfallData,
        portfolio_avg: portfolioAvgData.length ? portfolioAvgData[0] : null,
        error:         waterfallError,
      }))
    }

    // Generate narrative with full context
    var allSuccessful = allQueryResults.filter(function(r) { return !r.error && r.data && r.data.length })
    var dataSummary   = allSuccessful.map(function(r) {
      return { title: r.title, chart_type: r.chart_type, row_count: r.data.length, top_rows: r.data.slice(0, 10) }
    })

    var narrativePrompt = [
      '## TASK',
      'Answer this BI question using the query results. Be specific with numbers and entity names.',
      '',
      '## QUESTION', question,
      '## PERIOD', periodUsed, contextNote, mandatoryNote,
      '## IDENTIFIED ENTITIES', entityList.join(', '),
      '## TARGET KPI', targetKpi,
      '## DEPENDENCY KPIs', depKpisStr,
      '## QUERY RESULTS', JSON.stringify(dataSummary, null, 2),
      '',
      '## NARRATIVE INSTRUCTIONS FOR CAUSAL QUESTIONS',
      '1. State the magnitude of change/gap in the target KPI for each identified entity with actual numbers.',
      '2. For each dependency KPI that shows deviation from portfolio average, state its direction and magnitude and link it to the target KPI.',
      '3. For dependency KPIs that did NOT deviate, explicitly rule them out.',
      '4. Conclude with the most likely primary driver based on the data.',
      '5. Frame all findings as correlations: "correlates with", "likely contributed to", "data suggests".',
      '',
      '## OUTPUT — JSON only',
      '{"answer":"2-4 sentence answer with specific numbers","key_findings":["finding 1","finding 2"],"drivers":"1-2 sentences on primary drivers","investigate":["thing to check 1"],"data_limitation":"note if insufficient data, else empty string"}',
    ].join('\n')

    var narrativeRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1000, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Senior BI analyst. Answer precisely using only data provided. Never fabricate numbers.' }, { role: 'user', content: narrativePrompt }] }),
    })
    var narrativeJson = await narrativeRes.json()
    totalUsage.prompt_tokens     += narrativeJson.usage?.prompt_tokens     || 0
    totalUsage.completion_tokens += narrativeJson.usage?.completion_tokens || 0
    var narrative = null
    if (narrativeRes.ok) { try { narrative = JSON.parse(narrativeJson.choices[0].message.content.replace(/```json|```/g, '').trim()) } catch(e) { narrative = null } }

    return Response.json({
      question, periodUsed, queries: allQueryResults, narrative,
      dependentFields: dependencyKpis, twoPass: true,
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  // ── SINGLE-PASS FLOW (unchanged) ──────────────────────────────────────────
  var queryGenPrompt = [
    '## TASK',
    'Generate 1-4 SQL queries to answer this question from a BI dashboard.',
    '',
    '## QUESTION',
    question,
    '',
    promptBase,
    '',
    '## OUTPUT — JSON only',
    '{"queries":[{"id":"q1","title":"title","chart_type":"bar|line|area|pie|donut|scatter|kpi|table","sql":"SELECT ...","label_key":"label","value_key":"current_value","current_key":"current_value","unit":"","insight":"one sentence"}],"dependent_fields":[],"period_used":"' + periodConds.label + '"}',
  ].join('\n')

  var queryGenParsed
  try {
    queryGenParsed = await callOpenAI(
      'Senior BI SQL engineer. Return only valid JSON. Table: ' + tbl + '. Direct column access — no JSONB. CRITICAL: only use field names from the field catalogue — never invent fields.',
      queryGenPrompt,
      2000
    )
  } catch(err) {
    return Response.json({ error: 'Query generation failed: ' + err.message }, { status: 500 })
  }

  var queries         = queryGenParsed.queries        || []
  var dependentFields = queryGenParsed.dependent_fields || []
  var periodUsed      = queryGenParsed.period_used    || periodConds.label

  if (!queries.length) return Response.json({ error: 'No queries generated. The question may reference fields not in the dataset.' }, { status: 400 })

  var queryResults = await executeQueries(queries)

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
    '',
    '## QUESTION', question,
    '## PERIOD', periodUsed, contextNote, mandatoryNote,
    '## QUERY RESULTS', JSON.stringify(dataSummary, null, 2),
    failedResults.length ? '\n## NO DATA: ' + failedResults.map(function(r) { return r.title + (r.error ? ': ' + r.error : ': no rows') }).join(', ') : '',
    '## FIELD CONTEXT', 'Dependent fields: ' + dependentFields.join(', '),
    '',
    '## NARRATIVE INSTRUCTIONS FOR CAUSAL QUESTIONS',
    '1. State the magnitude of change in the target KPI with actual numbers.',
    '2. For each upstream/dependency KPI that changed, state its direction and magnitude and link it to the target.',
    '3. For KPIs that did NOT change, explicitly rule them out.',
    '4. Conclude with the most likely primary driver.',
    '5. Frame all findings as correlations: "correlates with", "likely contributed to", "data suggests".',
    '',
    '## OUTPUT — JSON only',
    '{"answer":"2-4 sentence answer with specific numbers","key_findings":["finding 1","finding 2"],"drivers":"1-2 sentences on what drives the pattern","investigate":["thing to check 1","thing to check 2"],"data_limitation":"note if data insufficient, else empty string"}',
  ].join('\n')

  var narrativeRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1000, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Senior BI analyst. Answer precisely using only the data provided. Never fabricate numbers.' }, { role: 'user', content: narrativePrompt }] }),
  })
  var narrativeJson = await narrativeRes.json()
  totalUsage.prompt_tokens     += narrativeJson.usage?.prompt_tokens     || 0
  totalUsage.completion_tokens += narrativeJson.usage?.completion_tokens || 0
  var narrative = null
  if (narrativeRes.ok) { try { narrative = JSON.parse(narrativeJson.choices[0].message.content.replace(/```json|```/g, '').trim()) } catch(e) { narrative = null } }

  return Response.json({
    question, periodUsed, queries: queryResults, narrative, dependentFields,
    usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
  })
}
