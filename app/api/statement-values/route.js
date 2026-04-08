import { query } from '../../../lib/db'

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

    // ── Time period math ─────────────────────────────────────────────────
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

    // Cumulative uses full period range; point_in_time uses the LATEST month only
    var curCondCumulative = periodCond(yr, curMonthMin, curMonthMax)
    var cmpCondCumulative = periodCond(cmpYear, cmpMonthMin, cmpMonthMax)
    var curCondPIT        = periodCond(yr, curMonthMax, curMonthMax)
    var cmpCondPIT        = periodCond(cmpYear, cmpMonthMax, cmpMonthMax)

    // ── Mandatory + dimension filters ────────────────────────────────────
    var mandatorySQL = mandatoryFilters.length
      ? mandatoryFilters.map(function(f) { return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'" }).join('')
      : ''
    var dimFilterSQL = ''
    dimensionFilters.forEach(fun
