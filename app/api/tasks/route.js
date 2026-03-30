import { query } from '../../../lib/db'

export async function GET(request) {
  var { searchParams } = new URL(request.url)
  var datasetId = searchParams.get('datasetId')
  if (!datasetId) return Response.json({ error: 'datasetId is required.' }, { status: 400 })
  try {
    var rows = await query(
      'SELECT * FROM prism_tasks WHERE dataset_id = $1 ORDER BY created_at DESC',
      [datasetId]
    )
    return Response.json({ tasks: rows })
  } catch (e) {
    console.error('tasks GET error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'Invalid body.' }, { status: 400 }) }

  var {
      datasetId, metadataSetId, kpiField, kpiDisplay,
      dimensionFilters, yearField, monthField,
      createdYear, createdMonth, createdValue,
      direction, note, mandatoryFilters,
    } = body

  if (!datasetId || !kpiField || !createdYear || !createdMonth) {
    return Response.json({ error: 'datasetId, kpiField, createdYear, createdMonth are required.' }, { status: 400 })
  }

  try {
    var rows = await query(
      `INSERT INTO prism_tasks
        (dataset_id, metadata_set_id, kpi_field, kpi_display, dimension_filters,
         year_field, month_field, created_year, created_month, created_value, direction, note, mandatory_filters)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        datasetId,
        metadataSetId || null,
        kpiField,
        kpiDisplay || kpiField,
        JSON.stringify(dimensionFilters || []),
        yearField || 'year',
        monthField || 'month',
        createdYear,
        createdMonth,
        createdValue !== undefined ? createdValue : null,
        direction || 'i',
        note || null,
        JSON.stringify(mandatoryFilters || []),
      ]
    )
    return Response.json({ task: rows[0] })
  } catch (e) {
    console.error('tasks POST error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
