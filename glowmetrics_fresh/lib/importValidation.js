// Server-side validation for rows about to be saved as tips / paid sessions.
// One pure function shared by every ingestion route, so the rules cannot drift
// between them (#734). It exists because corrupt rows were accepted and the
// import was still reported "complete" (#733): a running token BALANCE saved
// as USD, bare numbers read as dates in 2000/2001/0001, and a year landing in
// the token column.
//
// Rules (approved by the owner):
//  1. A date must be a FULL date (4-digit year plus a month name or d-m-y
//     parts). A missing/unreadable date is rejected, never replaced by "now".
//  2. Tokens must be a whole number >= 1; USD must be a finite number >= 0.
//  3. A tip's USD per TOKEN cannot exceed what a viewer pays for one token on
//     that platform (canonical PLATFORM_VIEWER_RATES). This never limits tip
//     SIZE: a 100,000-token tip at the normal rate passes.
//  4. The date must not be before MIN_YEAR nor more than 24h in the future
//     (the tolerance absorbs timezone differences).
// Paid sessions (private shows, paid chats) get rules 1, 2 and 4 only: their
// payouts are not per-token tips.
//
// All-or-nothing: callers must save NOTHING when result.ok is false.
import { viewerRate } from './constants'

export const IMPORT_RULES = Object.freeze({
  MIN_YEAR: 2004,
  FUTURE_TOLERANCE_MS: 24 * 60 * 60 * 1000,
  // USD is stored to the cent; allow half a cent of rounding on the ceiling.
  USD_ROUNDING_TOLERANCE: 0.005,
  MAX_REPORTED: 20,
})

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i
const DMY_PARTS_RE = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/

export function isFullDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  return /\b\d{4}\b/.test(s) && (MONTH_RE.test(s) || DMY_PARTS_RE.test(s))
}

const plural = (n) => (n === 1 ? '' : 's')

function dateProblems(row, now, n) {
  const raw = row.source_date != null ? row.source_date : row.date_time
  if (row.date_missing || raw == null || String(raw).trim() === '') {
    return [{
      code: 'date_missing', row: n,
      message: `Row ${n} has no date. Every tip needs a date.`,
      hint: 'Check that the Date column was copied and was not shifted into another column.',
    }]
  }
  if (!isFullDate(raw)) {
    return [{
      code: 'date_not_full', row: n,
      message: `Row ${n}: "${String(raw).trim().slice(0, 40)}" is not a full date (it needs a day, month and 4-digit year).`,
      hint: 'Check the Date column in your export. A number or a date without a year usually means the columns were shifted.',
    }]
  }
  const at = row.date_time ? new Date(row.date_time) : null
  if (!at || Number.isNaN(at.getTime())) {
    return [{
      code: 'date_unreadable', row: n,
      message: `Row ${n}: the date "${String(raw).trim().slice(0, 40)}" could not be read.`,
      hint: 'Use the date format your platform exports (for example 2026-08-02 08:54:54).',
    }]
  }
  if (at.getTime() < Date.UTC(IMPORT_RULES.MIN_YEAR, 0, 1)) {
    return [{
      code: 'date_before_floor', row: n,
      message: `Row ${n}: the date ${at.toISOString().slice(0, 10)} is before ${IMPORT_RULES.MIN_YEAR}, earlier than any supported platform.`,
      hint: 'This usually means the Date column was misread. Check the file and upload again.',
    }]
  }
  if (at.getTime() > now + IMPORT_RULES.FUTURE_TOLERANCE_MS) {
    return [{
      code: 'date_in_future', row: n,
      message: `Row ${n}: the date ${at.toISOString().slice(0, 10)} is in the future.`,
      hint: 'Check the Date column in your export.',
    }]
  }
  return []
}

export function validateImportRows(rows, { now = Date.now(), maxReported = IMPORT_RULES.MAX_REPORTED } = {}) {
  const all = []
  const list = Array.isArray(rows) ? rows : []
  list.forEach((row, i) => {
    const n = i + 1
    all.push(...dateProblems(row, now, n))

    const tokens = row.tokens
    const tokensOk = typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 1
    if (!tokensOk) {
      all.push({
        code: 'tokens_invalid', row: n,
        message: `Row ${n}: the token amount must be a whole number of at least 1.`,
        hint: 'Check the Tokens column in your export.',
      })
    }

    const usd = row.usd
    const usdOk = typeof usd === 'number' && Number.isFinite(usd) && usd >= 0
    if (!usdOk) {
      all.push({
        code: 'usd_invalid', row: n,
        message: `Row ${n}: the dollar amount is not a valid positive number.`,
        hint: 'Check the payout / USD column in your export.',
      })
    }

    if (tokensOk && usdOk && !row.is_paid_session) {
      const rate = viewerRate(row.platform)
      if (usd > tokens * rate + IMPORT_RULES.USD_ROUNDING_TOLERANCE) {
        all.push({
          code: 'usd_exceeds_viewer_price', row: n,
          message: `Row ${n}: $${usd.toFixed(2)} for ${tokens} token${plural(tokens)} is more than a viewer pays per token on ${row.platform || 'this platform'} (about $${rate.toFixed(2)}). This usually means a running Token Balance column was read as the amount.`,
          hint: 'Check that the columns are in the expected order, or export the file again from the platform and upload it as it is.',
        })
      }
    }
  })

  return {
    ok: all.length === 0,
    rowsChecked: list.length,
    problemCount: all.length,
    problems: all.slice(0, maxReported),
    truncated: all.length > maxReported,
  }
}

// A self-contained sentence for the UI's single error line.
export function describeProblems(result) {
  if (!result || result.ok) return ''
  const shown = result.problems.slice(0, 3).map((p) => p.message).join(' ')
  const more = result.problemCount > 3 ? ` (${result.problemCount - Math.min(3, result.problems.length)} more problem${result.problemCount - 3 === 1 ? '' : 's'} not shown.)` : ''
  return `Nothing was saved. ${result.problemCount} problem${plural(result.problemCount)} in ${result.rowsChecked} row${plural(result.rowsChecked)} stopped this import so your earnings aren't recorded wrongly. ${shown}${more}`
}
