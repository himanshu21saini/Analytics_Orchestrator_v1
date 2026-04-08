import { query } from '../../../lib/db'

export async function GET(request) {
  try {
    var url = new URL(request.url)
    var metadataSetId = url.searchParams.get('metadataSetId')
    if (!metadataSetId) return Response.json({ error: 'metadataSetId required.' }, { status: 400 })

    // Use SELECT * to capture all columns including newly-added ones
    var fields = await query('SELECT * FROM metadata_rows WHERE metadata_set_id = $1 ORDER BY id', [metadataSetId])

    // Check the metadata set's dataset_format
    var setRow = await query('SELECT dataset_format FROM metadata_sets WHERE id = $1', [metadataSetId])
    var datasetFormat = setRow.length ? (setRow[0].dataset_format || 'wide') : 'wide'

    // For long format, also return hierarchy nodes
    var hierarchyNodes = []
    if (datasetFormat === 'long_hierarchical') {
      hierarchyNodes = await query(
        'SELECT node_path, node_name, level, parent_path, is_leaf, display_name, definition, accumulation_type, favorable_direction, business_priority, unit FROM hierarchy_nodes WHERE metadata_set_id = $1 ORDER BY level, node_path',
        [metadataSetId]
      )
    }

    return Response.json({
      fields: fields,
      datasetFormat: datasetFormat,
      hierarchyNodes: hierarchyNodes,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
