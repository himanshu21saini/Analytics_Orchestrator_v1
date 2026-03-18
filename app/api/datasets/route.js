import { query } from '../../../lib/db'

export async function GET() {
  try {
    var rows = await query('SELECT id, name, row_count, columns, uploaded_at FROM datasets ORDER BY uploaded_at DESC')
    return Response.json({ datasets: rows })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
