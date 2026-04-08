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

function parseTimeFromQuestion(question, periodInfo) {
  var q = question.toLowerCase()
  var curYear = (periodInfo && periodInfo.curYear) || new Date().getFullYear()

  // Explicit fiscal/report override in question — overrides whatever the slider says
  var forceFiscal = /\bfiscal\b|\bfy\b/i.test(q) ? true
                  : /\breport(ing)?\s+year\b/i.test(q) ? false
                  : null  // null = use slider default

  // 1. Month + year: "jan 2024", "january '24"
  var m1 = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)['\s]+(\d{2,4})/i)
  if (m1) { var monthNum = MONTHS_MAP[m1[1].toLowerCase()]; var yr = parseInt(m1[2]); if (yr < 100) yr += 2000; return { year: yr, month: monthNum, label: m1[1] + ' ' + yr, type: 'month', forceFiscal: forceFiscal } }

  // 2. Quarter: "Q1 '24", "q3 2023"
  var m2 = q.match(/\bq([1-4])\s*'?(\d{2,4})/i)
  if (m2) { var qtr = parseInt(m2[1]); var yr2 = parseInt(m2[2]); if (yr2 < 100) yr2 += 2000; var mMin = (qtr-1)*3+1; var mMax = qtr*3; return { year: yr2, monthMin: mMin, monthMax: mMax, label: 'Q'+qtr+' '+yr2, type: 'quarter', forceFiscal: forceFiscal } }

  // 3. Rolling: "last 3 months"
  var m3 = q.match(/last\s+(\d+)\s+months?/i)
  if (m3) { var n = parseInt(m3[1]); var toD = new Date(); var fromD = new Date(toD.getFullYear(), toD.getMonth() - n + 1, 1); return { type: 'range', fromYear: fromD.getFullYear(), fromMonth: fromD.getMonth()+1, toYear: toD.getFullYear(), toMonth: toD.getMonth()+1, label: 'Last ' + n + ' months', forceFiscal: forceFiscal } }
  // 3b. Rolling quarters: "last quarter", "last 2 quarters"
  var m3q = q.match(/last\s+(\d+)?\s*quarters?/i)
  if (m3q) {
    var nq = parseInt(m3q[1] || '1')
    // Use slider's month — already fiscal-numbered if slider is in fiscal mode
    var sliderY = (timePeriod && timePeriod.year)  ? parseInt(timePeriod.year)  : curYear
    var sliderM = (timePeriod && timePeriod.month) ? parseInt(timePeriod.month) : 12
    var curQ    = Math.ceil(sliderM / 3)
    // "Last quarter" = previous completed quarter
    var endQ = curQ - 1; var endY = sliderY
    if (endQ < 1) { endQ += 4; endY -= 1 }
    var startQ = endQ - nq + 1; var startY = endY
    while (startQ < 1) { startQ += 4; startY -= 1 }
    return {
      type: 'range',
      fromYear: startY, fromMonth: (startQ - 1) * 3 + 1,
      toYear:   endY,   toMonth:   endQ * 3,
      label: nq === 1 ? 'Last quarter (Q' + endQ + ' ' + endY + ')'
                      : 'Last ' + nq + ' quarters (Q' + startQ + ' ' + startY + '–Q' + endQ + ' ' + endY + ')',
      forceFiscal: forceFiscal,
    }
  }
  // 4. Relative year keywords
  if (/\b(last|previous|prior)\s+year\b/i.test(q))       return { type: 'full_year', year: curYear - 1, label: String(curYear - 1), forceFiscal: forceFiscal }
  if (/\b(latest|current|this)\s+year\b/i.test(q))        return { type: 'full_year', year: curYear,     label: String(curYear),     forceFiscal: forceFiscal }
  if (/\byear\s+before\s+last\b|\btwo\s+years?\s+ago\b/i.test(q)) return { type: 'full_year', year: curYear - 2, label: String(curYear - 2), forceFiscal: forceFiscal }
  if (/\bytd\b/i.test(q))                                 return null  // fall back to slider (which is already YTD-style)

  // 5. Bare year: "2024", "FY2024", "2023 report year"
  var m4 = q.match(/\b(?:fy\s*)?(\d{4})\b/i)
  if (m4) { var yr4 = parseInt(m4[1]); return { type: 'full_year', year: yr4, label: (forceFiscal ? 'FY' : '') + yr4, forceFiscal: forceFiscal } }

  return null
}

function buildQuestionPeriodConds(parsedTime, periodInfo, yf, mf) {
  // Honor fiscal/report override from question
  var effYf = yf; var effMf = mf
  if (parsedTime && parsedTime.forceFiscal !== null && parsedTime.forceFiscal !== undefined) {
    effYf = parsedTime.forceFiscal ? 'fiscal_year'  : 'report_year'
    effMf = parsedTime.forceFiscal ? 'fiscal_month' : 'report_month'
  }

  if (parsedTime) {
    if (parsedTime.type === 'month')     return { cond: effYf + ' = ' + parsedTime.year + ' AND ' + effMf + ' = ' + parsedTime.month, label: parsedTime.label }
    if (parsedTime.type === 'quarter')   return { cond: effYf + ' = ' + parsedTime.year + ' AND ' + effMf + ' >= ' + parsedTime.monthMin + ' AND ' + effMf + ' <= ' + parsedTime.monthMax, label: parsedTime.label }
    if (parsedTime.type === 'full_year') return { cond: effYf + ' = ' + parsedTime.year, label: parsedTime.label }
    if (parsedTime.type === 'range') {
      var cond = '(' + effYf + ' > ' + parsedTime.fromYear + ' OR (' + effYf + ' = ' + parsedTime.fromYear + ' AND ' + effMf + ' >= ' + parsedTime.fromMonth + '))' +
        ' AND (' + effYf + ' < ' + parsedTime.toYear + ' OR (' + effYf + ' = ' + parsedTime.toYear + ' AND ' + effMf + ' <= ' + parsedTime.toMonth + '))'
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
    '21. For improvement/decline questions across periods, always check favorable_direction before deciding comparison direction.',
    '    favorable_direction = "i": improvement means value INCREASED → HAVING new_val > old_val',
    '    favorable_direction = "d": improvement means value DECREASED → HAVING new_val < old_val',
    '22. Column aliases defined in SELECT cannot be used in HAVING. Always repeat the full expression.',
    '    WRONG: HAVING new_value < old_value',
    '    CORRECT: HAVING AVG(CASE WHEN cond2 THEN metric END) < AVG(CASE WHEN cond1 THEN metric END)',
    '23. For "within a single day" or "per day" range/variance questions, ALWAYS use a subquery — never compute directly.',
    '    CORRECT: SELECT entity, MAX(daily_metric) FROM (SELECT entity, date_col, MAX(metric)-MIN(metric) AS daily_metric FROM tbl WHERE period GROUP BY entity, date_col) sub GROUP BY entity ORDER BY MAX(daily_metric) DESC LIMIT 1',
    '    WRONG: SELECT entity, MAX(metric)-MIN(metric) FROM tbl WHERE period GROUP BY entity',
    '24. For "which entity" singular questions (which branch, which region), always use LIMIT 1.',
    '    For range/spread questions generate 2 queries: Q1 identifies the entity (LIMIT 1), Q2 shows date/max/min/range detail for that entity.',
    '25. For labels/grouping, always prefer human-readable name columns (e.g. branch_name) over numeric ID columns (e.g. branch_id). Only use an ID column if no corresponding name column exists in the catalogue.',
'26. For "highest/lowest single-day" questions, ALWAYS use a subquery that groups by entity + date, then ORDER BY + LIMIT on the outer query.',
'    CORRECT: SELECT sub.dim AS label, sub.daily_val AS current_value FROM (SELECT dim, date_col, AGG(metric) AS daily_val FROM tbl WHERE period GROUP BY dim, date_col) sub ORDER BY sub.daily_val DESC LIMIT 1',
'    CRITICAL: The outer SELECT must ONLY reference columns defined in the subquery (dim, date_col, daily_val). NEVER use original table columns or aggregate functions in the outer query.',
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
  var parsedTime = parseTimeFromQuestion(question, periodInfo, timePeriod)
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

  var parsedTime  = parseTimeFromQuestion(question,periodInfo)
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

  // ═══════════════════════════════════════════════════════════════════════════
// LONG-FORMAT ASK FLOW
// Insert this block inside POST(), AFTER `executeQueries` is defined and
// BEFORE the "// ── TWO-PASS FLOW ──" comment.
//
// Requires the frontend to include `metadataSetId` in the request body.
// Uses closure access to: callOpenAI, executeQueries, totalUsage,
// periodConds, CF, contextNote, mandatoryNote, yf, mf, tbl, question,
// userContext, mandatoryFilters, parsedTime
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Detect format and branch ────────────────────────────────────────
var metadataSetId = body.metadataSetId
var dsRowAsk
try { dsRowAsk = await query('SELECT dataset_format FROM datasets WHERE id = $1', [datasetId]) }
catch(e) { dsRowAsk = [] }
var dsFmtAsk = dsRowAsk.length ? dsRowAsk[0].dataset_format : null
if (typeof dsFmtAsk === 'string') { try { dsFmtAsk = JSON.parse(dsFmtAsk) } catch(e) { dsFmtAsk = null } }
var isLongAsk = dsFmtAsk && dsFmtAsk.format === 'long_hierarchical'

if (isLongAsk) {
  if (!metadataSetId) {
    return Response.json({ error: 'metadataSetId is required for long-format questions.' }, { status: 400 })
  }
  return await handleLongAskFlow(dsFmtAsk)
}

// ── 2. Handler function (also inside POST closure) ─────────────────────
async function handleLongAskFlow(dsFmt) {
  var hierCols = dsFmt.hierarchyColumns || []
  var valueCol = dsFmt.valueColumn
  if (!valueCol || !hierCols.length) {
    return Response.json({ error: 'dataset_format missing valueColumn or hierarchyColumns.' }, { status: 400 })
  }

  // Load hierarchy nodes
  var nodes = await query(
    'SELECT node_path, node_name, parent_path, level, is_leaf, display_name, definition, accumulation_type, favorable_direction, business_priority, unit FROM hierarchy_nodes WHERE metadata_set_id = $1 ORDER BY level, node_path',
    [metadataSetId]
  )
  if (!nodes.length) return Response.json({ error: 'No hierarchy nodes found for this metadata set.' }, { status: 404 })

  var nodesByPath = {}
  nodes.forEach(function(n) { nodesByPath[n.node_path] = n })

  function resolveInherited(path, field) {
    var cur = nodesByPath[path]
    while (cur) {
      var v = cur[field]
      if (v !== null && v !== undefined && String(v).trim() !== '') return v
      if (!cur.parent_path) return null
      cur = nodesByPath[cur.parent_path]
    }
    return null
  }

  // Build resolved tree for the prompt — inheritance pre-applied
  var resolvedTree = nodes.map(function(n) {
    return {
      path:                n.node_path,
      name:                n.display_name || n.node_name,
      level:               n.level,
      parent:              n.parent_path || null,
      definition:          n.definition || '',
      accumulation_type:   resolveInherited(n.node_path, 'accumulation_type') || 'cumulative',
      favorable_direction: resolveInherited(n.node_path, 'favorable_direction') || 'i',
      business_priority:   resolveInherited(n.node_path, 'business_priority') || 'medium',
      unit:                resolveInherited(n.node_path, 'unit') || '',
    }
  })

  // Dimensions from metadata array (passed in by frontend)
  var dimsList = (metadata || [])
    .filter(function(m) { return m.type === 'dimension' && m.is_output !== 'N' })
    .map(function(m) { return { field_name: m.field_name, display_name: m.display_name, data_type: m.data_type || '' } })

  // Sample rows for LLM to verify column shapes
  var sampleRowsAsk = []
  try { sampleRowsAsk = await query('SELECT * FROM ' + tbl + ' LIMIT 3') } catch(e) {}

  // Build long-format prompt base
  var promptBaseLong = [
    '## DATABASE',
    'Table: ' + tbl + ' (real typed SQL columns — NOT JSONB)',
    'This is a LONG-HIERARCHICAL dataset:',
    '  - One numeric column: ' + valueCol,
    '  - Hierarchy columns (L1→Ln): ' + hierCols.join(', '),
    '  - Dimension columns: ' + dimsList.map(function(d) { return d.field_name }).join(', '),
    'Every query MUST filter by hierarchy columns to scope to a specific business concept.',
    'Example: WHERE level_1 = \'Revenue\' AND level_2 = \'Interest Income\'',
    '',
    '## TIME PERIOD',
    'Year column: ' + yf + ' | Month column: ' + mf,
    'Period label: ' + periodConds.label,
    'Period SQL condition: ' + periodConds.cond,
    contextNote,
    mandatoryNote,
    '',
    '## SAMPLE DATA (verify column names + shapes)',
    JSON.stringify(sampleRowsAsk, null, 2),
    '',
    '## RESOLVED HIERARCHY TREE (inheritance applied)',
    JSON.stringify(resolvedTree, null, 2),
    '',
    '## DIMENSIONS',
    JSON.stringify(dimsList, null, 2),
    '',
    '## SQL RULES',
    '1. Direct column access — NO data->>\'\' syntax, NO ::numeric casting.',
    '2. Every query must include WHERE ' + periodConds.cond + CF + ' AND <hierarchy filter>',
    '3. Use SUM(' + valueCol + ') as the aggregation. At monthly grain SUM works for both cumulative and point_in_time.',
    '4. To reference a hierarchy node, build the WHERE clause from its path. Example for "Revenue > Interest Income":',
    '   AND ' + (hierCols[0] || 'level_1') + " = 'Revenue' AND " + (hierCols[1] || 'level_2') + " = 'Interest Income'",
    '5. For ranking entities: SELECT dim AS label, SUM(' + valueCol + ') AS current_value FROM tbl WHERE ... AND <hier> GROUP BY dim ORDER BY current_value DESC LIMIT 10',
    '6. For trend: SELECT CONCAT(' + yf + ", '-', LPAD(CAST(" + mf + " AS TEXT), 2, '0')) AS period, SUM(" + valueCol + ') AS value FROM tbl WHERE ... AND <hier> GROUP BY ' + yf + ', ' + mf + ' ORDER BY period',
    '7. For YoY comparison on a node: use CASE WHEN current_period THEN ' + valueCol + ' ELSE 0 END for current_value and CASE WHEN comparison_period THEN ' + valueCol + ' ELSE 0 END for comparison_value.',
    '8. For multi-node comparison (e.g. parent vs children), use one column per node with CASE WHEN <hier filter> THEN ' + valueCol + ' END. Use chart_type "table" if more than 3 columns.',
    '9. Honor favorable_direction from the resolved tree when interpreting "improvement" or "decline".',
    '10. ONLY use node paths from the resolved tree. NEVER invent nodes.',
    '11. ONLY use dimension columns from the dimensions list. NEVER invent dimensions.',
    '12. Prefer high-priority nodes (business_priority = "high") when the question is vague.',
  ].join('\n')

  var twoPassTypeLong = getTwoPassType(question)

  // ── SINGLE-PASS LONG FLOW ───────────────────────────────────────────
  if (!twoPassTypeLong) {
    var singlePrompt = [
      '## TASK',
      'Generate 1-4 SQL queries to answer this question from a long-hierarchical BI dashboard.',
      '',
      '## QUESTION', question,
      '',
      promptBaseLong,
      '',
      '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
    '',
      '## OUTPUT — JSON only',
      '{"queries":[{"id":"q1","title":"title","chart_type":"bar|line|area|pie|donut|kpi|table","sql":"SELECT ...","label_key":"label","value_key":"current_value","current_key":"current_value","comparison_key":"comparison_value","unit":"","insight":"one sentence"}],"period_used":"' + periodConds.label + '"}',
    ].join('\n')

    var sParsed
    try {
      sParsed = await callOpenAI(
        'Senior BI SQL engineer. Long-hierarchical dataset. Return only valid JSON. Table: ' + tbl + '. ONLY use node paths and dimensions from the catalogue.',
        singlePrompt, 2000
      )
    } catch(err) {
      return Response.json({ error: 'Query generation failed: ' + err.message }, { status: 500 })
    }

    var sQueries    = sParsed.queries     || []
    var sPeriodUsed = sParsed.period_used || periodConds.label
    if (!sQueries.length) return Response.json({ error: 'No queries generated.' }, { status: 400 })

    var sResults = await executeQueries(sQueries)
    var sSuccess = sResults.filter(function(r) { return !r.error && r.data && r.data.length })

    var sDataSummary = sSuccess.map(function(r) {
      return { title: r.title, chart_type: r.chart_type, row_count: r.data.length, top_rows: r.data.slice(0, 10) }
    })

    var sNarrPrompt = [
      '## TASK',
      'Answer this question using only the query results. Be specific with numbers.',
      '',
      '## QUESTION', question,
      '## PERIOD', sPeriodUsed, contextNote, mandatoryNote,
      '## QUERY RESULTS', JSON.stringify(sDataSummary, null, 2),
      '',
      '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
    '',
      '## OUTPUT — JSON only',
      '{"answer":"2-4 sentence answer with specific numbers","key_findings":["finding 1","finding 2"],"drivers":"1-2 sentences","investigate":["thing to check"],"data_limitation":"note if insufficient, else empty"}',
    ].join('\n')

    var sNarrative = null
    try {
      sNarrative = await callOpenAI(
        'Senior BI analyst. Answer precisely using only the data provided. Never fabricate numbers.',
        sNarrPrompt, 1000
      )
    } catch(e) { sNarrative = null }

    return Response.json({
      question, periodUsed: sPeriodUsed, queries: sResults, narrative: sNarrative,
      datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  // ── TWO-PASS LONG FLOW ──────────────────────────────────────────────
  var pass1PromptLong = [
    '## TASK',
    'Pass 1 of a ' + twoPassTypeLong + ' two-pass question on a long-hierarchical dataset.',
    twoPassTypeLong === 'performance'
      ? 'Identify entities (one dimension) that under/over-perform on a chosen hierarchy node vs the portfolio average. Pick the most relevant high-priority L1 or L2 node from the resolved tree based on the question.'
      : 'Identify the specific entity that matches the analytical criterion in the question (range, variance, peak, pattern). Pick the most relevant hierarchy node based on the question.',
    '',
    '## QUESTION', question,
    '',
    promptBaseLong,
    '',
    '## PASS 1 INSTRUCTIONS',
    'Generate ONE SQL query that returns a list of entities with one value column.',
    'Use a SINGLE raw dimension column as label — NEVER concatenate (label values feed a WHERE IN filter in Pass 2).',
    'Honor favorable_direction of the chosen node when deciding ASC vs DESC and HAVING direction.',
    '',
    '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
    '',
    '## OUTPUT — JSON only',
    '{"query":{"id":"pass1_ranking","title":"...","chart_type":"bar","sql":"SELECT ...","label_key":"label","value_key":"current_value","current_key":"current_value","unit":"","insight":"..."},"target_node_path":"Revenue > Interest Income","entity_field":"branch_name","period_used":"' + periodConds.label + '"}',
  ].join('\n')

  var p1Parsed
  try {
    p1Parsed = await callOpenAI(
      'Senior BI SQL engineer. Long-hierarchical dataset. Return only valid JSON. Table: ' + tbl + '. ONLY use node paths and dimensions from the catalogue.',
      pass1PromptLong, 1000
    )
  } catch(err) {
    return Response.json({
      question, error: null,
      queries: [{ id: 'pass1_error', title: 'Analysis Failed', chart_type: 'error', data: [], error: 'Pass 1 failed: ' + err.message }],
      narrative: null, periodUsed: periodConds.label, datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  var p1Query        = p1Parsed.query
  var targetNodePath = p1Parsed.target_node_path || ''
  var entityFieldL   = p1Parsed.entity_field     || 'label'
  var periodUsedL    = p1Parsed.period_used      || periodConds.label

  if (!p1Query || !p1Query.sql) {
    return Response.json({
      question, error: null,
      queries: [{ id: 'pass1_error', title: 'Setup Error', chart_type: 'error', data: [], error: 'LLM did not return a valid Pass 1 query.' }],
      narrative: null, periodUsed: periodUsedL, datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  var p1Results
  try { p1Results = await query(p1Query.sql) }
  catch(err) {
    return Response.json({
      question, error: null,
      queries: [Object.assign({}, p1Query, { data: [], error: 'Pass 1 SQL error: ' + err.message })],
      narrative: null, periodUsed: periodUsedL, datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  if (!p1Results || !p1Results.length) {
    return Response.json({
      question, error: null,
      queries: [Object.assign({}, p1Query, { data: [], error: 'No entities found for ' + periodUsedL + '.' })],
      narrative: null, periodUsed: periodUsedL, datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  var entityListL    = p1Results.map(function(r) { return r[p1Query.label_key || 'label'] || r['label'] }).filter(Boolean)
  var entityListStrL = entityListL.map(function(e) { return "'" + String(e).replace(/'/g, "''") + "'" }).join(', ')

  // Find child nodes of target (for drill-down hint)
  var childNodes = nodes
    .filter(function(n) { return n.parent_path === targetNodePath })
    .map(function(n) { return { path: n.node_path, name: n.display_name || n.node_name } })

  var pass2PromptLong = [
    '## TASK',
    'Pass 2 of a long-hierarchical two-pass question. Pass 1 identified ' + (twoPassTypeLong === 'performance' ? 'under/over-performing entities' : 'the relevant entity') + '.',
    'Now generate 1-3 queries that explain WHY by drilling into child hierarchy nodes or showing detail.',
    '',
    '## ORIGINAL QUESTION', question,
    '',
    '## PASS 1 RESULT',
    'Target node: ' + targetNodePath,
    'Entity field: ' + entityFieldL,
    'Identified entities: ' + entityListL.join(', '),
    'Pass 1 data: ' + JSON.stringify(p1Results.slice(0, 10), null, 2),
    '',
    '## CHILD NODES OF TARGET (drill-down candidates)',
    childNodes.length ? JSON.stringify(childNodes, null, 2) : '(target node has no children — use sibling nodes or trend analysis instead)',
    '',
    promptBaseLong,
    '',
    '## PASS 2 INSTRUCTIONS',
    twoPassTypeLong === 'performance'
      ? '1. Generate a query that breaks down the target node by its CHILDREN for the identified entities.\n   Use chart_type "table" with one column per child node: SELECT entity, SUM(CASE WHEN <child1 hier> THEN ' + valueCol + ' END) AS child1, SUM(CASE WHEN <child2 hier> THEN ' + valueCol + ' END) AS child2, ... FROM tbl WHERE period AND entity IN (...) GROUP BY entity\n2. Optionally add a portfolio-average comparison query for the same children.\n3. If the target has no children, generate a trend query for the target node showing the identified entities over time.'
      : '1. Generate a detail query for the identified entity. Examples:\n   - Daily/monthly trend of the target node for that entity\n   - Breakdown by child nodes\n   - Comparison vs sibling nodes\n2. Use chart_type "line" for trends, "bar" for breakdowns, "table" for multi-column.\n3. Filter to entity: WHERE ' + entityFieldL + " = '" + String(entityListL[0] || '').replace(/'/g, "''") + "'",
    'Filter entities for performance pass 2: WHERE ' + entityFieldL + ' IN (' + entityListStrL + ')',
    '',
    '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
    '',
    '## OUTPUT — JSON only',
    '{"queries":[{"id":"q1","title":"...","chart_type":"table|bar|line","sql":"SELECT ...","label_key":"' + entityFieldL + '","unit":"","insight":"..."}],"period_used":"' + periodUsedL + '"}',
  ].join('\n')

  var p2Parsed
  try {
    p2Parsed = await callOpenAI(
      'Senior BI SQL engineer. Long-hierarchical dataset. Return only valid JSON. Table: ' + tbl + '. ONLY use node paths and dimensions from the catalogue.',
      pass2PromptLong, 1500
    )
  } catch(err) {
    var p1Only = Object.assign({}, p1Query, { data: p1Results, error: null })
    return Response.json({
      question, periodUsed: periodUsedL,
      queries: [p1Only],
      narrative: { answer: 'Identified entities but could not complete drill-down analysis. ' + err.message, key_findings: [], drivers: '', investigate: [], data_limitation: 'Pass 2 failed.' },
      datasetFormat: 'long_hierarchical',
      usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
    })
  }

  var p2Queries = p2Parsed.queries || []
  periodUsedL   = p2Parsed.period_used || periodUsedL

  var allResultsL = []
  allResultsL.push(Object.assign({}, p1Query, { data: p1Results, error: null }))

  for (var li = 0; li < p2Queries.length; li++) {
    var lq = p2Queries[li]
    try {
      var lRows = await query(lq.sql)
      allResultsL.push(Object.assign({}, lq, { data: lRows, error: null }))
    } catch(err) {
      console.error('long pass2 query error:', err.message)
      allResultsL.push(Object.assign({}, lq, { data: [], error: err.message }))
    }
  }

  // Narrative
  var lSuccess = allResultsL.filter(function(r) { return !r.error && r.data && r.data.length })
  var lDataSummary = lSuccess.map(function(r) {
    return { title: r.title, chart_type: r.chart_type, row_count: r.data.length, top_rows: r.data.slice(0, 10) }
  })

  var lNarrPrompt = [
    '## TASK', 'Answer this question using the query results. Be specific with numbers and entity names.',
    '',
    '## QUESTION', question,
    '## PERIOD', periodUsedL, contextNote, mandatoryNote,
    '## TARGET NODE', targetNodePath,
    '## IDENTIFIED ENTITIES', entityListL.join(', '),
    '## QUERY RESULTS', JSON.stringify(lDataSummary, null, 2),
    '',
    '## INSTRUCTIONS',
    '1. State which entities were identified and their values.',
    '2. Explain what the drill-down reveals about WHY.',
    '3. Frame as correlations: "correlates with", "likely contributed to", "data suggests".',
    '',
    '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
    '',
    '## OUTPUT — JSON only',
    '{"answer":"2-4 sentence answer with specific numbers","key_findings":["finding 1","finding 2"],"drivers":"1-2 sentences on primary drivers","investigate":["thing to check 1"],"data_limitation":"note if insufficient, else empty"}',
  ].join('\n')

  var lNarrative = null
  try {
    lNarrative = await callOpenAI(
      'Senior BI analyst. Answer precisely using only data provided. Never fabricate numbers.',
      lNarrPrompt, 1000
    )
  } catch(e) { lNarrative = null }

  return Response.json({
    question, periodUsed: periodUsedL, queries: allResultsL, narrative: lNarrative,
    twoPass: true, datasetFormat: 'long_hierarchical',
    usage: { prompt_tokens: totalUsage.prompt_tokens, completion_tokens: totalUsage.completion_tokens, model: 'gpt-4o' },
  })
}
// ═══════════════════════════════════════════════════════════════════════════
// END handleLongAskFlow
// ═══════════════════════════════════════════════════════════════════════════
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
  var high = dims.filter(function(m) { return (m.business_priority || '').toLowerCase() === 'high' })
  var pool = high.length ? high : dims

  // Prefer human-readable name columns over ID columns
  var nameCol = pool.find(function(m) { return /name/i.test(m.field_name) && (m.data_type || '').toLowerCase() === 'string' })
  if (nameCol) return nameCol.field_name

  // Then prefer any String dimension over Integer/numeric IDs
  var stringCol = pool.find(function(m) { return (m.data_type || '').toLowerCase() === 'string' })
  if (stringCol) return stringCol.field_name

  return pool[0] ? pool[0].field_name : null
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
      '## NUMBER FORMATTING (apply to answer, key_findings, and drivers)',
    '- Format large numbers with suffixes: 1,234,567 → "1.23M", 2,500,000,000 → "2.5B", 45,000 → "45K"',
    '- Numbers below 1,000: show as-is, up to 2 decimals',
    '- Always append the unit when available (e.g. "1.23M USD", "45.2K units")',
    '- Percentages: 1 decimal place (e.g. "12.3%")',
    '- Never output raw unformatted numbers like "1234567.89"',
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

    // Pass 2 prompt differs by type
    var pass2Prompt = twoPassType === 'analytical' ? [
      '## TASK',
      'Pass 2 of an analytical two-pass question. Pass 1 identified the top entity.',
      'Now generate 1-3 queries that explain WHY that entity has this characteristic.',
      'Focus on: date breakdown, max/min values per day, patterns over time, interval-level detail.',
      'Do NOT generate a waterfall or dependency KPI comparison — this is a detail drill-down.',
      '',
      '## ORIGINAL QUESTION', question,
      '',
      '## PASS 1 RESULT', 'Identified entity: ' + entityList[0] + ' (value: ' + (pass1Results[0] && pass1Results[0].current_value || '') + ')',
      'Entity field: ' + entityField,
      'Target KPI: ' + targetKpi,
      '',
      promptBase,
      '',
      '## PASS 2 INSTRUCTIONS',
      'Generate queries that show the detail behind why ' + entityList[0] + ' has this characteristic.',
      'Example for range question: show per-day max, min, range for this entity.',
      'Example for pattern question: show trend over time for this entity.',
      'For causal/what-led-to questions about a specific entity, generate a multi-column trend query showing the target KPI and all dependency KPIs as separate columns grouped by period — NOT as separate rows using UNION ALL.',
'Use chart_type "table" for multi-column results. This allows visual correlation between KPIs across time.',
      'Filter to entity: WHERE ' + entityField + " = '" + String(entityList[0] || '').replace(/'/g, "''") + "'",
      '',
      '## OUTPUT — JSON only',
      '{"queries":[{"id":"q1","title":"...","chart_type":"bar|line|table","sql":"SELECT ...","label_key":"label","value_key":"current_value","unit":"","insight":"..."}],"period_used":"' + periodUsed + '"}',
    ].join('\n') : [
      '## TASK',
      'Pass 2 of a performance two-pass question. Pass 1 identified underperforming/overperforming entities.',
      'Now generate causal/why queries using dependency KPIs and portfolio comparison.',
      '',
      '## ORIGINAL QUESTION', question,
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
      'IMPORTANT: Use AVG for ALL KPI columns — per-entity behavioural comparison normalising for different interval counts.',
      'Use chart_type: "waterfall"',
      'Include these extra fields: entity_field, entity_list, target_kpi, dependency_kpis.',
      '  entity_field: "' + entityField + '"',
      '  entity_list: ' + JSON.stringify(entityList),
      '  target_kpi: "' + targetKpi + '"',
      '  dependency_kpis: ' + JSON.stringify(dependencyKpis),
      '',
      'QUERY 2 — Portfolio average query:',
      'SELECT AVG of the target KPI and all dependency KPIs across ALL entities for the same period.',
      'Completely standalone SELECT — no GROUP BY, no entity filter, no UNION with Query 1.',
      'IMPORTANT: Use AVG for ALL KPI columns.',
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

    // Combine all results — always start with Pass 1
    var allQueryResults = []
    allQueryResults.push(Object.assign({}, pass1Query, { data: pass1Results, error: null }))

    if (twoPassType === 'analytical') {
      // ── Analytical: execute all Pass 2 queries normally ───────────────────
      for (var ai = 0; ai < pass2Queries.length; ai++) {
        var aq = pass2Queries[ai]
        try {
          var aRows = await query(aq.sql)
          allQueryResults.push(Object.assign({}, aq, { data: aRows, error: null }))
        } catch(err) {
          console.error('analytical pass2 query error:', err.message)
          allQueryResults.push(Object.assign({}, aq, { data: [], error: err.message }))
        }
      }
    } else {
      // ── Performance: waterfall + portfolio avg ────────────────────────────
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
      if (waterfallQuery) {
        allQueryResults.push(Object.assign({}, waterfallQuery, {
          data:          waterfallData,
          portfolio_avg: portfolioAvgData.length ? portfolioAvgData[0] : null,
          error:         waterfallError,
        }))
      }
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
      twoPassType === 'analytical'
        ? '## NARRATIVE INSTRUCTIONS\n1. State which entity was identified and its specific value.\n2. Explain the pattern — which day had the peak, what the max/min were, what the spread looks like.\n3. Suggest what might cause this pattern based on the data.'
        : '## NARRATIVE INSTRUCTIONS FOR PERFORMANCE QUESTIONS\n1. State the gap in the target KPI for each identified entity with actual numbers.\n2. For each dependency KPI that deviates from portfolio average, state direction and magnitude.\n3. Rule out dependency KPIs that did NOT deviate.\n4. Conclude with the most likely primary driver.\n5. Frame as correlations: "correlates with", "likely contributed to", "data suggests".',
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
