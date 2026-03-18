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

  // Max 8 KPI cards shown (4 per row × 2 rows) — pick highest priority
  var topKpis  = kpis.slice(0, 6)
  var topDerived = derived.slice(0, 4)

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

  // Concrete SQL templates with actual values filled in
  var tplSum = 'SELECT SUM(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__FIELD__\')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN ' + f.cmpCond + ' THEN COALESCE((data->>\'__FIELD__\')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = ' + datasetId

  var tplAvg = 'SELECT AVG(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__FIELD__\')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN ' + f.cmpCond + ' THEN COALESCE((data->>\'__FIELD__\')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = ' + datasetId

  var tplBar = 'SELECT data->>\'__DIM__\' AS label, SUM(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__KPI__\')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN ' + f.cmpCond + ' THEN COALESCE((data->>\'__KPI__\')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = ' + datasetId + ' GROUP BY label ORDER BY current_value DESC LIMIT 10'

  var tplLine = 'SELECT CONCAT(data->>\'year\',\'-\',LPAD(CAST((data->>\'month\')::integer AS TEXT),2,\'0\')) AS period, __AGG__(COALESCE((data->>\'__KPI__\')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = ' + datasetId + ' AND (data->>\'year\')::integer = ' + f.curYear + ' GROUP BY period ORDER BY period ASC'

  var tplPie = 'SELECT data->>\'__DIM__\' AS label, __AGG__(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__KPI__\')::numeric,0) ELSE 0 END) AS value FROM dataset_rows WHERE dataset_id = ' + datasetId + ' GROUP BY label ORDER BY value DESC LIMIT 6'

  var tplScatter = 'SELECT data->>\'__DIM__\' AS label, AVG(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__KPI1__\')::numeric,0) ELSE NULL END) AS x_value, AVG(CASE WHEN ' + f.curCond + ' THEN COALESCE((data->>\'__KPI2__\')::numeric,0) ELSE NULL END) AS y_value FROM dataset_rows WHERE dataset_id = ' + datasetId + ' AND ' + f.curCond + ' GROUP BY label'

  var tplArea = 'SELECT CONCAT(data->>\'year\',\'-\',LPAD(CAST((data->>\'month\')::integer AS TEXT),2,\'0\')) AS period, SUM(COALESCE((data->>\'__KPI__\')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = ' + datasetId + ' AND (data->>\'year\')::integer = ' + f.curYear + ' GROUP BY period ORDER BY period ASC'

  var systemMsg = 'You are a senior banking BI analyst and SQL engineer. Return only valid JSON. CRITICAL SQL RULE: current_value uses year=' + f.curYear + ' and comparison_value uses year=' + f.cmpYear + '. These are DIFFERENT years. Use CASE WHEN to split them. Never use IN. Never repeat the same condition in both columns.'

  var promptLines = [
    '## ROLE',
    'You are a senior banking BI analyst. Your job is to design the most insightful dashboard possible by intelligently selecting which KPIs to surface, which dimensions to break them by, and which chart type best communicates each insight.',
    '',
    '## DATABASE',
    'Table: dataset_rows | data column is JSONB',
    'Text: data->>\'field\' | Numeric: COALESCE((data->>\'field\')::numeric, 0)',
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
    '## YOUR INTELLIGENT DESIGN TASK',
    '',
    'STEP 1 — KPI Cards (max 8 total, 4 per row × 2 rows):',
    '  - Generate one kpi card for EACH of the top-priority KPI and derived_kpi fields',
    '  - Cap at 8 total KPI cards — prioritise by business_priority (High first)',
    '  - Use T-SUM for cumulative fields, T-AVG for point_in_time fields',
    '',
    'STEP 2 — Charts (generate 8-12 charts, you decide the mix):',
    '  - For each chart you design, ask: "What insight does this reveal for a banking executive?"',
    '  - Choose chart type based on what communicates the data best:',
    '    bar      → compare a KPI across categories (best with 4-10 categories, with comparison bars)',
    '    line     → show trend over time (best for cumulative flow metrics)',
    '    area     → show trend with visual weight (best for revenue/profit over time)',
    '    donut    → show distribution/share (best for segment mix, top 5-6 slices)',
    '    pie      → similar to donut, use when there are fewer than 5 categories',
    '    stacked_bar → show composition over time (e.g. revenue by segment by month)',
    '    scatter  → reveal correlation between two ratio/rate KPIs (e.g. NIM vs Cost-to-Income)',
    '',
    '  - Choose KPI × Dimension combinations that tell a story:',
    '    Good combos: Revenue by Region, NPA Ratio by Segment, Cost-to-Income by Region',
    '    Avoid: ID fields as axes, duplicate insights already shown in KPI cards',
    '',
    '  - Prioritise insights that would alert an executive to risks or opportunities',
    '  - Include at least 2 trend charts (line or area) for the most important flow metrics',
    '  - Include at least 1 scatter if two ratio KPIs exist (e.g. NIM vs ROE)',
    '  - Include at least 2 dimension breakdowns (bar) for top revenue/profit KPIs',
    '',
    '## OUTPUT FORMAT — JSON only, no markdown',
    '{',
    '  "queries": [',
    '    {',
    '      "id": "string (snake_case unique)",',
    '      "title": "string (executive-friendly, e.g. Net Interest Income by Region)",',
    '      "chart_type": "kpi|bar|line|area|pie|donut|stacked_bar|scatter",',
    '      "sql": "string (complete valid SQL, no placeholders)",',
    '      "current_key": "current_value (for kpi/bar — column with current period value)",',
    '      "comparison_key": "comparison_value (for kpi/bar — column with prior period value)",',
    '      "value_key": "value or current_value (main numeric alias)",',
    '      "label_key": "label or period (category/time alias)",',
    '      "series_keys": ["array", "for", "stacked_bar", "only"],',
    '      "x_key": "x_value (scatter only)",',
    '      "y_key": "y_value (scatter only)",',
    '      "unit": "USD|%|count|etc",',
    '      "insight": "one sentence: what executive insight this chart reveals",',
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
        model: 'gpt-4o-mini',
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

    return Response.json({
      queries:    queries,
      model:      'gpt-4o-mini',
      metadata:   metaRows,
      timePeriod: timePeriod,
      periodInfo: { viewLabel: f.viewLabel, cmpLabel: f.cmpLabel },
    })
  } catch (err) {
    console.error('generate-queries error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate queries.' }, { status: 500 })
  }
}
