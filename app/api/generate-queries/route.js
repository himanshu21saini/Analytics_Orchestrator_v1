import { query } from '../../../lib/db'
import { buildPeriodFilters } from '../../../lib/period-builder'



// ── Pre-analysis ──────────────────────────────────────────────────────────────
async function runPreAnalysis(tbl, kpis, dims, curCond, cmpCond, curCondPIT, cmpCondPIT) {
  var results = []; var kpiSample = kpis.slice(0, 5); var dimSample = dims.slice(0, 6)
  for (var ki = 0; ki < kpiSample.length; ki++) {
    var kpi = kpiSample[ki]
    var isCD  = /distinct/i.test(kpi.calculation_logic || '') || /count_distinct/i.test(kpi.aggregation || '')
    var distF = isCD ? (kpi.dependencies || kpi.field_name) : null
    var isPIT = !isCD && kpi.accumulation_type === 'point_in_time'
    var agg   = isCD ? null : (isPIT ? 'AVG' : 'SUM')
    var uCur  = isPIT ? curCondPIT : curCond; var uCmp = isPIT ? cmpCondPIT : cmpCond
    for (var di = 0; di < dimSample.length; di++) {
      var dim = dimSample[di]
      try {
        var sql = isCD && distF
          ? 'SELECT ' + dim.field_name + ' AS segment, COUNT(DISTINCT CASE WHEN ' + uCur + ' THEN ' + distF + ' ELSE NULL END) AS cur_val, COUNT(DISTINCT CASE WHEN ' + uCmp + ' THEN ' + distF + ' ELSE NULL END) AS cmp_val FROM ' + tbl + " WHERE " + dim.field_name + " IS NOT NULL AND CAST(" + dim.field_name + " AS TEXT) != '' GROUP BY " + dim.field_name + ' ORDER BY cur_val DESC NULLS LAST LIMIT 20'
          : 'SELECT ' + dim.field_name + ' AS segment, ' + agg + '(CASE WHEN ' + uCur + ' THEN COALESCE(' + kpi.field_name + ', 0) ELSE NULL END) AS cur_val, ' + agg + '(CASE WHEN ' + uCmp + ' THEN COALESCE(' + kpi.field_name + ', 0) ELSE NULL END) AS cmp_val FROM ' + tbl + " WHERE " + dim.field_name + " IS NOT NULL AND CAST(" + dim.field_name + " AS TEXT) != '' GROUP BY " + dim.field_name + ' ORDER BY cur_val DESC NULLS LAST LIMIT 20'
        var rows = await query(sql)
        if (!rows || rows.length < 2) continue
        var curVals = rows.map(function(r) { return parseFloat(r.cur_val) || 0 })
        var mean = curVals.reduce(function(a, b) { return a + b }, 0) / curVals.length
        if (mean === 0) continue
        var cv = Math.sqrt(curVals.reduce(function(acc, v) { return acc + Math.pow(v - mean, 2) }, 0) / curVals.length) / Math.abs(mean)
        var outliers = rows.map(function(r) {
          var cur = parseFloat(r.cur_val) || 0; var cmp2 = parseFloat(r.cmp_val) || 0
          return { segment: r.segment, dev_from_mean_pct: (cur - mean) / Math.abs(mean) * 100, yoy_delta_pct: cmp2 !== 0 ? (cur - cmp2) / Math.abs(cmp2) * 100 : null }
        }).sort(function(a, b) { return Math.abs(b.dev_from_mean_pct) - Math.abs(a.dev_from_mean_pct) })
        results.push({
          kpi_field: kpi.field_name, kpi_display: kpi.display_name, kpi_unit: kpi.unit || '', kpi_priority: kpi.business_priority || 'medium',
          dim_field: dim.field_name, dim_display: dim.display_name, segment_count: rows.length,
          cv: Math.round(cv * 1000) / 1000, cv_label: cv > 0.3 ? 'high' : cv > 0.1 ? 'medium' : 'low',
          mean_val: Math.round(mean * 100) / 100,
          top_segment:   rows[0]              ? { name: rows[0].segment,              value: Math.round((parseFloat(rows[0].cur_val)              || 0) * 100) / 100 } : null,
          worst_segment: rows[rows.length - 1] ? { name: rows[rows.length-1].segment, value: Math.round((parseFloat(rows[rows.length-1].cur_val) || 0) * 100) / 100 } : null,
          top_outlier: outliers[0] ? { name: outliers[0].segment, dev_from_mean_pct: Math.round(outliers[0].dev_from_mean_pct * 10) / 10, yoy_delta_pct: outliers[0].yoy_delta_pct !== null ? Math.round(outliers[0].yoy_delta_pct * 10) / 10 : null } : null,
        })
      } catch(e) { console.warn('pre-analysis skip:', kpi.field_name, 'x', dim.field_name, e.message) }
    }
  }
  var priOrder = { high: 3, medium: 2, low: 1 }
  results.sort(function(a, b) { var pa = priOrder[(a.kpi_priority||'').toLowerCase()]||1; var pb = priOrder[(b.kpi_priority||'').toLowerCase()]||1; return pa !== pb ? pb - pa : b.cv - a.cv })
  return results
}

function formatPreAnalysis(pa) {
  if (!pa || !pa.length) return '(pre-analysis unavailable)'
  var lines = ['CV > 0.3 = high variance. CV < 0.1 = low variance (skip).', '']
  var byKpi = {}; pa.forEach(function(r) { if (!byKpi[r.kpi_field]) byKpi[r.kpi_field] = []; byKpi[r.kpi_field].push(r) })
  Object.keys(byKpi).forEach(function(kf) {
    var rows = byKpi[kf]; var first = rows[0]
    lines.push('── ' + first.kpi_display + ' (' + first.kpi_field + ', priority: ' + first.kpi_priority + ')')
    rows.forEach(function(r) {
      var outStr = r.top_outlier ? ' | outlier: ' + r.top_outlier.name + ' (' + (r.top_outlier.dev_from_mean_pct > 0 ? '+' : '') + r.top_outlier.dev_from_mean_pct + '% from mean' + (r.top_outlier.yoy_delta_pct !== null ? ', YoY: ' + (r.top_outlier.yoy_delta_pct > 0 ? '+' : '') + r.top_outlier.yoy_delta_pct + '%' : '') + ')' : ''
      lines.push('   dim=' + r.dim_display.padEnd(18) + ' CV=' + String(r.cv).padEnd(6) + ' [' + r.cv_label.toUpperCase().padEnd(6) + '] segs=' + r.segment_count + (r.top_segment ? ' | top: ' + r.top_segment.name : '') + outStr)
    })
    lines.push('')
  })
  return lines.join('\n')
}

function buildIntentQueries(intent, tbl, f, CF, metaRows) {
  if (!intent || !intent.type || intent.type === 'null') return []
  var queries = []; var base = 'FROM ' + tbl + ' WHERE ' + f.curCond + CF
  function aggFn(fn) {
    var n = (fn || '').toLowerCase(); var m = metaRows && metaRows.find(function(r) { return (r.field_name || '').toLowerCase() === n })
    if (m) { var a = (m.aggregation || '').toUpperCase(); if (['SUM','AVG','COUNT','MAX','MIN'].includes(a)) return a; if (a === 'COUNT_DISTINCT') return 'COUNT'; if (m.accumulation_type === 'cumulative') return 'SUM'; if (m.accumulation_type === 'point_in_time') return 'AVG' }
    return 'AVG'
  }
  if (intent.type === 'ranking' || intent.type === 'ranking_with_drilldown') {
    var e = intent.primary_entity || 'branch_name'; var met = intent.primary_metric || 'bfi_2_score'
    var topN = parseInt(intent.top_n) || 10; var dir = (intent.direction || 'desc').toUpperCase()
    queries.push({ id: 'intent_ranking_' + e, title: (intent.primary_metric_display || met) + ' by ' + (intent.primary_entity_display || e) + ' — Ranked', chart_type: 'bar', sql: 'SELECT ' + e + ' AS label, ' + aggFn(met) + '(COALESCE(' + met + ', 0)) AS current_value ' + base + ' AND ' + e + " IS NOT NULL AND CAST(" + e + " AS TEXT) != '' GROUP BY " + e + ' ORDER BY current_value ' + dir + ' LIMIT ' + topN, current_key: 'current_value', value_key: 'current_value', label_key: 'label', unit: '', insight: 'Ranks by ' + (intent.primary_metric_display || met), priority: 50, intent_generated: true })
  }
  if (intent.type === 'distribution') {
    var dd = intent.distribution_dimension || 'stress_type'
    queries.push({ id: 'intent_dist_' + dd, title: 'Distribution by ' + dd, chart_type: 'donut', sql: 'SELECT ' + dd + ' AS label, COUNT(*) AS current_value ' + base + ' AND ' + dd + " IS NOT NULL AND CAST(" + dd + " AS TEXT) != '' GROUP BY " + dd + ' ORDER BY current_value DESC', current_key: 'current_value', value_key: 'current_value', label_key: 'label', unit: 'count', insight: 'Spread across ' + dd, priority: 50, intent_generated: true })
  }
  if (intent.type === 'temporal') {
    var td = intent.time_dimension || 'interval'; var tm = intent.temporal_metric || 'bfi_2_score'
    queries.push({ id: 'intent_temporal_' + td, title: tm + ' by ' + td, chart_type: 'area', sql: 'SELECT ' + td + ' AS label, ' + aggFn(tm) + '(COALESCE(' + tm + ', 0)) AS current_value ' + base + ' AND ' + td + ' IS NOT NULL GROUP BY ' + td + ' ORDER BY ' + td + ' ASC', current_key: 'current_value', value_key: 'current_value', label_key: 'label', unit: '', insight: 'Pattern across ' + td, priority: 50, intent_generated: true })
  }
  return queries
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })
  var body
  try { body = await request.json() } catch(e) { return Response.json({ error: 'Invalid request body.' }, { status: 400 }) }

  var metadataSetId = body.metadataSetId; var datasetId = body.datasetId
  var timePeriod    = body.timePeriod || { viewType: 'YTD', year: 2024, month: 12, comparisonType: 'YoY' }
  var userContext   = body.userContext || null; var mandatoryFilters = body.mandatoryFilters || []

  if (!metadataSetId || !datasetId) return Response.json({ error: 'metadataSetId and datasetId are required.' }, { status: 400 })

  var tbl = 'ds_' + datasetId

  // ── Branch on dataset format ─────────────────────────────────────────────
  var setRow = await query('SELECT dataset_format FROM metadata_sets WHERE id = $1', [metadataSetId])
  var datasetFormatType = setRow.length ? (setRow[0].dataset_format || 'wide') : 'wide'

  if (datasetFormatType === 'long_hierarchical') {
    return await generateLongFormatDashboard({
      datasetId: datasetId,
      metadataSetId: metadataSetId,
      timePeriod: timePeriod,
      userContext: userContext,
      mandatoryFilters: mandatoryFilters,
    })
  }
  // Context filters
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(fi) {
      var op = (fi.operator === 'equals' || fi.operator === '=') ? '=' : (fi.operator === 'not_equals' || fi.operator === '!=') ? '!=' : fi.operator
      return " AND " + fi.field + " " + op + " '" + String(fi.value || '').replace(/'/g, "''") + "'"
    }).join('')
  }
  // Mandatory filters
  var mandatoryFilterSQL = mandatoryFilters.length ? mandatoryFilters.map(function(fi) { return " AND " + fi.field + " = '" + String(fi.value || '').replace(/'/g, "''") + "'" }).join('') : ''
  var CF = contextFilterSQL + mandatoryFilterSQL

  function applyFocusPriority(arr) {
    if (!userContext || !userContext.kpi_focus || !userContext.kpi_focus.length) return arr
    return arr.slice().sort(function(a, b) { return (userContext.kpi_focus.indexOf(b.field_name) >= 0 ? 1 : 0) - (userContext.kpi_focus.indexOf(a.field_name) >= 0 ? 1 : 0) })
  }

  var metaRows = await query('SELECT * FROM metadata_rows WHERE metadata_set_id = $1 ORDER BY id', [metadataSetId])
  if (!metaRows.length) return Response.json({ error: 'No metadata found.' }, { status: 404 })

  // Sample from real table
  var sampleRows = []
  try { sampleRows = await query('SELECT * FROM ' + tbl + ' LIMIT 3') } catch(e) { console.warn('Sample failed:', e.message) }

  var f = buildPeriodFilters( timePeriod)

  function pri(m) { var p = (m.business_priority || '').toLowerCase(); return p === 'high' ? 3 : p === 'medium' ? 2 : 1 }
  var kpis    = applyFocusPriority(metaRows.filter(function(m) { return m.type === 'kpi'         && m.is_output !== 'N' }).sort(function(a,b) { return pri(b)-pri(a) }))
  var derived = applyFocusPriority(metaRows.filter(function(m) { return m.type === 'derived_kpi' && m.is_output !== 'N' }))
  var dims    = metaRows.filter(function(m) { return m.type === 'dimension' && m.is_output !== 'N' })
  var topKpis = kpis.slice(0, 6); var topDerived = derived.slice(0, 4)

  var cCur = f.curCond + CF; var cCmp = f.cmpCond + CF; var cCurP = f.curCondPIT + CF; var cCmpP = f.cmpCondPIT + CF
  console.log('=== generate-queries: tbl=' + tbl + ' curCond=' + f.curCond)
  var preAnalysis = await runPreAnalysis(tbl, topKpis, dims, cCur, cCmp, cCurP, cCmpP)
  var preAnalysisText = formatPreAnalysis(preAnalysis)

  function fieldList(arr) {
    return arr.map(function(m) {
      return { field_name: m.field_name, display_name: m.display_name, unit: m.unit || '', definition: m.definition || '', aggregation: m.aggregation || 'SUM', business_priority: m.business_priority || 'Medium', accumulation_type: m.accumulation_type || 'cumulative', favorable_direction: m.favorable_direction || 'i', calculation_logic: m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined, dependencies: m.type === 'derived_kpi' ? (m.dependencies || '') : undefined }
    })
  }

  // SQL templates — clean column-based, no JSONB
  var T = tbl; var WHERE = ' WHERE 1=1' + CF
  var tplSum  = 'SELECT SUM(CASE WHEN ' + f.curCond + ' THEN COALESCE(__FIELD__, 0) ELSE 0 END) AS current_value, SUM(CASE WHEN ' + f.cmpCond + ' THEN COALESCE(__FIELD__, 0) ELSE 0 END) AS comparison_value FROM ' + T + WHERE
  var tplPIT  = 'SELECT AVG(CASE WHEN ' + f.curCondPIT + ' THEN COALESCE(__FIELD__, 0) ELSE NULL END) AS current_value, AVG(CASE WHEN ' + f.cmpCondPIT + ' THEN COALESCE(__FIELD__, 0) ELSE NULL END) AS comparison_value FROM ' + T + WHERE
  var tplCD   = 'SELECT COUNT(DISTINCT CASE WHEN ' + f.curCondPIT + ' THEN __DIST_FIELD__ ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN ' + f.cmpCondPIT + ' THEN __DIST_FIELD__ ELSE NULL END) AS comparison_value FROM ' + T + WHERE
  var tplCDBar= 'SELECT __DIM__ AS label, COUNT(DISTINCT CASE WHEN ' + f.curCond + ' THEN __DIST_FIELD__ ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN ' + f.cmpCond + ' THEN __DIST_FIELD__ ELSE NULL END) AS comparison_value FROM ' + T + WHERE + ' GROUP BY __DIM__ ORDER BY current_value DESC LIMIT 10'
  var tplBar  = 'SELECT __DIM__ AS label, SUM(CASE WHEN ' + f.curCond + ' THEN COALESCE(__KPI__, 0) ELSE 0 END) AS current_value, SUM(CASE WHEN ' + f.cmpCond + ' THEN COALESCE(__KPI__, 0) ELSE 0 END) AS comparison_value FROM ' + T + WHERE + ' GROUP BY __DIM__ ORDER BY current_value DESC LIMIT 10'
  var tplBarP = 'SELECT __DIM__ AS label, AVG(CASE WHEN ' + f.curCondPIT + ' THEN COALESCE(__KPI__, 0) ELSE NULL END) AS current_value, AVG(CASE WHEN ' + f.cmpCondPIT + ' THEN COALESCE(__KPI__, 0) ELSE NULL END) AS comparison_value FROM ' + T + WHERE + ' GROUP BY __DIM__ ORDER BY current_value DESC LIMIT 10'
  var tplLine = 'SELECT CONCAT(' + f.yf + ", '-', LPAD(CAST(" + f.mf + " AS TEXT), 2, '0')) AS period, __AGG__(COALESCE(__KPI__, 0)) AS value FROM " + T + ' WHERE ' + f.yf + ' = ' + f.curYear + CF + ' GROUP BY ' + f.yf + ', ' + f.mf + ' ORDER BY period ASC'
  var tplArea = 'SELECT CONCAT(' + f.yf + ", '-', LPAD(CAST(" + f.mf + " AS TEXT), 2, '0')) AS period, SUM(COALESCE(__KPI__, 0)) AS value FROM " + T + ' WHERE ' + f.yf + ' = ' + f.curYear + CF + ' GROUP BY ' + f.yf + ', ' + f.mf + ' ORDER BY period ASC'
  var tplPie  = 'SELECT __DIM__ AS label, __AGG__(CASE WHEN ' + f.curCond + ' THEN COALESCE(__KPI__, 0) ELSE 0 END) AS value FROM ' + T + WHERE + ' GROUP BY __DIM__ ORDER BY value DESC LIMIT 6'
  var tplPieP = 'SELECT __DIM__ AS label, AVG(CASE WHEN ' + f.curCondPIT + ' THEN COALESCE(__KPI__, 0) ELSE NULL END) AS value FROM ' + T + WHERE + ' GROUP BY __DIM__ ORDER BY value DESC LIMIT 6'
  var tplScat = 'SELECT __DIM__ AS label, AVG(CASE WHEN ' + f.curCond + ' THEN COALESCE(__KPI1__, 0) ELSE NULL END) AS x_value, AVG(CASE WHEN ' + f.curCond + ' THEN COALESCE(__KPI2__, 0) ELSE NULL END) AS y_value FROM ' + T + ' WHERE ' + f.curCond + CF + ' GROUP BY __DIM__'
  var tplScatP= 'SELECT __DIM__ AS label, AVG(CASE WHEN ' + f.curCondPIT + ' THEN COALESCE(__KPI1__, 0) ELSE NULL END) AS x_value, AVG(CASE WHEN ' + f.curCondPIT + ' THEN COALESCE(__KPI2__, 0) ELSE NULL END) AS y_value FROM ' + T + ' WHERE ' + f.curCondPIT + CF + ' GROUP BY __DIM__'

  var mandNote = mandatoryFilters.length ? '\n## MANDATORY FILTERS (pre-applied to all templates — do NOT add again)\n' + mandatoryFilters.map(function(fi) { return '  ' + (fi.display_name || fi.field) + ' = "' + fi.value + '"' }).join('\n') : ''
  var sysMsg  = 'Senior BI analyst and SQL engineer. Return only valid JSON. Table: ' + tbl + '. Columns are real SQL columns — no JSONB syntax. Year col: ' + f.yf + ' (current=' + f.curYear + ', comparison=' + f.cmpYear + '). Month col: ' + f.mf + '. Use field names exactly as listed in the catalogue.'

  var prompt = [
    '## TASK: Design the most insightful dashboard for this dataset.',
    '',
    '## TABLE: ' + tbl + ' (real typed columns — plain SQL, no JSONB)',
    'Access fields directly: SELECT branch_name, SUM(revenue) FROM ' + tbl,
    'NO data->>\'\' syntax needed. NO ::numeric casting. Just column names.',
    '',
    '## SAMPLE DATA (verify exact column names)',
    JSON.stringify(sampleRows, null, 2),
    '',
    '## TIME PERIOD',
    'Year col: ' + f.yf + ' | Month col: ' + f.mf,
    'Current:    ' + f.viewLabel + ' | WHERE ' + f.curCond,
    'Comparison: ' + f.cmpLabel  + ' | WHERE ' + f.cmpCond,
    'Current PIT: WHERE ' + f.curCondPIT,
    'Comp PIT:    WHERE ' + f.cmpCondPIT,
    mandNote,
    '',
    '## SQL TEMPLATES (replace __FIELD__ __KPI__ __DIM__ __AGG__ __DIST_FIELD__ __KPI1__ __KPI2__ with actual column names)',
    'T-SUM    (KPI, cumulative):       ' + tplSum,
    'T-PIT    (KPI, point_in_time):    ' + tplPIT,
    'T-CD     (KPI, count distinct):   ' + tplCD,
    'T-CD-BAR (bar, count distinct):   ' + tplCDBar,
    'T-BAR    (bar, cumulative):        ' + tplBar,
    'T-BAR-PIT (bar, point_in_time):   ' + tplBarP,
    'T-LINE   (trend line):             ' + tplLine,
    'T-AREA   (area chart):             ' + tplArea,
    'T-PIE    (pie/donut, cumulative):  ' + tplPie,
    'T-PIE-PIT (pie/donut, PIT):        ' + tplPieP,
    'T-SCATTER (scatter, cumulative):   ' + tplScat,
    'T-SCATTER-PIT (scatter, PIT):      ' + tplScatP,
    '',
    '## ACCUMULATION TYPE',
'## ACCUMULATION TYPE',
'KPI cards:  cumulative → T-SUM  | point_in_time → T-PIT  | count_distinct → T-CD',
'Bar charts: cumulative → T-BAR  | point_in_time → T-BAR-PIT',
'OVERRIDE: if a field has aggregation = "AVG", always use T-PIT / T-BAR-PIT regardless of accumulation_type.',
    'Pie/donut:  cumulative → T-PIE  | point_in_time → T-PIE-PIT',
    'Scatter:    cumulative → T-SCATTER | point_in_time → T-SCATTER-PIT',
    'Line/area:  __AGG__=AVG for point_in_time, SUM for cumulative',
    '',
    '## DERIVED KPIs',
    'If calculation_logic is provided, use it directly in SQL. Example:',
    '  calculation_logic = "SUM(revenue) / NULLIF(SUM(client_count), 0)" → use exactly that expression in SELECT.',
    '',
    '## DATE FIELDS',
    'Date columns stored as TEXT in M/D/YY format. Use safe_date(column_name) to convert.',
    'Example for weekday: TO_CHAR(safe_date(transaction_date), \'Day\')',
    '',
    '## FIELD CATALOGUE',
    'KPI fields:   ' + JSON.stringify(fieldList(topKpis)),
    'Derived KPIs: ' + JSON.stringify(fieldList(topDerived)),
    'Dimensions:   ' + JSON.stringify(dims.map(function(d) { return { field_name: d.field_name, display_name: d.display_name } })),
    '',
    '## FAVORABLE DIRECTION: "i" = increase good | "d" = decrease good',
    '',
    '## PRE-ANALYSIS (real variance scores from data)',
    preAnalysisText,
    '',
    '## DESIGN RULES',
    'STEP 1 — KPI Cards: generate ONE card for EVERY field listed in the KPI and Derived KPI catalogue (max 8). Do not skip any. cumulative→T-SUM, PIT→T-PIT, count_distinct→T-CD.',
    'STEP 2 — Charts (8-12):',
    '  - Use highest-CV dimension per KPI from pre-analysis',
    '  - 2 line/area charts for top flow KPIs',
    '  - 1+ donut for distribution',
    '  - bar MUST have comparison_key: "comparison_value" and include comparison SQL',
    '  - No single dimension in more than 2 bar charts',
    '  - Multi-dimension results: concatenate labels (region || \' — \' || branch)',
    '',
    '## OUTPUT — JSON only, no markdown',
    '{"queries":[{"id":"snake_case","title":"Title","chart_type":"kpi|bar|line|area|pie|donut|scatter","sql":"SELECT...","current_key":"current_value","comparison_key":"comparison_value","value_key":"value","label_key":"label","unit":"","insight":"specific insight","priority":1}]}',
  ].join('\n')

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 6000, temperature: 0.15, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }] }),
    })
    var json = await response.json()
    if (!response.ok) throw new Error((json.error && json.error.message) || 'OpenAI error ' + response.status)
    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (!content) throw new Error('Empty response from OpenAI')
    var parsed; try { parsed = JSON.parse(content.replace(/```json|```/g, '').trim()) } catch(e) { throw new Error('Could not parse JSON: ' + content.slice(0, 300)) }
    var queries = parsed.queries || parsed; if (!Array.isArray(queries)) throw new Error('Expected queries array')
    queries.sort(function(a, b) { return (a.priority || 99) - (b.priority || 99) })
    var intent = userContext && userContext.intent ? userContext.intent : null
    if (intent && intent.type && intent.type !== 'null') queries = queries.concat(buildIntentQueries(intent, tbl, f, CF, metaRows))
    console.log('=== Queries generated:', queries.length)
    var usage = json.usage || {}
    var allKpis = metaRows.filter(function(m) { return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N' })
    var kpiCov = allKpis.map(function(m) {
      var inTop = topKpis.concat(topDerived).some(function(k) { return k.field_name === m.field_name })
      var hasCard = queries.some(function(q) { return q.chart_type === 'kpi' && (q.id === m.field_name || (q.title || '').toLowerCase().includes((m.display_name || '').toLowerCase())) })
      return { field_name: m.field_name, display_name: m.display_name, type: m.type, business_priority: m.business_priority, accumulation_type: m.accumulation_type, aggregation: m.aggregation, reason: hasCard ? 'shown' : !inTop ? 'not_in_topkpis' : 'not_selected' }
    })
    var dimCov = preAnalysis.map(function(r) {
      var cvNum = parseFloat(r.cv) || 0; var charted = queries.some(function(q) { return q.chart_type !== 'kpi' && q.sql && q.sql.indexOf(r.kpi_field) >= 0 && q.sql.indexOf(r.dim_field) >= 0 })
      return { kpi_field: r.kpi_field, kpi_display: r.kpi_display, dim_field: r.dim_field, dim_display: r.dim_display, cv: r.cv, cv_label: r.cv_label, top_segment: r.top_segment, top_outlier: r.top_outlier, charted, reason: charted ? 'charted' : cvNum < 0.05 ? 'flat' : cvNum < 0.15 ? 'low_cv' : 'not_selected' }
    })
    return Response.json({
      queries, model: 'gpt-4o', metadata: metaRows, timePeriod,
      periodInfo: { viewLabel: f.viewLabel, cmpLabel: f.cmpLabel, yf: f.yf, mf: f.mf, curYear: f.curYear, curCond: f.curCond },
      preAnalysis, coverageData: { kpiCoverage: kpiCov, dimCoverage: dimCov, kpiCapUsed: kpiCov.filter(function(k) { return k.reason === 'shown' }).length, kpiCapMax: 8 },
      usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o' },
    })
  } catch(err) {
    console.error('generate-queries error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate queries.' }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LONG HIERARCHICAL DASHBOARD (Stage 1: returns hierarchy structure only)
// Stage 4 will add LLM-generated supplementary charts here.
// ═══════════════════════════════════════════════════════════════════════════
async function generateLongFormatDashboard(args) {
  var datasetId        = args.datasetId
  var metadataSetId    = args.metadataSetId
  var timePeriod       = args.timePeriod
  var mandatoryFilters = args.mandatoryFilters || []

  // Load metadata_rows (dimensions + value column rows)
  var metaRows = await query('SELECT * FROM metadata_rows WHERE metadata_set_id = $1 ORDER BY id', [metadataSetId])

  // Load hierarchy nodes
  var hierarchyNodes = await query(
    'SELECT node_path, node_name, level, parent_path, is_leaf, display_name, definition, accumulation_type, favorable_direction, business_priority, unit FROM hierarchy_nodes WHERE metadata_set_id = $1 ORDER BY level, node_path',
    [metadataSetId]
  )

  if (!hierarchyNodes.length) {
    return Response.json({ error: 'No hierarchy nodes found for this metadata set.' }, { status: 404 })
  }

  // Build periodInfo so the Dashboard header still renders
  var yf = timePeriod.yearField  || 'report_year'
  var mf = timePeriod.monthField || 'report_month'
  var vt = timePeriod.viewType   || 'YTD'
  var ct = timePeriod.comparisonType || 'YoY'
  var yr = parseInt(timePeriod.year)  || new Date().getFullYear()
  var mo = parseInt(timePeriod.month) || 12

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  var viewLabel = vt === 'MTD'
    ? MONTHS[mo-1] + ' ' + yr + ' (MTD)'
    : vt === 'YTD'
      ? 'Jan–' + MONTHS[mo-1] + ' ' + yr + ' (YTD)'
      : 'Q' + Math.ceil(mo/3) + ' ' + yr + ' (QTD)'
  var cmpLabel = ct === 'YoY'
    ? 'vs ' + (vt === 'MTD' ? MONTHS[mo-1] : vt === 'YTD' ? 'Jan–' + MONTHS[mo-1] : 'Q' + Math.ceil(mo/3)) + ' ' + (yr - 1) + ' (YoY)'
    : 'vs prior period'

  var periodInfo = {
    viewLabel: viewLabel,
    cmpLabel:  cmpLabel,
    yf:        yf,
    mf:        mf,
    curYear:   yr,
  }

  return Response.json({
    queries:        [],   // Stage 4 will populate
    metadata:       metaRows,
    hierarchyNodes: hierarchyNodes,
    datasetFormat:  'long_hierarchical',
    timePeriod:     timePeriod,
    periodInfo:     periodInfo,
    coverageData:   { kpiCoverage: [], dimCoverage: [], kpiCapUsed: 0, kpiCapMax: 0 },
    usage:          { prompt_tokens: 0, completion_tokens: 0, model: 'none' },
  })
}
