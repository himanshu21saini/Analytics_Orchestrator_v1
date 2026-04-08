import { query } from '../../../lib/db'

// ── Helper: walk up the tree to resolve an inherited field ──────────────────
// nodes is the full list for this metadata set, indexed by path for O(1) lookup
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

// ── Helper: which hierarchy column does each level live in? ─────────────────
// Reads from datasets.dataset_format.hierarchyColumns
function getLevelColumn(hierCols, level) {
  if (!hierCols || level < 1 || level > hierCols.length) return null
  return hierCols[level - 1]
}

export async function POST(request) {
  try {
    var body = await request.json()
    var datasetId       = body.datasetId
    var metadataSetId   = body.metadataSetId
    var nodePaths       = body.nodePaths || []
    var timePeriod      = body.timePeriod || {}
    var mandatoryFilters= body.mandatoryFilters || []
    var dimensionFilters= body.dimensionFilters || []   // [{field, values: [...]}]

    if (!datasetId)     return Response.json({ error: 'datasetId required.' }, { status: 400 })
    if (!metadataSetId) return Response.json({ error: 'metadataSetId required.' }, { status: 400 })
    if (!nodePaths.length) return Response.json({ values: {} })

    var tbl = 'ds_' + datasetId

    // ── Load dataset_format to find hierarchy columns + value column ───────
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

    // ── Load all hierarchy nodes for inheritance resolution ────────────────
    var allNodes = await query(
      'SELECT node_path, parent_path, level, accumulation_type, favorable_direction FROM hierarchy_nodes WHERE metadata_set_id = $1',
      [metadataSetId]
    )
    var nodesByPath = {}
    allNodes.forEach(function(n) { nodesByPath[n.node_path] = n })

    // ── Build period filters from timePeriod ────────────────────────────────
    // Reuse same convention as generate-queries: yf, mf, viewType, comparisonType
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
    var curCond = periodCond(yr, curMonthMin, curMonthMax)
    var cmpCond = periodCond(cmpYear, cmpMonthMin, cmpMonthMax)

    // For point_in_time, restrict to single month (latest in period)
    var curCondPIT = periodCond(yr, curMonthMax, curMonthMax)
    var cmpCondPIT = periodCond(cmpYear, cmpMonthMax, cmpMonthMax)

    // ── Mandatory + dimension filters as SQL ────────────────────────────────
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

    // ── For each requested node, build & execute one query ──────────────────
    var results = {}
    for (var i = 0; i < nodePaths.length; i++) {
      var path = nodePaths[i]
      var node = nodesByPath[path]
      if (!node) { results[path] = { error: 'Node not found in metadata' }; continue }

      // Build hierarchy WHERE conditions from the path
      var pathParts = path.split(' > ')
      var hierWhere = []
      for (var j = 0; j < pathParts.length; j++) {
        var col = getLevelColumn(hierCols, j + 1)
        if (!col) { hierWhere = null; break }
        hierWhere.push(col + " = '" + pathParts[j].replace(/'/g, "''") + "'")
      }
      if (!hierWhere) { results[path] = { error: 'Could not map hierarchy columns' }; continue }

      // Resolve accumulation_type via inheritance
      var accType = resolveInherited(nodesByPath, path, 'accumulation_type') || 'cumulative'
      var aggFn = accType === 'point_in_time' ? 'AVG' : 'SUM'
      var useCur = accType === 'point_in_time' ? curCondPIT : curCond
      var useCmp = accType === 'point_in_time' ? cmpCondPIT : cmpCond

      var hierWhereSQL = hierWhere.join(' AND ')

      var sql =
        'SELECT ' +
          aggFn + '(CASE WHEN ' + useCur + ' THEN COALESCE(' + valueCol + ', 0) ELSE NULL END) AS current_value, ' +
          aggFn + '(CASE WHEN ' + useCmp + ' THEN COALESCE(' + valueCol + ', 0) ELSE NULL
