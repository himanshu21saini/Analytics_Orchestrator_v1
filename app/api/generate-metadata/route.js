import { query } from '../../../lib/db'
import * as XLSX from 'xlsx'

// ── Column order for the output Excel ────────────────────────────────────────
// Matches the metadata format save-metadata expects.
// confidence + review_notes are extra columns for the user to review — they
// should be deleted before re-uploading. save-metadata ignores unknown columns.
var OUTPUT_COLUMNS = [
  'field_name',
  'type',
  'display_name',
  'data_type',
  'unit',
  'definition',
  'aggregation',
  'accumulation_type',
  'favorable_direction',
  'business_priority',
  'sample_values',
  'is_output',
  'confidence',     // high | medium | low  — DELETE before re-uploading
  'review_notes',   // LLM explanation of uncertainty — DELETE before re-uploading
]

export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })

  var body
  try { body = await request.json() } catch(e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var datasetId = body.datasetId
  if (!datasetId) return Response.json({ error: 'datasetId is required.' }, { status: 400 })

  // ── 1. Load dataset info + sample rows ───────────────────────────────────
  var dataset = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])
  if (!dataset.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })

  // Sample up to 50 rows for analysis — enough for the LLM to infer types
  var sampleRows = await query(
    'SELECT data FROM dataset_rows WHERE dataset_id = $1 LIMIT 50',
    [datasetId]
  )
  if (!sampleRows.length) return Response.json({ error: 'Dataset has no rows.' }, { status: 400 })

  var samples = sampleRows.map(function(r) { return r.data })

  // ── 2. Derive field summary from sample data ──────────────────────────────
  // Collect distinct values per field so the LLM has concrete examples
  var fieldSummary = {}
  samples.forEach(function(row) {
    Object.keys(row).forEach(function(k) {
      if (!fieldSummary[k]) fieldSummary[k] = { values: new Set(), numericCount: 0, totalCount: 0 }
      var v = row[k]
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        fieldSummary[k].values.add(String(v))
        fieldSummary[k].totalCount++
        if (!isNaN(parseFloat(v))) fieldSummary[k].numericCount++
      }
    })
  })

  // Convert to compact list for the prompt
  var fieldList = Object.keys(fieldSummary).map(function(k) {
    var s = fieldSummary[k]
    var vals = Array.from(s.values).slice(0, 5)
    var numericPct = s.totalCount > 0 ? Math.round((s.numericCount / s.totalCount) * 100) : 0
    return {
      field_name:   k,
      sample_values: vals.join(', '),
      numeric_pct:  numericPct,   // % of non-null values that are numeric
      distinct_count: s.values.size,
    }
  })

  // ── 3. Build LLM prompt ───────────────────────────────────────────────────
  var prompt = [
    '## ROLE',
    'You are a senior BI analyst examining a new dataset to produce metadata for an AI analytics platform.',
    'Analyse every field and produce a complete, accurate metadata entry for each.',
    '',
    '## DATASET NAME',
    dataset[0].name,
    '',
    '## FIELD SUMMARY (field name, sample values, % numeric, distinct count)',
    JSON.stringify(fieldList, null, 2),
    '',
    '## SAMPLE ROWS (first 5)',
    JSON.stringify(samples.slice(0, 5), null, 2),
    '',
    '## OUTPUT SPECIFICATION',
    'Return a JSON array — one object per field. Use ONLY these keys:',
    '',
    'field_name         — exact field name from the data (no changes)',
    'type               — one of: kpi | derived_kpi | dimension | datetime | year_month | id',
    '                     kpi         = measurable numeric metric (revenue, count, score)',
    '                     derived_kpi = calculated from other fields (ratio, rate, margin)',
    '                     dimension   = categorical grouping (name, region, type, status)',
    '                     datetime    = date or timestamp field',
    '                     year_month  = integer year or month field used for time filtering',
    '                     id          = unique identifier — exclude from analysis',
    'display_name       — human-friendly label (Title Case, spaces instead of underscores)',
    'data_type          — Integer | Float | String | Date | Boolean',
    'unit               — USD | % | Seconds | Minutes | Count | Score | or blank',
    'definition         — one clear sentence explaining what this field measures',
    'aggregation        — SUM | AVG | COUNT | MAX | MIN | COUNT_DISTINCT',
    '                     Use AVG for rates, ratios, scores, indices',
    '                     Use SUM for counts, amounts, durations that accumulate',
    '                     Use COUNT_DISTINCT for unique entity counts',
    'accumulation_type  — cumulative | point_in_time',
    '                     cumulative    = adds up over time (transactions, revenue, new customers)',
    '                     point_in_time = snapshot at a moment (balance, ratio, score, index)',
    'favorable_direction — i (increase is good) | d (decrease is good) | blank if not applicable',
    'business_priority  — High | Medium | Low',
    'sample_values      — 3-5 representative values from the data, comma separated',
    'is_output          — Y (show in dashboard) | N (internal/helper field, exclude from analysis)',
    '                     Mark as N: sort order fields, internal flags, helper columns, raw IDs',
    '                     Mark as Y: everything a business user would want to see or filter by',
    'confidence         — high | medium | low',
    '                     high   = you are certain about all fields',
    '                     medium = one or two fields you inferred but are not sure about',
    '                     low    = significant uncertainty — multiple fields need human review',
    'review_notes       — if confidence is medium or low, explain specifically what you are unsure',
    '                     about and what the user should verify. Empty string if confidence = high.',
    '',
    '## RULES',
    '1. Return ONLY a JSON array. No markdown, no explanation outside the array.',
    '2. Every field in the dataset must appear in the output — do not skip any.',
    '3. For year/month integer fields: use type=year_month.',
    '4. For score/index fields that range 0-N: type=kpi, accumulation_type=point_in_time, aggregation=AVG.',
    '5. For sort order / sequence number fields: is_output=N.',
    '6. For fields where the definition is genuinely ambiguous, set confidence=low and explain in review_notes.',
    '7. Do not invent field names — use the exact field_name from the input.',
  ].join('\n')

  // ── 4. Call LLM ──────────────────────────────────────────────────────────
  var llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:           'gpt-4o',
      max_tokens:      4000,
      temperature:     0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role:    'system',
          content: 'You are a senior BI analyst. You MUST return a JSON object with exactly one key called "fields". The value must be an array of metadata objects, one per field. Example: { "fields": [ { "field_name": "revenue", "type": "kpi", ... } ] }. No markdown. No explanation. Only the JSON object.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })

  var llmJson = await llmResponse.json()
  if (!llmResponse.ok) {
    var errMsg = llmJson.error && llmJson.error.message ? llmJson.error.message : 'OpenAI error ' + llmResponse.status
    return Response.json({ error: errMsg }, { status: 500 })
  }

  var content = llmJson.choices && llmJson.choices[0] && llmJson.choices[0].message && llmJson.choices[0].message.content
  if (!content) return Response.json({ error: 'Empty response from LLM.' }, { status: 500 })

 var parsed
  try {
    var cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch(e) {
    // Log the raw response to Vercel logs so you can see what came back
    console.error('LLM raw response:', content.slice(0, 500))
    return Response.json({ error: 'Could not parse LLM response as JSON. Check Vercel logs for raw output.' }, { status: 500 })
  }

  // Handle all the ways the LLM might wrap the array
  var fields = null
  if (Array.isArray(parsed)) {
    fields = parsed
  } else if (parsed.fields && Array.isArray(parsed.fields)) {
    fields = parsed.fields
  } else if (parsed.metadata && Array.isArray(parsed.metadata)) {
    fields = parsed.metadata
  } else {
    // Last resort — find the first array value in the object
    var keys = Object.keys(parsed)
    for (var ki = 0; ki < keys.length; ki++) {
      if (Array.isArray(parsed[keys[ki]])) { fields = parsed[keys[ki]]; break }
    }
  }

  if (!fields || !fields.length) {
    console.error('Parsed object keys:', Object.keys(parsed))
    return Response.json({ error: 'LLM returned no fields. Check Vercel logs.' }, { status: 500 })
  }


  // ── 5. Build Excel ────────────────────────────────────────────────────────
  var wb = XLSX.utils.book_new()

  // Main metadata sheet
  var rows = fields.map(function(f) {
    var row = {}
    OUTPUT_COLUMNS.forEach(function(col) {
      row[col] = f[col] !== undefined && f[col] !== null ? f[col] : ''
    })
    return row
  })

  var ws = XLSX.utils.json_to_sheet(rows, { header: OUTPUT_COLUMNS })

  // Style header row — make it obvious confidence + review_notes should be deleted
  // xlsx doesn't support rich cell styling without xlsx-js-style, so we add a
  // "INSTRUCTIONS" row at the top as the clearest possible guidance
  var instructionRow = {}
  OUTPUT_COLUMNS.forEach(function(col) {
    if (col === 'confidence') {
      instructionRow[col] = '← REVIEW these rows'
    } else if (col === 'review_notes') {
      instructionRow[col] = '← DELETE both columns before re-uploading'
    } else {
      instructionRow[col] = ''
    }
  })

  // Insert instruction row at top (before data rows)
  var wsWithInstructions = XLSX.utils.json_to_sheet(
    [instructionRow].concat(rows),
    { header: OUTPUT_COLUMNS }
  )

  XLSX.utils.book_append_sheet(wb, wsWithInstructions, 'Metadata')

  // Summary sheet — count by confidence level so user knows what to review
  var highCount   = fields.filter(function(f) { return f.confidence === 'high' }).length
  var mediumCount = fields.filter(function(f) { return f.confidence === 'medium' }).length
  var lowCount    = fields.filter(function(f) { return f.confidence === 'low' }).length
  var flagged     = fields.filter(function(f) { return f.confidence !== 'high' })

  var summaryRows = [
    { item: 'Total fields', value: fields.length },
    { item: 'High confidence (no review needed)', value: highCount },
    { item: 'Medium confidence (review recommended)', value: mediumCount },
    { item: 'Low confidence (review required)', value: lowCount },
    { item: '', value: '' },
    { item: 'FIELDS TO REVIEW', value: 'NOTES' },
  ].concat(
    flagged.map(function(f) {
      return { item: f.field_name + '  [' + f.confidence + ']', value: f.review_notes || '' }
    })
  )

  var wsSummary = XLSX.utils.json_to_sheet(summaryRows, { header: ['item', 'value'], skipHeader: true })
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Review Summary')

  // ── 6. Return Excel as base64 ─────────────────────────────────────────────
  var buffer   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  var base64   = Buffer.from(buffer).toString('base64')
  var filename = (dataset[0].name || 'dataset').replace(/[^a-zA-Z0-9]/g, '_') + '_metadata_draft.xlsx'

  // Count flagged for client to show in UI
  return Response.json({
    base64,
    filename,
    fieldCount:  fields.length,
    flaggedCount: mediumCount + lowCount,
    highCount,
    mediumCount,
    lowCount,
    model: 'gpt-4o',
  })
}
