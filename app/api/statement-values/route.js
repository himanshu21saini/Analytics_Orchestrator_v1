import { query } from '../../../lib/db'
import { buildPeriodFilters } from '../../../lib/period-builder'

function resolveInherited(nodesByPath, nodePath, fieldName) {
  var current = nodesByPath[nodePath]
  while (current) {
    var v = current[fieldName]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
    if (!current.parent_path) return null
    current = nodesByPath[current.parent_path]
  }
  return null
}

function getLevelColumn(hierCols, level) {
  if (!hierCols || level < 1 || level > hierCols.length) return null
  return hierCols[level - 1]
}

export async function POST(request) {
  try {
    var body = await request.json()
    var datasetId        = body.datasetId
    var metadataSetId    = body.metadataSetId
    var nodePaths        = body.nodePaths || []
    var timePeriod       = body.timePeriod || {}
    var mandatoryFilters = body.mandatoryFilters || []
    var dimensionFilters = body.dimensionFilters || []

    if (!datasetId)     return Response.json({ error: 'datasetId required.' }, { status: 400 })
    if (!metadataSetId) return Response.json({ error: 'metadataSetId required.' }, { status: 400 })
    if (!nodePaths.length) return Response.json({ values: {} })

    var tbl = 'ds_' + datasetId

    var dsRow = await query('SELECT dataset_format FROM datasets WHERE id = $1', [datasetId])
    if (!dsRow.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })
    var datasetFormat = dsRow[0].dataset_format
    if (typeof datasetFormat === 'string') { try { datasetFormat = JSON.parse(datasetFormat) } catch(e) { datasetFormat = null } }
    if (!datasetFormat || datasetFormat.format !== 'long_hierarchical') {
      return Response.json({ error: 'Dataset is not long_hierarchical format.' }, { status: 400 })
    }
    var hierCols = datasetFormat.hierarchyColumns || []
    var valueCol = datasetFormat.valueColumn
    if (!valueCol) return Response.json({ error: 'No valueColumn in dataset_format.' }, { status: 400 })

    // ── Load hierarchy nodes for inheritance ─────────────────────────────
    var allNodes = await query(
      'SELECT node_path, parent_path, level, accumulation_type, favorable_direction FROM hierarchy_nodes WHERE metadata_set_id = $1',
      [metadataSetId]
    )
    var nodesByPath = {}
    allNodes.forEach(function(n) { nodesByPath[n.node_path] = n })

    // ── Load value column metadata to get its declared aggregation ───────
    var valueRow = await query(
      "SELECT aggregation FROM metadata_rows WHERE metadata_set_id = $1 AND field_name = $2 AND type = 'value_column' LIMIT 1",
      [metadataSetId, valueCol]
    )
    var aggFn = 'SUM'
    if (valueRow.length && valueRow[0].aggregation) {
      var declared = String(valueRow[0].aggregation).toUpperCase().trim()
      if (['SUM','AVG','COUNT','MAX','MIN'].indexOf(declared) !== -1) aggFn = declared
    }

    // Use the shared period builder so fiscal vs calendar math is consistent
    // with generate-queries-route.js
    var f = buildPeriodFilters(timePeriod)
    var curCondCumulative = f.curCond
    var cmpCondCumulative = f.cmpCond
    var curCondPIT        = f.curCondPIT
    var cmpCondPIT        = f.cmpCondPIT

    // ── Mandatory + dimension filters ────────────────────────────────────
    var mandatorySQL = mandatoryFilters.length
      ? mandatoryFilters.map(function(f) { return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'" }).join('')
      : ''
    var dimFilterSQL = ''
    dimensionFilters.forEach(function(df) {
      if (!df.field || !df.values || !df.values.length) return
      var quoted = df.values.map(function(v) { return "'" + String(v).replace(/'/g, "''") + "'" }).join(',')
      dimFilterSQL += " AND " + df.field + " IN (" + quoted + ")"
    })
    var CF = mandatorySQL + dimFilterSQL

    // ── Query each node ──────────────────────────────────────────────────
    var results = {}
    for (var i = 0; i < nodePaths.length; i++) {
      var path = nodePaths[i]
      var node = nodesByPath[path]
      if (!node) { results[path] = { error: 'Node not found in metadata' }; continue }

      var pathParts = path.split(' > ')
      var hierWhere = []
      var skipNode = false
      for (var j = 0; j < pathParts.length; j++) {
        var col = getLevelColumn(hierCols, j + 1)
        if (!col) { skipNode = true; break }
        hierWhere.push(col + " = '" + pathParts[j].replace(/'/g, "''") + "'")
      }
      if (skipNode) { results[path] = { error: 'Could not map hierarchy columns' }; continue }

      // Resolve accumulation_type via inheritance — determines WHICH rows,
      // not which function. aggFn (SUM by default) applies in both cases.
      var accType = resolveInherited(nodesByPath, path, 'accumulation_type') || 'cumulative'
      var useCur = accType === 'point_in_time' ? curCondPIT : curCondCumulative
      var useCmp = accType === 'point_in_time' ? cmpCondPIT : cmpCondCumulative

      var hierWhereSQL = hierWhere.join(' AND ')
      var curExpr = aggFn + '(CASE WHEN ' + useCur + ' THEN COALESCE(' + valueCol + ', 0) ELSE NULL END)'
      var cmpExpr = aggFn + '(CASE WHEN ' + useCmp + ' THEN COALESCE(' + valueCol + ', 0) ELSE NULL END)'
      var sql = 'SELECT ' + curExpr + ' AS current_value, ' + cmpExpr + ' AS comparison_value FROM ' + tbl + ' WHERE ' + hierWhereSQL + CF

      try {
        var rows = await query(sql)
        var row = rows[0] || {}
        var cur = row.current_value !== null && row.current_value !== undefined ? parseFloat(row.current_value) : null
        var cmp = row.comparison_value !== null && row.comparison_value !== undefined ? parseFloat(row.comparison_value) : null
        results[path] = {
          current_value:       cur,
          comparison_value:    cmp,
          accumulation_type:   accType,
          favorable_direction: resolveInherited(nodesByPath, path, 'favorable_direction'),
          sql:                 sql,
        }
      } catch(err) {
        console.error('statement-values query error for', path, ':', err.message)
        results[path] = { error: err.message, sql: sql }
      }
    }

    return Response.json({ values: results })
  } catch (err) {
    console.error('statement-values error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
