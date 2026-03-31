/**
 * Parse Naver pubDate in RFC2822 format. Returns Date object.
 */
function parseNaverDate(dateStr) {
  try {
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) return null;
    return dt;
  } catch {
    return null;
  }
}

/**
 * Parse Google relative time strings like '2 hours ago', '1 day ago', '2시간 전', '3일 전'.
 * Returns Date object in UTC.
 */
function parseGoogleRelativeTime(timeStr) {
  try {
    const str = timeStr.toLowerCase().trim();
    const now = new Date();

    const patterns = [
      // English patterns
      { regex: /(\d+)\s*second[s]?\s*ago/, unit: 'seconds' },
      { regex: /(\d+)\s*minute[s]?\s*ago/, unit: 'minutes' },
      { regex: /(\d+)\s*hour[s]?\s*ago/, unit: 'hours' },
      { regex: /(\d+)\s*day[s]?\s*ago/, unit: 'days' },
      { regex: /(\d+)\s*week[s]?\s*ago/, unit: 'weeks' },
      { regex: /(\d+)\s*month[s]?\s*ago/, unit: 'months' },
      { regex: /(\d+)\s*year[s]?\s*ago/, unit: 'years' },
      // Korean patterns
      { regex: /(\d+)\s*초\s*전/, unit: 'seconds' },
      { regex: /(\d+)\s*분\s*전/, unit: 'minutes' },
      { regex: /(\d+)\s*시간\s*전/, unit: 'hours' },
      { regex: /(\d+)\s*일\s*전/, unit: 'days' },
      { regex: /(\d+)\s*주\s*전/, unit: 'weeks' },
      { regex: /(\d+)\s*개월\s*전/, unit: 'months' },
      { regex: /(\d+)\s*달\s*전/, unit: 'months' },
      { regex: /(\d+)\s*년\s*전/, unit: 'years' },
    ];

    for (const { regex, unit } of patterns) {
      const match = str.match(regex);
      if (match) {
        const value = parseInt(match[1], 10);
        const ms = {
          seconds: value * 1000,
          minutes: value * 60 * 1000,
          hours: value * 60 * 60 * 1000,
          days: value * 24 * 60 * 60 * 1000,
          weeks: value * 7 * 24 * 60 * 60 * 1000,
          months: value * 30 * 24 * 60 * 60 * 1000,
          years: value * 365 * 24 * 60 * 60 * 1000,
        }[unit];
        return new Date(now.getTime() - ms);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse SerpAPI datetime format: '01/27/2026, 02:06 AM, +0000 UTC'
 * Returns Date object in UTC.
 */
function parseSerpApiDatetime(dateStr) {
  try {
    // Remove ', +0000 UTC' and parse
    const cleaned = dateStr.replace(/, \+0000 UTC$/, '').trim();
    // Format: MM/DD/YYYY, HH:MM AM/PM
    const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;

    let [, month, day, year, hours, minutes, ampm] = match;
    hours = parseInt(hours, 10);
    if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;

    const dt = new Date(Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hours,
      parseInt(minutes, 10)
    ));

    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

/**
 * Extract date from URL path patterns.
 * Handles /YYYY/MM/DD/, YYYY-MM-DD, and 8-digit YYYYMMDD in URL.
 */
function extractDateFromUrl(url) {
  if (!url) return null;
  try {
    // /YYYY/MM/DD/ pattern
    let m = url.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$|-|\?)/);
    if (m) {
      const dt = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (!isNaN(dt.getTime()) && parseInt(m[1]) >= 2000) return dt;
    }

    // YYYY-MM-DD pattern anywhere in URL
    m = url.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const dt = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      if (!isNaN(dt.getTime()) && parseInt(m[1]) >= 2000) return dt;
    }

    // 8-digit YYYYMMDD after /, =, or _
    m = url.match(/[/=_](\d{8})(?:\D|$)/);
    if (m) {
      const s = m[1];
      const year  = parseInt(s.slice(0, 4));
      const month = parseInt(s.slice(4, 6)) - 1;
      const day   = parseInt(s.slice(6, 8));
      if (year >= 2000 && month >= 0 && month < 12 && day >= 1 && day <= 31) {
        const dt = new Date(year, month, day);
        if (!isNaN(dt.getTime())) return dt;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Parse published date based on source.
 * Supports multiple formats:
 * - SerpAPI format: '01/27/2026, 02:06 AM, +0000 UTC'
 * - RFC2822: 'Wed, 29 Jan 2026 10:30:00 GMT'
 * - Relative time: '2시간 전', '2 hours ago'
 */
function parseDotDate(dateStr) {
  // YYYY.MM.DD or YYYY.M.D format (네이버/다음에서 사용)
  const match = dateStr.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\.?$/);
  if (!match) return null;
  const dt = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * @param {string|null} dateStr
 * @param {string} source
 * @param {string|null} url - article URL used as last-resort fallback for date extraction
 */
function parsePublishedDate(dateStr, source = 'google', url = null) {
  if (!dateStr) {
    return url ? extractDateFromUrl(url) : null;
  }

  let result = parseSerpApiDatetime(dateStr);
  if (result) return result;

  result = parseGoogleRelativeTime(dateStr);
  if (result) return result;

  result = parseDotDate(dateStr);
  if (result) return result;

  result = parseNaverDate(dateStr);
  if (result) return result;

  // All string parsers failed — try URL
  return url ? extractDateFromUrl(url) : null;
}

module.exports = { parsePublishedDate, extractDateFromUrl, parseNaverDate, parseGoogleRelativeTime, parseSerpApiDatetime };
