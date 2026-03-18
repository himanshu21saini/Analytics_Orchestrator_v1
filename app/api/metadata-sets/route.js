import { query } from '../../../lib/db'

export async function GET() {
  try {
    var rows = await query('SELECT id, name, uploaded_at FROM metadata_sets ORDER BY uploaded_at DESC')
    return Response.json({ metadataSets: rows })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
