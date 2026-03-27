import { query, execute } from '../../../lib/db'

// ── Column name sanitizer ─────────────────────────────────────────────────────
// Converts any column name to a valid lowercase SQL identifier
// "Predicted Length" → "predicted_length", "BFI 2 Score" → "bfi_2_score"
function sanitizeColName(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[0-9]/, 'c_$&')
    .replace(/^_+|_+$/g, '') || 'col'
}

// ── Type inference from sample values ────────────────────────────────────────
function inferColType(sampleValues) {
  var nonNull = sampleValues.filter(function(v) {
    return v !== null && v !== undefined && String(v).trim() !== ''
  })
  if (!nonNull.length) return 'TEXT'
  var allNumeric = nonNull.every(function(v) {
    var s = String(v).trim().replace(/,/g, '')
    return s !== '' && !isNaN(Number(s))
  })
  return allNumeric ? 'NUMERIC' : 'TEXT'
}

export async function POST(request) {
  try {
    var body = await request.json()
    var action = body.action

    // ── INIT ────────────────────────────────────────────────────────────────
    // Creates/replaces the dataset record and the typed data table
    if (action === 'init') {
      var name       = body.name
      var rowCount   = body.rowCount
      var sampleRows = body.sampleRows || []

      if (!name) return Response.json({ error: 'name is required.' }, { status: 400 })
      if (!sampleRows.length) return Response.json({ error: 'sampleRows is required for type inference.' }, { status: 400 })

      // Ensure column_map column exists on datasets table
      await execute(
        'ALTER TABLE datasets ADD COLUMN IF NOT EXISTS column_map JSONB',
        []
      )

      // Upsert dataset record
      var existing = await query('SELECT id FROM datasets WHERE name = $1', [name])
      var datasetId
      if (existing.length > 0) {
        datasetId = existing[0].id
        await execute(
          'UPDATE datasets SET row_count = $1, uploaded_at = NOW() WHERE id = $2',
          [rowCount, datasetId]
        )
      } else {
        var result = await query(
          'INSERT INTO datasets (name, row_count) VALUES ($1, $2) RETURNING id',
          [name, rowCount]
        )
        datasetId = result[0].id
      }

      // Build column definitions from sample rows
      var rawCols = Object.keys(sampleRows[0])
      var cols = rawCols.map(function(raw) {
        var sanitized   = sanitizeColName(raw)
        var sampleVals  = sampleRows.map(function(r) { return r[raw] })
        var type        = inferColType(sampleVals)
        return { raw: raw, sanitized: sanitized, type: type }
      })

      // Deduplicate sanitized names (edge case: two cols sanitize to same name)
      var seen = {}
      cols = cols.map(function(c) {
        var name = c.sanitized
        if (seen[name]) { seen[name]++; name = name + '_' + seen[name] }
        else seen[name] = 1
        return Object.assign({}, c, { sanitized: name })
      })

      // Build column_map: { "Original Name": "sanitized_name" }
      var colMap = {}
      cols.forEach(function(c) { colMap[c.raw] = c.sanitized })

      // Drop old data table if exists, create fresh
      await execute('DROP TABLE IF EXISTS ds_' + datasetId, [])
      var colDefs = cols.map(function(c) { return c.sanitized + ' ' + c.type }).join(', ')
      await execute('CREATE TABLE ds_' + datasetId + ' (' + colDefs + ')', [])

      // Save column map to datasets record
      await execute(
        'UPDATE datasets SET column_map = $1 WHERE id = $2',
        [JSON.stringify(colMap), datasetId]
      )

      console.log('=== upload-dataset init: dataset', datasetId, 'table ds_' + datasetId, 'cols:', cols.length)
      return Response.json({ datasetId: datasetId, columns: cols, colMap: colMap })
    }

    // ── CHUNK ───────────────────────────────────────────────────────────────
    // Inserts a batch of rows into the typed table
    if (action === 'chunk') {
      var datasetId = body.datasetId
      var rows      = body.rows || []

      if (!datasetId || !rows.length) {
        return Response.json({ error: 'datasetId and rows required.' }, { status: 400 })
      }

      // Load column map
      var dsRow = await query('SELECT column_map FROM datasets WHERE id = $1', [datasetId])
      if (!dsRow.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })
      var colMap = dsRow[0].column_map || {}
      var rawCols       = Object.keys(colMap)
      var sanitizedCols = rawCols.map(function(r) { return colMap[r] })
      var colList       = sanitizedCols.join(', ')

      // Insert in sub-batches of 100 rows to keep payload size manageable
      var SUB = 100
      var totalInserted = 0
      for (var b = 0; b < rows.length; b += SUB) {
        var batch       = rows.slice(b, b + SUB)
        var placeholders = []
        var values       = []
        var idx          = 1

        batch.forEach(function(row) {
          var rowPH = rawCols.map(function(raw) {
            var v = row[raw]
            values.push(v !== null && v !== undefined ? String(v) : null)
            return '$' + (idx++)
          })
          placeholders.push('(' + rowPH.join(', ') + ')')
        })

        await execute(
          'INSERT INTO ds_' + datasetId + ' (' + colList + ') VALUES ' + placeholders.join(', '),
          values
        )
        totalInserted += batch.length
      }

      return Response.json({ inserted: totalInserted })
    }

    // ── FINALISE ────────────────────────────────────────────────────────────
    if (action === 'finalise') {
      var datasetId = body.datasetId
      var rowCount  = body.rowCount
      var name      = body.name

      await execute(
        'UPDATE datasets SET row_count = $1 WHERE id = $2',
        [rowCount, datasetId]
      )
      var ds = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])
      console.log('=== upload-dataset finalise: dataset', datasetId, rowCount, 'rows')
      return Response.json({ dataset: ds[0] })
    }

    return Response.json({ error: 'Unknown action: ' + action }, { status: 400 })

  } catch (err) {
    console.error('upload-dataset error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
