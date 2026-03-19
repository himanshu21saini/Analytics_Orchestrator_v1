import { query } from '../../../lib/db'

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function quarterStart(m) { return Math.floor((m - 1) / 3) * 3 + 1 }

function buildPeriodFilters(datasetId, tp) {
  var vt = tp.viewType
  var yr = parseInt(tp.year)
  var mo = parseInt(tp.month)
  var ct = tp.comparisonType

  var curYear     = yr
  var curMonthMin = vt === 'MTD' ? mo : vt === 'YTD' ? 1 : quarterStart(mo)
  var curMonthMax = mo

  var cmpYear, cmpMonthMin, cmpMonthMax

  if (ct === 'YoY') {
    cmpYear = yr - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax
  } else if (ct === 'MoM') {
    cmpYear = mo === 1 ? yr - 1 : yr
    cmpMonthMin = cmpMonthMax = mo === 1 ? 12 : mo - 1
  } else {
    var cqs = quarterStart(mo)
    cmpYear = cqs <= 3 ? yr - 1 : yr
    cmpMonthMin = cqs <= 3 ? cqs + 9 : cqs - 3
    cmpMonthMax = cmpMonthMin + 2
  }

  var curCond = curMonthMin === curMonthMax
    ? "(data->>'year')::integer = " + curYear + " AND (data->>'month')::integer = " + curMonthMax
    : "(data->>'year')::integer = " + curYear + " AND (data->>'month')::integer >= " + curMonthMin + " AND (data->>'month')::integer <= " + curMonthMax

  var cmpCond = cmpMonthMin === cmpMonthMax
    ? "(data->>'year')::integer = " + cmpYear + " AND (data->>'month')::integer = " + cmpMonthMax
    : "(data->>'year')::integer = " + cmpYear + " AND (data->>'month')::integer >= " + cmpMonthMin + " AND (data->>'month')::integer <= " + cmpMonthMax

  var viewLabel, cmpLabel
  if (vt === 'MTD')      viewLabel = MONTHS[mo-1] + ' ' + yr + ' (MTD)'
  else if (vt === 'YTD') viewLabel = 'Jan-' + MONTHS[mo-1] + ' ' + yr + ' (YTD)'
  else                   viewLabel = 'Q' + Math.ceil(mo/3) + ' ' + yr + ' (QTD)'

  if (ct === 'YoY') {
    if (vt === 'MTD')      cmpLabel = 'vs ' + MONTHS[mo-1] + ' ' + cmpYear + ' (YoY)'
    else if (vt === 'YTD') cmpLabel = 'vs Jan-' + MONTHS[mo-1] + ' ' + cmpYear + ' (YoY)'
    else                   cmpLabel = 'vs Q' + Math.ceil(mo/3) + ' ' + cmpYear + ' (YoY)'
  } else if (ct === 'MoM') {
    cmpLabel = 'vs ' + MONTHS[cmpMonthMax-1] + ' ' + cmpYear + ' (MoM)'
  } else {
    cmpLabel = 'vs Q' + Math.ceil(cmpMonthMax/3) + ' ' + cmpYear + ' (QoQ)'
  }

  return { curCond, cmpCond, curYear, cmpYear, viewLabel, cmpLabel }
}

// ── PRE-ANALYSIS: compute real variance for every KPI × dimension pair ────────
//
// For each combination we run a lightweight SQL query that groups the KPI by
// the dimension and computes:
//   - mean across segments
//   - coefficient of variation (CV = stddev / mean)  ← key signal
//   - min / max segment values
//   - number of distinct segments
//
// CV is the best proxy for "does this dimension actually reveal something
// interesting about this KPI?":
//   CV > 0.3  → high variance → great breakdown candidate
//   CV 0.1-0.3 → moderate → worth showing
//   CV < 0.1  → low variance → dimension adds little insight
//
// We also compute YoY delta per segment so the LLM knows which segments
// are diverging (a segment moving away from peers is the most exec-relevant signal).

async function runPreAnalysis(datasetId, kpis, dims, curCond, cmpCond) {
  var results = []

  // Cap: analyse top 5 KPIs × top 6 dimensions = max 30 queries
  // Each is a tiny GROUP BY on an indexed JSONB column — fast
  var kpiSample = kpis.slice(0, 5)
  var dimSample = dims.slice(0, 6)

  for (var ki = 0; ki < kpiSample.length; ki++) {
    var kpi = kpiSample[ki]
    var agg = (kpi.accumulation_type === 'point_in_time') ? 'AVG' : 'SUM'

    for (var di = 0; di < dimSample.length; di++) {
      var dim = dimSample[di]

      try {
        var sql = [
          'SELECT',
          "  data->>'" + dim.field_name + "' AS segment,",
          '  ' + agg + "(CASE WHEN " + curCond + " THEN COALESCE((data->>'" + kpi.field_name + "')::numeric, 0) ELSE NULL END) AS cur_val,",
          '  ' + agg + "(CASE WHEN " + cmpCond + " THEN COALESCE((data->>'" + kpi.field_name + "')::numeric, 0) ELSE NULL END) AS cmp_val",
          'FROM dataset_rows',
          'WHERE dataset_id = ' + datasetId,
          "  AND data->>'" + dim.field_name + "' IS NOT NULL",
          "  AND data->>'" + dim.field_name + "' != ''",
          "GROUP BY data->>'" + dim.field_name + "'",
          'ORDER BY cur_val DESC NULLS LAST',
          'LIMIT 20',
        ].join('\n')

        var rows = await query(sql)

        // Need at least 2 segments to compute variance meaningfully
        if (!rows || rows.length < 2) continue

        var curVals = rows.map(function(r) { return parseFloat(r.cur_val) || 0 })
        var mean    = curVals.reduce(function(a, b) { return a + b }, 0) / curVals.length
        if (mean === 0) continue

        // Population std dev
        var variance = curVals.reduce(function(acc, v) { return acc + Math.pow(v - mean, 2) }, 0) / curVals.length
        var stdDev   = Math.sqrt(variance)
        var cv       = stdDev / Math.abs(mean)

        // Segments diverging from peers (largest absolute delta vs mean)
        var outliers = rows
          .map(function(r) {
            var cur     = parseFloat(r.cur_val) || 0
            var cmp     = parseFloat(r.cmp_val) || 0
            var devFromMean = ((cur - mean) / Math.abs(mean) * 100)
            var yoyDelta    = cmp !== 0 ? ((cur - cmp) / Math.abs(cmp) * 100) : null
            return { segment: r.segment, cur_val: cur, cmp_val: cmp, dev_from_mean_pct: devFromMean, yoy_delta_pct: yoyDelta }
          })
          .sort(function(a, b) { return Math.abs(b.dev_from_mean_pct) - Math.abs(a.dev_from_mean_pct) })

        // Top outlier = the most diverging segment
        var topOutlier   = outliers[0]
        var topSegment   = rows[0]  // highest current value segment
        var worstSegment = rows[rows.length - 1] // lowest

        results.push({
          kpi_field:       kpi.field_name,
          kpi_display:     kpi.display_name,
          kpi_unit:        kpi.unit || '',
          kpi_priority:    kpi.business_priority || 'medium',
          dim_field:       dim.field_name,
          dim_display:     dim.display_name,
          segment_count:   rows.length,
          cv:              Math.round(cv * 1000) / 1000,
          cv_label:        cv > 0.3 ? 'high' : cv > 0.1 ? 'medium' : 'low',
          mean_val:        Math.round(mean * 100) / 100,
          top_segment:     topSegment ? { name: topSegment.segment, value: Math.round((parseFloat(topSegment.cur_val) || 0) * 100) / 100 } : null,
          worst_segment:   worstSegment ? { name: worstSegment.segment, value: Math.round((parseFloat(worstSegment.cur_val) || 0) * 100) / 100 } : null,
          top_outlier:     topOutlier ? {
            name:             topOutlier.segment,
            dev_from_mean_pct: Math.round(topOutlier.dev_from_mean_pct * 10) / 10,
            yoy_delta_pct:    topOutlier.yoy_delta_pct !== null ? Math.round(topOutlier.yoy_delta_pct * 10) / 10 : null,
          } : null,
        })
      } catch (e) {
        // Non-fatal — skip this KPI × dim pair if SQL fails
        console.warn('pre-analysis skip:', kpi.field_name, 'x', dim.field_name, e.message)
      }
    }
  }

  // Sort by informativeness: KPI priority first, then CV descending
  var priOrder = { high: 3, medium: 2, low: 1 }
  results.sort(function(a, b) {
    var pa = priOrder[a.kpi_priority.toLowerCase()] || 1
    var pb = priOrder[b.kpi_priority.toLowerCase()] || 1
    if (pa !== pb) return pb - pa
    return b.cv - a.cv
  })

  return results
}

// ── Format pre-analysis for the LLM prompt ───────────────────────────────────
function formatPreAnalysis(preAnalysis) {
  if (!preAnalysis || !preAnalysis.length) return '(pre-analysis unavailable)'

  var lines = [
    'Each row = one KPI × dimension combination, ranked by business priority then data variance.',
    'CV (coefficient of variation) = how much the KPI varies across segments of that dimension.',
    'CV > 0.3 = high variance = this dimension reveals meaningful differences in this KPI.',
    'CV < 0.1 = low variance = this dimension adds little insight for this KPI.',
    '',
    'USE THIS DATA to decide:',
    '  1. Which KPI × dimension pairs to chart (prefer high CV)',
    '  2. Which dimension to use for breakdown charts (prefer highest CV for that KPI)',
    '  3. Which outlier segments to call out in the insight field',
    '  4. Skip combinations where CV < 0.05 — they are visually flat and uninformative',
    '',
  ]

  // Group by KPI for readability
  var byKpi = {}
  preAnalysis.forEach(function(r) {
    if (!byKpi[r.kpi_field]) byKpi[r.kpi_field] = []
    byKpi[r.kpi_field].push(r)
  })

  Object.keys(byKpi).forEach(function(kpiField) {
    var rows = byKpi[kpiField]
    var first = rows[0]
    lines.push('── ' + first.kpi_display + ' (' + first.kpi_field + ', priority: ' + first.kpi_priority + ')')

    rows.forEach(function(r) {
      var outStr = ''
      if (r.top_outlier) {
        outStr = ' | outlier: ' + r.top_outlier.name +
          ' (' + (r.top_outlier.dev_from_mean_pct > 0 ? '+' : '') + r.top_outlier.dev_from_mean_pct + '% from mean' +
          (r.top_outlier.yoy_delta_pct !== null ? ', YoY: ' + (r.top_outlier.yoy_delta_pct > 0 ? '+' : '') + r.top_outlier.yoy_delta_pct + '%' : '') + ')'
      }
      var topStr = r.top_segment ? ' | top: ' + r.top_segment.name : ''
      var wrstStr = r.worst_segment && r.worst_segment.name !== (r.top_segment && r.top_segment.name) ? ' | worst: ' + r.worst_segment.name : ''

      lines.push(
        '   dim=' + r.dim_display.padEnd(18) +
        ' CV=' + String(r.cv).padEnd(6) +
        ' [' + r.cv_label.toUpperCase().padEnd(6) + ']' +
        ' segments=' + r.segment_count +
        topStr + wrstStr + outStr
      )
    })
    lines.push('')
  })

  return lines.join('\n')
}

// ── Main route handler ────────────────────────────────────────────────────────
export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })

  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var metadataSetId = body.metadataSetId
  var datasetId     = body.datasetId
  var timePeriod    = body.timePeriod || { viewType: 'YTD', year: 2024, month: 12, comparisonType: 'YoY' }

  if (!metadataSetId || !datasetId) {
    return Response.json({ error: 'metadataSetId and datasetId are required.' }, { status: 400 })
  }

  var metaRows = await query('SELECT * FROM metadata_rows WHERE metadata_set_id = $1 ORDER BY id', [metadataSetId])
  if (!metaRows.length) return Response.json({ error: 'No metadata found.' }, { status: 404 })

  var dataset = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])
  if (!dataset.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })

  var sampleRows = await query('SELECT data FROM dataset_rows WHERE dataset_id = $1 LIMIT 3', [datasetId])
  var sampleData = sampleRows.map(function(r) { return r.data })

  var f = buildPeriodFilters(datasetId, timePeriod)

  function pri(m) {
    var p = (m.business_priority || '').toLowerCase()
    return p === 'high' ? 3 : p === 'medium' ? 2 : 1
  }

  var kpis    = metaRows.filter(function(m) { return m.type === 'kpi' }).sort(function(a,b) { return pri(b)-pri(a) })
  var derived = metaRows.filter(function(m) { return m.type === 'derived_kpi' })
  var dims    = metaRows.filter(function(m) { return m.type === 'dimension' })

  var topKpis    = kpis.slice(0, 6)
  var topDerived = derived.slice(0, 4)

  // ── RUN PRE-ANALYSIS before calling LLM ──────────────────────────────────
  console.log('=== pre-analysis: running', topKpis.length, 'KPIs ×', dims.length, 'dims')
  var preAnalysis = await runPreAnalysis(datasetId, topKpis, dims, f.curCond, f.cmpCond)
  var preAnalysisText = formatPreAnalysis(preAnalysis)
  console.log('=== pre-analysis: done,', preAnalysis.length, 'combinations scored')

  function fieldList(arr) {
    return arr.map(function(m) {
      return {
        field_name:        m.field_name,
        display_name:      m.display_name,
        unit:              m.unit || '',
        definition:        m.definition || '',
        aggregation:       m.aggregation || 'SUM',
        business_priority: m.business_priority || 'Medium',
        accumulation_type: m.accumulation_type || 'cumulative',
        calculation_logic: m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined,
        dependencies:      m.type === 'derived_kpi' ? (m.dependencies || '') : undefined,
        benchmark:         m.benchmark || '',
      }
    })
  }

  // SQL templates (unchanged from original)
  var tplSum = "SELECT SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId

  var tplAvg = "SELECT AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId

  var tplBar = "SELECT data->>'__DIM__' AS label, SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + " GROUP BY label ORDER BY current_value DESC LIMIT 10"

  var tplLine = "SELECT CONCAT(data->>'year','-',LPAD(CAST((data->>'month')::integer AS TEXT),2,'0')) AS period, __AGG__(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + " AND (data->>'year')::integer = " + f.curYear + " GROUP BY period ORDER BY period ASC"

  var tplPie = "SELECT data->>'__DIM__' AS label, __AGG__(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + " GROUP BY label ORDER BY value DESC LIMIT 6"

  var tplScatter = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI1__')::numeric,0) ELSE NULL END) AS x_value, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI2__')::numeric,0) ELSE NULL END) AS y_value FROM dataset_rows WHERE dataset_id = " + datasetId + " AND " + f.curCond + " GROUP BY label"

  var tplArea = "SELECT CONCAT(data->>'year','-',LPAD(CAST((data->>'month')::integer AS TEXT),2,'0')) AS period, SUM(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + " AND (data->>'year')::integer = " + f.curYear + " GROUP BY period ORDER BY period ASC"

  var systemMsg = 'You are a senior banking BI analyst and SQL engineer. Return only valid JSON. CRITICAL SQL RULE: current_value uses year=' + f.curYear + ' and comparison_value uses year=' + f.cmpYear + '. These are DIFFERENT years. Use CASE WHEN to split them. Never use IN. Never repeat the same condition in both columns.'

  var promptLines = [
    '## ROLE',
    'You are a senior banking BI analyst. Your job is to design the most insightful dashboard possible.',
    'You have been given REAL DATA ANALYSIS (pre-computed variance scores) to guide your decisions.',
    'Use this data — do not guess at which dimensions are interesting.',
    '',
    '## DATABASE',
    'Table: dataset_rows | data column is JSONB',
    "Text: data->>'field' | Numeric: COALESCE((data->>'field')::numeric, 0)",
    'All queries must include: WHERE dataset_id = ' + datasetId,
    '',
    '## SAMPLE DATA (all field names must match these keys exactly)',
    JSON.stringify(sampleData, null, 2),
    '',
    '## TIME PERIOD',
    'Current  : ' + f.viewLabel + '  |  WHERE: ' + f.curCond,
    'Comparison: ' + f.cmpLabel + '  |  WHERE: ' + f.cmpCond,
    'current year = ' + f.curYear + '  |  comparison year = ' + f.cmpYear,
    '',
    '## SQL TEMPLATES (replace __FIELD__, __KPI__, __DIM__, __AGG__ with actual values)',
    'T-SUM (KPI card, cumulative): ' + tplSum,
    'T-AVG (KPI card, point_in_time): ' + tplAvg,
    'T-BAR (grouped bar): ' + tplBar,
    'T-LINE (trend line): ' + tplLine,
    'T-PIE (pie/donut): ' + tplPie,
    'T-SCATTER (scatter): ' + tplScatter,
    'T-AREA (area chart): ' + tplArea,
    '',
    '## FIELD CATALOGUE',
    'KPI fields: ' + JSON.stringify(fieldList(topKpis)),
    'Derived KPIs: ' + JSON.stringify(fieldList(topDerived)),
    'Dimensions: ' + JSON.stringify(dims.map(function(d) { return { field_name: d.field_name, display_name: d.display_name } })),
    '',
    '## ACCUMULATION TYPE',
    'cumulative → SUM | point_in_time → AVG. Check accumulation_type on each field.',
    '',
    '## PRE-ANALYSIS: DATA-DRIVEN VARIANCE SCORES (computed from actual data)',
    preAnalysisText,
    '',
    '## YOUR INTELLIGENT DESIGN TASK',
    '',
    'STEP 1 — KPI Cards (max 8 total, 4 per row × 2 rows):',
    '  - Generate one kpi card for EACH of the top-priority KPI and derived_kpi fields',
    '  - Cap at 8 total KPI cards — prioritise by business_priority (High first)',
    '  - Use T-SUM for cumulative fields, T-AVG for point_in_time fields',
    '',
    'STEP 2 — Charts (generate 8-12 charts):',
    '  DIMENSION SELECTION RULES (enforce strictly):',
    '    - For each KPI, use the dimension with the HIGHEST CV from the pre-analysis above',
    '    - Only use a dimension with CV < 0.05 if no better option exists',
    '    - When a top_outlier is present (a segment diverging from peers), call it out in the insight field',
    '    - Prefer dimensions where the top and worst segments show meaningful divergence',
    '',
    '  CHART TYPE RULES:',
    '    bar         → compare a KPI across categories (use highest-CV dimension)',
    '    line        → trend over time (best for cumulative flow metrics)',
    '    area        → trend with visual weight (best for revenue/profit over time)',
    '    donut       → distribution/share (segment mix, top 5-6 slices)',
    '    pie         → fewer than 5 categories only',
    '    stacked_bar → composition over time (e.g. revenue by segment by month)',
    '    scatter     → correlation between two ratio/rate KPIs',
    '',
    '  INSIGHT FIELD RULES:',
    '    - Always reference the outlier segment when pre-analysis shows one (e.g. "North region is +34% above peer average")',
    '    - Always mention YoY direction if pre-analysis shows it',
    '    - Be specific — name actual segments, not generic descriptions',
    '',
    '  - Include at least 2 trend charts (line or area) for the most important flow metrics',
    '  - Include at least 1 scatter if two ratio KPIs exist',
    '  - Include at least 2 dimension breakdowns (bar) for top KPIs — using highest-CV dimensions',
    '  - Do NOT generate a chart for any KPI × dimension pair where CV < 0.05',
    '',
    '## OUTPUT FORMAT — JSON only, no markdown',
    '{',
    '  "queries": [',
    '    {',
    '      "id": "string (snake_case unique)",',
    '      "title": "string (executive-friendly, e.g. Net Interest Income by Region)",',
    '      "chart_type": "kpi|bar|line|area|pie|donut|stacked_bar|scatter",',
    '      "sql": "string (complete valid SQL, no placeholders)",',
    '      "current_key": "current_value (for kpi/bar)",',
    '      "comparison_key": "comparison_value (for kpi/bar)",',
    '      "value_key": "value or current_value (main numeric alias)",',
    '      "label_key": "label or period (category/time alias)",',
    '      "series_keys": ["array", "for", "stacked_bar", "only"],',
    '      "x_key": "x_value (scatter only)",',
    '      "y_key": "y_value (scatter only)",',
    '      "unit": "USD|%|count|etc",',
    '      "insight": "one sentence with specific segment names and numbers from pre-analysis",',
    '      "priority": 1',
    '    }',
    '  ]',
    '}',
    '',
    'Order by priority: KPI cards first (priority 1-8), then charts by insight value.',
    'Generate all KPI cards + all charts you deem insightful. Do not artificially limit.',
  ]

  var prompt = promptLines.join('\n')

  console.log('=== generate-queries: curCond=' + f.curCond)
  console.log('=== generate-queries: cmpCond=' + f.cmpCond)

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 6000,
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

    var queries = parsed.queries || parsed
    if (!Array.isArray(queries)) throw new Error('Expected queries array, got: ' + typeof queries)

    queries.sort(function(a, b) { return (a.priority || 99) - (b.priority || 99) })

    console.log('=== Queries generated: ' + queries.length)

    var usage = json.usage || {}
    return Response.json({
      queries:     queries,
      model:       'gpt-4o',
      metadata:    metaRows,
      timePeriod:  timePeriod,
      periodInfo:  { viewLabel: f.viewLabel, cmpLabel: f.cmpLabel },
      preAnalysis: preAnalysis,
      usage:       { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o' },
    })
  } catch (err) {
    console.error('generate-queries error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate queries.' }, { status: 500 })
  }
}
