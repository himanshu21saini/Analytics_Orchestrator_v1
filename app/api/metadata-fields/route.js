import { query } from '../../../lib/db'

// Returns all metadata rows for a given metadata set, filtered by type.
// Used by SetupScreen to resolve year/month field names before building.
export async function GET(request) {
  var url    = new URL(request.url)
  var metaId = url.searchParams.get('metadataSetId')
  var type   = url.searchParams.get('type') // optional filter

  if (!metaId) {
    return Response.json({ error: 'metadataSetId is required.' }, { status: 400 })
  }

  try {
    var whereType = type ? " AND type = '" + type + "'" : ''
    var rows = await query(
      'SELECT field_name, type, display_name,mandatory_filter_value,sample_values, is_output FROM metadata_rows WHERE metadata_set_id = ' + parseInt(metaId) + whereType + ' ORDER BY id ASC'
    )
    return Response.json({ fields: rows })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
