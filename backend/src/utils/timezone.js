/**
 * Centralized Timezone & Entity Safety Utilities
 * Standardizes all date and time operations strictly in Pakistan Standard Time (PKT, UTC+5)
 * regardless of host machine or serverless (Vercel UTC) execution context.
 */

const PKT_TIMEZONE = 'Asia/Karachi';

/**
 * Returns strictly formatted local YYYY-MM-DD date string in Asia/Karachi timezone.
 * Eliminates UTC day-shift bugs caused by .toISOString().
 */
function getPKTDate(d = new Date()) {
  if (!d) return getPKTDate(new Date());
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return getPKTDate(new Date());

  // en-CA locale formats natively as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PKT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dateObj);
}

/**
 * Returns strictly formatted local 12-hour time string (e.g. "01:40 PM") in Asia/Karachi timezone.
 */
function getPKTTime(d = new Date()) {
  if (!d) return getPKTTime(new Date());
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return getPKTTime(new Date());

  return new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(dateObj);
}

/**
 * Returns unified PKT date and time object with UTC ISO string for database storage.
 */
function getPKTTimestamp(d = new Date()) {
  const dateObj = (d instanceof Date) ? d : new Date(d);
  return {
    date: getPKTDate(dateObj),
    time: getPKTTime(dateObj),
    iso: dateObj.toISOString()
  };
}

/**
 * Checks if a class ID, class name, or student is designated as a test or dummy entity.
 * Used to safeguard parents against real WhatsApp dispatches during testing.
 */
function isTestEntity(...identifiers) {
  const testPattern = /(?:dummy|test|sample|mock|demo_test)/i;
  return identifiers.some(id => id && testPattern.test(String(id).trim()));
}

module.exports = {
  PKT_TIMEZONE,
  getPKTDate,
  getPKTTime,
  getPKTTimestamp,
  isTestEntity
};
