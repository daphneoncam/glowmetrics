import { supabase } from './supabase'

const SUPPORTED_PLATFORMS = ['chaturbate', 'bongacams', 'myfreecams']

/**
 * Log a paste/upload parsing attempt to the database
 * @param {Object} params
 * @param {UUID} params.userId - auth user id
 * @param {string} params.source - 'onboarding' or 'dashboard'
 * @param {string} params.attemptedPlatform - platform name (what they tried)
 * @param {string} params.claimedPlatform - platform they selected (if different)
 * @param {string} params.rawText - first part of pasted/uploaded text
 * @param {Object} params.formatAnalysis - {line_count, has_tabs, has_commas, top_shapes}
 * @param {boolean} params.parseSuccess - did parsing succeed?
 * @param {string} params.errorReason - friendly error message
 * @param {Object} params.errorDetails - detailed error info
 */
export async function logParseAttempt({
  userId,
  source,
  attemptedPlatform,
  claimedPlatform = null,
  rawText = null,
  formatAnalysis = {},
  parseSuccess = false,
  errorReason = null,
  errorDetails = null,
}) {
  if (!userId || !source || !attemptedPlatform) {
    console.warn('logParseAttempt: missing required fields', {
      userId,
      source,
      attemptedPlatform,
    })
    return
  }

  const supported = SUPPORTED_PLATFORMS.includes(attemptedPlatform.toLowerCase())

  // The full dataset is sent; the database function stores up to 2,000,000
  // characters (plus size, sha256 and a truncated flag) and keeps 90 days.
  const fullText = rawText || null

  try {
    const { data, error } = await supabase.rpc('log_paste_parse_attempt', {
      p_user_id: userId,
      p_source: source,
      p_attempted_platform: attemptedPlatform.toLowerCase(),
      p_claimed_platform: claimedPlatform ? claimedPlatform.toLowerCase() : null,
      p_supported: supported,
      p_raw_text: fullText,
      p_line_count: formatAnalysis.line_count || null,
      p_has_tabs: formatAnalysis.has_tabs || null,
      p_has_commas: formatAnalysis.has_commas || null,
      p_top_shapes: formatAnalysis.top_shapes || null,
      p_parse_success: parseSuccess,
      p_error_reason: errorReason,
      p_error_details: errorDetails || null,
    })

    if (error) {
      console.error('Failed to log parse attempt:', error)
      return null
    }

    return data
  } catch (err) {
    console.error('logParseAttempt error:', err)
    return null
  }
}

/**
 * Analyze format characteristics of pasted text
 * Returns object with line_count, has_tabs, has_commas, top_shapes
 */
export function analyzeFormat(rawText) {
  if (!rawText) return {}

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const lineCount = lines.length
  const hasCommas = rawText.includes(',')
  const hasTabs = rawText.includes('\t')

  // Analyze line shapes (pattern of text vs numbers)
  const shapes = []
  for (const line of lines.slice(0, 20)) {
    // Content-free: every digit -> 9, every letter in ANY script -> a, all
    // other characters (punctuation, emoji, symbols) dropped. No username,
    // amount or text survives, only the line's structure.
    const shape = line
      .replace(/\p{Nd}/gu, '9')
      .replace(/\p{L}/gu, 'a')
      .replace(/[^a9\s]/g, '')
      .substring(0, 50)
    shapes.push(shape)
  }

  // Count shape frequencies
  const shapeFreq = {}
  for (const shape of shapes) {
    shapeFreq[shape] = (shapeFreq[shape] || 0) + 1
  }

  const topShapes = Object.entries(shapeFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([shape, count]) => `${count}x ${shape}`)

  return {
    line_count: lineCount,
    has_tabs: hasTabs,
    has_commas: hasCommas,
    top_shapes: topShapes,
  }
}
