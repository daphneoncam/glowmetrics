// ============================================
// CAMCASH COMPLETE ANALYTICS ENGINE
// ============================================

// Token rates live in ONE place — lib/constants.js
// Do not define rates here. Import only.
import { PLATFORM_TOKEN_RATES, DEFAULT_TOKEN_RATE, tokenRate, canonicalPlatform } from './constants'
// Session grouping lives in ONE place — lib/analytics/sessions.js
// Shared with app/live/page.js. Do not redefine this logic here.
import { detectSessions, SESSION_GAP_MS, isValidSession } from './analytics/sessions'

// ===============================
// TIMEZONE HELPERS
// ===============================

// A tip with no platform is grouped as 'Unknown' — never assigned to a real
// platform (it used to default to 'Chaturbate', silently adding unattributed
// revenue to that platform's totals, times and rates). Same label the rest of
// the engine and the importer use for an undetermined platform.
export const MISSING_PLATFORM = 'Unknown'
const platformKey = (p) => p || MISSING_PLATFORM

function calcMedian(arr) {
  if (!arr || arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

// ===============================
// DATA CONFIDENCE
// Single source of truth for "how much do we trust this sample" — never
// reimplement these bands locally in a component or page.
// ===============================
export function calculateConfidence(validSessionCount, streamedHours) {
  const n = validSessionCount || 0
  const h = streamedHours || 0
  if (n >= 10 && h >= 20) return { level: 'High',     label: 'Strong pattern' }
  if (n < 3 || h < 3)     return { level: 'Very Low', label: 'Not enough data yet' }
  if (n <= 4 || h <= 5)   return { level: 'Low',      label: 'Early signal' }
  return { level: 'Medium', label: 'Likely pattern' }
}

// Building an Intl.DateTimeFormat is expensive; constructing one per tip made
// aggregateRows take 10–36s on ~12k tips (#667). Reuse one per (kind, tz).
// Same locale and options as before, so output is unchanged; an invalid tz
// still throws from the constructor into each caller's existing catch.
const localTimeFormatters = new Map()
function localTimeFormatter(kind, tz, locale, options) {
  const key = `${kind}|${tz}`
  let fmt = localTimeFormatters.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: tz, ...options })
    localTimeFormatters.set(key, fmt)
  }
  return fmt
}

export function toLocalHour(dateStr, tz) {
  try {
    const date = new Date(dateStr)
    const formatted = localTimeFormatter('hour', tz, 'en-US', {
      hour: 'numeric',
      hour12: false
    }).format(date)
    const h = parseInt(formatted)
    return isNaN(h) ? 0 : h === 24 ? 0 : h
  } catch { return new Date(dateStr).getUTCHours() }
}

export function toLocalDow(dateStr, tz) {
  try {
    const date = new Date(dateStr)
    const dayName = localTimeFormatter('weekday', tz, 'en-US', {
      weekday: 'long'
    }).format(date)
    return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      .indexOf(dayName)
  } catch { return new Date(dateStr).getUTCDay() }
}

// Creator-local calendar date in the same M/D/YYYY form toLocaleDateString()
// produced for en-US, but on the creator's clock instead of the device's.
function toLocalDisplayDate(dateStr, tz) {
  try {
    return localTimeFormatter('mdy', tz, 'en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(dateStr))
  } catch { return new Date(dateStr).toISOString().slice(0, 10) }
}

function toLocalDateStr(dateStr, tz) {
  try {
    return localTimeFormatter('date', tz, 'en-CA', {}).format(new Date(dateStr)) // returns YYYY-MM-DD
  } catch { return new Date(dateStr).toISOString().slice(0, 10) }
}

// ===============================
// SANITY + FILTER HELPERS
// ===============================

function clampPrediction(min, max) {
  const MAX_SPREAD = 3;
  if (max / Math.max(min, 1) > MAX_SPREAD) {
    return { min: Math.round(min), max: Math.round(min * MAX_SPREAD), confidence: "low" };
  }
  return { min: Math.round(min), max: Math.round(max), confidence: "high" };
}

function getTipFrequency(daysBetweenTips) {
  if (!daysBetweenTips || daysBetweenTips.length < 2) return null;
  const avg = daysBetweenTips.reduce((a, b) => a + b, 0) / daysBetweenTips.length;
  if (avg < 1.5) return "daily";
  if (avg < 3) return "every few days";
  if (avg < 7) return "weekly";
  return null;
}

function isUserRelevant(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.daysSinceLastTip > 90) return false;
  if ((user.totalTokens || 0) < 100) return false;
  return true;
}

function validateInsights(insights = []) {
  return insights.filter(i => {
    if (!i?.text) return false;
    if (i.text.includes("$0")) return false;
    if (i.text.includes("100%") && i.text.includes("returning")) return false;
    return true;
  });
}

// Chaturbate's "Token Stats" page copies as a 3-line block per tip:
//   Jun 18, 2026, 8:27 PM
//   Tip From: username123
//   500  12345
// (date line / "Tip From: user" line / "tokens  running_balance" line)
const CB_DATE_LINE_RE = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
const CB_TIP_FROM_RE = /^Tip From:\s*(.+)$/i
// Fan Club Membership purchases are real earnings from a named fan, same as
// a tip — mirrors app/onboarding/page.js's parseRows(), which handles the
// same three Chaturbate paste cases for the client-side preview. Kept in
// sync manually (see the comment there) since this is the separate parser
// used server-side for direct CSV-file uploads of the same raw export.
const CB_FAN_CLUB_RE = /^Fan Club Membership:\s*(.+)$/i
// Not earnings from a fan at all — an account-level token debit/cashout —
// so it must never fall through to the generic multi-line date match below
// and get treated as an unrecognized (but still date-stamped) tip block.
const CB_NON_EARNING_ACTION_RE = /^(Admin Adjustment|Transfer tokens to)\b/i
const CB_TOKENS_LINE_RE = /^(\d+)\s+(\d+)$/
const CB_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 }

// Both Chaturbate export shapes express the same storage timestamp.
function chaturbateTimestamp(raw) {
  const match=String(raw).trim().match(CB_DATE_LINE_RE)
  if(!match)return null
  const [,mon,day,year,hr,min,ampm]=match
  let hour=Number(hr)%12
  if(/pm/i.test(ampm))hour+=12
  return `${year}-${String(CB_MONTHS[mon.toLowerCase()]).padStart(2,'0')}-${day.padStart(2,'0')} ${String(hour).padStart(2,'0')}:${min}:00`
}

function parseChaturbateMultiLine(lines) {
  const results = []
  let i = 0
  while (i < lines.length) {
    const dateMatch = lines[i].trim().match(CB_DATE_LINE_RE)
    if (!dateMatch) { i++; continue }

    const [, mon, day, year, hr, min, ampm] = dateMatch
    const actionLine = (lines[i + 1] || '').trim()
    const privateMatch = actionLine.match(/^Private Show:\s*(.+)$/i)
    if (CB_NON_EARNING_ACTION_RE.test(actionLine)) { i++; continue }
    const tipMatch = actionLine.match(CB_TIP_FROM_RE)
    const fanClubMatch = !tipMatch && actionLine.match(CB_FAN_CLUB_RE)
    const saleMatch = actionLine.match(/^((?:Snapchat|Social|Other)[^:]*):\s*(.+)$/i)
    if (!tipMatch && !fanClubMatch && !privateMatch && !saleMatch) { i++; continue }

    const username = (tipMatch?.[1] || fanClubMatch?.[1] || privateMatch?.[1] || saleMatch?.[2]).trim()
    let tokensLine = (lines[i + 2] || '').trim()
    let note = ''
    let tMatch = tokensLine.match(CB_TOKENS_LINE_RE)
    if (!tMatch && lines[i + 3]) {
      note = tokensLine
      tokensLine = (lines[i + 3] || '').trim()
      tMatch = tokensLine.match(CB_TOKENS_LINE_RE)
    }

    if (tMatch) {
      const tokens = parseInt(tMatch[1], 10)
      if (username && tokens >= 1) {
        let h = parseInt(hr, 10)
        if (/pm/i.test(ampm) && h !== 12) h += 12
        if (/am/i.test(ampm) && h === 12) h = 0
        const monthNum = CB_MONTHS[mon.toLowerCase()] || 1
        const dateRaw = `${year}-${String(monthNum).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')} ${String(h).padStart(2, '0')}:${min}:00`
        if (fanClubMatch) note = note ? `Fan Club Membership: ${note}` : 'Fan Club Membership'
        results.push({
          dateRaw, date_time: dateRaw, username, platform: 'Chaturbate',
          tokens, usd: parseFloat((tokens * tokenRate('Chaturbate')).toFixed(2)),
          tip_type: privateMatch ? 'Private Show' : fanClubMatch ? 'Membership' : saleMatch ? 'Other Sale' : 'Tip', tip_note: note,
          ...(privateMatch ? { is_paid_session: true, session_type: 'Private Show' } : {}),
        })
      }
    }
    i++
  }
  return results
}

// Numeric dates like 06/11/2024 can be June 11 or 6 November. JS Date reads
// them month-first, so a day-first export lands on the wrong dates (and a
// re-import of the same tips no longer dedups against the originals). The
// order is decided per file from its own unambiguous dates, never guessed:
//   'DMY'       some date has a first number > 12
//   'MDY'       some date has a second number > 12
//   'conflict'  both appear — the file mixes formats
//   'ambiguous' every date could be either — the user must choose
//   null        no such dates (ISO, dotted BongaCams, epoch, etc.)
const NUMERIC_DATE_RE = /(?:^|[\s",;\t])(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?=$|[\s",;\tT])/g
export function detectDateOrder(text) {
  let dmy = false, mdy = false, seen = false
  for (const m of String(text || '').matchAll(NUMERIC_DATE_RE)) {
    const a = Number(m[1]), b = Number(m[2])
    if (a < 1 || b < 1 || a > 31 || b > 31) continue
    seen = true
    if (a > 12) dmy = true
    if (b > 12) mdy = true
  }
  if (!seen) return null
  if (dmy && mdy) return 'conflict'
  if (dmy) return 'DMY'
  if (mdy) return 'MDY'
  return 'ambiguous'
}

// Date order for the parse in progress (parseCSV is synchronous, so this is
// never shared between two parses). null keeps the previous behaviour.
let activeDateOrder = null

export function parseCSV(text, platform = null, { dateOrder = null } = {}) {
  activeDateOrder = dateOrder === 'DMY' || dateOrder === 'MDY' ? dateOrder : null
  try {
    return parseCSVInner(text, platform)
  } finally {
    activeDateOrder = null
  }
}

function parseCSVInner(text, platform) {
  let allLines = text.trim().split('\n')
  if (allLines.length === 0) return []

  if (!platform) platform = detectPlatform(text)

  // Detect delimiter — must happen before any CSV parsing
  const delimiter = detectDelimiter(text)
  if (!delimiter) {
    // Ambiguous delimiter — default to comma but warn
    console.warn('[parseCSV] Could not detect delimiter; defaulting to comma')
  }
  const detectedDelimiter = delimiter || ','

  // Some BongaCams pastes (Reports → General earnings table) put every
  // header cell on its own line — "Date and Time" / "Member" / "Type" /
  // "Tokens Earned" / "Your Payout" — instead of one delimiter-joined
  // header row. parseWithHeaders below only maps as many columns as the
  // header row contains, so left alone this silently drops every value
  // past column 0 and the whole paste parses to zero rows. Stitch a
  // detected stacked-header block back into one row before anything else runs.
  allLines = joinStackedHeaderLines(allLines, detectedDelimiter)

  // Raw multi-line Chaturbate paste (not a proper CSV) — needs block-based stitching
  // instead of the line-by-line parsers below, which mangle date/"Tip From:"/tokens
  // onto separate rows.
  if (allLines.some(l => CB_TIP_FROM_RE.test(l.trim()) || CB_FAN_CLUB_RE.test(l.trim()) || CB_PRIVATE_SHOW_PATTERN.test(l.trim()) || /^(Snapchat|Social|Other)[^:]*:/i.test(l.trim()))) {
    return parseChaturbateMultiLine(allLines).map(normalizeTip).filter(isValidTip)
  }

  let startIdx = 0
  for (let i = 0; i < Math.min(5, allLines.length); i++) {
    const cols = parseCSVLine(allLines[i], detectedDelimiter)
    if (cols.filter(c => c.trim()).length >= 2) { startIdx = i; break }
  }

  const lines = allLines.slice(startIdx).filter(l => l.trim())
  if (lines.length === 0) return []

  const firstCols = parseCSVLine(lines[0], detectedDelimiter)

  const firstColIsDate = /^\d{2}[.\-/]\d{2}[.\-/]\d{4}/.test(firstCols[0]) ||
                         /^\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(firstCols[0]) ||
                         /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(firstCols[0]) ||
                         /^\d{10,13}$/.test(firstCols[0]) // MyFreeCams epoch-id column

  // Checks each COLUMN of the first line against the same normalizeHeaderName
  // used to map real header cells — never a raw substring match against the
  // whole line. A substring check (e.g. firstLine.includes('username')) is a
  // false-positive trap: a headerless MyFreeCams paste whose first data row
  // contains a real username like "username123" contains the literal
  // substring "username" and was wrongly routed to parseWithHeaders, which
  // then found no recognized columns and silently produced zero rows.
  const KNOWN_HEADER_FIELDS = new Set(['date_time','username','tokens','usd','tip_type','action','note','platform','session_id','token_balance'])
  const hasHeaders = !firstColIsDate && firstCols.some(c => KNOWN_HEADER_FIELDS.has(normalizeHeaderName(c)))

  const raw = hasHeaders ? parseWithHeaders(lines, platform, detectedDelimiter) : parseHeaderless(lines, platform, detectedDelimiter)
  // Per-row format-based platform fallback — runs after both parsers
  raw.forEach(r => {
    if (r.platform && r.platform !== 'Unknown') return
    if (/tip from:/i.test(text)) { r.platform = 'Chaturbate'; return }
    if (/^\d{2}\.\d{2}\.\d{4}/.test(r.dateRaw || '')) { r.platform = 'BongaCams'; return }
    if (/^\d{10,13}$/.test(String(r.dateRaw || '').trim())) { r.platform = 'MyFreeCams'; return }
  })
  return raw.map(normalizeTip).filter(isValidTip)
}

// Detects a run of 2+ consecutive single-column lines at the top of the
// paste followed by a data line whose column count matches that run
// exactly, and joins the header block into one delimiter-separated row.
// Deliberately conservative (exact column-count match required) so it
// never fires on ordinary single-column data.
function joinStackedHeaderLines(lines, delimiter) {
  let i = 0
  const headerCells = []
  while (i < lines.length && i < 10) {
    const line = lines[i].trim()
    if (!line) break
    if (parseCSVLine(line, delimiter).length !== 1) break
    headerCells.push(line)
    i++
  }
  if (headerCells.length < 2) return lines
  const dataLine = (lines[i] || '').trim()
  if (!dataLine) return lines
  if (parseCSVLine(dataLine, delimiter).length !== headerCells.length) return lines
  return [headerCells.join(delimiter), ...lines.slice(i)]
}

function normalizeTip(row) {
  const tokens = parseInt(row.tokens) || 0
  const rawUsd = parseFloat(row.usd) || 0
  const rate = tokenRate(row.platform)
  const usd = rawUsd > 0 ? rawUsd : parseFloat((tokens * rate).toFixed(2))
  const dateRaw = normalizeDate(row.dateRaw || row.date_time || '')
  const parsedDate = new Date(dateRaw)
  if (isNaN(parsedDate.getTime())) return null
  return {
    ...row,
    username: (row.username || '').toLowerCase().trim(),
    tokens,
    usd: parseFloat(usd.toFixed(2)),
    dateRaw,
    date_time: dateRaw,
  }
}

function isValidTip(t) {
  if (!t) return false
  return (
    typeof t.username === 'string' &&
    t.username.length > 0 &&
    !isNaN(t.tokens) &&
    !isNaN(t.usd) &&
    t.tokens >= 0 &&
    t.usd >= 0 &&
    (t.tokens > 0 || t.usd > 0)
  )
}

export function detectPlatform(text) {
  const lower = text.toLowerCase()
  // Keyword detection — platform name or signature phrase present in text
  if (lower.includes('chaturbate') || lower.includes('tip from:') || lower.includes('token balance') || lower.includes('token change')) return 'Chaturbate'
  if (lower.includes('bongacams') || lower.includes('bonga') || lower.includes('your payout')) return 'BongaCams'
  if (lower.includes('myfreecams') || lower.includes('mfc')) return 'MyFreeCams'
  if (lower.includes('stripchat')) return 'Stripchat'
  if (lower.includes('camsoda')) return 'CamSoda'
  // Structural detection — platform-unique data format when no platform name appears in the text
  if (/^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/m.test(text)) return 'BongaCams'
  if (/^\d{10,13}\t/m.test(text)) return 'MyFreeCams'
  return 'Unknown'
}

function normalizeDate(raw) {
  if (!raw) return null
  // MyFreeCams' "Token Sessions" export uses ordinal day numbers — "Jun 18th,
  // 2026 10:40 PM". `new Date()` cannot parse the "th"/"st"/"nd"/"rd" suffix
  // at all (returns Invalid Date), so every MFC row silently failed the
  // isNaN(new Date(...)) validity check below. Strip it before anything else.
  raw = raw.replace(/\b(\d{1,2})(st|nd|rd|th)\b/i, '$1')
  const euro = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?/)
  if (euro) return `${euro[2]}/${euro[1]}/${euro[3]}${euro[4] ? ' ' + euro[4] : ''}`
  if (activeDateOrder) {
    const num = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(.*)/)
    if (num) {
      const [d, m] = activeDateOrder === 'DMY' ? [num[1], num[2]] : [num[2], num[1]]
      // YYYY-MM-DD HH:MM: not re-matched when normalizeTip normalizes again,
      // and (with a time) read as local time exactly like MM/DD/YYYY was. A
      // date-only value gets 00:00 so it is not read as UTC midnight instead.
      const rest = num[4].replace('T', ' ').replace('Z', '').trim()
      return `${num[3]}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${rest || '00:00'}`
    }
  }
  const slash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})(.*)/)
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}${slash[4]}`
  // An explicit zone ('Z', '+02:00') marks a real instant — keep it, so the
  // upload stores that instant instead of re-reading it as wall-clock time.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim())) return raw.trim()
  return raw.replace('T', ' ').replace('Z', '')
}

function normalizeHeaderName(h) {
  const clean = re_clean(h)
  if (['token_balance','balance','running_balance'].includes(clean)) return 'token_balance'
  if (clean.includes('amount') && clean.includes('token')) return 'tokens'
  if (clean.includes('amount') && (clean.includes('usd') || clean.includes('dollar'))) return 'usd'
  if (['token_change','tokens_earned','tokens','token','credits'].includes(clean)) return 'tokens'
  if (['your_payout','usd_amount','payout','usd','earnings','amount_usd'].includes(clean)) return 'usd'
  if (['date_and_time','date_time','datetime','timestamp','date','time'].includes(clean)) return 'date_time'
  if (['member','username','user','tipper','sender','nickname','from'].includes(clean)) return 'username'
  // Session type column variations: chat_type, session_type, activity_type, show_type, paid_chat_type, etc.
  // Maps different platform export formats to the unified tip_type field for BC_PAID_CHAT_TYPES matching
  if (['transaction_type','chat_type','tip_type','type','session_type','activity_type','show_type','paid_chat_type'].includes(clean)) return 'tip_type'
  if (clean === 'action') return 'action'
  if (clean === 'note') return 'note'
  if (clean === 'platform') return 'platform'
  if (clean === 'session_id') return 'session_id'
  return clean
}

function re_clean(h) {
  return h.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function parseCSVLine(line, delimiter = ',') {
  const trimmed = line.trim()
  if (delimiter === ',' && trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.slice(1, -1).includes('"')) {
    return trimmed.slice(1, -1).split(',').map(v => v.trim())
  }
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === delimiter && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''))
      current = ''
    }
    else { current += char }
  }
  result.push(current.trim().replace(/^"|"$/g, ''))
  return result
}

// Detect whether a CSV uses comma or tab as delimiter
// Returns 'comma', 'tab', or null if detection is ambiguous
function detectDelimiter(text) {
  const lines = text.trim().split('\n').slice(0, 10) // Check first 10 lines
  if (lines.length === 0) return ',' // Default to comma

  let commaCount = 0
  let tabCount = 0

  for (const line of lines) {
    if (!line.trim()) continue
    // Count unquoted commas and tabs
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') inQuotes = !inQuotes
      else if (!inQuotes) {
        if (char === ',') commaCount++
        if (char === '\t') tabCount++
      }
    }
  }

  // Returns the actual delimiter CHARACTER, not a name. parseCSV passes this
  // straight into parseCSVLine as the split token, so returning 'comma'/'tab'
  // made it split on those literal words — which never occur in real data, so
  // every line collapsed to a single column and every row failed isValidTip.
  // Well-formed CSVs parsed to zero rows; only ambiguous files worked, because
  // the null branch fell back to the correct ','.
  if (tabCount > 0 && tabCount >= commaCount) return '\t'
  if (commaCount > 0) return ','
  // Ambiguous or no delimiters found — caller falls back to ','
  return null
}

// BongaCams paid-chat/spy-mode session types, matched against a row's
// "Chat Type" column (normalized to tip_type by normalizeHeaderName above).
// Duplicated from the identical BC_PAID_TYPES list in app/onboarding/page.js
// on purpose — that list drives the paste-flow's own client-side detection
// and is out of scope here; consolidating the two is a separate follow-up.
const BC_PAID_CHAT_TYPES = ['Private Chat', 'Full-Private Chat', 'Group Chat', 'Spy Mode']

// Chaturbate private show detection — matched against Action column
// "Private Show:" indicates a paid private show, "Tip From:" indicates free tips
const CB_PRIVATE_SHOW_PATTERN = /^Private Show:/i

// MyFreeCams private session detection — matched against Type column
// Type = "Private" indicates paid private earnings, "Tip" indicates free tips
const MFC_PRIVATE_TYPE = 'Private'

function parseWithHeaders(lines, platform, delimiter = ',') {
  const rawHeaders = parseCSVLine(lines[0], delimiter)
  const headers = rawHeaders.map(normalizeHeaderName)
  const results = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const vals = parseCSVLine(line, delimiter)
    const row = {}
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? '').trim() })

    const action = (row.action || '')
    const actionLower = action.toLowerCase()
    const tipType = (row.tip_type || '').toLowerCase()

    // Platform-specific private session detection:
    // 1. BongaCams: Chat Type column matches one of the paid session types
    const bcPaidChatType = BC_PAID_CHAT_TYPES.find(t => t.toLowerCase() === tipType) || null

    // 2. Chaturbate: Action field starts with "Private Show:" (paid), "Tip From:" (free)
    const cbIsPrivateShow = CB_PRIVATE_SHOW_PATTERN.test(action) || (platform === 'Chaturbate' && /^private show$/i.test(tipType))

    // 3. MyFreeCams: Type column equals "Private" (paid), "Tip" (free)
    const mfcIsPrivate = tipType === MFC_PRIVATE_TYPE.toLowerCase()

    if (actionLower.includes('transfer') || actionLower.includes('cash') ||
        actionLower.includes('outbound tip') || actionLower.includes('promoted room') ||
        actionLower.includes('referral')) continue

    if (tipType && !tipType.includes('tip') && !tipType.includes('private') &&
        !tipType.includes('spy') && !tipType.includes('show') && !tipType.includes('chat') &&
        !tipType.includes('received') && !tipType.includes('freechat') &&
        !tipType.includes('sale') && !/membership|fan club/.test(tipType)) continue

    if (tipType.includes('cash') || tipType.includes('transfer') ||
        tipType.includes('payout') || tipType.includes('refund')) continue

    let username = (row.username || row.user || '').trim()
    if (!username && row.action) {
      const m = row.action.match(/^[^:]+:\s*(\S+)/i)
      if (m) {
        username = m[1]
        if (!row.tip_type) {
          const al = row.action.toLowerCase()
          if (al.includes('private show')) row.tip_type = 'Private Show'
          else if (al.includes('spy show')) row.tip_type = 'Spy Show'
          else if (al.includes('tip from')) row.tip_type = 'Tip'
          else row.tip_type = 'Other'
        }
      } else continue
    }
    if (!username) continue

    // Strip $, comma, AND whitespace (incl. NBSP/narrow-NBSP thousands
    // separators like BongaCams' "1 507") before parsing — parseInt
    // otherwise stops at the first non-numeric character and silently
    // truncates e.g. "1 507" tokens down to 1. Mirrors the cleanup already
    // applied to usd just below.
    let tokens = parseInt((row.tokens || '0').toString().replace(/[$,\s]/g, '')) || 0
    if (tokens < 0) continue

    const rawUsd = (row.usd || row.usd_amount || '0').toString().replace(/[$,\s]/g, '')
    let usd = parseFloat(rawUsd) || 0
    if (usd < 0) usd = 0
    if (tokens <= 0 && usd <= 0) continue

    const rawDate = row.date_time || row.date || row.timestamp || ''
    const dateRaw = (platform === 'Chaturbate' ? chaturbateTimestamp(rawDate) : null) || normalizeDate(rawDate) || new Date().toISOString()
    const parsedDate = new Date(dateRaw)
    if (isNaN(parsedDate.getTime())) continue

    const rowPlatform = row.platform
      ? (row.platform.toLowerCase().includes('bonga') ? 'BongaCams'
        : row.platform.toLowerCase().includes('chaturbate') ? 'Chaturbate'
        : row.platform.toLowerCase().includes('mfc') || row.platform.toLowerCase().includes('freecams') ? 'MyFreeCams'
        : canonicalPlatform(row.platform) || platform)
      : platform

    // Determine if this is a paid session based on platform-specific patterns:
    // - BongaCams: checked via Chat Type column values
    // - Chaturbate: checked via Action field prefix "Private Show:"
    // - MyFreeCams: checked via Type column value "Private"
    const isPaidSession = bcPaidChatType || cbIsPrivateShow || mfcIsPrivate
    const sessionTypeValue = bcPaidChatType || (cbIsPrivateShow ? 'Private Show' : (mfcIsPrivate ? 'Private' : null))

    results.push({
      dateRaw, date_time: dateRaw, username,
      platform: rowPlatform || 'Unknown',
      tokens: tokens > 0 ? tokens : Math.round(usd / tokenRate(rowPlatform)),
      usd: usd > 0 ? parseFloat(usd.toFixed(2)) : parseFloat((tokens * tokenRate(rowPlatform)).toFixed(2)),
      tip_type: sessionTypeValue || ((/membership|fan club/i.test(action + ' ' + tipType) || /^Fan Club Membership(?::|$)/i.test(row.note || row.tip_note || '')) ? 'Membership' : /sale|snapchat|social/i.test(action + ' ' + tipType) ? 'Other Sale' : 'Tip'),
      tip_note: row.note || row.tip_note || '',
      // Paid-chat/spy-mode/private-show rows must be routed to paid_sessions, not tips —
      // stamped here so callers (e.g. /api/upload) can split the flat
      // parseCSV() result without re-deriving the classification themselves.
      // Applies to: BongaCams paid chat types, Chaturbate private shows, MyFreeCams private sessions
      ...(isPaidSession ? { is_paid_session: true, session_type: sessionTypeValue } : {}),
    })
  }
  return results
}

function parseHeaderless(lines, platform, delimiter = ',') {
  const results = []
  for (const line of lines) {
    if (!line.trim()) continue
    const vals = parseCSVLine(line, delimiter)
    if (vals.length === 0) continue

    if (vals.length >= 3 && vals[1] && vals[1].toLowerCase().includes('tip from')) {
      const dateRaw = normalizeDate(vals[0].replace(/"/g, ''))
      const m = vals[1].match(/tip from[:\s]*(\S+)/i)
      const username = m ? m[1] : null
      const tokens = parseInt(vals[2]) || 0
      if (!username || tokens <= 0) continue
      if (vals[1].toLowerCase().includes('transfer') || vals[1].toLowerCase().includes('cash')) continue
      if (!dateRaw || isNaN(new Date(dateRaw).getTime())) continue
      results.push({ dateRaw, date_time: dateRaw, username, platform: 'Chaturbate', tokens, usd: parseFloat((tokens * tokenRate('Chaturbate')).toFixed(2)), tip_type: 'Tip', tip_note: '' })
      continue
    }

    if (vals.length >= 4 && /^\d{2}\.\d{2}\.\d{4}/.test(vals[0])) {
      const dateRaw = normalizeDate(vals[0])
      const username = vals[1] || null
      const tokens = parseInt(vals[3]) || 0
      const usd = parseFloat((vals[4] || '').replace(/[$,]/g, '')) || 0
      if (!username || (tokens <= 0 && usd <= 0)) continue
      if (!dateRaw || isNaN(new Date(dateRaw).getTime())) continue
      results.push({ dateRaw, date_time: dateRaw, username, platform: platform || 'BongaCams', tokens: tokens > 0 ? tokens : Math.round(usd / tokenRate(platform || 'BongaCams')), usd: usd > 0 ? parseFloat(usd.toFixed(2)) : parseFloat((tokens * tokenRate(platform || 'BongaCams')).toFixed(2)), tip_type: vals[2] || 'Tip', tip_note: '' })
      continue
    }

    // MyFreeCams "Token Sessions" paste — epoch_id / formatted date / tokens /
    // username / type ("Tip" or "Private"), e.g.:
    //   1746555770  Jun 18th, 2026 10:40 PM  500  username123  Tip
    // Previously fell through to the generic branch below, which reads
    // column 0 as the date (the epoch id, not a parseable date) and column 1
    // as the username (actually the date) — every row failed validation and
    // this, MFC's own documented paste format, parsed to zero rows.
    if (vals.length >= 5 && /^\d{10,13}$/.test(vals[0])) {
      const dateRaw = normalizeDate(vals[1])
      const username = (vals[3] || '').trim()
      const tokens = parseInt(vals[2]) || 0
      const typeVal = (vals[4] || 'Tip').trim()
      if (!username || tokens <= 0) continue
      if (!dateRaw || isNaN(new Date(dateRaw).getTime())) continue
      const isPrivate = typeVal.toLowerCase() === MFC_PRIVATE_TYPE.toLowerCase()
      results.push({
        dateRaw, date_time: dateRaw, username, platform: 'MyFreeCams',
        tokens, usd: parseFloat((tokens * tokenRate('MyFreeCams')).toFixed(2)),
        tip_type: isPrivate ? 'Private' : 'Tip', tip_note: '',
        ...(isPrivate ? { is_paid_session: true, session_type: 'Private' } : {}),
      })
      continue
    }

    if (vals.length >= 2) {
      const dateRaw = normalizeDate(vals[0]) || vals[0]
      const username = (vals[1] || '').trim()
      if (!username) continue
      if (!dateRaw || isNaN(new Date(dateRaw).getTime())) continue
      let tokens = 0, usd = 0
      for (let i = 2; i < vals.length; i++) {
        const raw = vals[i]
        const num = parseFloat(raw.replace(/[$,]/g, ''))
        if (isNaN(num) || num <= 0) continue
        if (raw.includes('$')) { usd = num }
        else if (i === 2 && tokens === 0) { tokens = Math.round(num) }
      }
      if (tokens === 0 && usd > 0) tokens = Math.round(usd / tokenRate(platform))
      if (usd === 0 && tokens > 0) usd = parseFloat((tokens * tokenRate(platform)).toFixed(2))
      if (tokens === 0 && usd === 0) continue
      results.push({ dateRaw, date_time: dateRaw, username, platform: platform || 'Unknown', tokens, usd: parseFloat(usd.toFixed(2)), tip_type: 'Tip', tip_note: '' })
    }
  }
  return results
}

// detectSessions/finalizeSession live in ./analytics/sessions.js — shared with
// app/live/page.js. Do not redefine this grouping logic here.

// ── FAN IDENTITY ─────────────────────────────────────────────────────────
// "Never merge fans across platforms by username alone" (formula-requirments
// skill). A username is only unique within one platform.
function fanKey(platform, username) {
  const normalized = (username || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '') // Remove leading @ symbols
  return `${platform || 'Unknown'}:${normalized}`
}

// ── FAN BEHAVIORAL VISITS ────────────────────────────────────────────────
// A raw tip is not an independent behavioral observation: several tips sent
// minutes apart in one sitting are one visit, not evidence of several
// separate returns. This groups ONE FAN's own tips (already scoped to a
// single platform+username via fanKey upstream) into visits using the same
// gap constant the creator-stream session detector uses (SESSION_GAP_MS,
// lib/analytics/sessions.js) -- not a new threshold, the existing one,
// applied to a different partition of the data. detectSessions() itself
// cannot be reused directly here: it groups an entire creator's tip stream
// across ALL fans by platform+gap (shared with app/live/page.js for
// stream-level metrics), so a single multi-fan creator session would
// otherwise collapse many different fans' independent visits into one.
function groupFanVisits(tips) {
  if (!tips || tips.length === 0) return []
  const sorted = [...tips]
    .map(t => ({ ...t, _ts: new Date(t.dateRaw || t.date_time) }))
    .filter(t => !isNaN(t._ts.getTime()))
    .sort((a, b) => a._ts - b._ts)
  if (sorted.length === 0) return []

  const visits = []
  let cur = null
  sorted.forEach(t => {
    if (!cur) {
      cur = { startTime: t._ts, endTime: t._ts, tips: [t] }
    } else if (t._ts - cur.endTime <= SESSION_GAP_MS) {
      cur.endTime = t._ts
      cur.tips.push(t)
    } else {
      visits.push(cur)
      cur = { startTime: t._ts, endTime: t._ts, tips: [t] }
    }
  })
  if (cur) visits.push(cur)

  return visits.map(v => ({
    startTime: v.startTime,
    endTime: v.endTime,
    tipCount: v.tips.length,
    totalUSD: parseFloat(v.tips.reduce((s, t) => s + (t.usd || 0), 0).toFixed(2)),
  }))
}

// Minimum tip count before we trust a fan's own history as a baseline for
// TIER classification only (New/Developing split, identifyWhales below) —
// unchanged, tier logic is out of scope for the behavioral-observation
// correction. Carried over from the original calcChurnRisk's `count < 3`
// floor.
const FAN_MIN_TIPS_FOR_BASELINE = 3

// Minimum DISTINCT BEHAVIORAL VISITS (not raw tips) before we trust a fan's
// own history as an established personal baseline for behavioral claims
// (calcFanBehavioralState, expectedNextTip, tipProbability, trend, spend
// decline). Same value (3) as FAN_MIN_TIPS_FOR_BASELINE -- this is the
// existing product minimum translated into the correct observation unit,
// not a new threshold. A fan can clear FAN_MIN_TIPS_FOR_BASELINE (tier)
// while remaining below this bar (behavioral baseline) if their tips all
// came from one or two visits.
const FAN_MIN_OBSERVATIONS_FOR_BASELINE = 3

// ── CREATOR/PLATFORM ACTIVITY CONTEXT ────────────────────────────────────
// A fan's absence can only be evidence of that FAN's decline if the creator
// actually had the opportunity to be tipped on that same platform recently,
// and if the fan data itself isn't stale. This computes that context once,
// per platform, from the creator's own meaningfulSessions (the existing
// "creator had a meaningful opportunity" concept — sessionQuality ===
// 'meaningful') and the tips' own event timestamps (never import time).
//
// RISK_SIGNALS_PAUSE_DAYS reuses the same 60-day floor already used for the
// pre-existing fan-tier Dormant rule below (`daysSinceLastTip > max(60, ...)`)
// — one constant, not a new invented one.
const RISK_SIGNALS_PAUSE_DAYS = 60
// DATA_STALE_GAP_DAYS is NEW and NOT derived from existing logic — flagged in
// the report as unvalidated and needing product sign-off. It only decides
// when to show "Data Needs Updating" instead of suppressing risk silently.
const DATA_STALE_GAP_DAYS = 14

export function getPlatformRiskContext(tips, meaningfulSessions = []) {
  const now = Date.now()
  const platforms = new Set()
  tips.forEach(t => platforms.add(t.platform || 'Unknown'))
  meaningfulSessions.forEach(s => platforms.add(s.platform || 'Unknown'))

  const ctx = {}
  platforms.forEach(p => {
    const platTips = tips.filter(t => (t.platform || 'Unknown') === p)
    const platSessions = meaningfulSessions.filter(s => (s.platform || 'Unknown') === p)
    const lastTipMs = platTips.length
      ? Math.max(...platTips.map(t => new Date(t.dateRaw || t.date_time).getTime()))
      : null
    const lastSessionMs = platSessions.length
      ? Math.max(...platSessions.map(s => new Date(s.startTime).getTime()))
      : null
    const lastTipDaysAgo = lastTipMs !== null && !isNaN(lastTipMs) ? Math.floor((now - lastTipMs) / 86400000) : null
    const lastMeaningfulSessionDaysAgo = lastSessionMs !== null && !isNaN(lastSessionMs)
      ? Math.floor((now - lastSessionMs) / 86400000) : null

    // No meaningful same-platform session at all, or none recently enough —
    // the creator hasn't had the opportunity to be tipped, so absence of fan
    // tips cannot be attributed to fan decline.
    const riskSignalsPaused = lastMeaningfulSessionDaysAgo === null || lastMeaningfulSessionDaysAgo > RISK_SIGNALS_PAUSE_DAYS

    // Creator has streamed meaningfully on this platform more recently than
    // the newest tip on record for it, by more than the gap threshold — the
    // fan/tip import is behind the creator's real activity, so "no tips"
    // reflects a data gap, not fan behavior.
    const dataNeedsUpdating = !riskSignalsPaused && lastTipDaysAgo !== null &&
      (lastTipDaysAgo - lastMeaningfulSessionDaysAgo) > DATA_STALE_GAP_DAYS

    ctx[p] = {
      platform: p,
      riskSignalsPaused,
      dataNeedsUpdating,
      lastMeaningfulSessionDaysAgo,
      lastTipDaysAgo,
      dataAgeDays: lastTipDaysAgo,
    }
  })
  return ctx
}

// ── FAN BEHAVIORAL STATE ─────────────────────────────────────────────────
// Single source of truth for churn/risk labeling — replaces calcChurnRisk.
// Two independent dimensions, per the spec: `tier` (relationship/type,
// computed in identifyWhales below) and `behavioralState` (this function).
//
// CURRENT (before this change): gated on raw tipCount >= FAN_MIN_TIPS_FOR_BASELINE.
// NEW: gated on observationCount (distinct behavioral visits, see
//   groupFanVisits above) >= FAN_MIN_OBSERVATIONS_FOR_BASELINE.
// REASON: a fan can send several tips in one sitting; that is one visit,
//   not several independent observations of return behavior. Gating on raw
//   tip count let a single burst satisfy the baseline and immediately
//   qualify for At Risk once the (near-zero, burst-derived) cadence was
//   exceeded. Gating on distinct visits requires the fan to have actually
//   returned multiple times before any behavioral claim is made.
//
// A fan can only be labeled At Risk when ALL of:
//   (a) an established per-fan baseline exists (observationCount >= FAN_MIN_OBSERVATIONS_FOR_BASELINE)
//   (b) the creator had meaningful same-platform opportunity recently (platformCtx)
//   (c) the comparison is same-platform (platformCtx is keyed by the fan's own platform)
//   (d) the fan's own data isn't stale relative to the creator's recent activity (platformCtx)
//   (e) there is a meaningful decline from the fan's own baseline — frequency
//       (daysSinceLastTip vs avgDaysBetweenTips, now visit-cadence-based) OR
//       spend amount (this fan's own recent VISITS' spend vs their own
//       earlier visits' spend — see spendDeclineRatio in identifyWhales)
function calcFanBehavioralState({ daysSinceLastTip, avgDaysBetweenTips, observationCount, spendDeclineRatio, platformCtx }) {
  // Fewer than 3 distinct visits: never enough baseline to claim decline of
  // any kind, regardless of how many raw tips those visits contained.
  if (observationCount < FAN_MIN_OBSERVATIONS_FOR_BASELINE) {
    if (observationCount <= 0) return { state: 'Insufficient Data', reason: 'No tip history yet.' }
    // Still within a plausible early window since their (only) visit(s) —
    // treat as a developing relationship, not a risk signal either way.
    if (daysSinceLastTip <= 45) {
      return { state: 'New/Developing', reason: `Only ${observationCount} visit${observationCount === 1 ? '' : 's'} so far — too early to assess a pattern.` }
    }
    return { state: 'Insufficient Data', reason: `Only ${observationCount} visit${observationCount === 1 ? '' : 's'} on record and no recent activity — not enough history to assess behavior.` }
  }

  const r = avgDaysBetweenTips > 0 ? daysSinceLastTip / avgDaysBetweenTips : (daysSinceLastTip > 0 ? Infinity : 0)
  const hasSpendDecline = spendDeclineRatio !== null && spendDeclineRatio !== undefined && spendDeclineRatio <= 0.5
  const stillOnSchedule = r < 1 && !hasSpendDecline
  const evidenceOfDecline = r >= 2 || hasSpendDecline

  // Creator context must support attributing an absence to the FAN — never
  // fabricated from "time passed" alone.
  const creatorEligible = !!platformCtx && !platformCtx.riskSignalsPaused && !platformCtx.dataNeedsUpdating

  if (!creatorEligible) {
    if (stillOnSchedule) return { state: 'Active', reason: 'Tipping on their normal schedule.' }
    const reason = !platformCtx || platformCtx.riskSignalsPaused
      ? "Creator hasn't had meaningful activity on this platform recently, so this fan's absence can't be attributed to fan decline."
      : "This platform's fan/tip data may be behind the creator's recent activity, so current behavior may not be complete."
    return { state: 'Dormant', reason }
  }

  if (stillOnSchedule) return { state: 'Active', reason: 'Tipping on their normal schedule.' }
  if (evidenceOfDecline) {
    const reason = hasSpendDecline && r < 2
      ? "Tip amounts have dropped well below this fan's own baseline while the creator remains active on this platform."
      : `Hasn't tipped in ${Math.round(daysSinceLastTip)} days vs. their usual ~${Math.round(avgDaysBetweenTips)}-day pattern.`
    return { state: 'At Risk', reason }
  }
  return { state: 'Watch', reason: "Some deviation from this fan's normal pattern, but not enough evidence yet to call it at risk." }
}

// Backward-compatible shape for existing UI (app/dashboard/page.js) that
// reads `fan.churnRisk.level` / `.risk` — derived from the one behavioral
// state above rather than computed separately, so there is exactly one
// churn formula, just exposed under two field names during migration.
function legacyChurnRiskShape(state) {
  switch (state) {
    case 'Active':          return { level: 'Low',      risk: 'Active' }
    case 'Watch':           return { level: 'Medium',   risk: 'Watch closely' }
    case 'At Risk':         return { level: 'High',     risk: 'At risk' }
    case 'Dormant':         return { level: 'Dormant',  risk: 'Dormant' }
    case 'New/Developing':
    case 'Insufficient Data':
    default:                return { level: 'Unknown',  risk: 'Insufficient data' }
  }
}

export function identifyWhales(tips, meaningfulSessions = [], userTz = 'UTC') {
  const fanMap = {}
  tips.forEach(t => {
    const key = fanKey(t.platform, t.username)
    if (!fanMap[key]) { fanMap[key] = { username: t.username, totalUSD: 0, totalTokens: 0, tipCount: 0, tips: [], platform: t.platform, tipNotes: [] } }
    fanMap[key].totalUSD += t.usd || 0
    fanMap[key].totalTokens += t.tokens || 0
    fanMap[key].tipCount += 1
    fanMap[key].tips.push(t)
    if (t.tip_note) fanMap[key].tipNotes.push(t.tip_note)
  })

  const allFans = Object.values(fanMap)
  const sorted = [...allFans].sort((a, b) => b.totalUSD - a.totalUSD)
  const totalFans = sorted.length
  // O(1) rank lookup instead of sorted.findIndex(...) per fan (was O(fans^2)).
  // Keyed by platform+username now, matching the fan-identity fix above.
  const rankByFanKey = new Map(sorted.map((s, i) => [fanKey(s.platform, s.username), i]))
  const platformRiskContext = getPlatformRiskContext(tips, meaningfulSessions)

  return allFans.map(f => {
    const fanSorted = [...f.tips].sort((a, b) => new Date(b.dateRaw || b.date_time) - new Date(a.dateRaw || a.date_time))
    const lastTipDate = new Date(fanSorted[0].dateRaw || fanSorted[0].date_time)
    const firstTipDate = new Date(fanSorted[fanSorted.length - 1].dateRaw || fanSorted[fanSorted.length - 1].date_time)
    const daysSinceLastTip = Math.floor((Date.now() - lastTipDate) / 86400000)
    const lifetimeDays = Math.max(Math.floor((lastTipDate - firstTipDate) / 86400000), 1)
    // TIER-ONLY raw-tip interval. Tier classification (below) is explicitly
    // out of scope for the behavioral-observation correction and is
    // preserved byte-for-byte, including this fallback -- it must NOT be
    // replaced by the visit-based avgDaysBetweenVisits used for behavioral
    // fields further down, which is intentionally a different, nullable
    // value with no fabricated fallback.
    const rawAvgDaysBetweenTipsForTier = f.tipCount > 1 ? Math.max(1, lifetimeDays / (f.tipCount - 1)) : 30
    const biggestTip = Math.max(...f.tips.map(t => t.usd))
    const fanRankIndex = rankByFanKey.get(fanKey(f.platform, f.username))
    const percentileRank = totalFans > 1 ? fanRankIndex / (totalFans - 1) : 0

    // ── TIER (relationship/type) — independent of behavioral state ────────
    // Whale/Shark/Dormant thresholds and priority order preserved exactly as
    // before. New/Developing and Occasional fill the previously-uniform
    // "Regular" bucket for low-history/low-frequency fans. UNCHANGED by the
    // behavioral-observation correction (out of scope).
    let tier = 'Regular'
    if (percentileRank <= 0.05) tier = 'Whale'
    else if (percentileRank <= 0.20) tier = 'Shark'
    else if (f.tipCount < FAN_MIN_TIPS_FOR_BASELINE) tier = 'New/Developing'
    else if (daysSinceLastTip > Math.max(60, rawAvgDaysBetweenTipsForTier * 3)) tier = 'Dormant'
    else if (f.tipCount < 5) tier = 'Occasional' // NEW threshold (unvalidated) — see report

    const privateTips = f.tips.filter(t => t.tip_type?.toLowerCase().includes('private') || t.tip_note?.toLowerCase().includes('private'))
    const hourCounts = {}
    f.tips.forEach(t => { const h = toLocalHour(t.dateRaw || t.date_time, userTz); hourCounts[h] = (hourCounts[h] || 0) + 1 })
    const mostActiveHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]
    const spendPercentile = Math.round((1 - percentileRank) * 100)

    // ── BEHAVIORAL OBSERVATIONS: distinct visits, not raw tips ────────────
    // CURRENT (before this change): avgDaysBetweenTips = lifetimeDays /
    //   (tipCount - 1), fallback 30 when tipCount <= 1; spend-decline and
    //   trend split raw tips in half chronologically; baseline gated on
    //   raw tipCount >= FAN_MIN_TIPS_FOR_BASELINE.
    // NEW: all of the above operate on `visits` (groupFanVisits output —
    //   tips grouped using the same SESSION_GAP_MS gap the creator-stream
    //   session detector uses), gated on observationCount (visits.length)
    //   >= FAN_MIN_OBSERVATIONS_FOR_BASELINE. No fabricated 30-day fallback:
    //   an unestablished cadence is null, not invented.
    // REASON: 10 tips in one sitting must not read as "returns every day."
    const visits = groupFanVisits(f.tips)
    const observationCount = visits.length

    let avgDaysBetweenVisits = null
    const daysBetweenVisitsArr = []
    if (observationCount >= 2) {
      for (let i = 1; i < observationCount; i++) {
        daysBetweenVisitsArr.push((visits[i].startTime - visits[i - 1].startTime) / 86400000)
      }
      const totalSpanDays = (visits[observationCount - 1].startTime - visits[0].startTime) / 86400000
      // Mean gap between visit starts. Deliberately no Math.max(1, ...) floor
      // and no hardcoded fallback -- if a fan's 2-3 visits all landed on the
      // same day, the true observed cadence IS sub-daily; flooring it to "1
      // day" would fabricate elapsed history that wasn't actually observed.
      // (This does mean a same-day multi-visit fan can still produce a very
      // small, technically-honest cadence number that reads oddly if
      // displayed without qualification -- flagged in the final report as a
      // residual case requiring a product decision, not resolved by
      // inventing a new elapsed-day threshold here.)
      avgDaysBetweenVisits = totalSpanDays / (observationCount - 1)
    }

    // Spend-decline baseline: this fan's own recent VISITS' spend vs their
    // own earlier visits' spend (split visit history in half chronologically
    // -- not raw tips, so one 10-tip burst visit can't be internally split
    // into fake "earlier" and "recent" halves of itself). Needs at least 4
    // visits to form two non-trivial halves; otherwise null (not computable
    // — never fabricated). Direct unit translation of the existing ">= 4"
    // requirement (was raw tips, now visits) -- not a new threshold value.
    let spendDeclineRatio = null
    if (observationCount >= 4) {
      const mid = Math.floor(observationCount / 2)
      const earlier = visits.slice(0, mid)
      const recent = visits.slice(mid)
      const earlierAvg = earlier.reduce((s, v) => s + v.totalUSD, 0) / earlier.length
      const recentAvg = recent.reduce((s, v) => s + v.totalUSD, 0) / recent.length
      if (earlierAvg > 0) spendDeclineRatio = parseFloat((recentAvg / earlierAvg).toFixed(3))
    }

    const baselineEstablished = observationCount >= FAN_MIN_OBSERVATIONS_FOR_BASELINE
    const platformCtx = platformRiskContext[f.platform || 'Unknown'] || null
    const behavioral = calcFanBehavioralState({ daysSinceLastTip, avgDaysBetweenTips: avgDaysBetweenVisits, observationCount, spendDeclineRatio, platformCtx })

    return {
      username: f.username, totalUSD: parseFloat(f.totalUSD.toFixed(2)), totalTokens: f.totalTokens,
      tipCount: f.tipCount, avgTipSize: parseFloat((f.totalUSD / f.tipCount).toFixed(2)),
      biggestTip: parseFloat(biggestTip.toFixed(2)), platform: f.platform, tier,
      lastTipDate: lastTipDate.toISOString(), firstTipDate: firstTipDate.toISOString(),
      daysSinceLastTip,
      // Field NAME kept as avgDaysBetweenTips for compatibility (per spec),
      // but its MEANING is now avg days between distinct visits.
      // ACTUAL GATE (documented as-is; product decision pending): it is set
      // from 2 visits (observationCount >= 2) and null below that — NOT from
      // FAN_MIN_OBSERVATIONS_FOR_BASELINE (3) as an earlier comment claimed.
      // The 3-visit baseline gates expectedNextTip, tipProbability,
      // lifetimeValue and behavioralState only. So Top Earners
      // (page.js "every ~Nd", shown when tipCount > 1) and the fan profile can
      // show a cadence from 2 visits, while "Who deserves your attention"
      // (CommandCenter, needs expectedNextTip) only does so from 3.
      avgDaysBetweenTips: avgDaysBetweenVisits !== null ? parseFloat(avgDaysBetweenVisits.toFixed(1)) : null,
      daysBetweenTipsArr: daysBetweenVisitsArr,
      observationCount, baselineEstablished,
      // tipProbability: CURRENT was hardcoded 85/70/50/30/15% buckets framed
      // as a statistical probability, computed unconditionally (even at 1
      // tip). NEW: still the same internal bucket math (no new probability
      // model invented, per spec), but now null unless a personal baseline
      // is established -- so it can no longer misrepresent a single-visit
      // fan's likelihood of return as a computed percentage.
      tipProbability: (baselineEstablished && avgDaysBetweenVisits) ? calcTipProbability(daysSinceLastTip, avgDaysBetweenVisits) : null,
      // trend: calcFanTrend now receives `visits`, not raw tips (see
      // function below) -- a burst of tips in one visit can no longer
      // manufacture a trend by being split against itself.
      trend: calcFanTrend(visits),
      // behavioralState: the new, correct, eligibility-gated status (spec Step 1).
      behavioralState: behavioral.state, behavioralStateReason: behavioral.reason,
      spendDeclineRatio, platformRiskContext: platformCtx,
      // churnRisk: kept only for backward compatibility with existing UI —
      // derived 1:1 from behavioralState above, not a second formula.
      churnRisk: legacyChurnRiskShape(behavioral.state),
      lifetimeValue: calcLifetimeValue(f.totalUSD, lifetimeDays, observationCount),
      // expectedNextTip: CURRENT was computed unconditionally from
      // avg-based subtraction, even for a 1-2 tip fan (using the 30-day
      // fallback). NEW: null unless a personal baseline is established --
      // "likely to tip again" cannot exist before CamCash has seen the fan
      // return multiple times.
      expectedNextTip: (baselineEstablished && avgDaysBetweenVisits !== null) ? calcExpectedNextTip(daysSinceLastTip, avgDaysBetweenVisits) : null,
      hasPrivates: privateTips.length > 0, privateCount: privateTips.length,
      privateSpent: parseFloat(privateTips.reduce((s, t) => s + t.usd, 0).toFixed(2)),
      typicalOnlineHours: mostActiveHour ? `${mostActiveHour[0]}:00 - ${parseInt(mostActiveHour[0]) + 2}:00` : 'Unknown',
      tipNotes: f.tipNotes, tips: f.tips, isTopSpender: percentileRank <= 0.05, spendPercentile
    }
  }).sort((a, b) => b.totalUSD - a.totalUSD)
}

function calcTipProbability(d, avg) {
  if (d < avg * 0.5)  return { level: 'High',        percentage: 85 }
  if (d < avg)        return { level: 'Medium-High',  percentage: 70 }
  if (d < avg * 1.5)  return { level: 'Medium',       percentage: 50 }
  if (d < avg * 2)    return { level: 'Low-Medium',   percentage: 30 }
  return                     { level: 'Low',           percentage: 15 }
}

// CURRENT (before this change): gated on days>=7 && tipCount>=2 -- two tips
//   sent minutes apart within one short visit could clear this and still
//   produce a run-rate confidence-labeled 'Low' (conflating "insufficient
//   data" with "valid-but-weak estimate", the distinction this task
//   requires to be enforced).
// NEW: gated on days>=7 && observationCount>=FAN_MIN_OBSERVATIONS_FOR_BASELINE
//   (distinct visits, not raw tips). Below that bar, returns nulls rather
//   than a number-plus-'Low'-confidence -- insufficient data means no
//   run-rate exists yet, not a weak one.
// REASON: the days>=7 floor alone doesn't prevent a burst-then-nothing fan
//   (e.g. 2 tips in one visit, 7 days ago) from producing a confident-
//   looking monthly figure; requiring an established visit baseline does.
function calcLifetimeValue(spent, days, observationCount) {
  if (days < 7 || observationCount < FAN_MIN_OBSERVATIONS_FOR_BASELINE) {
    return { prediction: null, confidence: null, monthly: null }
  }
  const p = (spent / days) * 365
  return { prediction: parseFloat(p.toFixed(2)), confidence: observationCount > 10 ? 'High' : observationCount > 5 ? 'Medium' : 'Low', monthly: parseFloat((p / 12).toFixed(2)) }
}

function calcExpectedNextTip(d, avg) {
  const n = Math.max(0, Math.round(avg - d))
  if (n === 0) return 'Overdue'
  if (n === 1) return 'Tomorrow'
  if (n <= 3)  return `In ${n} days`
  if (n <= 7)  return `In ~${n} days`
  return `In ~${Math.round(n / 7)} weeks`
}

// ── FAN TREND SIGNAL ─────────────────────────────────────────────────────
// Trending is a separate signal from tier/behavioralState — describes whether a
// fan's own spending is moving relative to their own established pattern,
// never relative to other fans or a single outlier tip.
//
// CURRENT (before this change): tipsAsc — raw tips, sorted oldest -> newest
//   — split in half, comparing per-tip average spend.
// NEW: visits — this fan's distinct behavioral visits (groupFanVisits
//   output, from identifyWhales), sorted oldest -> newest, split in half,
//   comparing per-visit average spend.
// REASON: a single burst visit with several tips of increasing size would
//   previously manufacture an "up" trend purely from tip-to-tip noise
//   inside one sitting. Comparing visits instead requires the fan to have
//   actually returned multiple times, with the later returns spending more
//   or less than the earlier ones.
// NOTE: TREND_CHANGE_THRESHOLD of 0.25 is unchanged -- a starting point,
// not yet validated against real fan spending distributions — flag per
// formula-requirements. The "4" and "8" counts below are also unchanged
// values, now counting visits instead of tips (direct unit translation,
// not a new threshold, per spec).
const TREND_CHANGE_THRESHOLD = 0.25

function calcFanTrend(visits) {
  const count = visits.length
  // Fewer than 4 visits isn't enough to compare a "before" and "after"
  // window without a single visit dominating either side.
  if (count < 4) {
    return { direction: 'insufficient', label: 'New / Insufficient Data', confidence: 'none' }
  }

  const mid = Math.floor(count / 2)
  const priorHalf = visits.slice(0, mid)
  const recentHalf = visits.slice(mid)
  const avg = arr => arr.reduce((s, v) => s + (v.totalUSD || 0), 0) / arr.length
  const priorAvg = avg(priorHalf)
  const recentAvg = avg(recentHalf)

  if (priorAvg <= 0) {
    return { direction: 'insufficient', label: 'New / Insufficient Data', confidence: 'none' }
  }

  const pctChange = (recentAvg - priorAvg) / priorAvg
  const confidence = count >= 8 ? 'Medium' : 'Low'

  if (pctChange >= TREND_CHANGE_THRESHOLD) {
    return { direction: 'up', label: 'Trending Up', confidence, pctChange: parseFloat((pctChange * 100).toFixed(1)) }
  }
  if (pctChange <= -TREND_CHANGE_THRESHOLD) {
    return { direction: 'down', label: 'Trending Down', confidence, pctChange: parseFloat((pctChange * 100).toFixed(1)) }
  }
  return { direction: 'stable', label: 'Stable', confidence, pctChange: parseFloat((pctChange * 100).toFixed(1)) }
}

export function generateWhaleAlerts(whales) {
  let alerts = []
  if (!whales.length) return alerts
  const totalSpend = whales.reduce((s, w) => s + w.totalUSD, 0)
  const avgSpend = totalSpend / whales.length
  const churnThreshold = avgSpend * 0.5
  const tipLikelyThreshold = avgSpend * 0.8

  whales.forEach(w => {
    if (w.tier === 'Whale' && w.daysSinceLastTip < 7 && w.isTopSpender)
      alerts.push({ type: 'new_whale', severity: 'success', icon: '🐳', whale: w, message: `${w.username} just became your top tipper! ($${w.totalUSD.toFixed(0)} lifetime)`, action: 'Send a thank you message' })
    // churnRisk.level can only be 'High'/'Critical' when behavioralState is
    // 'At Risk', which now already requires an established visit baseline
    // (see calcFanBehavioralState) -- this alert can't fire from a burst.
    // avgDaysBetweenTips can be null even when this fires if daysBetween...Arr
    // is empty for some other reason; guarded below rather than assumed.
    if ((w.churnRisk.level === 'High' || w.churnRisk.level === 'Critical') && w.totalUSD >= churnThreshold && w.observationCount >= 3) {
      const freq = getTipFrequency(w.daysBetweenTipsArr)
      const freqText = freq ? `they typically tip ${freq}` : (w.avgDaysBetweenTips != null ? `they usually tip every ${w.avgDaysBetweenTips.toFixed(0)} days` : null)
      if (freqText) alerts.push({ type: 'churn_risk', severity: 'warning', icon: '⚠️', whale: w, message: `${w.username} hasn't tipped in ${w.daysSinceLastTip} days — ${freqText}`, action: 'Re-engage now before they go cold' })
    }
    // tipProbability is null below the same established-baseline gate (see
    // identifyWhales) -- this can no longer claim a "likely to tip soon"
    // percentage for a fan CamCash hasn't seen return multiple times.
    if (w.tipProbability?.level === 'High' && w.totalUSD >= tipLikelyThreshold)
      alerts.push({ type: 'tip_likely', severity: 'info', icon: '💰', whale: w, message: `${w.username} is likely to tip soon (${w.tipProbability.percentage}% probability based on their pattern)`, action: 'Go live during their active hours' })
    if (w.daysSinceLastTip > 0 && w.daysSinceLastTip <= 3 && w.tipCount > 5) {
      if (w.avgDaysBetweenTips != null && w.daysSinceLastTip > w.avgDaysBetweenTips * 1.5)
        alerts.push({ type: 'returned', severity: 'success', icon: '🎉', whale: w, message: `${w.username} just tipped again after ${w.daysSinceLastTip} days away — welcome them back!`, action: 'Send a thank you message' })
    }
  })
  alerts = alerts.filter(a => isUserRelevant(a.whale))
  const order = { critical: 0, warning: 1, info: 2, success: 3 }
  return alerts.sort((a, b) => order[a.severity] - order[b.severity])
}

// tz: the creator's selected IANA timezone. "Tonight" means the creator's
// local weekday, so both today and each session's weekday are read on that
// clock. Defaults to 'UTC' only for callers outside aggregateRows that have
// not passed one (their previous behaviour).
export function predictRevenue(tips, sessions, tz = 'UTC') {
  if (!sessions.length) return null
  const predictions = {}
  const now = Date.now()
  const last7 = tips.filter(t => (now - new Date(t.dateRaw || t.date_time)) / 86400000 <= 7)
  predictions.next7Days = { amount: parseFloat(last7.reduce((s, t) => s + t.usd, 0).toFixed(2)), confidence: last7.length > 20 ? 'High' : last7.length > 10 ? 'Medium' : 'Low' }
  const last30 = tips.filter(t => (now - new Date(t.dateRaw || t.date_time)) / 86400000 <= 30)
  const prev30 = tips.filter(t => { const d = (now - new Date(t.dateRaw || t.date_time)) / 86400000; return d > 30 && d <= 60 })
  const last30Rev = last30.reduce((s, t) => s + t.usd, 0)
  const prev30Rev = prev30.reduce((s, t) => s + t.usd, 0)
  const weeklyTrend = prev30Rev > 0 ? ((last30Rev - prev30Rev) / prev30Rev) * 100 : null
  predictions.next30Days = { amount: parseFloat(last30Rev.toFixed(2)), confidence: last30.length > 50 ? 'High' : last30.length > 25 ? 'Medium' : 'Low', trend: weeklyTrend !== null ? parseFloat(weeklyTrend.toFixed(1)) : null }
  const todayDow = toLocalDow(new Date(), tz)
  const sameDaySessions = sessions.filter(s => toLocalDow(s.startTime, tz) === todayDow)
  if (sameDaySessions.length >= 3) {
    const amounts = sameDaySessions.map(s => s.totalUSD).sort((a, b) => a - b)
    const avg = amounts.reduce((s, x) => s + x, 0) / amounts.length
    const p10idx = Math.max(0, Math.floor(amounts.length * 0.10))
    const p90idx = Math.min(amounts.length - 1, Math.floor(amounts.length * 0.90))
    const fixedRange = clampPrediction(amounts[p10idx] || amounts[0], amounts[p90idx] || amounts[amounts.length - 1])
    if (!(fixedRange.min === 0 && fixedRange.max === 0)) {
      predictions.tonightStream = { expected: parseFloat(avg.toFixed(2)), range: { min: fixedRange.min, max: fixedRange.max }, confidence: fixedRange.confidence === 'high' && sameDaySessions.length > 5 ? 'High' : 'Medium', returningTippers: Math.round(sameDaySessions.reduce((s, x) => s + x.uniqueFans, 0) / sameDaySessions.length * 0.4) }
    }
  }
  return predictions
}

// tz: creator timezone — bestHour.hour is a creator-local hour, so session
// start hours must be read on the same clock.
export function generateLossAlerts(tips, sessions, whales, bestHour, tz = 'UTC') {
  const alerts = []
  const now = Date.now()
  if (bestHour) {
    const bh = parseInt(bestHour.hour)
    const recentSessions = sessions.filter(s => (now - new Date(s.startTime)) / 86400000 <= 3)
    const recentAtPeak = recentSessions.filter(s => Math.abs(toLocalHour(s.startTime, tz) - bh) <= 1)
    if (recentSessions.length > 0 && recentAtPeak.length === 0) {
      const label = bh === 0 ? '12 AM' : bh < 12 ? `${bh} AM` : bh === 12 ? '12 PM' : `${bh - 12} PM`
      alerts.push({ type: 'peak_missed', severity: 'warning', icon: '🚨', message: `You haven't streamed during your peak window (${label}) in 3 days — estimated loss: $${(bestHour.avg * 3).toFixed(2)}`, action: `Go live at ${label} to recover this` })
    }
  }
  const thisWeek = tips.filter(t => (now - new Date(t.dateRaw || t.date_time)) / 86400000 <= 7)
  const lastWeek = tips.filter(t => { const d = (now - new Date(t.dateRaw || t.date_time)) / 86400000; return d > 7 && d <= 14 })
  if (thisWeek.length >= 5 && lastWeek.length >= 5) {
    const thisAvg = thisWeek.reduce((s, t) => s + t.usd, 0) / thisWeek.length
    const lastAvg = lastWeek.reduce((s, t) => s + t.usd, 0) / lastWeek.length
    const drop = Math.round(((lastAvg - thisAvg) / lastAvg) * 100)
    if (drop >= 15) alerts.push({ type: 'tip_drop', severity: 'warning', icon: '📉', message: `Your avg tip dropped ${drop}% this week ($${lastAvg.toFixed(2)} → $${thisAvg.toFixed(2)})`, action: 'Focus on high-value fans during your next stream' })
  }
  // fan_churn must rely on the canonical, baseline-gated behavioralState
  // (lib/analytics.js calcFanBehavioralState) rather than an independent
  // day-range/totalUSD formula -- a single-visit fan has no personal
  // cadence to compare against, so it can never be "At Risk" on its own.
  whales.filter(w => w.behavioralState === 'At Risk' && w.totalUSD >= 50).slice(0, 2).forEach(w => {
    alerts.push({ type: 'fan_churn', severity: 'critical', icon: '🚨', message: `${w.username} hasn't tipped in ${w.daysSinceLastTip} days — high churn risk ($${w.totalUSD.toFixed(0)} lifetime value)`, action: 'Send a re-engagement message now' })
  })
  const lastStreamed = sessions.length ? (now - new Date(sessions[sessions.length - 1].startTime)) / 86400000 : 999
  if (lastStreamed > 2 && sessions.length > 5) {
    alerts.push({ type: 'streak_broken', severity: 'info', icon: '⏸️', message: `You haven't streamed in ${Math.floor(lastStreamed)} days — your audience engagement drops after 3 days off`, action: 'Get back live — consistency is your #1 growth tool' })
  }
  return alerts
}

// tz: creator timezone — bestDay.day is a creator-local weekday.
export function generateInsights(tips, sessions, bestDay, worstDay, bestHour, precomputedWhales = null, tz = 'UTC') {
  const insights = []
  if (!tips.length || !sessions.length) return insights
  const now = Date.now()

  if (bestDay && worstDay && bestDay.day !== worstDay.day) {
    const daySessionMap = {}
    sessions.forEach(s => {
      const d = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][toLocalDow(s.startTime, tz)]
      if (!daySessionMap[d]) daySessionMap[d] = []
      daySessionMap[d].push(s.totalUSD)
    })
    const bestDayAvg = daySessionMap[bestDay.day] ? daySessionMap[bestDay.day].reduce((a,b) => a+b, 0) / daySessionMap[bestDay.day].length : 0
    const otherDaysSessions = Object.entries(daySessionMap).filter(([d]) => d !== bestDay.day).flatMap(([_, vals]) => vals)
    const overallDayAvg = otherDaysSessions.length ? otherDaysSessions.reduce((a,b) => a+b, 0) / otherDaysSessions.length : 0
    const mult = overallDayAvg > 0 ? (bestDayAvg / overallDayAvg).toFixed(1) : null
    const costOfMissing = parseFloat((bestDayAvg - overallDayAvg).toFixed(2))
    if (mult && parseFloat(mult) > 1 && costOfMissing > 0) {
      insights.push({ icon: '📅', text: `${bestDay.day}s are your highest-earning day — you avg $${bestDayAvg.toFixed(0)} on ${bestDay.day}s vs $${overallDayAvg.toFixed(0)} on other days (${mult}x more). Missing one ${bestDay.day} costs you ~$${costOfMissing.toFixed(0)}`, type: 'day', priority: 1 })
    }
  }

  if (bestHour) {
    const h = parseInt(bestHour.hour)
    const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`
    const avgOverall = sessions.reduce((s, x) => s + x.totalUSD, 0) / sessions.length
    const multiplier = avgOverall > 0 ? (bestHour.avg / avgOverall).toFixed(1) : null
    insights.push({ icon: '⏰', text: `Go live at ${label} — your avg session earnings are ${multiplier ? `${multiplier}x higher` : 'at their peak'} at this hour ($${bestHour.avg.toFixed(0)} avg). Missing this window costs you real money every session`, type: 'time', priority: 1 })
  }

  const whales = precomputedWhales || identifyWhales(tips, sessions, tz)
  const trueWhales = whales.filter(w => w.tier === 'Whale')
  const topWhales = (trueWhales.length > 0 ? trueWhales : whales.filter(w => w.tier === 'Shark')).slice(0, 5)
  const wE = topWhales.reduce((s, w) => s + w.totalUSD, 0)
  const tE = tips.reduce((s, t) => s + t.usd, 0)
  if (wE > 0 && tE > 0 && topWhales.length > 0) {
    const pct = Math.round((wE / tE) * 100)
    insights.push({ icon: '🐳', text: `Your top ${topWhales.length} fan${topWhales.length > 1 ? 's' : ''} generate${topWhales.length === 1 ? 's' : ''} ${pct}% of your revenue. Losing even one of them would cost you $${(wE / topWhales.length).toFixed(0)} on average — keep them engaged`, type: 'whales', priority: 2 })
  }

  const timedSessionsForLength = sessions.filter(s => !s.durationUnknown)
  const longSessions  = timedSessionsForLength.filter(s => s.durationMinutes > 60)
  const shortSessions = timedSessionsForLength.filter(s => s.durationMinutes > 1 && s.durationMinutes <= 60)
  if (longSessions.length >= 3 && shortSessions.length >= 3) {
    const longAvg  = longSessions.reduce((s, x) => s + x.totalUSD, 0) / longSessions.length
    const shortAvg = shortSessions.reduce((s, x) => s + x.totalUSD, 0) / shortSessions.length
    if (longAvg > shortAvg * 1.2) {
      const pct = Math.round(((longAvg - shortAvg) / shortAvg) * 100)
      insights.push({ icon: '⏱️', text: `Streams over 60 min earn ${pct}% more than short ones ($${longAvg.toFixed(0)} vs $${shortAvg.toFixed(0)}). Every extra 30 minutes adds ~$${((longAvg - shortAvg) / 2).toFixed(0)} on average`, type: 'duration', priority: 2 })
    }
  }

  const fanTipCounts = {}, fanTipUSD = {}
  tips.forEach(t => {
    const k = t.username.toLowerCase()
    fanTipCounts[k] = (fanTipCounts[k] || 0) + 1
    fanTipUSD[k] = (fanTipUSD[k] || 0) + (t.usd || 0)
  })
  const returning = Object.values(fanTipCounts).filter(c => c > 1).length
  const total = Object.keys(fanTipCounts).length
  if (total > 10) {
    const pct = Math.round((returning / total) * 100)
    const returningKeys = Object.keys(fanTipCounts).filter(k => fanTipCounts[k] > 1)
    const oneTimeKeys = Object.keys(fanTipCounts).filter(k => fanTipCounts[k] === 1)
    const avgReturning = returningKeys.length ? returningKeys.reduce((s, k) => s + fanTipUSD[k], 0) / returningKeys.length : 0
    const avgOneTime = oneTimeKeys.length ? oneTimeKeys.reduce((s, k) => s + fanTipUSD[k], 0) / oneTimeKeys.length : 0
    const multiplierText = avgOneTime > 0 && avgReturning > 0 ? `${(avgReturning / avgOneTime).toFixed(1)}x more` : 'significantly more'
    const fmtAmt = (v) => v < 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`
    insights.push({ icon: '🔁', text: `${pct}% of your fans are returning tippers — loyalty is your strongest asset. Returning fans spend ${multiplierText} on average than first-timers (${fmtAmt(avgReturning)} vs ${fmtAmt(avgOneTime)})`, type: 'retention', priority: 3 })
  }

  const thisWeek = tips.filter(t => (now - new Date(t.dateRaw || t.date_time)) / 86400000 <= 7)
  const lastWeek = tips.filter(t => { const d = (now - new Date(t.dateRaw || t.date_time)) / 86400000; return d > 7 && d <= 14 })
  if (thisWeek.length > 0 && lastWeek.length > 0) {
    const thisRev = thisWeek.reduce((s, t) => s + t.usd, 0)
    const lastRev = lastWeek.reduce((s, t) => s + t.usd, 0)
    const change = Math.round(((thisRev - lastRev) / lastRev) * 100)
    if (Math.abs(change) >= 10) {
      insights.push({ icon: change >= 0 ? '📈' : '📉', text: change >= 0 ? `You're up ${change}% this week vs last week ($${thisRev.toFixed(0)} vs $${lastRev.toFixed(0)}) — keep the momentum going` : `You're down ${Math.abs(change)}% this week vs last ($${thisRev.toFixed(0)} vs $${lastRev.toFixed(0)}) — increase stream frequency to recover`, type: 'momentum', priority: 2 })
    }
  }

  return insights.sort((a, b) => a.priority - b.priority)
}

// tz: creator timezone — best hours are creator-local, so "hours until peak"
// is measured on the creator's clock, not UTC.
export function generateNextMoves(tips, sessions, whales, predictions, bestHour, hourAvgs = [], tz = 'UTC') {
  const moves = []
  const now = Date.now()

  // Early signal: if no strong bestHour but some hourly data exists, show the best available
  const hourToUse = bestHour || (hourAvgs && hourAvgs.length > 0 ? [...hourAvgs].sort((a, b) => b.avg - a.avg)[0] : null)
  const isEarlySignal = !bestHour && hourToUse

  if (hourToUse) {
    const bh = parseInt(hourToUse.hour)
    const currentHour = toLocalHour(new Date(), tz)
    const hoursUntil = (bh - currentHour + 24) % 24
    const label = bh === 0 ? '12 AM' : bh < 12 ? `${bh} AM` : bh === 12 ? '12 PM' : `${bh - 12} PM`

    if (isEarlySignal) {
      // Early signal: weak data but showing best available hour
      if (hoursUntil === 0 || hoursUntil === 1) moves.push({ icon: '📍', color: '#8B5CF6', text: `Go live NOW — ${label} looks promising (early signal). Early data shows $${hourToUse.avg.toFixed(0)}/session at this hour`, priority: 0 })
      else if (hoursUntil <= 2) moves.push({ icon: '📍', color: '#8B5CF6', text: `${hoursUntil} hour${hoursUntil > 1 ? 's' : ''} until ${label} (early signal). This is showing as your strongest window so far — $${hourToUse.avg.toFixed(0)}/session`, priority: 1 })
      else moves.push({ icon: '📍', color: '#8B5CF6', text: `Early signal: ${label} looks like your best earning window so far. $${hourToUse.avg.toFixed(0)}/session. More data will confirm this.`, priority: 2 })
    } else {
      // Strong signal: confident pattern
      if (hoursUntil === 0 || hoursUntil === 1) moves.push({ icon: '🔥', color: '#FB923C', text: `Go live NOW — ${label} is your peak earning time. Your data shows you average $${bestHour.avg.toFixed(0)}/session at this hour`, priority: 0 })
      else if (hoursUntil <= 2) moves.push({ icon: '⏰', color: '#22D3EE', text: `You're ${hoursUntil} hour${hoursUntil > 1 ? 's' : ''} away from your peak time (${label}). Prep your room title and get ready — you avg $${bestHour.avg.toFixed(0)} at this hour`, priority: 1 })
      else moves.push({ icon: '🕐', color: '#22D3EE', text: `Your best earning time is ${label} — plan your next stream around it. Your data shows $${bestHour.avg.toFixed(0)} avg per session at this hour`, priority: 2 })
    }
  }
  if (predictions?.tonightStream) {
    const { expected, range, returningTippers } = predictions.tonightStream
    moves.push({ icon: '🎯', color: '#F59E0B', text: `Set a goal of $${Math.round(expected * 1.2)} for tonight — your data predicts $${range.min}–$${range.max} and ~${returningTippers} returning tippers`, priority: 1 })
  }
  whales.filter(w => { const days = Math.floor((now - new Date(w.lastTipDate)) / 86400000); return days >= 3 && days <= 45 && w.totalUSD >= 20 }).sort((a, b) => b.totalUSD - a.totalUSD).slice(0, 3).forEach(w => {
    const days = Math.floor((now - new Date(w.lastTipDate)) / 86400000)
    moves.push({ icon: '💸', color: '#EC4899', text: `Message ${w.username} — they've spent $${w.totalUSD.toFixed(0)} total but haven't tipped in ${days} days. One message could recover $${(w.avgTipSize * 2).toFixed(0)}+`, cta: true, username: w.username, priority: 1 })
  })
  const avgSession = sessions.length ? sessions.reduce((s, x) => s + x.totalUSD, 0) / sessions.length : 0
  if (avgSession > 0) {
    const goal = Math.round(avgSession * 1.2 / 5) * 5
    moves.push({ icon: '🏆', color: '#F59E0B', text: `Your sessions average $${avgSession.toFixed(0)} — aim for $${goal} next stream. You've already hit this ${sessions.filter(s => s.totalUSD >= goal).length} times`, priority: 3 })
  }
  return moves.sort((a, b) => a.priority - b.priority).slice(0, 5)
}

// ===============================
// BEST TIME WINDOWS — the documented best-time formula
// Single implementation used by the dashboard hero (via aggregateRows) and the
// Stream Planner. Formula reference: Best Time Score = USD earned in a bucket
// / streamed hours in that bucket, from valid sessions only.
//
//   bucket       = platform x creator-local weekday x creator-local hour
//   streamed min = minutes of VALID sessions (isValidSession: >= 30 min AND
//                  >= 2 tips, known duration) overlapping the bucket — this
//                  includes zero-tip minutes inside a session
//   USD          = tips inside those valid sessions that fall in the bucket
//   rate         = USD / (streamed min / 60)
//   eligible     = streamed on >= BEST_TIME_MIN_LOCAL_DATES distinct
//                  creator-local dates ("a pattern across at least three
//                  separate days")
//   confidence   = calculateConfidence(validSessionCount, streamedHours) for
//                  the bucket; "Very Low" means "Not enough data yet"
//
// Duration basis: imported tip data has no real stream start/end, so a
// session's time is the span between its first and last tip. It is always
// reported as an ESTIMATE (durationBasis 'tip_span_estimate'); time streamed
// before the first or after the last tip is not observable and not counted.
// ===============================
export const BEST_TIME_MIN_LOCAL_DATES = 3
const LONG_DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// Creator-local weekday/hour/minute/second/date for one instant (cached formatter).
function localClockParts(date, tz) {
  const fmt = localTimeFormatter('clock', tz, 'en-US', {
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const p = {}
  for (const x of fmt.formatToParts(date)) p[x.type] = x.value
  return {
    dayIndex: LONG_DAY_NAMES.indexOf(p.weekday),
    hour: parseInt(p.hour, 10) % 24,
    minute: parseInt(p.minute, 10),
    second: parseInt(p.second, 10),
    dateKey: `${p.year}-${p.month}-${p.day}`,
  }
}

export function calculateBestTimeWindows(tips, tz = 'UTC', { sessions = null } = {}) {
  const all = sessions || detectSessions(tips || [])
  const valid = all.filter(s => isValidSession(s) && !s.durationUnknown)
  const cells = {}
  const cellFor = (platform, dayIndex, hour) => {
    const k = `${platform}|${dayIndex}|${hour}`
    if (!cells[k]) cells[k] = { platform, dayIndex, day: LONG_DAY_NAMES[dayIndex], hour, usd: 0, minutes: 0, sessions: new Set(), dates: new Set() }
    return cells[k]
  }
  let overallMinutes = 0
  valid.forEach((s, i) => {
    const platform = platformKey(s.platform)
    const startMs = new Date(s.startTime).getTime()
    const endMs = new Date(s.endTime).getTime()
    overallMinutes += (endMs - startMs) / 60000
    // Walk the session in creator-local hour segments (boundaries fall at
    // :30 UTC in +5:30 zones etc., so they are computed from local minutes).
    let t = startMs
    while (t < endMs) {
      const lp = localClockParts(new Date(t), tz)
      const toBoundary = ((60 - lp.minute) * 60 - lp.second) * 1000 - (t % 1000)
      const segEnd = Math.min(endMs, t + Math.max(toBoundary, 1000))
      const c = cellFor(platform, lp.dayIndex, lp.hour)
      c.minutes += (segEnd - t) / 60000
      c.sessions.add(i); c.dates.add(lp.dateKey)
      t = segEnd
    }
    // USD is allocated by each tip's own timestamp (NOT pro-rated across the
    // session), so a tip belongs to the hour it was received in. A tip stamped
    // exactly at the session's end has no streamed minutes after it, so it is
    // allocated to the last streamed instant (end - 1 ms): otherwise it would
    // open a zero-minute cell and add a phantom session and date to it.
    for (const tip of s.tips || []) {
      const tipMs = Math.min(new Date(tip.dateRaw || tip.date_time || tip.timestamp).getTime(), endMs - 1)
      const lp = localClockParts(new Date(tipMs), tz)
      const c = cellFor(platform, lp.dayIndex, lp.hour)
      c.usd += tip.usd || 0
      c.sessions.add(i); c.dates.add(lp.dateKey)
    }
  })
  const finish = (c) => {
    const streamedHours = c.minutes / 60
    const validSessionCount = c.sessions.size
    const localDates = c.dates.size
    const out = {
      platform: c.platform, day: c.day, dayIndex: c.dayIndex, hour: c.hour,
      totalUSD: parseFloat(c.usd.toFixed(2)),
      streamedMinutes: parseFloat(c.minutes.toFixed(1)),
      streamedHours: parseFloat(streamedHours.toFixed(3)),
      usdPerStreamedHour: c.minutes > 0 ? parseFloat((c.usd / streamedHours).toFixed(2)) : null,
      validSessionCount, localDates,
      eligible: c.minutes > 0 && localDates >= BEST_TIME_MIN_LOCAL_DATES,
      confidence: calculateConfidence(validSessionCount, streamedHours),
      durationBasis: 'tip_span_estimate',
    }
    // A window is recommended only when it is a pattern (>= 3 separate local
    // dates) AND its own confidence is above "Very Low" ("Not enough data yet").
    out.recommended = out.eligible && out.usdPerStreamedHour != null && out.confidence.level !== 'Very Low'
    return out
  }
  const byRate = (a, b) => (b.usdPerStreamedHour ?? -1) - (a.usdPerStreamedHour ?? -1)
  const platformCells = Object.values(cells).map(finish).sort(byRate)

  // Per weekday: every recommended platform cell, best rate first. Callers
  // pick from this list (e.g. the best one that has not ended yet today);
  // bestByDay is its first entry.
  const recommendedByDay = {}, bestByDay = {}
  LONG_DAY_NAMES.forEach((d, i) => {
    recommendedByDay[d] = platformCells.filter(c => c.dayIndex === i && c.recommended)
    bestByDay[d] = recommendedByDay[d][0] || null
  })

  return {
    durationBasis: 'tip_span_estimate',
    minLocalDates: BEST_TIME_MIN_LOCAL_DATES,
    overall: {
      validSessionCount: valid.length,
      streamedHours: parseFloat((overallMinutes / 60).toFixed(2)),
      confidence: calculateConfidence(valid.length, overallMinutes / 60),
    },
    platformCells, recommendedByDay, bestByDay,
  }
}

export function aggregateRows(tips, tz = null) {
  let userTz = tz
  if (!userTz) {
    if (typeof Intl === 'undefined') {
      throw new Error('Intl API not available and no timezone provided to aggregateRows')
    }
    userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!userTz) {
      throw new Error('Failed to resolve user timezone from Intl API')
    }
  }

  if (!tips || tips.length === 0) {
    return {
      totalUSD: 0, totalTokens: 0, totalTips: 0, avgTipSize: 0,
      topTippers: [], platforms: [], sessions: [], insights: [],
      predictions: null, whaleAlerts: [], lossAlerts: [], nextMoves: [],
      bestDay: null, bestHour: null, platformBestTimes: {}, platformDayActivity: {}, bestTimeWindows: calculateBestTimeWindows([], userTz), canonicalBestTimes: { bestWindow: null, earlySignal: null, grid: [] },
      monthlyData: [], bestMonth: null, tipTypeBreakdown: [], platformTipTypes: {},
      privateShowFans: [], spyShowFans: [], earningsVelocity: null, totalStreamMinutes: 0,
      estimatedHourlyRate: 0, hourlyRateSessionCount: 0, hourlyRateTotalMinutes: 0,
      hourlyRateTotalUsd: 0, excludedUntimedSessionCount: 0,
      platformVelocity: {}, missedRevenueByPlatform: {}, platformMomentum: {},
      returningVsNew: null, topFanDependency: null,
      dependencyRisk: null, preTipBehavior: null, trueHourlyAvg: [],
      platformRiskContext: {}
    }
  }

  const sessions = detectSessions(tips)

  // ── SESSION QUALITY CLASSIFICATION ───────────────────────────────────
  const classifySession = (s) => {
    const mins = s.durationMinutes || 0
    const usd  = s.totalUSD || 0
    if (mins < 2 && usd === 0) return 'invalid'
    // Canonical rule: meaningful = duration >= 30 min AND tips >= 2.
    return isValidSession(s) ? 'meaningful' : 'low_signal'
  }
  const scoreSession = (s) => {
    const mins = s.durationMinutes || 0
    const usd  = s.totalUSD || 0
    const durationScore = Math.min(mins / 120, 1)
    const revenueScore  = Math.min(usd  / 100, 1)
    return parseFloat(((durationScore * 0.4) + (revenueScore * 0.6)).toFixed(3))
  }
  sessions.forEach(s => { s.sessionQuality = classifySession(s); s.sessionWeight = scoreSession(s) })

  const meaningfulSessions = sessions.filter(s => s.sessionQuality === 'meaningful')
  const allValidSessions   = sessions.filter(s => s.sessionQuality !== 'invalid')

  // ── HOURLY-RATE ELIGIBILITY ────────────────────────────────────────────
  // Defined here, above the platform rollup, so that every hourly rate in the
  // engine — overall and per platform — divides the same sessions' revenue by
  // the same sessions' time. A session can be a meaningful *earning* event
  // (e.g. one $75 tip, durationUnknown) while being unusable as a rate, since
  // an unknown duration has no denominator. Counting such a session's revenue
  // against only the timed sessions' hours inflates the rate, which is exactly
  // what this rule exists to prevent.
  //
  // Applied ONLY to meaningfulSessions, which already satisfy the canonical
  // isValidSession rule (duration >= 30 min AND tips >= 2). On top of that a
  // rate needs a known duration and some revenue. (A former
  // `durationMinutes >= 15` clause here could never exclude anything — every
  // meaningful session is >= 30 min — and was removed so the code states the
  // rule that actually applies.)
  const isHourlyRateEligible = (s) =>
    s.tipCount >= 2 &&
    !s.durationUnknown &&
    Number.isFinite(s.durationMinutes) &&
    s.totalUSD > 0

  const hourlyRateSessions = meaningfulSessions.filter(isHourlyRateEligible)

  const dayTipsUSD = {}, dayActiveDates = {}, hourTipsUSD = {}, hourBucketSets = {}
  const dayDateAmts = {}, hourBucketAmts = {}
  // Distinct creator-local dates seen at each local hour. The best-time
  // eligibility rule is "a pattern across at least three separate days";
  // UTC hour buckets only equal local dates in whole-hour offset zones (in
  // +5:30, one local hour spans two UTC buckets), so dates are counted here.
  const hourDateSets = {}
  const UTC_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

  tips.forEach(t => {
    const dt = new Date(t.dateRaw || t.date_time)
    if (isNaN(dt.getTime())) return
    const dow = UTC_LONG[toLocalDow(t.dateRaw || t.date_time, userTz)]
    const dateKey = toLocalDateStr(t.dateRaw || t.date_time, userTz)
    const h = toLocalHour(t.dateRaw || t.date_time, userTz)
    const hBucket = Math.floor(dt.getTime() / 3600000)
    const usd = t.usd || 0
    if (!dayTipsUSD[dow]) { dayTipsUSD[dow] = 0; dayActiveDates[dow] = new Set(); dayDateAmts[dow] = {} }
    dayTipsUSD[dow] += usd
    dayActiveDates[dow].add(dateKey)
    dayDateAmts[dow][dateKey] = (dayDateAmts[dow][dateKey] || 0) + usd
    if (!hourTipsUSD[h]) { hourTipsUSD[h] = 0; hourBucketSets[h] = new Set(); hourBucketAmts[h] = {}; hourDateSets[h] = new Set() }
    hourTipsUSD[h] += usd
    hourBucketSets[h].add(hBucket)
    hourDateSets[h].add(dateKey)
    hourBucketAmts[h][hBucket] = (hourBucketAmts[h][hBucket] || 0) + usd
  })

  const dayAvgs = Object.keys(dayTipsUSD)
    .filter(d => dayActiveDates[d].size >= 3)
    .map(d => ({ day: d, avg: parseFloat(calcMedian(Object.values(dayDateAmts[d])).toFixed(2)), total: dayTipsUSD[d], count: dayActiveDates[d].size }))
  const hourAvgs = Object.keys(hourTipsUSD)
    .filter(h => hourDateSets[h].size >= 3)
    .map(h => ({ hour: h, avg: parseFloat(calcMedian(Object.values(hourBucketAmts[h])).toFixed(2)), total: hourTipsUSD[h], count: hourBucketSets[h].size, localDates: hourDateSets[h].size }))
  const bestDay  = [...dayAvgs].sort((a, b) => b.avg - a.avg)[0] || null
  const worstDay = [...dayAvgs].sort((a, b) => a.avg - b.avg)[0] || null
  const bestHour = [...hourAvgs].sort((a, b) => b.avg - a.avg)[0] || null

  const whales      = identifyWhales(tips, meaningfulSessions, userTz)
  const platformRiskContext = getPlatformRiskContext(tips, meaningfulSessions)
  const insights    = generateInsights(tips, meaningfulSessions, bestDay, worstDay, bestHour, whales, userTz)
  const predictions = predictRevenue(tips, meaningfulSessions, userTz)
  const whaleAlerts = generateWhaleAlerts(whales)
  const lossAlerts  = generateLossAlerts(tips, meaningfulSessions, whales, bestHour, userTz)
  const nextMoves   = generateNextMoves(tips, meaningfulSessions, whales, predictions, bestHour, hourAvgs, userTz)

  let totalUSD = 0, totalTokens = 0
  for (const t of tips) { totalUSD += t.usd || 0; totalTokens += t.tokens || 0 }

  // FINANCIAL TRUTH: Platform revenue breakdown from ALL tips (not filtered)
  // This ensures platform rows reconcile to totalUSD
  const platformMap = {}
  const platformSessionMap = {}
  const platformHoursMap = {}

  // Sum all tips by platform
  tips.forEach(t => {
    const p = platformKey(t.platform)
    if (!platformMap[p]) { platformMap[p] = { platform: p, totalUSD: 0, totalTokens: 0, sessions: 0, hours: 0, tips: 0 } }
    platformMap[p].totalUSD += t.usd || 0
    platformMap[p].totalTokens += t.tokens || 0
    platformMap[p].tips += 1
  })

  // Add session and hours data from meaningful sessions (for context, but revenue is from all tips)
  meaningfulSessions.forEach(s => {
    const sp = platformKey(s.platform)
    if (!platformSessionMap[sp]) platformSessionMap[sp] = { sessions: 0, hours: 0 }
    platformSessionMap[sp].sessions += 1
    if (!s.durationUnknown) platformSessionMap[sp].hours += s.durationHours
  })

  // Merge session/hours data into platform map
  Object.keys(platformMap).forEach(p => {
    if (platformSessionMap[p]) {
      platformMap[p].sessions = platformSessionMap[p].sessions
      platformMap[p].hours = platformSessionMap[p].hours
    }
  })

  // Per-platform rate basis — revenue and time from the same eligible sessions,
  // so summing these across platforms reproduces estimatedHourlyRate exactly.
  const platformRate = {}
  hourlyRateSessions.forEach(s => {
    const sp = platformKey(s.platform)
    if (!platformRate[sp]) platformRate[sp] = { usd: 0, minutes: 0, sessions: 0 }
    platformRate[sp].usd     += s.totalUSD
    platformRate[sp].minutes += s.durationMinutes
    platformRate[sp].sessions += 1
  })

  const platforms = Object.values(platformMap).map(p => {
    const rate = platformRate[p.platform] || { usd: 0, minutes: 0, sessions: 0 }
    const rateHours = rate.minutes / 60
    return {
      ...p,
      // Hours and revenue used for the rate, kept alongside it so a caller can
      // show the rate with the sample it was actually built from.
      rateHours:        parseFloat(rateHours.toFixed(2)),
      rateUSD:          parseFloat(rate.usd.toFixed(2)),
      rateSessionCount: rate.sessions,
      usdPerHour:    rateHours > 0 ? parseFloat((rate.usd / rateHours).toFixed(2)) : 0,
      tokensPerHour: p.hours > 0 ? Math.round( p.totalTokens / p.hours)            : 0,
      avgTipSize:    p.tips  > 0 ? parseFloat((p.totalUSD    / p.tips).toFixed(2)) : 0
    }
  })

  const topTippers = whales.map((w, i) => ({
    rank: i + 1, username: w.username, usd: w.totalUSD, tokens: w.totalTokens, count: w.tipCount,
    status: w.tier === 'Whale' ? '🐳 WHALE' : w.tier === 'Shark' ? '🦈 SHARK' : w.tier === 'Dormant' ? '💤 DORMANT' : '🐟 REGULAR',
    last: toLocalDisplayDate(w.lastTipDate, userTz), first: toLocalDisplayDate(w.firstTipDate, userTz),
    daysSince: w.daysSinceLastTip, tipProbability: w.tipProbability, churnRisk: w.churnRisk
  }))

  // ── PER-PLATFORM BEST TIMES ───────────────────────────────────────────
  const UTC_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const platHourUSD = {}, platHourBuckets = {}, platDayUSD = {}, platDayDates = {}
  // Distinct creator-local dates per platform hour / platform weekday-hour —
  // the ">= 3 separate days" rule, counted in local dates (see hourDateSets).
  const platHourDates = {}, platDayHourDates = {}
  const platDayHourUSD = {}, platDayHourBuckets = {}
  const platHourBucketAmts = {}, platDayDateAmts = {}, platDayHourBucketAmts = {}

  tips.forEach(t => {
    const p = platformKey(t.platform)
    const dt = new Date(t.dateRaw || t.date_time)
    if (isNaN(dt.getTime())) return
    const h = toLocalHour(t.dateRaw || t.date_time, userTz)
    const dow = UTC_DAYS[toLocalDow(t.dateRaw || t.date_time, userTz)]
    const dateKey = toLocalDateStr(t.dateRaw || t.date_time, userTz)
    const hBucket = Math.floor(dt.getTime() / 3600000)
    const usd = t.usd || 0

    if (!platHourUSD[p]) { platHourUSD[p] = {}; platHourBuckets[p] = {}; platHourBucketAmts[p] = {}; platHourDates[p] = {} }
    if (!platHourUSD[p][h]) { platHourUSD[p][h] = 0; platHourBuckets[p][h] = new Set(); platHourBucketAmts[p][h] = {}; platHourDates[p][h] = new Set() }
    platHourUSD[p][h] += usd; platHourBuckets[p][h].add(hBucket); platHourDates[p][h].add(dateKey)
    platHourBucketAmts[p][h][hBucket] = (platHourBucketAmts[p][h][hBucket] || 0) + usd

    if (!platDayUSD[p]) { platDayUSD[p] = {}; platDayDates[p] = {}; platDayDateAmts[p] = {} }
    if (!platDayUSD[p][dow]) { platDayUSD[p][dow] = 0; platDayDates[p][dow] = new Set(); platDayDateAmts[p][dow] = {} }
    platDayUSD[p][dow] += usd; platDayDates[p][dow].add(dateKey)
    platDayDateAmts[p][dow][dateKey] = (platDayDateAmts[p][dow][dateKey] || 0) + usd

    const dayHourKey = `${dow}__${h}`
    if (!platDayHourUSD[p]) { platDayHourUSD[p] = {}; platDayHourBuckets[p] = {}; platDayHourBucketAmts[p] = {}; platDayHourDates[p] = {} }
    if (!platDayHourUSD[p][dayHourKey]) { platDayHourUSD[p][dayHourKey] = 0; platDayHourBuckets[p][dayHourKey] = new Set(); platDayHourBucketAmts[p][dayHourKey] = {}; platDayHourDates[p][dayHourKey] = new Set() }
    platDayHourUSD[p][dayHourKey] += usd; platDayHourBuckets[p][dayHourKey].add(hBucket); platDayHourDates[p][dayHourKey].add(dateKey)
    platDayHourBucketAmts[p][dayHourKey][hBucket] = (platDayHourBucketAmts[p][dayHourKey][hBucket] || 0) + usd
  })

  const platformBestTimes = {}
  Object.keys(platHourUSD).forEach(p => {
    const hourEntries = Object.keys(platHourUSD[p])
      .filter(h => platHourDates[p][h].size >= 3)
      .map(h => ({
        hour: parseInt(h),
        avg: parseFloat(calcMedian(Object.values(platHourBucketAmts[p][h])).toFixed(2)),
        sessionCount: platHourBuckets[p][h].size, localDates: platHourDates[p][h].size, total: platHourUSD[p][h]
      }))
      .sort((a, b) => b.avg - a.avg)
    const dayEntries = Object.keys(platDayUSD[p])
      .filter(d => platDayDates[p][d].size >= 3)
      .map(d => ({
        day: d,
        avg: parseFloat(calcMedian(Object.values(platDayDateAmts[p][d])).toFixed(2)),
        activeDays: platDayDates[p][d].size, total: platDayUSD[p][d]
      }))
      .sort((a, b) => b.avg - a.avg)
    const bestHourByDay = {}
    UTC_DAYS.forEach(dow => {
      const dayHourEntries = Object.keys(platDayHourUSD[p] || {})
        .filter(k => k.startsWith(dow + '__') && platDayHourDates[p][k].size >= 3)
        .map(k => {
          const h = parseInt(k.split('__')[1])
          return { hour: h, avg: parseFloat(calcMedian(Object.values(platDayHourBucketAmts[p][k])).toFixed(2)), sessionCount: platDayHourBuckets[p][k].size, localDates: platDayHourDates[p][k].size }
        })
        .sort((a, b) => b.avg - a.avg)
      if (dayHourEntries.length > 0) bestHourByDay[dow] = dayHourEntries[0]
    })
    platformBestTimes[p] = { hour: hourEntries[0] || null, bestDay: dayEntries[0] || null, bestHourByDay, allHours: hourEntries, allDays: dayEntries }
  })

  // ── PLATFORM × CREATOR-LOCAL WEEKDAY ACTIVITY (dashboard heatmap) ─────
  // Every weekday for every platform in the engine's (plan-gated) input:
  // total $ and distinct creator-local active dates, from the same pass that
  // builds platformBestTimes. avgPerActiveDay = totalUSD / activeDays is the
  // heatmap's existing "avg $/active day" measure, now computed once here so
  // the dashboard no longer re-aggregates raw (ungated) tips. No minimum-date
  // filter: the heatmap shows every observed cell.
  const platformDayActivity = {}
  Object.keys(platDayUSD).forEach(p => {
    platformDayActivity[p] = {}
    Object.keys(platDayUSD[p]).forEach(d => {
      const activeDays = platDayDates[p][d].size
      platformDayActivity[p][d] = {
        totalUSD: parseFloat(platDayUSD[p][d].toFixed(2)),
        activeDays,
        avgPerActiveDay: activeDays > 0 ? parseFloat((platDayUSD[p][d] / activeDays).toFixed(2)) : 0,
      }
    })
  })

  // ── EARNINGS VELOCITY (legacy field, kept for existing callers) ───────
  const timedSessions = meaningfulSessions.filter(s => !s.durationUnknown)
  const totalTimedHours = timedSessions.reduce((s, x) => s + x.durationHours, 0)
  const totalTimedUSD = timedSessions.reduce((s, x) => s + x.totalUSD, 0)
  const earningsVelocity = totalTimedHours > 0 ? parseFloat((totalTimedUSD / totalTimedHours).toFixed(2)) : null
  const totalStreamMinutes = Math.round(totalTimedHours * 60)

  // ── ESTIMATED $/HOUR ───────────────────────────────────────────────────
  // Imported CSV files carry tip timestamps only — never a creator's actual
  // stream start/end time — so this can only ever be an estimate inferred
  // from the gap between a session's first and last recorded tip. The
  // eligibility rule this uses is defined above, next to meaningfulSessions,
  // because the per-platform rates are built from the same sessions.
  const hourlyRateTotalUsd = parseFloat(hourlyRateSessions.reduce((s, x) => s + x.totalUSD, 0).toFixed(2))
  const hourlyRateTotalMinutes = hourlyRateSessions.reduce((s, x) => s + x.durationMinutes, 0)
  // Weighted overall average — numerator and denominator always come from the
  // exact same eligible sessions. Never average each session's own hourly rate;
  // that would give a short session the same weight as a long one.
  const estimatedHourlyRate = hourlyRateTotalMinutes > 0
    ? parseFloat((hourlyRateTotalUsd / (hourlyRateTotalMinutes / 60)).toFixed(2))
    : 0
  const hourlyRateSessionCount = hourlyRateSessions.length
  const excludedUntimedSessionCount = meaningfulSessions.filter(s => !isHourlyRateEligible(s)).length

  // Count unique fans (all distinct users who have tipped)
  const uniqueFanCount = [...new Set(tips.map(t => (t.username || '').toLowerCase()).filter(Boolean))].length

  // Same rate basis as platforms[].usdPerHour — these two must never disagree.
  const platformVelocity = {}
  Object.keys(platformMap).forEach(p => {
    const rate = platformRate[p]
    platformVelocity[p] = rate && rate.minutes > 0
      ? parseFloat((rate.usd / (rate.minutes / 60)).toFixed(2))
      : null
  })

  // ── MISSED REVENUE BY PLATFORM ────────────────────────────────────────
  const missedRevenueByPlatform = {}
  Object.keys(platformBestTimes).forEach(p => {
    const bestHourData = platformBestTimes[p].hour
    if (!bestHourData) return
    const platSessions = timedSessions.filter(s => platformKey(s.platform) === p)
    if (platSessions.length < 3) return
    const overallAvg = platSessions.reduce((s, x) => s + x.totalUSD, 0) / platSessions.length
    const bestHourAvg = bestHourData.avg
    if (bestHourAvg <= overallAvg * 1.2) return
    // bestHourData.hour came from toLocalHour, so the session hour has to be
    // read on the same clock. Comparing a UTC hour against a local one made
    // this count every session "not at the best hour" for any creator whose
    // offset exceeded an hour, inflating the missed-revenue figure below.
    const sessionsNotAtBestHour = platSessions.filter(s => Math.abs(toLocalHour(s.startTime, userTz) - bestHourData.hour) > 1).length
    const missedRevenue = parseFloat(((bestHourAvg - overallAvg) * sessionsNotAtBestHour).toFixed(2))
    if (missedRevenue > 5) {
      missedRevenueByPlatform[p] = { bestHour: bestHourData.hour, bestHourAvg, overallAvg: parseFloat(overallAvg.toFixed(2)), sessionsNotAtBestHour, missedRevenue, multiplier: parseFloat((bestHourAvg / overallAvg).toFixed(1)) }
    }
  })

  // ── RETURNING VS NEW ──────────────────────────────────────────────────
  const fanTipCounts = {}, fanTipUSD2 = {}
  tips.forEach(t => {
    const k = t.username.toLowerCase()
    fanTipCounts[k] = (fanTipCounts[k] || 0) + 1
    fanTipUSD2[k] = (fanTipUSD2[k] || 0) + (t.usd || 0)
  })
  const returningKeys = Object.keys(fanTipCounts).filter(k => fanTipCounts[k] > 1)
  const newKeys = Object.keys(fanTipCounts).filter(k => fanTipCounts[k] === 1)
  const avgReturnSpend = returningKeys.length ? returningKeys.reduce((s, k) => s + fanTipUSD2[k], 0) / returningKeys.length : 0
  const avgNewSpend = newKeys.length ? newKeys.reduce((s, k) => s + fanTipUSD2[k], 0) / newKeys.length : 0
  const returningVsNew = {
    returningCount: returningKeys.length, newCount: newKeys.length,
    returningPct: Math.round((returningKeys.length / Math.max(Object.keys(fanTipCounts).length, 1)) * 100),
    avgReturnSpend: parseFloat(avgReturnSpend.toFixed(2)), avgNewSpend: parseFloat(avgNewSpend.toFixed(2)),
    multiplier: avgNewSpend > 0 ? parseFloat((avgReturnSpend / avgNewSpend).toFixed(1)) : null
  }

  // ── TOP FAN DEPENDENCY ────────────────────────────────────────────────
  const sortedWhales = [...whales].sort((a, b) => b.totalUSD - a.totalUSD)
  const top1USD = sortedWhales[0]?.totalUSD || 0
  const top3USD = sortedWhales.slice(0, 3).reduce((s, w) => s + w.totalUSD, 0)
  const top5USD = sortedWhales.slice(0, 5).reduce((s, w) => s + w.totalUSD, 0)
  const topFanDependency = totalUSD > 0 ? {
    top1Pct: Math.round((top1USD / totalUSD) * 100),
    top3Pct: Math.round((top3USD / totalUSD) * 100),
    top5Pct: Math.round((top5USD / totalUSD) * 100),
    lossIfTopFanLeaves: parseFloat(top1USD.toFixed(2))
  } : null

  // ── MONTHLY DATA ──────────────────────────────────────────────────────
  const monthMap = {}
  tips.forEach(t => {
    const dt = new Date(t.dateRaw || t.date_time)
    if (isNaN(dt.getTime())) return
    // Creator-local month (YYYY-MM): a tip at 11:30 PM on the 31st belongs to
    // that month on the creator's calendar, not the next UTC month.
    const key = toLocalDateStr(t.dateRaw || t.date_time, userTz).slice(0, 7)
    if (!monthMap[key]) monthMap[key] = { usd: 0, tips: 0, fans: new Set(), sessions: 0 }
    monthMap[key].usd += t.usd || 0
    monthMap[key].tips += 1
    monthMap[key].fans.add(t.username.toLowerCase())
  })
  allValidSessions.forEach(s => {
    const key = toLocalDateStr(s.startTime, userTz).slice(0, 7)
    if (monthMap[key]) monthMap[key].sessions += 1
  })
  const monthlyData = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).map(([month, d]) => ({
    month, usd: parseFloat(d.usd.toFixed(2)), tips: d.tips, fans: d.fans.size, sessions: d.sessions,
    usdPerFan: d.fans.size > 0 ? parseFloat((d.usd / d.fans.size).toFixed(2)) : 0
  }))
  const bestMonth = monthlyData.length > 0 ? [...monthlyData].sort((a, b) => b.usd - a.usd)[0] : null

  // ── TIP TYPE BREAKDOWN ────────────────────────────────────────────────
  const tipTypeMap = {}
  tips.forEach(t => {
    const type = t.tip_type || 'Tip'
    if (!tipTypeMap[type]) tipTypeMap[type] = { usd: 0, count: 0, fans: new Set() }
    tipTypeMap[type].usd += t.usd || 0
    tipTypeMap[type].count += 1
    tipTypeMap[type].fans.add(t.username.toLowerCase())
  })
  const tipTypeBreakdown = Object.entries(tipTypeMap).map(([type, d]) => ({
    type, usd: parseFloat(d.usd.toFixed(2)), count: d.count, fans: d.fans.size,
    pct: totalUSD > 0 ? Math.round((d.usd / totalUSD) * 100) : 0,
    avgUsd: d.count > 0 ? parseFloat((d.usd / d.count).toFixed(2)) : 0
  })).sort((a, b) => b.usd - a.usd)

  // Same breakdown split by platform. Built from every tip, grouped with the
  // same platform key as `platforms` (which sums ALL tips — "financial
  // truth"), so each platform's mix sums to exactly the earnings that
  // platform reports beside it.
  // Percentages are shares of that platform's own revenue, so a row never
  // reads as a share of the whole business on a single-platform view.
  const platformTipTypeMap = {}
  tips.forEach(t => {
    const plat = platformKey(t.platform)
    const type = t.tip_type || 'Tip'
    if (!platformTipTypeMap[plat]) platformTipTypeMap[plat] = { total: 0, types: {} }
    if (!platformTipTypeMap[plat].types[type]) platformTipTypeMap[plat].types[type] = { usd: 0, count: 0, fans: new Set() }
    platformTipTypeMap[plat].total += t.usd || 0
    platformTipTypeMap[plat].types[type].usd += t.usd || 0
    platformTipTypeMap[plat].types[type].count += 1
    platformTipTypeMap[plat].types[type].fans.add((t.username || '').toLowerCase())
  })

  const platformTipTypes = {}
  Object.entries(platformTipTypeMap).forEach(([plat, d]) => {
    platformTipTypes[plat] = Object.entries(d.types).map(([type, x]) => ({
      type, usd: parseFloat(x.usd.toFixed(2)), count: x.count, fans: x.fans.size,
      pct: d.total > 0 ? Math.round((x.usd / d.total) * 100) : 0,
      avgUsd: x.count > 0 ? parseFloat((x.usd / x.count).toFixed(2)) : 0
    })).sort((a, b) => b.usd - a.usd)
  })

  // ── PRIVATE & SPY SHOW FANS ───────────────────────────────────────────
  const privateFanMap = {}, spyFanSet = new Set()
  tips.forEach(t => {
    const type = (t.tip_type || '').toLowerCase()
    if (type.includes('private')) {
      const k = t.username.toLowerCase()
      if (!privateFanMap[k]) privateFanMap[k] = { username: t.username, usd: 0, count: 0 }
      privateFanMap[k].usd += t.usd || 0
      privateFanMap[k].count += 1
    }
    if (type.includes('spy')) spyFanSet.add(t.username.toLowerCase())
  })
  const privateShowFans = Object.values(privateFanMap).sort((a, b) => b.usd - a.usd).map(f => ({ ...f, usd: parseFloat(f.usd.toFixed(2)) }))
  const spyShowFans = [...spyFanSet].filter(u => !privateFanMap[u])

  // Momentum — month over month revenue comparison
  const now = new Date()
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000)

  const last30USD = tips
    .filter(t => new Date(t.date_time) >= thirtyDaysAgo)
    .reduce((sum, t) => sum + (parseFloat(t.usd) || 0), 0)

  const priorWindowTips = tips
    .filter(t => new Date(t.date_time) >= sixtyDaysAgo &&
                 new Date(t.date_time) < thirtyDaysAgo)
  const prior30USD = priorWindowTips.reduce((sum, t) => sum + (parseFloat(t.usd) || 0), 0)
  // Distinguishes "the prior period was empty of data" from "the prior period
  // genuinely earned nothing", which are very different claims.
  const priorWindowTipCount = priorWindowTips.length

  let momentumPct = 0
  let momentumLabel = 'Steady'
  let momentumEmoji = '→'

  if (prior30USD === 0 && last30USD === 0) {
    momentumLabel = 'No data'; momentumEmoji = '—'
  } else if (last30USD === 0) {
    // No revenue at all in the last 30 days — this is an absence of
    // recent streaming, not a measured downward trend. Don't fabricate
    // a "Declining" claim from zero data.
    momentumPct = -100; momentumLabel = 'Inactive'; momentumEmoji = '💤'
  } else if (priorWindowTipCount === 0 || prior30USD === 0) {
    // Nothing in the prior 30 days to compare against. That is usually not a
    // standing start: the free tier hands this engine a 31-day window, so the
    // prior period is empty by construction for those accounts. Reading that
    // emptiness as a 100% rise badged every free user "Surging" off data they
    // were never asked for. An unmeasurable trend is reported as such.
    momentumPct = null; momentumLabel = 'Not enough history'; momentumEmoji = '—'
  } else {
    momentumPct = ((last30USD - prior30USD) / prior30USD) * 100
    if (momentumPct > 50)       { momentumLabel = 'Surging';   momentumEmoji = '🚀' }
    else if (momentumPct > 10)  { momentumLabel = 'Growing';   momentumEmoji = '📈' }
    else if (momentumPct > -10) { momentumLabel = 'Steady';    momentumEmoji = '→'  }
    else                        { momentumLabel = 'Declining'; momentumEmoji = '📉' }
  }

  const momentum = { pct: momentumPct, label: momentumLabel, emoji: momentumEmoji, last30USD, prior30USD }

  // ── BEST WINDOW FAN OVERLAP ────────────────────────────────────────────
  // Find high-value fans who have been active in the best window (day + hour).
  // This is only computed if we have a strong best window to compare against.
  let bestWindowFanOverlap = null
  if (bestHour && bestDay) {
    const bestWindowTips = tips.filter(t => {
      const h = toLocalHour(t.dateRaw || t.date_time, userTz)
      const dow = UTC_DAYS[toLocalDow(t.dateRaw || t.date_time, userTz)]
      return Math.abs(h - bestHour.hour) <= 1 && dow === bestDay.day
    })
    const bestWindowFans = [...new Set(bestWindowTips.map(t => (t.username || '').toLowerCase()))].length
    if (bestWindowFans > 0) {
      const bestWindowUSD = bestWindowTips.reduce((s, t) => s + (t.usd || 0), 0)
      // Only show if high-value fans are active there
      const highValueFans = whales.filter(w => {
        return w.totalUSD >= 20 && bestWindowTips.some(t => (t.username || '').toLowerCase() === (w.username || '').toLowerCase())
      })
      if (highValueFans.length > 0) {
        bestWindowFanOverlap = {
          count: highValueFans.length,
          totalUSD: parseFloat(highValueFans.reduce((s, w) => s + w.totalUSD, 0).toFixed(2))
        }
      }
    }
  }

  // ── BEST TIME WINDOWS ($ per streamed hour; hero + Stream Planner) ─────
  const bestTimeWindows = calculateBestTimeWindows(tips, userTz, { sessions })
  // High-value fans around each day's recommended window — the existing
  // bestWindowFanOverlap rule (whales with >= $20 lifetime who tipped on that
  // weekday within +/-1 local hour), applied to the window actually shown.
  Object.values(bestTimeWindows.recommendedByDay).flat().forEach(w => {
    const tipped = new Set()
    tips.forEach(t => {
      if (platformKey(t.platform) !== w.platform) return
      const dt = t.dateRaw || t.date_time
      if (toLocalDow(dt, userTz) !== w.dayIndex) return
      if (Math.abs(toLocalHour(dt, userTz) - w.hour) > 1) return
      tipped.add(`${platformKey(t.platform)}:${(t.username || '').toLowerCase()}`)
    })
    const fans = whales.filter(f => f.totalUSD >= 20 && tipped.has(`${platformKey(f.platform)}:${(f.username || '').toLowerCase()}`))
    w.fanOverlap = { count: fans.length, totalUSD: parseFloat(fans.reduce((x, f) => x + f.totalUSD, 0).toFixed(2)) }
  })

  // ── CANONICAL BEST TIMES (for CommandCenter hero section) ───────────────
  // Builds the bestWindow/earlySignal object that CommandCenter reads.
  // Converts UTC hours to local time + adds confidence tier.
  const getTier = (sessionCount) => {
    if (sessionCount >= 6) return 'high'
    if (sessionCount >= 4) return 'supported'
    if (sessionCount >= 3) return 'promising'
    return null
  }

  const getTopPlatform = (day, hour, tz) => {
    // Find which platform has the highest earnings in this day+hour bucket
    const candidates = Object.entries(platformBestTimes)
      .map(([p, data]) => {
        const bestHourForDay = data.bestHourByDay?.[day]
        if (!bestHourForDay || Math.abs(bestHourForDay.hour - hour) > 1) return null
        return { platform: p, avg: bestHourForDay.avg }
      })
      .filter(x => x)
      .sort((a, b) => b.avg - a.avg)
    return candidates[0]?.platform || platforms[0]?.platform || null
  }

  let canonicalBestTimes = { bestWindow: null, earlySignal: null, grid: [] }

  if (bestHour) {
    const localHour = bestHour.hour
    const dayOfWeek = bestDay ? bestDay.day : null
    canonicalBestTimes.bestWindow = {
      localHour,
      localDay: dayOfWeek,
      medianUsdPerHour: bestHour.avg,
      sessionCount: bestHour.sessionCount || bestHour.count || 0,
      tier: getTier(bestHour.sessionCount || bestHour.count || 0),
      topPlatform: dayOfWeek ? getTopPlatform(dayOfWeek, localHour, userTz) : null,
    }
  } else if (hourAvgs && hourAvgs.length > 0) {
    // Early signal: best available hour when no strong bestHour
    const topHour = [...hourAvgs].sort((a, b) => b.avg - a.avg)[0]
    canonicalBestTimes.earlySignal = {
      localHour: topHour.hour,
      localDay: bestDay ? bestDay.day : 'Any day',
      sessionCount: topHour.count || 0,
    }
  }

  // Populate grid data for hourly distribution chart
  canonicalBestTimes.grid = hourAvgs.map(h => ({
    hour: h.hour,
    avg: h.avg,
    count: h.count,
  })).sort((a, b) => a.hour - b.hour)

  // ── PLATFORM MOMENTUM ─────────────────────────────────────────────────
  // Per-platform version of the same last-30 vs prior-30 comparison, built
  // from the meaningful sessions' own tips so a platform's trend rests on the
  // same revenue its earnings row reports.
  //
  // A trend is only claimed when the prior period actually contains data. The
  // free tier feeds this engine a 31-day window (applyFreeAnalysisWindow), so
  // the prior period is empty by construction for those accounts — treating
  // that emptiness as growth would label every free user's platforms as
  // surging off the back of data that was never supplied. No prior period
  // means no trend, not a flattering one.
  const platformMomentum = {}
  Object.keys(platformMap).forEach(p => {
    let last = 0, prior = 0, priorTips = 0
    // FINANCIAL TRUTH: Use ALL tips by platform (matching overall momentum calculation)
    tips.forEach(t => {
      const tipPlatform = platformKey(t.platform)
      if (tipPlatform !== p) return
      const d = new Date(t.dateRaw || t.date_time)
      if (isNaN(d.getTime())) return
      if (d >= thirtyDaysAgo) last += t.usd || 0
      else if (d >= sixtyDaysAgo) { prior += t.usd || 0; priorTips += 1 }
    })

    if (priorTips === 0) {
      platformMomentum[p] = { pct: null, label: 'Not enough history', emoji: '—', last30USD: parseFloat(last.toFixed(2)), prior30USD: 0 }
      return
    }

    const pct = ((last - prior) / prior) * 100
    let label = 'Steady', emoji = '→'
    if (last === 0)      { label = 'Inactive';  emoji = '💤' }
    else if (pct > 50)   { label = 'Surging';   emoji = '🚀' }
    else if (pct > 10)   { label = 'Growing';   emoji = '📈' }
    else if (pct > -10)  { label = 'Steady';    emoji = '→'  }
    else                 { label = 'Declining'; emoji = '📉' }

    platformMomentum[p] = {
      pct: parseFloat(pct.toFixed(1)), label, emoji,
      last30USD: parseFloat(last.toFixed(2)), prior30USD: parseFloat(prior.toFixed(2)),
    }
  })

  return {
    totalUSD: parseFloat(totalUSD.toFixed(2)),
    totalTokens,
    totalTips: tips.length,
    avgTipSize: parseFloat((tips.length > 0 ? totalUSD / tips.length : 0).toFixed(2)),
    topTippers, platforms, sessions: meaningfulSessions,
    insights: validateInsights(insights),
    predictions, whaleAlerts, lossAlerts, nextMoves, whales,
    bestDay, bestHour, platformBestTimes, platformDayActivity, canonicalBestTimes, bestWindowFanOverlap,
    monthlyData, bestMonth,
    tipTypeBreakdown, platformTipTypes, privateShowFans, spyShowFans,
    earningsVelocity, totalStreamMinutes, platformVelocity,
    estimatedHourlyRate, hourlyRateSessionCount, hourlyRateTotalMinutes,
    hourlyRateTotalUsd, excludedUntimedSessionCount,
    missedRevenueByPlatform, returningVsNew, topFanDependency,
    dependencyRisk: null, preTipBehavior: null, trueHourlyAvg: [],
    platformRiskContext, platformMomentum,
    meaningfulSessions, allValidSessions,
    meaningfulSessionCount: meaningfulSessions.length,
    lowSignalSessionCount: allValidSessions.length - meaningfulSessions.length,
    momentum, uniqueFanCount,
    bestTimeWindows,
  }
}

// ============================================================
// PAID SESSION ANALYTICS
// Operates on rows from the paid_sessions table (BongaCams).
// Completely separate from tip analytics — never mixed.
// ============================================================

export function computePaidSessionAnalytics(sessions) {
  if (!sessions || sessions.length === 0) return null

  const totalUSD     = sessions.reduce((s, r) => s + (parseFloat(r.usd) || 0), 0)
  const totalTokens  = sessions.reduce((s, r) => s + (parseInt(r.tokens) || 0), 0)
  const totalCount   = sessions.length

  // ── SESSION TYPE BREAKDOWN ─────────────────────────────────
  const typeMap = {}
  sessions.forEach(s => {
    const t = s.session_type || 'Unknown'
    if (!typeMap[t]) typeMap[t] = { usd: 0, count: 0, clients: new Set() }
    typeMap[t].usd     += parseFloat(s.usd) || 0
    typeMap[t].count   += 1
    typeMap[t].clients.add((s.username || '').toLowerCase())
  })
  const sessionTypeBreakdown = Object.entries(typeMap)
    .map(([type, d]) => ({
      type,
      usd:      parseFloat(d.usd.toFixed(2)),
      count:    d.count,
      clients:  d.clients.size,
      pct:      totalUSD > 0 ? Math.round((d.usd / totalUSD) * 100) : 0,
      avgUsd:   d.count > 0 ? parseFloat((d.usd / d.count).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.usd - a.usd)

  // ── PLATFORM BREAKDOWN ─────────────────────────────────────
  // Same shape/derivation as sessionTypeBreakdown above, just keyed by
  // platform instead of session_type -- only BongaCams populates
  // paid_sessions today, but this doesn't assume that.
  const platformMap = {}
  sessions.forEach(s => {
    const p = s.platform || 'Unknown'
    if (!platformMap[p]) platformMap[p] = { usd: 0, count: 0, clients: new Set() }
    platformMap[p].usd     += parseFloat(s.usd) || 0
    platformMap[p].count   += 1
    platformMap[p].clients.add((s.username || '').toLowerCase())
  })
  const platformBreakdown = Object.entries(platformMap)
    .map(([platform, d]) => ({
      platform,
      usd:      parseFloat(d.usd.toFixed(2)),
      count:    d.count,
      clients:  d.clients.size,
      pct:      totalUSD > 0 ? Math.round((d.usd / totalUSD) * 100) : 0,
      avgUsd:   d.count > 0 ? parseFloat((d.usd / d.count).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.usd - a.usd)

  // ── TOP PRIVATE CLIENTS ────────────────────────────────────
  const clientMap = {}
  sessions.forEach(s => {
    const k = (s.username || 'unknown').toLowerCase()
    if (!clientMap[k]) clientMap[k] = {
      username: s.username || 'unknown',
      usd: 0, tokens: 0, count: 0,
      sessionTypes: new Set(),
      dates: [],
      platforms: new Map(),
    }
    clientMap[k].usd    += parseFloat(s.usd) || 0
    clientMap[k].tokens += parseInt(s.tokens) || 0
    clientMap[k].count  += 1
    clientMap[k].sessionTypes.add(s.session_type || 'Unknown')
    clientMap[k].dates.push(new Date(s.date_time))
    if (s.platform) {
      clientMap[k].platforms.set(s.platform, (clientMap[k].platforms.get(s.platform) || 0) + 1)
    }
  })

  const topClients = Object.values(clientMap)
    .map(c => {
      const sorted = [...c.dates].sort((a, b) => a - b)
      // Most-used platform for this client — used to open the correct
      // fan profile (platform + username is the match key there).
      let platform = null, platformMax = 0
      c.platforms.forEach((count, p) => { if (count > platformMax) { platformMax = count; platform = p } })
      return {
        username:     c.username,
        platform,
        totalUSD:     parseFloat(c.usd.toFixed(2)),
        totalTokens:  c.tokens,
        sessionCount: c.count,
        avgSessionUSD: parseFloat((c.usd / c.count).toFixed(2)),
        sessionTypes: [...c.sessionTypes],
        lastSession:  sorted[sorted.length - 1]?.toISOString() || null,
        firstSession: sorted[0]?.toISOString() || null,
        daysSinceLast: sorted.length
          ? Math.floor((Date.now() - sorted[sorted.length - 1]) / 86400000)
          : null,
      }
    })
    .sort((a, b) => b.totalUSD - a.totalUSD)
    .slice(0, 20)

  // ── PEAK HOURS FOR PAID SESSIONS ───────────────────────────
  const hourMap = {}
  sessions.forEach(s => {
    const h = new Date(s.date_time).getUTCHours()
    if (!hourMap[h]) hourMap[h] = { usd: 0, count: 0 }
    hourMap[h].usd   += parseFloat(s.usd) || 0
    hourMap[h].count += 1
  })
  const peakHours = Object.entries(hourMap)
    .map(([h, d]) => ({
      hour:     parseInt(h),
      usd:      parseFloat(d.usd.toFixed(2)),
      count:    d.count,
      avgUsd:   parseFloat((d.usd / d.count).toFixed(2)),
    }))
    .sort((a, b) => b.usd - a.usd)

  const bestHour = peakHours[0] || null

  // ── MONTHLY TREND ──────────────────────────────────────────
  const monthMap = {}
  sessions.forEach(s => {
    const dt  = new Date(s.date_time)
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    if (!monthMap[key]) monthMap[key] = { usd: 0, count: 0, clients: new Set() }
    monthMap[key].usd     += parseFloat(s.usd) || 0
    monthMap[key].count   += 1
    monthMap[key].clients.add((s.username || '').toLowerCase())
  })
  const monthlyTrend = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      usd:     parseFloat(d.usd.toFixed(2)),
      count:   d.count,
      clients: d.clients.size,
    }))

  const bestMonth = monthlyTrend.length
    ? [...monthlyTrend].sort((a, b) => b.usd - a.usd)[0]
    : null

  // ── MOMENTUM (last 30 vs prior 30 days) ───────────────────
  const now         = Date.now()
  const ms30        = 30 * 24 * 60 * 60 * 1000
  const last30USD   = sessions
    .filter(s => now - new Date(s.date_time) <= ms30)
    .reduce((sum, s) => sum + (parseFloat(s.usd) || 0), 0)
  const prior30USD  = sessions
    .filter(s => {
      const age = now - new Date(s.date_time)
      return age > ms30 && age <= ms30 * 2
    })
    .reduce((sum, s) => sum + (parseFloat(s.usd) || 0), 0)

  let momentumPct   = 0
  let momentumLabel = 'Steady'
  if (prior30USD === 0 && last30USD === 0) {
    momentumLabel = 'No data'
  } else if (last30USD === 0) {
    // No revenue at all in the last 30 days — this is an absence of
    // recent streaming, not a measured downward trend. Don't fabricate
    // a "Declining" claim from zero data.
    momentumPct = -100; momentumLabel = 'Inactive'
  } else if (prior30USD === 0) {
    momentumPct = 100; momentumLabel = 'Surging'
  } else {
    momentumPct = ((last30USD - prior30USD) / prior30USD) * 100
    if      (momentumPct >  50) momentumLabel = 'Surging'
    else if (momentumPct >  10) momentumLabel = 'Growing'
    else if (momentumPct > -10) momentumLabel = 'Steady'
    else                        momentumLabel = 'Declining'
  }

  // ── REPEAT CLIENT RATE ─────────────────────────────────────
  const repeatClients   = Object.values(clientMap).filter(c => c.count > 1).length
  const totalClients    = Object.keys(clientMap).length
  const repeatClientPct = totalClients > 0
    ? Math.round((repeatClients / totalClients) * 100)
    : 0

  // ── DATE RANGE ─────────────────────────────────────────────
  const allDates  = sessions.map(s => new Date(s.date_time)).filter(d => !isNaN(d))
  const dateRange = allDates.length ? {
    from: new Date(Math.min(...allDates)).toISOString(),
    to:   new Date(Math.max(...allDates)).toISOString(),
  } : null

  // ── AVERAGES ────────────────────────────────────────────────
  const avgTokensPerSession = totalCount > 0 ? Math.round(totalTokens / totalCount) : 0
  const avgPayoutPerToken   = totalTokens > 0 ? parseFloat((totalUSD / totalTokens).toFixed(4)) : 0

  return {
    totalUSD:            parseFloat(totalUSD.toFixed(2)),
    totalTokens,
    totalCount,
    avgSessionUSD:       totalCount > 0 ? parseFloat((totalUSD / totalCount).toFixed(2)) : 0,
    avgTokensPerSession,
    avgPayoutPerToken,
    uniqueClients:       totalClients,
    repeatClients,
    repeatClientPct,
    sessionTypeBreakdown,
    platformBreakdown,
    topClients,
    peakHours,
    bestHour,
    monthlyTrend,
    bestMonth,
    momentum: {
      pct:        parseFloat(momentumPct.toFixed(1)),
      label:      momentumLabel,
      last30USD:  parseFloat(last30USD.toFixed(2)),
      prior30USD: parseFloat(prior30USD.toFixed(2)),
    },
    dateRange,
  }
}

// ── Snapshot window (Free-tier 31-day analysis window) ──────────────────
// Single source of truth for "full imported history" vs "the most recent
// N days of it" — used by both the onboarding paste flow (client-side, over
// already-parsed rows) and the CSV-upload API route (server-side, over
// tipRows about to be inserted), so the two import paths never compute this
// two different ways. This is a DISPLAY window, not a storage/retention
// limit: callers must still persist every valid row regardless of what this
// returns — it only describes what date range the "full" vs "recent" stats
// cover, from data that's already been correctly parsed/validated upstream.
export function computeSnapshotStats(rows, windowDays = 31) {
  const dated = rows
    .map(r => ({
      date: r.date instanceof Date ? r.date : new Date(r.date || r.dateRaw || r.ts),
      tokens: Number(r.tokens) || 0,
      usd: Number(r.usd) || 0,
    }))
    .filter(r => !isNaN(r.date.getTime()))
    .sort((a, b) => a.date - b.date)

  const empty = { from: null, to: null, days: 0, tips: 0, tokens: 0, usd: 0 }
  if (!dated.length) return { full: empty, recent: { ...empty, isPartial: true } }

  const from = dated[0].date
  const to = dated[dated.length - 1].date
  const fullDays = Math.floor((to - from) / 86400000) + 1

  const full = {
    from, to, days: fullDays,
    tips: dated.length,
    tokens: dated.reduce((s, r) => s + r.tokens, 0),
    usd: parseFloat(dated.reduce((s, r) => s + r.usd, 0).toFixed(2)),
  }

  const windowStart = new Date(to.getTime() - (windowDays - 1) * 86400000)
  const recentStart = windowStart < from ? from : windowStart
  const recentRows = dated.filter(r => r.date >= recentStart)
  const recentDays = Math.floor((to - recentStart) / 86400000) + 1

  const recent = {
    from: recentStart, to, days: recentDays,
    tips: recentRows.length,
    tokens: recentRows.reduce((s, r) => s + r.tokens, 0),
    usd: parseFloat(recentRows.reduce((s, r) => s + r.usd, 0).toFixed(2)),
    isPartial: fullDays < windowDays,
  }

  return { full, recent }
}

// ── FREE TIER 31-DAY WINDOW ENFORCEMENT ────────────────────────────────────────
// Apply 31-day rolling window PER PLATFORM for free-tier analysis.
// Free users see only the most recent 31 days per connected platform (activity-anchored,
// not calendar-anchored). Pro users see full history.
// This is a DISPLAY/ANALYSIS window, not a storage limit: all rows are persisted,
// only what the analysis consumes changes.
// Start of the free-tier window per platform, anchored to that platform's
// latest row. Shared by applyFreeAnalysisWindow and anything that must apply
// the identical window to a different row set (e.g. private earnings).
export function freeWindowStartByPlatform(rows = [], { windowDays = 31 } = {}) {
  const latest = {}
  for (const row of rows) {
    const platform = row.platform || 'unknown'
    const d = new Date(row.date_time || row.date || row.ts)
    if (isNaN(d.getTime())) continue
    if (!latest[platform] || d > latest[platform]) latest[platform] = d
  }
  const starts = {}
  for (const platform in latest) {
    starts[platform] = new Date(latest[platform].getTime() - (windowDays - 1) * 86400000)
  }
  return starts
}

// Free tier: every platform keeps a rolling `windowDays` (anchored to its own
// latest row) EXCEPT the creator's primary platform (`unlimitedPlatform`, from
// lib/planLimits.js resolvePlatformRoles), which keeps its full history.
// With no primary (null) every platform is windowed — the pre-existing rule.
// This is the ONLY implementation of Free history gating; everything that
// shows Free data must go through it (see accessibleDataset below).
export function applyFreeAnalysisWindow(rows = [], { windowDays = 31, unlimitedPlatform = null } = {}) {
  if (!rows.length) return []
  const unlimited = unlimitedPlatform ? canonicalPlatform(unlimitedPlatform) : null

  // Group by platform, compute window per platform (anchored to that platform's latest activity)
  const byPlatform = {}
  for (const row of rows) {
    const platform = row.platform || 'unknown'
    if (!byPlatform[platform]) {
      byPlatform[platform] = []
    }
    byPlatform[platform].push(row)
  }

  const windowed = []
  for (const platform in byPlatform) {
    const platformRows = byPlatform[platform]
    // Sort by date to find latest
    const sorted = [...platformRows].sort((a, b) => {
      const aDate = new Date(a.date_time || a.date || a.ts)
      const bDate = new Date(b.date_time || b.date || b.ts)
      return aDate - bDate
    })

    if (!sorted.length) continue
    if (unlimited && canonicalPlatform(platform) === unlimited) { windowed.push(...sorted); continue }

    const latestDate = new Date(sorted[sorted.length - 1].date_time || sorted[sorted.length - 1].date || sorted[sorted.length - 1].ts)
    const windowStart = new Date(latestDate.getTime() - (windowDays - 1) * 86400000)

    // Keep only rows >= windowStart for this platform
    const kept = sorted.filter(r => {
      const rowDate = new Date(r.date_time || r.date || r.ts)
      return rowDate >= windowStart
    })

    windowed.push(...kept)
  }

  return windowed
}

// ── Window exclusion summary for teaser signal detection ──────────────────────────
// Summarizes what was excluded when applying the free-tier window.
// Used to determine whether a Pro teaser card has "real signal" (there actually IS
// excluded older data) vs. being fabricated/empty.
export function summarizeWindowExclusion(allRows = [], windowedRows = []) {
  if (allRows.length === windowedRows.length) {
    // No exclusion happened
    return {
      excludedCount: 0,
      oldestExcludedDate: null,
      byPlatform: {},
    }
  }

  // Find excluded rows
  const windowedSet = new Set(windowedRows.map(r => `${r.username}|${r.platform}|${r.date_time || r.date || r.ts}`))
  const excluded = allRows.filter(r => !windowedSet.has(`${r.username}|${r.platform}|${r.date_time || r.date || r.ts}`))

  // Group excluded by platform
  const byPlatform = {}
  let oldestDate = null
  for (const row of excluded) {
    const platform = row.platform || 'unknown'
    if (!byPlatform[platform]) {
      byPlatform[platform] = { count: 0, oldestDate: null }
    }
    byPlatform[platform].count++

    const rowDate = new Date(row.date_time || row.date || row.ts)
    if (!byPlatform[platform].oldestDate || rowDate < new Date(byPlatform[platform].oldestDate)) {
      byPlatform[platform].oldestDate = rowDate
    }
    if (!oldestDate || rowDate < oldestDate) {
      oldestDate = rowDate
    }
  }

  return {
    excludedCount: excluded.length,
    oldestExcludedDate: oldestDate,
    byPlatform,
  }
}

// The accessible dataset for a plan. Tips go through applyFreeAnalysisWindow;
// private charges, Live private intervals and finalized Live shows are cut at
// the SAME per-platform start the tips produced (a platform with no tips is
// anchored on its own latest private row), so nothing hidden can leak through
// another table. Pro gets everything unchanged.
export function accessibleDataset({
  tips = [], paidSessions = [], liveIntervals = [], shows = [],
  isPro = false, unlimitedPlatform = null, windowDays = 31,
} = {}) {
  if (isPro) return { tips, paidSessions, liveIntervals, shows, windowStarts: null, unlimitedPlatform: null }
  const unlimited = unlimitedPlatform ? canonicalPlatform(unlimitedPlatform) : null
  const starts = { ...freeWindowStartByPlatform(paidSessions, { windowDays }), ...freeWindowStartByPlatform(tips, { windowDays }) }
  const byKey = {}
  for (const [p, d] of Object.entries(starts)) byKey[canonicalPlatform(p).toLowerCase()] = d
  const allowed = (platform, at) => {
    const c = canonicalPlatform(platform || 'unknown')
    if (unlimited && c === unlimited) return true
    const start = byKey[c.toLowerCase()]
    const d = new Date(at)
    return !!start && !isNaN(d.getTime()) && d >= start
  }
  return {
    tips: applyFreeAnalysisWindow(tips, { windowDays, unlimitedPlatform: unlimited }),
    paidSessions: paidSessions.filter((r) => allowed(r.platform, r.date_time)),
    liveIntervals: liveIntervals.filter((r) => allowed(r.platform, r.ended_at || r.endedAt)),
    shows: shows.filter((s) => {
      const plats = (s.platformRevenue || []).map((x) => x.platform)
      if (!plats.length && s.platform) plats.push(s.platform)
      return plats.some((p) => allowed(p, s.startedAt))
    }),
    windowStarts: byKey,
    unlimitedPlatform: unlimited,
  }
}
