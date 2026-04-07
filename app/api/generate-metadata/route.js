import * as XLSX from 'xlsx'
import { query } from '../../../lib/db'

export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY not set.' }, { status: 500 })

  var body
  try { body = await request.json() } catch(e) { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }) }

  var datasetId = body.datasetId
  if (!datasetId) return Response.json({ error: 'datasetId is required.' }, { status: 400 })

  var tbl = 'ds_' + datasetId

  // ── Load dataset_format from datasets row ─────────────────────────────────
  var dsRow
  try {
    dsRow = await query('SELECT dataset_format FROM datasets WHERE id = $1', [datasetId])
  } catch(e) {
    return Response.json({ error: 'Could not read dataset record: ' + e.message }, { status: 500 })
  }
  if (!dsRow.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })

  var datasetFormat = dsRow[0].dataset_format
  if (typeof datasetFormat === 'string') {
    try { datasetFormat = JSON.parse(datasetFormat) } catch(e) { datasetFormat = null }
  }
  var format = (datasetFormat && datasetFormat.format) || 'wide'

  // ── Branch ────────────────────────────────────────────────────────────────
  if (format === 'long_hierarchical') {
    return await generateLongFormatMetadata(tbl, datasetFormat, apiKey)
  }
  return await generateWideFormatMetadata(tbl, apiKey)
}

// ═══════════════════════════════════════════════════════════════════════════
// WIDE FORMAT (unchanged from existing implementation)
// ═══════════════════════════════════════════════════════════════════════════
async function generateWideFormatMetadata(tbl, apiKey) {
  var sampleRows = []
  var columns    = []
  try {
    sampleRows = await query('SELECT * FROM ' + tbl + ' LIMIT 10')
    if (sampleRows.length) columns = Object.keys(sampleRows[0])
  } catch(e) {
    return Response.json({ error: 'Could not read dataset table ' + tbl + '. ' + e.message }, { status: 404 })
  }
  if (!columns.length) return Response.json({ error: 'Dataset table is empty.' }, { status: 400 })

  var colSummary = columns.map(function(col) {
    var vals = sampleRows.map(function(r) { return r[col] }).filter(function(v) { return v !== null && v !== undefined })
    var unique = Array.from(new Set(vals.map(String))).slice(0, 5)
    return { field_name: col, sample_values: unique.join(', ') }
  })

  var prompt = [
    '## TASK',
    'Generate metadata for each field in this dataset. Return one row per field.',
    '',
    '## DATASET FIELDS WITH SAMPLE VALUES',
    JSON.stringify(colSummary, null, 2),
    '',
    '## OUTPUT FORMAT — JSON object only',
    'Return a JSON object with a single key "fields" containing an array. Each element has exactly these keys:',
    '{',
    '  "field_name": "exact field name from input",',
    '  "display_name": "human-friendly name e.g. Branch Name",',
    '  "type": "kpi | derived_kpi | dimension | year_month",',
    '  "data_type": "Integer | Float | String | Date",',
    '  "unit": "USD | % | count | Sec | days | (empty if none)",',
    '  "definition": "clear business definition of this field",',
    '  "aggregation": "SUM | AVG | COUNT | COUNT_DISTINCT | MAX | MIN | (empty for dimensions)",',
    '  "accumulation_type": "cumulative | point_in_time | (empty for dimensions)",',
    '  "is_output": "Y | N",',
    '  "favorable_direction": "i | d | (empty for dimensions)",',
    '  "business_priority": "High | Medium | Low",',
    '  "calculation_logic": "(formula for derived_kpi only, else empty)",',
    '  "dependencies": "(source fields for derived_kpi only, else empty)",',
    '  "sample_values": "comma-separated sample values",',
    '  "confidence": "high | medium | low",',
    '  "review_notes": "(explanation if confidence is not high, else empty)"',
    '}',
    '',
    '## CLASSIFICATION RULES',
    'type = "kpi": a measurable numeric metric (revenue, count, score)',
    'type = "derived_kpi": a calculated metric from other fields (ratio, rate, average)',
    'type = "dimension": a categorical/descriptive field (name, region, type, date label)',
    'type = "year_month": a year or month integer field used for time filtering',
    'is_output = "N": internal/technical fields the user would not want to see (sort orders, flags, IDs used only for joining)',
    'favorable_direction = "i": higher is better (revenue, customers, score if higher=better)',
    'favorable_direction = "d": lower is better (cost, idle time, wait time, error rate)',
    'For year_month fields: aggregation and accumulation_type should be empty, is_output = Y',
    '',
    '## IMPORTANT',
    'Return ONLY {"fields": [...]}. No markdown. No explanation. No preamble.',
    'Every field from the input must appear in the output exactly once.',
    'field_name must exactly match the input field name.',
  ].join('\n')

  var response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', max_tokens: 8000, temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a senior BI analyst. Generate precise metadata. Return valid JSON only.' },
        { role: 'user',   content: prompt },
      ],
    }),
  })
  var json = await response.json()
  if (!response.ok) return Response.json({ error: (json.error && json.error.message) || 'OpenAI error.' }, { status: 500 })

  var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
  if (!content) return Response.json({ error: 'Empty response from OpenAI.' }, { status: 500 })

  var parsed
  try { parsed = JSON.parse(content.replace(/```json|```/g, '').trim()) }
  catch(e) { return Response.json({ error: 'Could not parse metadata response.' }, { status: 500 }) }

  var fields = parsed.fields || parsed.metadata || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0])
  if (!Array.isArray(fields)) return Response.json({ error: 'Expected array of fields from LLM.' }, { status: 500 })

  var mainCols = ['field_name','display_name','type','data_type','unit','definition','aggregation',
    'accumulation_type','is_output','favorable_direction','business_priority',
    'calculation_logic','dependencies','sample_values']
  var reviewCols = [...mainCols, 'confidence', 'review_notes']

  var mainRows = fields.map(function(f) {
    var row = {}; mainCols.forEach(function(c) { row[c] = f[c] !== undefined ? f[c] : '' }); return row
  })
  var reviewRows = fields.map(function(f) {
    var row = {}; reviewCols.forEach(function(c) { row[c] = f[c] !== undefined ? f[c] : '' }); return row
  })

  var flaggedCount = fields.filter(function(f) { return f.confidence && f.confidence !== 'high' }).length

  var wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mainRows),   'Metadata')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reviewRows), 'Review Summary')

  var buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  var base64   = Buffer.from(buf).toString('base64')
  var filename = 'metadata_' + tbl + '_' + Date.now() + '.xlsx'

  return Response.json({ base64, filename, fieldCount: fields.length, flaggedCount, format: 'wide' })
}

// ═══════════════════════════════════════════════════════════════════════════
// LONG HIERARCHICAL FORMAT (new)
// ═══════════════════════════════════════════════════════════════════════════
async function generateLongFormatMetadata(tbl, datasetFormat, apiKey) {
  var hierCols = datasetFormat.hierarchyColumns || []
  var dimCols  = datasetFormat.dimensionColumns || []
  if (hierCols.length < 2) {
    return Response.json({ error: 'Long format dataset has fewer than 2 hierarchy columns. Re-confirm format.' }, { status: 400 })
  }

  // ── Step 1: Enumerate all unique hierarchy combinations ─────────────────
  var distinctSql = 'SELECT DISTINCT ' + hierCols.join(', ') + ' FROM ' + tbl +
                    ' WHERE ' + hierCols.map(function(c) { return c + ' IS NOT NULL' }).join(' AND ')
  var distinctRows
  try { distinctRows = await query(distinctSql) }
  catch(e) { return Response.json({ error: 'Could not enumerate hierarchy: ' + e.message }, { status: 500 }) }

  if (!distinctRows.length) return Response.json({ error: 'No hierarchy rows found in dataset.' }, { status: 400 })

  // ── Step 2: Build the full set of nodes (L1, L2, L3, ...) ───────────────
  var nodeMap = {}
  distinctRows.forEach(function(row) {
    var pathParts = []
    for (var i = 0; i < hierCols.length; i++) {
      var val = row[hierCols[i]]
      if (val === null || val === undefined || String(val).trim() === '') break
      pathParts.push(String(val))
      var path        = pathParts.join(' > ')
      var parentPath  = pathParts.length > 1 ? pathParts.slice(0, -1).join(' > ') : null
      var isLeafLevel = (i === hierCols.length - 1) ||
                        (row[hierCols[i + 1]] === null || row[hierCols[i + 1]] === undefined)
      if (!nodeMap[path]) {
        nodeMap[path] = {
          node_path:   path,
          node_name:   pathParts[pathParts.length - 1],
          level:       i + 1,
          parent_path: parentPath,
          is_leaf:     isLeafLevel,
        }
      } else if (isLeafLevel) {
        nodeMap[path].is_leaf = true
      }
    }
  })

  var allNodes = Object.values(nodeMap).sort(function(a, b) {
    if (a.level !== b.level) return a.level - b.level
    return a.node_path.localeCompare(b.node_path)
  })

  // ── Step 3: Sample dimension columns for the second sheet ───────────────
  var dimSummary = []
  if (dimCols.length) {
    try {
      var dimSampleRows = await query('SELECT DISTINCT ' + dimCols.join(', ') + ' FROM ' + tbl + ' LIMIT 200')
      dimCols.forEach(function(col) {
        var unique = {}
        dimSampleRows.forEach(function(r) {
          var v = r[col]
          if (v !== null && v !== undefined && String(v).trim() !== '') unique[String(v)] = true
        })
        dimSummary.push({ field_name: col, sample_values: Object.keys(unique).slice(0, 20) })
      })
    } catch(e) {
      // Non-fatal — just skip dim sampling
      dimCols.forEach(function(col) { dimSummary.push({ field_name: col, sample_values: [] }) })
    }
  }

  // ── Step 4: LLM enrichment for hierarchy + dimensions ───────────────────
  var treeForPrompt = allNodes.map(function(n) {
    return { path: n.node_path, level: n.level, is_leaf: n.is_leaf }
  })

  var prompt = [
    '## TASK',
    'Generate metadata for a hierarchical KPI tree from a financial/BI dataset.',
    'Some categories represent balance sheet items (point-in-time stocks) and others',
    'represent income statement items (period flows). Use accumulation_type accordingly:',
    '  - Stocks (Assets, Liabilities, Equity, Loans, Deposits): point_in_time',
    '  - Flows (Revenue, Income, Expenses, Tax, NIX): cumulative',
    '',
    'For every node, provide a display_name, definition, and accumulation_type.',
    'For LEVEL 1 nodes only, also provide favorable_direction, business_priority, and unit.',
    'For descendants whose nature DIFFERS from their parent (e.g. an expense line under Revenue,',
    'or an asset that is bad to have like NPLs), set favorable_direction explicitly and add a',
    'review_note explaining why. All other descendants leave favorable_direction empty (they inherit).',
    '',
    'ALSO generate metadata for the dimension columns listed below.',
    '',
    '## TREE NODES',
    JSON.stringify(treeForPrompt, null, 2),
    '',
    '## DIMENSION COLUMNS',
    JSON.stringify(dimSummary, null, 2),
    '',
    '## OUTPUT — JSON object with two keys: "nodes" and "dimensions"',
    '"nodes" is an array. Each element has exactly:',
    '{',
    '  "node_path": "exact path from input",',
    '  "display_name": "clean human-readable name",',
    '  "definition": "one-line business definition",',
    '  "accumulation_type": "cumulative | point_in_time",',
    '  "favorable_direction": "i | d | (empty to inherit)",',
    '  "business_priority": "High | Medium | Low | (empty to inherit)",',
    '  "unit": "USD | % | count | (empty to inherit)",',
    '  "review_notes": "(only fill if override or ambiguous, else empty)"',
    '}',
    '',
    '"dimensions" is an array. Each element has exactly:',
    '{',
    '  "field_name": "exact dimension column name from input",',
    '  "display_name": "clean human-readable name",',
    '  "definition": "one-line business definition",',
    '  "sample_values": "comma-separated sample values",',
    '  "mandatory_filter_value": "(LEAVE EMPTY — user fills this in manually)",',
    '  "review_notes": "(suggest if user should likely set a mandatory filter, e.g. statement_type)"',
    '}',
    '',
    '## RULES',
    '1. Every input node and dimension must appear in output exactly once.',
    '2. node_path / field_name must match input exactly.',
    '3. L1 nodes: ALWAYS set favorable_direction, business_priority, unit.',
    '4. L2/L3+ nodes: leave favorable_direction empty UNLESS it differs from parent.',
    '5. ALWAYS leave mandatory_filter_value empty for dimensions — the user fills it.',
    '6. If a dimension looks like it should have a mandatory filter (e.g. mixing Balance Sheet + P&L, mixing Actual + Plan + Forecast, multiple forecast versions), add a review_note suggesting it.',
    '7. If an L1 direction is genuinely ambiguous (e.g. Liabilities), leave favorable_direction empty and add a review_note.',
    '8. Return ONLY {"nodes": [...], "dimensions": [...]}. No markdown. No preamble.',
  ].join('\n')

  var response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', max_tokens: 8000, temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a senior finance/BI analyst. Generate precise hierarchy metadata. Return valid JSON only.' },
        { role: 'user',   content: prompt },
      ],
    }),
  })
  var json = await response.json()
  if (!response.ok) return Response.json({ error: (json.error && json.error.message) || 'OpenAI error.' }, { status: 500 })

  var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
  if (!content) return Response.json({ error: 'Empty response from OpenAI.' }, { status: 500 })

  var parsed
  try { parsed = JSON.parse(content.replace(/```json|```/g, '').trim()) }
  catch(e) { return Response.json({ error: 'Could not parse LLM response.' }, { status: 500 }) }

  var llmNodes      = parsed.nodes      || []
  var llmDimensions = parsed.dimensions || []
  if (!Array.isArray(llmNodes))      return Response.json({ error: 'Expected "nodes" array from LLM.' }, { status: 500 })
  if (!Array.isArray(llmDimensions)) llmDimensions = []

  var llmNodesByPath = {}
  llmNodes.forEach(function(n) { if (n.node_path) llmNodesByPath[n.node_path] = n })
  var llmDimsByName = {}
  llmDimensions.forEach(function(d) { if (d.field_name) llmDimsByName[d.field_name] = d })

  // ── Step 5: Merge structural nodes with LLM enrichment ──────────────────
  var hierarchyRows = allNodes.map(function(n) {
    var enrich = llmNodesByPath[n.node_path] || {}
    return {
      node_path:           n.node_path,
      level:               n.level,
      display_name:        enrich.display_name        || n.node_name,
      definition:          enrich.definition          || '',
      accumulation_type:   enrich.accumulation_type   || '',
      favorable_direction: enrich.favorable_direction || '',
      business_priority:   enrich.business_priority   || '',
      unit:                enrich.unit                || '',
      review_notes:        enrich.review_notes        || '',
    }
  })

  var dimensionRows = dimSummary.map(function(d) {
    var enrich = llmDimsByName[d.field_name] || {}
    return {
      field_name:             d.field_name,
      display_name:           enrich.display_name           || d.field_name,
      definition:             enrich.definition             || '',
      sample_values:          enrich.sample_values          || d.sample_values.join(', '),
      mandatory_filter_value: '',  // ALWAYS blank — user fills in
      review_notes:           enrich.review_notes           || '',
    }
  })

  var flaggedCount = hierarchyRows.filter(function(r) { return r.review_notes && String(r.review_notes).trim() }).length +
                     dimensionRows.filter(function(r) { return r.review_notes && String(r.review_notes).trim() }).length

  // ── Step 6: Build Excel with two sheets + tree view ─────────────────────
  var wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hierarchyRows), 'Hierarchy Metadata')
  if (dimensionRows.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dimensionRows), 'Dimensions')
  }


  var buf      = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  var base64   = Buffer.from(buf).toString('base64')
  var filename = 'hierarchy_metadata_' + tbl + '_' + Date.now() + '.xlsx'

  return Response.json({
    base64, filename,
    fieldCount: hierarchyRows.length + dimensionRows.length,
    flaggedCount,
    format: 'long_hierarchical',
  })
}
