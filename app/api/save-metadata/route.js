import * as XLSX from 'xlsx'
import { execute, query } from '../../../lib/db'

export async function POST(request) {
  try {
    var formData = await request.formData()
    var file = formData.get('file')
    var metaName = formData.get('name') || file.name
    if (!file) return Response.json({ error: 'No file provided.' }, { status: 400 })

    var arrayBuffer = await file.arrayBuffer()
    var buffer = Buffer.from(arrayBuffer)
    var wb = file.name.toLowerCase().endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
      : XLSX.read(buffer, { type: 'buffer' })

    // ── Detect format by sheet presence ───────────────────────────────────
    var sheetNames = wb.SheetNames.map(function(s) { return s.toLowerCase() })
    var isLongFormat = sheetNames.indexOf('hierarchy metadata') !== -1

    if (isLongFormat) return await saveLongFormat(wb, metaName)
    return await saveWideFormat(wb, metaName)
  } catch (err) {
    console.error('save-metadata error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

function getVal(row, key) {
  var found = Object.keys(row).find(function(k) { return k.toLowerCase().trim() === key })
  return found ? (row[found] !== undefined && row[found] !== null ? row[found] : null) : null
}

async function upsertMetadataSet(metaName, datasetFormat) {
  // Ensure the column exists (cheap idempotent check)
  await execute("ALTER TABLE metadata_sets ADD COLUMN IF NOT EXISTS dataset_format TEXT DEFAULT 'wide'", [])

  var existing = await query('SELECT id FROM metadata_sets WHERE name = $1', [metaName])
  var setId
  var isReplacement = false
  if (existing.length > 0) {
    setId = existing[0].id
    isReplacement = true
    await execute('DELETE FROM metadata_rows  WHERE metadata_set_id = $1', [setId])
    await execute('DELETE FROM hierarchy_nodes WHERE metadata_set_id = $1', [setId])
    await execute('UPDATE metadata_sets SET uploaded_at = NOW(), dataset_format = $1 WHERE id = $2', [datasetFormat, setId])
  } else {
    var result = await query('INSERT INTO metadata_sets (name, dataset_format) VALUES ($1, $2) RETURNING id', [metaName, datasetFormat])
    setId = result[0].id
  }
  return { setId: setId, isReplacement: isReplacement }
}

// ═══════════════════════════════════════════════════════════════════════════
// WIDE FORMAT (existing behavior)
// ═══════════════════════════════════════════════════════════════════════════
async function saveWideFormat(wb, metaName) {
  var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
  if (!rows.length) return Response.json({ error: 'Metadata file is empty.' }, { status: 400 })

  var keys = Object.keys(rows[0]).map(function(k) { return k.toLowerCase().trim() })
  var required = ['field_name', 'type', 'display_name']
  for (var i = 0; i < required.length; i++) {
    if (keys.indexOf(required[i]) === -1) {
      return Response.json({
        error: 'Missing required column: "' + required[i] + '". Required: field_name, type, display_name'
      }, { status: 400 })
    }
  }

  var setInfo = await upsertMetadataSet(metaName, 'wide')
  var setId = setInfo.setId
  var isReplacement = setInfo.isReplacement

  function inferUnit(row) {
    var unit = getVal(row, 'unit')
    if (unit) return unit
    var fn = String(getVal(row, 'field_name') || '').toLowerCase()
    var sv = String(getVal(row, 'sample_values') || '')
    if (sv.includes('%') || /margin|rate|ratio|percent|pct|share|growth|yield|nim|roe|roa|npa|casa/i.test(fn)) return '%'
    if (sv.includes('$') || /revenue|income|profit|loss|cost|expense|fee|provision|nii|aum|loan|deposit|amount|value|spend|budget/i.test(fn)) return 'USD'
    if (/count|number|num|qty|quantity|units|orders|customers|transactions|accounts/i.test(fn)) return 'count'
    if (/days|duration|age|lag|lead/i.test(fn)) return 'days'
    return ''
  }

  function inferTimeGrain(row) {
    var grain = getVal(row, 'time_grain')
    if (grain) return grain
    var type = String(getVal(row, 'type') || '').toLowerCase()
    if (type !== 'datetime' && type !== 'year_month') return null
    var fn = String(getVal(row, 'field_name') || '').toLowerCase()
    if (/year/.test(fn) && /month/.test(fn)) return 'monthly'
    if (/year/.test(fn)) return 'yearly'
    if (/month/.test(fn)) return 'monthly'
    if (/quarter|qtr/.test(fn)) return 'quarterly'
    return 'monthly'
  }

  function inferAccumulationType(row) {
    var acc = getVal(row, 'accumulation_type')
    if (acc) return String(acc).toLowerCase().trim()
    var fn   = String(getVal(row, 'field_name') || '').toLowerCase()
    var type = String(getVal(row, 'type') || '').toLowerCase()
    if (type === 'derived_kpi') return 'point_in_time'
    if (/deposit|balance|outstanding|aum|asset|liability|equity|total_customer|customer_count/i.test(fn)) return 'point_in_time'
    if (/ratio|rate|margin|nim|roe|roa|npa|casa|yield|score|index|pct|percent/i.test(fn)) return 'point_in_time'
    if (/revenue|income|profit|loss|expense|cost|fee|provision|disbursed|new_customer|churn|transaction|sale|units_sold/i.test(fn)) return 'cumulative'
    return 'cumulative'
  }

  var savedCount = 0
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j]
    var fieldName = getVal(r, 'field_name')
    if (!fieldName) continue
    await execute(`INSERT INTO metadata_rows (
        metadata_set_id, field_name, display_name, type, data_type,
        unit, definition, aggregation, calculation_logic, dependencies,
        sample_values, business_priority, filters_applicable, time_grain,
        benchmark, accumulation_type, is_output, favorable_direction,
        mandatory_filter_value
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        setId,
        String(fieldName),
        getVal(r, 'display_name'),
        getVal(r, 'type'),
        getVal(r, 'data_type'),
        inferUnit(r),
        getVal(r, 'definition'),
        getVal(r, 'aggregation'),
        getVal(r, 'calculation_logic'),
        getVal(r, 'dependencies'),
        getVal(r, 'sample_values'),
        getVal(r, 'business_priority'),
        getVal(r, 'filters_applicable'),
        inferTimeGrain(r),
        getVal(r, 'benchmark'),
        inferAccumulationType(r),
        (function() { var v = getVal(r, 'is_output'); return (v && v.toString().trim().toUpperCase() === 'N') ? 'N' : 'Y' })(),
        (function() { var v = getVal(r, 'favorable_direction'); if (!v) return null; var s = v.toString().trim().toLowerCase(); return (s === 'd') ? 'd' : 'i' })(),
        getVal(r, 'mandatory_filter_value'),
      ]
    )
    savedCount++
  }

  return Response.json({
    message: isReplacement
      ? savedCount + ' metadata rows replaced for "' + metaName + '".'
      : savedCount + ' metadata rows saved.',
    replaced: isReplacement,
    format: 'wide',
    metadataSet: { id: setId, name: metaName, row_count: savedCount }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// LONG HIERARCHICAL FORMAT (new)
// ═══════════════════════════════════════════════════════════════════════════
async function saveLongFormat(wb, metaName) {
  // ── Find both sheets by case-insensitive match ──────────────────────────
  var hierSheetName = wb.SheetNames.find(function(s) { return s.toLowerCase() === 'hierarchy metadata' })
  var fieldSheetName = wb.SheetNames.find(function(s) { return s.toLowerCase() === 'fields' })
  if (!hierSheetName) return Response.json({ error: 'Missing "Hierarchy Metadata" sheet.' }, { status: 400 })
  if (!fieldSheetName) return Response.json({ error: 'Missing "Fields" sheet.' }, { status: 400 })

  var hierRows  = XLSX.utils.sheet_to_json(wb.Sheets[hierSheetName],  { defval: null })
  var fieldRows = XLSX.utils.sheet_to_json(wb.Sheets[fieldSheetName], { defval: null })
  if (!hierRows.length) return Response.json({ error: 'Hierarchy Metadata sheet is empty.' }, { status: 400 })
  if (!fieldRows.length) return Response.json({ error: 'Fields sheet is empty.' }, { status: 400 })

  // ── Validate required columns ──────────────────────────────────────────
  var hierKeys = Object.keys(hierRows[0]).map(function(k) { return k.toLowerCase().trim() })
  if (hierKeys.indexOf('node_path') === -1) {
    return Response.json({ error: 'Hierarchy Metadata sheet missing "node_path" column.' }, { status: 400 })
  }
  if (hierKeys.indexOf('level') === -1) {
    return Response.json({ error: 'Hierarchy Metadata sheet missing "level" column.' }, { status: 400 })
  }

  var fieldKeys = Object.keys(fieldRows[0]).map(function(k) { return k.toLowerCase().trim() })
  if (fieldKeys.indexOf('field_name') === -1) {
    return Response.json({ error: 'Fields sheet missing "field_name" column.' }, { status: 400 })
  }
  if (fieldKeys.indexOf('type') === -1) {
    return Response.json({ error: 'Fields sheet missing "type" column.' }, { status: 400 })
  }

  // ── Validate every L1 node has required fields set ─────────────────────
  // (Can't inherit from anywhere, so must be explicit)
  var missingL1 = []
  hierRows.forEach(function(r) {
    var level = parseInt(getVal(r, 'level'))
    if (level !== 1) return
    var acc = getVal(r, 'accumulation_type')
    var fav = getVal(r, 'favorable_direction')
    // Only error if BOTH are missing — single missing is warning-level
    if (!acc && !fav) {
      missingL1.push(getVal(r, 'node_path'))
    }
  })
  if (missingL1.length) {
    return Response.json({
      error: 'L1 nodes missing both accumulation_type and favorable_direction: ' + missingL1.join(', ') +
             '. At least one root-level field must be set so descendants can inherit.'
    }, { status: 400 })
  }

  // ── Create/replace metadata set ────────────────────────────────────────
  var setInfo = await upsertMetadataSet(metaName, 'long_hierarchical')
  var setId = setInfo.setId
  var isReplacement = setInfo.isReplacement

  // ── Save hierarchy nodes ───────────────────────────────────────────────
  var hierSavedCount = 0
  for (var i = 0; i < hierRows.length; i++) {
    var r = hierRows[i]
    var nodePath = getVal(r, 'node_path')
    if (!nodePath) continue

    var level = parseInt(getVal(r, 'level')) || 1
    var pathParts = String(nodePath).split(' > ')
    var nodeName = pathParts[pathParts.length - 1]
    var parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join(' > ') : null

    // favorable_direction: normalize i/d, null otherwise
    var fav = getVal(r, 'favorable_direction')
    var favNormalized = null
    if (fav) {
      var s = String(fav).trim().toLowerCase()
      if (s === 'i' || s === 'd') favNormalized = s
    }

    var acc = getVal(r, 'accumulation_type')
    var accNormalized = null
    if (acc) {
      var sa = String(acc).trim().toLowerCase()
      if (sa === 'cumulative' || sa === 'point_in_time') accNormalized = sa
    }

    await execute(`INSERT INTO hierarchy_nodes (
        metadata_set_id, node_path, node_name, level, parent_path, is_leaf,
        display_name, definition, accumulation_type, favorable_direction,
        business_priority, unit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        setId,
        String(nodePath),
        nodeName,
        level,
        parentPath,
        false, // is_leaf is computed at read time for now — not trusted from Excel
        getVal(r, 'display_name'),
        getVal(r, 'definition'),
        accNormalized,
        favNormalized,
        getVal(r, 'business_priority'),
        getVal(r, 'unit'),
      ]
    )
    hierSavedCount++
  }

  // ── Save fields (value column + dimensions) to metadata_rows ───────────
  var fieldSavedCount = 0
  for (var j = 0; j < fieldRows.length; j++) {
    var fr = fieldRows[j]
    var fieldName = getVal(fr, 'field_name')
    if (!fieldName) continue

var type = String(getVal(fr, 'type') || '').toLowerCase().trim()
    // Accept 'value_column' | 'dimension' | 'year_month' (normalise 'value' → 'value_column')
    if (type === 'value') type = 'value_column'
    if (type !== 'value_column' && type !== 'dimension' && type !== 'year_month') {
      type = 'dimension'
    }

    // favorable_direction (only meaningful for value_column in long format, dimensions leave null)
    var fav2 = getVal(fr, 'favorable_direction')
    var fav2Normalized = null
    if (fav2) {
      var s2 = String(fav2).trim().toLowerCase()
      if (s2 === 'i' || s2 === 'd') fav2Normalized = s2
    }

    await execute(`INSERT INTO metadata_rows (
        metadata_set_id, field_name, display_name, type, data_type,
        unit, definition, aggregation, calculation_logic, dependencies,
        sample_values, business_priority, filters_applicable, time_grain,
        benchmark, accumulation_type, is_output, favorable_direction,
        mandatory_filter_value
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        setId,
        String(fieldName),
        getVal(fr, 'display_name'),
        type,
        getVal(fr, 'data_type'),
        getVal(fr, 'unit'),
        getVal(fr, 'definition'),
        getVal(fr, 'aggregation'),
        null,  // calculation_logic — not used in long format
        null,  // dependencies — not used in long format
        getVal(fr, 'sample_values'),
        getVal(fr, 'business_priority'),
        null,  // filters_applicable
        null,  // time_grain
        null,  // benchmark
        getVal(fr, 'accumulation_type'),
        'Y',   // is_output
        fav2Normalized,
        getVal(fr, 'mandatory_filter_value'),
      ]
    )
    fieldSavedCount++
  }

  var totalCount = hierSavedCount + fieldSavedCount

  return Response.json({
    message: isReplacement
      ? totalCount + ' rows replaced for "' + metaName + '" (' + hierSavedCount + ' hierarchy nodes + ' + fieldSavedCount + ' fields).'
      : totalCount + ' rows saved (' + hierSavedCount + ' hierarchy nodes + ' + fieldSavedCount + ' fields).',
    replaced: isReplacement,
    format: 'long_hierarchical',
    metadataSet: {
      id: setId,
      name: metaName,
      row_count: totalCount,
      hierarchy_count: hierSavedCount,
      field_count: fieldSavedCount,
    }
  })
}
