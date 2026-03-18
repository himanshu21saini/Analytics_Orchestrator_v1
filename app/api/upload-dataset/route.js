import * as XLSX from 'xlsx'
import { execute, query } from '../../../lib/db'

export async function POST(request) {
  try {
    var formData = await request.formData()
    var file = formData.get('file')
    var datasetName = formData.get('name') || file.name

    if (!file) return Response.json({ error: 'No file provided.' }, { status: 400 })

    var arrayBuffer = await file.arrayBuffer()
    var buffer = Buffer.from(arrayBuffer)

    var wb = file.name.toLowerCase().endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
      : XLSX.read(buffer, { type: 'buffer' })

    var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
    if (!rows.length) return Response.json({ error: 'File is empty.' }, { status: 400 })

    var columns = Object.keys(rows[0]).join(',')

    // Check if dataset with same name already exists — replace if so
    var existing = await query('SELECT id FROM datasets WHERE name = $1', [datasetName])

    var datasetId
    var isReplacement = false

    if (existing.length > 0) {
      datasetId = existing[0].id
      isReplacement = true
      await execute('DELETE FROM dataset_rows WHERE dataset_id = $1', [datasetId])
      await execute(
        'UPDATE datasets SET row_count = $1, columns = $2, uploaded_at = NOW() WHERE id = $3',
        [rows.length, columns, datasetId]
      )
    } else {
      var result = await query(
        'INSERT INTO datasets (name, row_count, columns) VALUES ($1, $2, $3) RETURNING id',
        [datasetName, rows.length, columns]
      )
      datasetId = result[0].id
    }

    // Batch insert rows
    for (var i = 0; i < rows.length; i += 100) {
      var batch = rows.slice(i, i + 100)
      for (var j = 0; j < batch.length; j++) {
        await execute(
          'INSERT INTO dataset_rows (dataset_id, data) VALUES ($1, $2)',
          [datasetId, JSON.stringify(batch[j])]
        )
      }
    }

    return Response.json({
      message: isReplacement
        ? rows.length + ' rows replaced for "' + datasetName + '".'
        : rows.length + ' rows uploaded successfully.',
      replaced: isReplacement,
      dataset: { id: datasetId, name: datasetName, row_count: rows.length, columns: columns }
    })
  } catch (err) {
    console.error('upload-dataset error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
