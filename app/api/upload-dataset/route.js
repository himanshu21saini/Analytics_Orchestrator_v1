import { execute, query } from '../../../lib/db'

export async function POST(request) {
  try {
    var body   = await request.json()
    var action = body.action

    // ── INIT: create/replace dataset record, return datasetId ────────────────
    if (action === 'init') {
      var name     = body.name     || 'Untitled Dataset'
      var columns  = body.columns  || ''

      var existing = await query('SELECT id FROM datasets WHERE name = $1', [name])
      var datasetId

      if (existing.length > 0) {
        datasetId = existing[0].id
        await execute('DELETE FROM dataset_rows WHERE dataset_id = $1', [datasetId])
        await execute(
          'UPDATE datasets SET row_count = 0, columns = $1, uploaded_at = NOW() WHERE id = $2',
          [columns, datasetId]
        )
      } else {
        var result = await query(
          'INSERT INTO datasets (name, row_count, columns) VALUES ($1, $2, $3) RETURNING id',
          [name, 0, columns]
        )
        datasetId = result[0].id
      }

      return Response.json({ datasetId, name })
    }

    // ── CHUNK: bulk insert one batch of rows ──────────────────────────────────
    if (action === 'chunk') {
      var datasetId = body.datasetId
      var rows      = body.rows || []

      if (!datasetId) return Response.json({ error: 'datasetId required.' }, { status: 400 })
      if (!rows.length) return Response.json({ ok: true, inserted: 0 })

      var values = [], params = [], idx = 1
      for (var i = 0; i < rows.length; i++) {
        values.push('($' + idx + ', $' + (idx + 1) + ')')
        params.push(datasetId, JSON.stringify(rows[i]))
        idx += 2
      }

      await execute(
        'INSERT INTO dataset_rows (dataset_id, data) VALUES ' + values.join(', '),
        params
      )

      return Response.json({ ok: true, inserted: rows.length })
    }

    // ── FINALISE: update row_count, return dataset record ────────────────────
    if (action === 'finalise') {
      var datasetId = body.datasetId
      var name      = body.name

      if (!datasetId) return Response.json({ error: 'datasetId required.' }, { status: 400 })

      var countRes    = await query('SELECT COUNT(*) as cnt FROM dataset_rows WHERE dataset_id = $1', [datasetId])
      var actualCount = parseInt(countRes[0].cnt) || 0

      await execute('UPDATE datasets SET row_count = $1 WHERE id = $2', [actualCount, datasetId])

      var ds = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])

      return Response.json({
        message: actualCount + ' rows uploaded successfully.',
        dataset: ds[0] || { id: datasetId, name: name, row_count: actualCount }
      })
    }

    return Response.json({ error: 'Unknown action: ' + action }, { status: 400 })

  } catch (err) {
    console.error('upload-dataset error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
