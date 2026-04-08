import { query } from '../../../lib/db'
import { FISCAL_START_MONTH } from '../../../lib/fiscal-config'

// Only alphanumeric + underscore — matches distinct-values convention
function safeIdent(s) { return typeof s === 'string' && /^[a-zA-Z0-9_]+$/.test(s) }

export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var datasetId        = body.datasetId
  var yearField        = body.yearField  || 'year'
  var monthField       = body.monthField || 'month'
  var yearsBack        = body.yearsBack || 3
  var mandatoryFilters = body.mandatoryFilters || []
  var dimensionFilters = body.dimensionFilters || []
  var fiscal           = /fiscal/i.test(yearField)

  if (!datasetId) return Response.json({ error: 'datasetId is required.' }, { status: 400 })
  if (!safeIdent(yearField) || !safeIdent(monthField)) {
    return Response.json({ error: 'Invalid yearField/monthField.' }, { status: 400 })
  }

  // ── Detect format from datasets.dataset_format JSONB ────────────────
  var dsRow
  try {
    dsRow = await query('SELECT dataset_format FROM datasets WHERE id = $1', [datasetId])
  } catch (e) {
    return Response.json({ error: 'Failed to load dataset: ' + e.message }, { status: 500 })
  }
  if (!dsRow.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })

  var dsFmt = dsRow[0].dataset_format
  if (typeof dsFmt === 'string') { try { dsFmt = JSON.parse(dsFmt) } catch(e) { dsFmt = null } }
  var isLong = dsFmt && dsFmt.format === 'long_hierarchical'

  var tbl = 'ds_' + datasetId

  // ── Build mandatory + dimension WHERE fragments (shared) ────────────
  var extraFilterSQL = ''
  mandatoryFilters.forEach(function(f) {
    if (!f || !f.field || !safeIdent(f.field)) return
    extraFilterSQL += " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'"
  })
  dimensionFilters.forEach(function(df) {
    if (!df || !df.field || !safeIdent(df.field) || !df.values || !df.values.length) return
    var quoted = df.values.map(function(v) { return "'" + String(v).replace(/'/g, "''") + "'" }).join(',')
    extraFilterSQL += " AND " + df.field + " IN (" + quoted + ")"
  })

  // ── Branch on format ────────────────────────────────────────────────
  var valueExpr, hierWhereSQL = '', effectiveFieldName

  if (isLong) {
    var nodePath      = body.nodePath
    var metadataSetId = body.metadataSetId
    if (!nodePath)      return Response.json({ error: 'nodePath is required for long format.' }, { status: 400 })
    if (!metadataSetId) return Response.json({ error: 'metadataSetId is required for long format.' }, { status: 400 })

    var hierCols = dsFmt.hierarchyColumns || []
    var valueCol = dsFmt.valueColumn
    if (!valueCol || !safeIdent(valueCol)) {
      return Response.json({ error: 'Invalid or missing valueColumn in dataset_format.' }, { status: 400 })
    }

    // Look up declared aggregation from metadata_rows (SUM default)
    var aggFn = 'SUM'
    try {
      var valueRow = await query(
        "SELECT aggregation FROM metadata_rows WHERE metadata_set_id = $1 AND field_name = $2 AND type = 'value_column' LIMIT 1",
        [metadataSetId, valueCol]
      )
      if (valueRow.length && valueRow[0].aggregation) {
        var declared = String(valueRow[0].aggregation).toUpperCase().trim()
        if (['SUM','AVG','COUNT','MAX','MIN'].indexOf(declared) !== -1) aggFn = declared
      }
    } catch (e) { /* fall back to SUM */ }

    // Map nodePath → hierarchy column filters
    var pathParts = nodePath.split(' > ')
    var hierFilters = []
    for (var i = 0; i < pathParts.length; i++) {
      var col = hierCols[i]
      if (!col || !safeIdent(col)) {
        return Response.json({ error: 'Could not map hierarchy columns for node path.' }, { status: 400 })
      }
      hierFilters.push(col + " = '" + pathParts[i].replace(/'/g, "''") + "'")
    }
    hierWhereSQL = ' AND ' + hierFilters.join(' AND ')

    // Monthly grain: SUM works for both cumulative and point_in_time
    // (no sub-monthly filter possible at this grain)
    valueExpr        = aggFn + '(COALESCE(' + valueCol + ', 0))'
    effectiveFieldName = nodePath
  } else {
    // ── Wide format ──
    var fieldName        = body.fieldName
    var accumulationType = body.accumulationType || 'cumulative'
    var calculationLogic = body.calculationLogic || ''
    var dependencies     = body.dependencies     || ''

    if (!fieldName || !safeIdent(fieldName)) {
      return Response.json({ error: 'Valid fieldName is required for wide format.' }, { status: 400 })
    }

    var isCountDistinct = /distinct/i.test(calculationLogic)
    var distField       = isCountDistinct ? (dependencies || fieldName) : null
    if (distField && !safeIdent(distField)) {
      return Response.json({ error: 'Invalid dependencies field.' }, { status: 400 })
    }
    var agg = accumulationType === 'point_in_time' ? 'AVG' : 'SUM'

    valueExpr = isCountDistinct
      ? 'COUNT(DISTINCT ' + distField + ')'
      : agg + '(COALESCE(' + fieldName + ', 0))'
    effectiveFieldName = fieldName
  }

  // ── Year range ──────────────────────────────────────────────────────
  var yearRange
  try {
    var yr = await query(
      'SELECT MIN(' + yearField + '::integer) AS min_year, MAX(' + yearField + '::integer) AS max_year ' +
      'FROM ' + tbl + ' WHERE ' + yearField + ' IS NOT NULL'
    )
    yearRange = yr[0] || { min_year: null, max_year: null }
  } catch (e) {
    return Response.json({ error: 'Failed to read year range: ' + e.message }, { status: 500 })
  }
  var maxYear = yearRange.max_year ? parseInt(yearRange.max_year) : new Date().getFullYear()
  var minYear = Math.max(
    yearRange.min_year ? parseInt(yearRange.min_year) : maxYear - yearsBack,
    maxYear - yearsBack
  )

  // ── Trend query ─────────────────────────────────────────────────────
  var trendSQL = [
    'SELECT',
    "  CONCAT(" + yearField + ", '-', LPAD(CAST(" + monthField + "::integer AS TEXT), 2, '0')) AS period,",
    '  ' + valueExpr + ' AS value',
    'FROM ' + tbl,
    'WHERE ' + yearField + '::integer >= ' + minYear,
    '  AND ' + yearField + '::integer <= ' + maxYear,
    '  AND ' + monthField + ' IS NOT NULL',
    '  AND ' + yearField  + ' IS NOT NULL' + hierWhereSQL + extraFilterSQL,
    'GROUP BY ' + yearField + ', ' + monthField,
    'ORDER BY period ASC',
  ].join('\n')

  try {
    var rows = await query(trendSQL)
    var filtered = rows.filter(function(r) {
      return r.period && r.value !== null && r.value !== undefined
    })
    return Response.json({
      data:             filtered,
      fieldName:        effectiveFieldName,
      agg:              isLong ? 'SUM' : (body.accumulationType === 'point_in_time' ? 'AVG' : 'SUM'),
      minYear:          minYear,
      maxYear:          maxYear,
      fiscal:           fiscal,
      fiscalStartMonth: FISCAL_START_MONTH,
      format:           isLong ? 'long_hierarchical' : 'wide',
    })
  } catch (err) {
    console.error('fetch-trend error:', err.message)
    return Response.json({ error: 'Query failed: ' + err.message, sql: trendSQL }, { status: 500 })
  }
}
