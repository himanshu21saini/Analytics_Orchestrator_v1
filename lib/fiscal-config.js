// ── Fiscal Calendar Configuration ─────────────────────────────────────────────
// Edit FISCAL_START_MONTH to match your organisation's fiscal year start.
//   11 = November  (default — fiscal year starts in November)
//    4 = April     (common in UK/India)
//    1 = January   (fiscal = calendar, no translation needed)

export var FISCAL_START_MONTH = 11   // 1–12

export var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Given a calendar year+month, return { fiscalMonth, fiscalQuarter }
// fiscalMonth 1 = first month of fiscal year (e.g. November when start=11)
export function toFiscal(calYear, calMonth) {
  var fm = ((calMonth - FISCAL_START_MONTH + 12) % 12) + 1
  var fq = Math.ceil(fm / 3)
  return { fiscalMonth: fm, fiscalQuarter: fq }
}

// Given a fiscal month (1–12) relative to the as-of calendar year,
// return the actual calendar { year, month }
export function fromFiscalMonth(asOfCalYear, asOfCalMonth, fiscalMonth) {
  // calendar month for this fiscal month
  var calMonth = ((FISCAL_START_MONTH - 1 + fiscalMonth - 1) % 12) + 1
  // if calMonth < FISCAL_START_MONTH it rolled into the next calendar year
  var calYear = calMonth < FISCAL_START_MONTH
    ? (asOfCalMonth >= FISCAL_START_MONTH ? asOfCalYear + 1 : asOfCalYear)
    : (asOfCalMonth >= FISCAL_START_MONTH ? asOfCalYear : asOfCalYear - 1)
  return { calYear, calMonth }
}

// Build a human-readable calendar range label for a fiscal period
// e.g. fiscalMonth 1–4, asOf Feb 2026, start=Nov  →  "Nov 25–Feb 26"
export function fiscalRangeLabel(asOfCalYear, asOfCalMonth, fmStart, fmEnd) {
  var s = fromFiscalMonth(asOfCalYear, asOfCalMonth, fmStart)
  var e = fromFiscalMonth(asOfCalYear, asOfCalMonth, fmEnd)
  var sLabel = MONTH_SHORT[s.calMonth - 1] + ' ' + String(s.calYear).slice(2)
  var eLabel = MONTH_SHORT[e.calMonth - 1] + ' ' + String(e.calYear).slice(2)
  return fmStart === fmEnd ? sLabel : sLabel + '–' + eLabel
}
