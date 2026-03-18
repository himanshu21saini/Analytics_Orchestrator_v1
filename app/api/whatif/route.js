import { query } from '../../../lib/db'

// Injects a multiplier or absolute override into an existing SQL query.
// Strategy: wrap the original SQL as a CTE, then apply the scenario
// adjustment to the target field in the outer SELECT.
function buildWhatIfSQL(originalSQL, scenario) {
  var field      = scenario.field          // e.g. "net_interest_income"
  var changeType = scenario.changeType     // 'percent' | 'absolute'
  var changeValue = parseFloat(scenario.changeValue) // e.g. -15 for -15%
  var dimension  = scenario.dimension || null  // e.g. "region"
  var dimValue   = scenario.dimensionValue || null  // e.g. "North"

  if (!field || isNaN(changeValue)) {
    throw new Error('Invalid scenario: field and changeValue are required.')
  }

  // Build the multiplier expression
  // For percent: new_value = original * (1 + changeValue/100)
  // For absolute: new_value = original + changeValue
  var multiplierExpr
  if (changeType === 'absolute') {
    multiplierExpr = '+ (' + changeValue + ')'
  } else {
    // percent change
    var factor = (1 + changeValue / 100).toFixed(6)
    multiplierExpr = '* ' + factor
  }

  // We need to find references to the field in the SQL and wrap them
  // with the adjustment. We do this by wrapping the entire original
  // query as a CTE and patching the relevant column in the outer query.
  //
  // Pattern: find all column aliases that contain the field name,
  // and apply the multiplier. This is simpler and safer than trying
  // to rewrite inner CASE WHEN expressions.

  // Get the column names from the original SELECT clause
  // We'll wrap the whole query and rewrite just the affected columns
  var cteSQL = [
    'WITH base AS (',
    originalSQL,
    ')',
    buildOuterSelect(originalSQL, field, multiplierExpr, dimension, dimValue),
  ].join('\n')

  return cteSQL
}

function buildOuterSelect(originalSQL, field, multiplierExpr, dimension, dimValue) {
  // Parse the SELECT clause column aliases from the original SQL
  // We look for: AS current_value, AS comparison_value, AS value, AS x_value, AS y_value
  var valueAliases = ['current_value', 'comparison_value', 'value', 'x_value', 'y_value']

  // Determine which aliases to patch — those that represent the target KPI
  // We check the original SQL to see if it references the field name
  var fieldLower   = field.toLowerCase()
  var sqlLower     = originalSQL.toLowerCase()
  var fieldMentioned = sqlLower.includes("'" + fieldLower + "'") || sqlLower.includes('"' + fieldLower + '"')

  // Build column list for the outer SELECT
  // For each value alias, if the original SQL has it AND the field is referenced, apply the multiplier
  // For non-numeric columns (label, period), pass through unchanged
  var allAliases = detectAliases(originalSQL)

  var outerCols = allAliases.map(function(alias) {
    var isValueCol = valueAliases.indexOf(alias) !== -1

    if (isValueCol && fieldMentioned) {
      if (dimension && dimValue) {
        // Apply multiplier only to rows matching the dimension filter
        // We need the dimension column to be available in the CTE
        var dimColLower = dimension.toLowerCase()
        return (
          'CASE WHEN lower(CAST(' + dimColLower + ' AS TEXT)) = lower(\'' + dimValue + '\') ' +
          'THEN CAST(' + alias + ' AS numeric) ' + multiplierExpr + ' ' +
          'ELSE ' + alias + ' END AS ' + alias
        )
      } else {
        return 'CAST(' + alias + ' AS numeric) ' + multiplierExpr + ' AS ' + alias
      }
    }

    return alias
  })

  return 'SELECT ' + outerCols.join(', ') + ' FROM base'
}

// Extract the column aliases declared in a SELECT statement
function detectAliases(sql) {
  // Match patterns like: ... AS alias_name
  // We look specifically for our known alias patterns + label/period
  var known = ['current_value', 'comparison_value', 'value', 'x_value', 'y_value', 'label', 'period']
  var sqlLower = sql.toLowerCase()

  return known.filter(function(alias) {
    // Check if this alias appears in the SQL as " AS alias"
    return sqlLower.includes(' as ' + alias) || sqlLower.includes(' as "' + alias + '"')
  })
}

export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var originalQuery = body.originalQuery  // { id, title, chart_type, sql, label_key, value_key, current_key, comparison_key, unit }
  var scenario      = body.scenario       // { field, changeType, changeValue, dimension, dimensionValue }

  if (!originalQuery || !originalQuery.sql) {
    return Response.json({ error: 'originalQuery with sql is required.' }, { status: 400 })
  }
  if (!scenario || !scenario.field) {
    return Response.json({ error: 'scenario with field is required.' }, { status: 400 })
  }

  // Safety: only allow SELECT-based queries
  var sqlTrimmed = originalQuery.sql.trim().toUpperCase()
  if (!sqlTrimmed.startsWith('SELECT')) {
    return Response.json({ error: 'Only SELECT queries are allowed.' }, { status: 400 })
  }

  var whatifSQL
  try {
    whatifSQL = buildWhatIfSQL(originalQuery.sql, scenario)
  } catch (err) {
    return Response.json({ error: 'Failed to build scenario SQL: ' + err.message }, { status: 400 })
  }

  console.log('=== whatif SQL ===\n', whatifSQL)

  try {
    var rows = await query(whatifSQL)

    // Compute summary delta vs original for the response
    var originalRows = []
    try {
      originalRows = await query(originalQuery.sql)
    } catch (e) {
      // non-fatal — we still return the whatif rows
    }

    var delta = computeDelta(originalRows, rows, originalQuery)

    return Response.json({
      whatifData:    rows,
      originalData:  originalRows,
      delta:         delta,
      scenario:      scenario,
      whatifSQL:     whatifSQL,
    })
  } catch (err) {
    console.error('whatif query error:', err.message)
    return Response.json({ error: 'Query failed: ' + err.message }, { status: 500 })
  }
}

// Compute the aggregate delta between original and what-if result sets
function computeDelta(originalRows, whatifRows, q) {
  var curKey = q.current_key || q.value_key || 'current_value'
  var cmpKey = q.comparison_key || 'comparison_value'

  function sumCol(rows, key) {
    return rows.reduce(function(acc, row) {
      var v = parseFloat(row[key])
      return acc + (isNaN(v) ? 0 : v)
    }, 0)
  }

  var origCur  = sumCol(originalRows, curKey)
  var whatifCur = sumCol(whatifRows,  curKey)

  var delta = {
    current_original:  origCur,
    current_whatif:    whatifCur,
    current_diff:      whatifCur - origCur,
    current_diff_pct:  origCur !== 0 ? ((whatifCur - origCur) / Math.abs(origCur) * 100) : null,
  }

  // Also compute comparison delta if available
  if (cmpKey) {
    var origCmp   = sumCol(originalRows, cmpKey)
    var whatifCmp = sumCol(whatifRows,   cmpKey)
    delta.comparison_original = origCmp
    delta.comparison_whatif   = whatifCmp
    delta.comparison_diff     = whatifCmp - origCmp
  }

  return delta
}
