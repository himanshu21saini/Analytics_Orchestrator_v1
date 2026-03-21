
// ── Intent-specific query builder ────────────────────────────────────────────
// All SQL strings use double-quote JS delimiters to avoid collision with
// Postgres data->>'field' single quotes inside the string.
function buildIntentQueries(intent, datasetId, f, CF) {
  if (!intent || !intent.type || intent.type === "null") return []

  var queries = []
  var base = "FROM dataset_rows WHERE dataset_id = " + datasetId + " AND " + f.curCond + CF

  // Safe ORDER BY — casts to integer only when field name looks numeric/sequential.
  // Falls back to plain text sort for display-label fields like interval names.
  function safeIntOrder(field) {
    if (/sort|order|seq|num|idx|id$/i.test(field)) {
      return "CASE WHEN (data->>'" + field + "') ~ '^[0-9]+$' THEN (data->>'" + field + "')::integer ELSE 0 END ASC, data->>'" + field + "' ASC"
    }
    return "data->>'" + field + "' ASC"
  }

  // ── RANKING ───────────────────────────────────────────────────────────────
  if (intent.type === "ranking" || intent.type === "ranking_with_drilldown") {
    var entity = intent.primary_entity         || "branch_name"
    var metric = intent.primary_metric         || "bfi_2_score"
    var topN   = parseInt(intent.top_n)        || 10
    var dir    = (intent.direction || "desc").toUpperCase()
    var eDisp  = intent.primary_entity_display || entity
    var mDisp  = intent.primary_metric_display || metric

    var rankSQL = "SELECT data->>'" + entity + "' AS label, " +
      "AVG(COALESCE((data->>'" + metric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + entity + "' IS NOT NULL AND data->>'" + entity + "' != '' " +
      "GROUP BY data->>'" + entity + "' ORDER BY current_value " + dir + " LIMIT " + topN

    queries.push({
      id:               "intent_ranking_" + entity,
      title:            mDisp + " by " + eDisp + " — Ranked",
      chart_type:       "bar",
      sql:              rankSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "",
      insight:          "Ranks every " + eDisp + " by average " + mDisp + ". " + (dir === "DESC" ? "Highest values first." : "Lowest values first."),
      priority:         50,
      intent_generated: true,
    })

    var stressSQL = "SELECT data->>'Stress Type' AS label, COUNT(*) AS current_value " +
      base + " AND data->>'Stress Type' IS NOT NULL AND data->>'Stress Type' != '' " +
      "GROUP BY data->>'Stress Type' ORDER BY current_value DESC"

    queries.push({
      id:               "intent_stress_distribution",
      title:            "Distribution by Stress Type",
      chart_type:       "donut",
      sql:              stressSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "count",
      insight:          "Proportion of records in each stress category for the selected period.",
      priority:         51,
      intent_generated: true,
    })
  }

  // ── RANKING WITH DRILLDOWN ────────────────────────────────────────────────
  if (intent.type === "ranking_with_drilldown") {
    var ddDim    = intent.drilldown_dimension    || "interval_sort_order"
    var ddLabel  = intent.drilldown_label_field  || ddDim
    var ddDisp   = intent.drilldown_display      || ddDim
    var ddMetric = intent.primary_metric         || "bfi_2_score"
    var ddEntity = intent.primary_entity         || "branch_name"
    var ddMDisp  = intent.primary_metric_display || ddMetric
    var ddEDisp  = intent.primary_entity_display || ddEntity
    var ddTopN   = parseInt(intent.top_n)        || 5

    // Intra-day / sub-dimension line — avg metric across all entities by time slot
    var groupByDrill = ddDim !== ddLabel
      ? "GROUP BY data->>'" + ddLabel + "', data->>'" + ddDim + "'"
      : "GROUP BY data->>'" + ddLabel + "'"

    var drillSQL = "SELECT data->>'" + ddLabel + "' AS label, " +
      "AVG(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + ddLabel + "' IS NOT NULL " +
      groupByDrill + " ORDER BY " + safeIntOrder(ddDim)

    queries.push({
      id:               "intent_drilldown_" + ddDim,
      title:            ddMDisp + " across " + ddDisp + "s",
      chart_type:       "line",
      sql:              drillSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "",
      insight:          "Average " + ddMDisp + " per " + ddDisp.toLowerCase() + " across all entities. Peaks indicate highest-stress slots.",
      priority:         52,
      intent_generated: true,
    })

    // Top-N entity × drilldown slot — rendered as DrillDownChart (interactive)
    var groupByHeat = "GROUP BY data->>'" + ddEntity + "', data->>'" + ddLabel + "'" +
      (ddDim !== ddLabel ? ", data->>'" + ddDim + "'" : "")

    var subquery = "SELECT data->>'" + ddEntity + "' FROM dataset_rows " +
      "WHERE dataset_id = " + datasetId + " AND " + f.curCond + CF +
      " AND data->>'" + ddEntity + "' IS NOT NULL " +
      "GROUP BY data->>'" + ddEntity + "' " +
      "ORDER BY AVG(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) DESC " +
      "LIMIT " + ddTopN

    var heatSQL = "SELECT data->>'" + ddEntity + "' AS label, " +
      "data->>'" + ddLabel + "' AS slot, " +
      (ddDim !== ddLabel ? "data->>'" + ddDim + "' AS slot_sort, " : "data->>'" + ddLabel + "' AS slot_sort, ") +
      "AVG(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + ddEntity + "' IN (" + subquery + ") " +
      groupByHeat + " ORDER BY data->>'" + ddEntity + "', " + safeIntOrder(ddDim)

    queries.push({
      id:               "intent_heatmap_" + ddEntity + "_" + ddDim,
      title:            "Top " + ddTopN + " " + ddEDisp + "s — " + ddMDisp + " by " + ddDisp,
      chart_type:       "drilldown",
      sql:              heatSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      slot_key:         "slot",
      slot_sort_key:    "slot_sort",
      entity_display:   ddEDisp,
      slot_display:     ddDisp,
      metric_display:   ddMDisp,
      unit:             "",
      insight:          "Click any " + ddEDisp.toLowerCase() + " to see its " + ddDisp.toLowerCase() + " breakdown.",
      priority:         53,
      intent_generated: true,
    })
  }

  // ── DISTRIBUTION ─────────────────────────────────────────────────────────
  if (intent.type === "distribution") {
    var distDim    = intent.distribution_dimension || "Stress Type"
    var distMetric = intent.distribution_metric    || "bfi_2_score"

    var distSQL = "SELECT data->>'" + distDim + "' AS label, COUNT(*) AS current_value " +
      base + " AND data->>'" + distDim + "' IS NOT NULL AND data->>'" + distDim + "' != '' " +
      "GROUP BY data->>'" + distDim + "' ORDER BY current_value DESC"

    queries.push({
      id:               "intent_dist_" + distDim.replace(/\s+/g, "_"),
      title:            "Distribution by " + distDim,
      chart_type:       "donut",
      sql:              distSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "count",
      insight:          "Spread of records across each " + distDim + " category.",
      priority:         50,
      intent_generated: true,
    })

    var distBarSQL = "SELECT data->>'" + distDim + "' AS label, " +
      "AVG(COALESCE((data->>'" + distMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + distDim + "' IS NOT NULL " +
      "GROUP BY data->>'" + distDim + "' ORDER BY current_value DESC"

    queries.push({
      id:               "intent_dist_bar_" + distDim.replace(/\s+/g, "_"),
      title:            "Avg " + distMetric + " by " + distDim,
      chart_type:       "bar",
      sql:              distBarSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "",
      insight:          "Average " + distMetric + " for each " + distDim + " category.",
      priority:         51,
      intent_generated: true,
    })
  }

  // ── TEMPORAL ─────────────────────────────────────────────────────────────
  if (intent.type === "temporal") {
    var timeDim   = intent.time_dimension   || "interval_sort_order"
    var timeLabel = intent.time_label_field || timeDim
    var timeMet   = intent.temporal_metric  || "bfi_2_score"

    var groupByTemporal = timeDim !== timeLabel
      ? "GROUP BY data->>'" + timeLabel + "', data->>'" + timeDim + "'"
      : "GROUP BY data->>'" + timeLabel + "'"

    var temporalSQL = "SELECT data->>'" + timeLabel + "' AS label, " +
      "AVG(COALESCE((data->>'" + timeMet + "')::numeric, 0)) AS current_value, " +
      "COUNT(*) AS record_count " +
      base + " AND data->>'" + timeLabel + "' IS NOT NULL " +
      groupByTemporal + " ORDER BY " + safeIntOrder(timeDim)

    queries.push({
      id:               "intent_temporal_" + timeDim,
      title:            timeMet + " Pattern by " + (timeLabel !== timeDim ? timeLabel : timeDim),
      chart_type:       "area",
      sql:              temporalSQL,
      current_key:      "current_value",
      value_key:        "current_value",
      label_key:        "label",
      unit:             "",
      insight:          "How " + timeMet + " evolves across each " + timeLabel + ". Peaks reveal the highest-stress slots.",
      priority:         50,
      intent_generated: true,
    })
  }

  return queries
}

// ── Main route handler ────────────────────────────────────────────────────────
