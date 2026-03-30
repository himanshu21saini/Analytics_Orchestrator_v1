import { query } from '../../../../../lib/db'

export async function PATCH(request, { params }) {
  var taskId = params.id
  var body
  try { body = await request.json() } catch (e) { return Response.json({ error: 'Invalid body.' }, { status: 400 }) }

  var { status, note } = body

  // Build dynamic update
  var setClauses = []
  var values     = []
  var idx        = 1

  if (status !== undefined) { setClauses.push('status = $' + idx); values.push(status); idx++ }
  if (note   !== undefined) { setClauses.push('note = $'   + idx); values.push(note);   idx++ }

  if (!setClauses.length) return Response.json({ error: 'Nothing to update.' }, { status: 400 })

  values.push(taskId)
  try {
    var rows = await query(
      'UPDATE prism_tasks SET ' + setClauses.join(', ') + ' WHERE id = $' + idx + ' RETURNING *',
      values
    )
    if (!rows.length) return Response.json({ error: 'Task not found.' }, { status: 404 })
    return Response.json({ task: rows[0] })
  } catch (e) {
    console.error('task PATCH error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  var taskId = params.id
  try {
    await query('DELETE FROM prism_tasks WHERE id = $1', [taskId])
    return Response.json({ success: true })
  } catch (e) {
    console.error('task DELETE error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
