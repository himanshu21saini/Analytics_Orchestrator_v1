import { query } from '../../../lib/db'
import { FISCAL_START_MONTH } from '../../../lib/fiscal-config'

export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var datasetId        = body.datasetId
  var fieldName        = body.fieldName
  var accumulationType = body.accumulationType || 'cumulative'
  var yearsBack        = body.yearsBack || 3
  var yf               = body.yearField  || 'year'
  var mf               = body.monthField || 'month'
  var fiscal           = /fiscal/i.test(yf)

  if (!datasetId || !fieldName) {
    return Response.json({ error: 'datasetId and fieldName are required.' }, { status: 400 })
  }

  var agg = accumulationType === 'point_in_time' ? 'AVG' : 'SUM'

  var yearRangeSQL = [
    'SELECT',
    "  MIN((data->>'" + yf + "')::integer) AS min_year,",
    "  MAX((data->>'" + yf + "')::integer) AS max_year",
    'FROM dataset_rows',
    'WHERE dataset_id = ' + datasetId,
    "  AND (data->>'" + yf + "') IS NOT NULL",
  ].join('\n')

  var yearRange
  try {
    var yr = await query(yearRangeSQL)
    yearRange = yr[0] || { min_year: null, max_year: null }
  } catch (e) {
    return Response.json({ error: 'Failed to read year range: ' + e.message }, { status: 500 })
  }

  var maxYear = yearRange.max_year ? parseInt(yearRange.max_year) : new Date().getFullYear()
  var minYear = Math.max(
    yearRange.min_year ? parseInt(yearRange.min_year) : maxYear - yearsBack,
    maxYear - yearsBack
  )

  var trendSQL = [
    'SELECT',
    "  CONCAT(data->>'" + yf + "', '-', LPAD(CAST((data->>'" + mf + "')::integer AS TEXT), 2, '0')) AS period,",
    '  ' + agg + "(COALESCE((data->>'" + fieldName + "')::numeric, 0)) AS value",
    'FROM dataset_rows',
    'WHERE dataset_id = ' + datasetId,
    "  AND (data->>'" + yf + "')::integer >= " + minYear,
    "  AND (data->>'" + yf + "')::integer <= " + maxYear,
    "  AND (data->>'" + mf + "') IS NOT NULL",
    "  AND (data->>'" + yf + "') IS NOT NULL",
    "GROUP BY data->>'" + yf + "', data->>'" + mf + "'",
    'ORDER BY period ASC',
  ].join('\n')

  try {
    var rows = await query(trendSQL)
    var filtered = rows.filter(function(r) {
      return r.period && r.value !== null && r.value !== undefined
    })
    return Response.json({
      data: filtered, fieldName, agg, minYear, maxYear,
      fiscal:           fiscal,
      fiscalStartMonth: FISCAL_START_MONTH,
    })
  } catch (err) {
    console.error('fetch-trend error:', err.message)
    return Response.json({ error: 'Query failed: ' + err.message }, { status: 500 })
  }
}
