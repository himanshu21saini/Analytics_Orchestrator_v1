import { query } from '../../../lib/db'

// ── Helper: walk up the tree to resolve an inherited field ──────────────────
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

    var allNodes = await query(
      'SELECT node_path, parent_path, level, accumulation_type, favorable_direction FROM hierarchy_nodes WHERE metadata_set_id = $1',
      [metadataSetId]
    )
    var nodesByPath = {}
    allNodes.forEach(function(n) { nodesByPath[n.node_path] = n })

    var yf = timePeriod.yearField  || 'report_year'
    var mf = timePeriod.monthField || 'report_month'
    var vt = timePeriod.viewType   || 'YTD'
    var ct = timePeriod.comparisonType || 'YoY'
    var yr = parseInt(timePeriod.year)  || new Date().getFullYear()
    var mo = parseInt(timePeriod.month) || 12

    function quarterStart(m) { return Math.floor((m - 1) / 3) * 3 + 1 }
    var curMonthMin = vt === 'MTD' ? mo : vt === 'YTD' ? 1 : quarterStart(mo)
    var curMonthMax = mo
    var cmpYear, cmpMonthMin, cmpMonthMax
    if (ct === 'YoY')      { cmpYear = yr - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax }
    else if (ct === 'MoM') { cmpYear = mo === 1 ? yr - 1 : yr; cmpMonthMin = cmpMonthMax = mo === 1 ? 12 : mo - 1 }
    else { var cqs = quarterStart(mo); cmpYear = cqs <= 3 ? yr - 1 : yr; cmpMonthMin = cqs <= 3 ? cqs + 9 : cqs - 3; cmpMonthMax = cmpMonthMin + 2 }

    function periodCond(year, mMin, mMax) {
      var y = yf + ' = ' + year
      var m = mMin === mMax ? mf + ' = ' + mMax : mf + ' >= ' + mMin + ' AND ' + mf + ' <= ' + mMax
      return y + ' AND ' + m
    }
    var curCond    = periodCond(yr, curMonthMin, curMonthMax)
    var cmpCond    = periodCond(cmpYear, cmpMonthMin, cmpMonthMax)
    var curCondPIT = periodCond(yr, curMonthMax, curMonthMax)
    var cmpCondPIT = periodCond(cmpYear, cmpMonthMax, cmpMonthMax)

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

      var accType = resolveInherited(nodesByPath, path, 'accumulation_type') || 'cumulative'
      var aggFn = accType === 'point_in_time' ? 'AVG' : 'SUM'
      var useCur = accType === 'point_in_time' ? curCondPIT : curCond
      var useCmp = accType === 'point_in_time' ? cmpCondPIT : cmpCond

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
