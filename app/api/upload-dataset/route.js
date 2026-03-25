import * as XLSX from 'xlsx'
import { execute, query } from '../../../lib/db'

// Tell Next.js this route accepts large payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
}

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

    // ── Bulk insert using multi-row VALUES batches ────────────────────────────
    // Old approach: one INSERT per row = thousands of round trips to Neon.
    // New approach: batch 500 rows per INSERT = ~10x fewer round trips.
    // Each batch builds: INSERT INTO dataset_rows (dataset_id, data) VALUES ($1,$2),($3,$4)...
    // 500 rows × ~200 bytes JSON ≈ 100KB per batch — well within Neon's limits.

    var BATCH_SIZE = 500

    for (var i = 0; i < rows.length; i += BATCH_SIZE) {
      var batch  = rows.slice(i, i + BATCH_SIZE)
      var values = []
      var params = []
      var paramIdx = 1

      for (var j = 0; j < batch.length; j++) {
        values.push('($' + paramIdx + ', $' + (paramIdx + 1) + ')')
        params.push(datasetId, JSON.stringify(batch[j]))
        paramIdx += 2
      }

      await execute(
        'INSERT INTO dataset_rows (dataset_id, data) VALUES ' + values.join(', '),
        params
      )
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
