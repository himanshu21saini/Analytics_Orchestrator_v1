import { query } from '../../../../../lib/db'

export async function GET(request, { params }) {
  var taskId = params.id
  var { searchParams } = new URL(request.url)
  var mandatoryFiltersRaw = searchParams.get('mandatoryFilters')
  var mandatoryFilters = []
  try { if (mandatoryFiltersRaw) mandatoryFilters = JSON.parse(mandatoryFiltersRaw) } catch (e) {}

  try {
    // Load the task
    var tasks = await query('SELECT * FROM prism_tasks WHERE id = $1', [taskId])
    if (!tasks.length) return Response.json({ error: 'Task not found.' }, { status: 404 })
    var task = tasks[0]

    var tbl = 'ds_' + task.dataset_id
    var yf  = task.year_field  || 'year'
    var mf  = task.month_field || 'month'
    var kpi = task.kpi_field

    // Parse dimension filters
    var dimFilters = []
    try {
      dimFilters = typeof task.dimension_filters === 'string'
        ? JSON.parse(task.dimension_filters)
        : (task.dimension_filters || [])
    } catch (e) { dimFilters = [] }

    // Build WHERE clause for dimension filters
    var dimSQL = dimFilters.map(function(f) {
      return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'"
    }).join('')

    // Mandatory filters
    var mandSQL = mandatoryFilters.map(function(f) {
      return " AND " + f.field + " = '" + String(f.value || '').replace(/'/g, "''") + "'"
    }).join('')

    // Determine aggregation
    var metaRows = []
    if (task.metadata_set_id) {
      try {
        metaRows = await query(
          'SELECT * FROM metadata_rows WHERE metadata_set_id = $1 AND field_name = $2',
          [task.metadata_set_id, kpi]
        )
      } catch (e) {}
    }
    var meta       = metaRows[0]
    var accumType  = meta ? (meta.accumulation_type || 'cumulative') : 'cumulative'
    var aggFn      = accumType === 'point_in_time' ? 'AVG' : 'SUM'
    var calcLogic  = meta && meta.calculation_logic ? meta.calculation_logic : null
    var selectExpr = calcLogic ? calcLogic : aggFn + '(COALESCE(' + kpi + ', 0))'

    // Pull full time series — no period filter, all months in table
    var sql = [
      'SELECT',
      '  ' + yf + ' AS yr,',
      '  ' + mf + ' AS mo,',
      '  ' + selectExpr + ' AS value',
      'FROM ' + tbl,
      'WHERE 1=1' + dimSQL + mandSQL,
      'GROUP BY ' + yf + ', ' + mf,
      'ORDER BY ' + yf + ' ASC, ' + mf + ' ASC',
    ].join(' ')

    var rows = await query(sql)

    // Format as period strings for the chart
    var series = rows.map(function(r) {
      var mo = parseInt(r.mo)
      var yr = parseInt(r.yr)
      var moStr = mo < 10 ? '0' + mo : String(mo)
      return {
        period:      yr + '-' + moStr,
        year:        yr,
        month:       mo,
        value:       parseFloat(r.value) || 0,
        is_creation: yr === parseInt(task.created_year) && mo === parseInt(task.created_month),
      }
    })

    // Compute trend summary
    var creationPoint = series.find(function(s) { return s.is_creation })
    var latestPoint   = series[series.length - 1]
    var trend = null
    if (creationPoint && latestPoint && !creationPoint.is_creation === false) {
      var creationVal = creationPoint.value
      var latestVal   = latestPoint.value
      var delta       = latestVal - creationVal
      var deltaPct    = creationVal !== 0 ? (delta / Math.abs(creationVal)) * 100 : null
      var dir         = task.direction || 'i'
      // improved = moved in favorable direction
      var improved = dir === 'i' ? delta > 0 : delta < 0
      trend = {
        creation_value: creationVal,
        latest_value:   latestVal,
        delta:          Math.round(delta * 100) / 100,
        delta_pct:      deltaPct !== null ? Math.round(deltaPct * 10) / 10 : null,
        status:         Math.abs(delta) < 0.001 ? 'no_change' : improved ? 'improved' : 'worsened',
      }
    }

    return Response.json({ task, series, trend })
  } catch (e) {
    console.error('task history error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
