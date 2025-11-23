/**
 * Timezone utility functions for consistent date/time handling
 * Uses Asia/Manila timezone (UTC+8) for all display and filtering operations
 */

const USER_TIMEZONE = 'Asia/Manila';

/**
 * Parse a timestamp string and convert it to a Date object
 * Assumes input is UTC (from Supabase timestamptz)
 */
export function parseTimestampToLocal(timestamp: string | Date): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  
  const timestampStr = String(timestamp).trim();
  
  if (!timestampStr) {
    throw new Error('Empty timestamp string');
  }
  
  let date: Date;
  
  // Check if timestamp has explicit timezone indicator
  const hasTimezone = timestampStr.includes('Z') || timestampStr.match(/[+-]\d{2}:?\d{2}$/);
  
  if (hasTimezone) {
    date = new Date(timestampStr);
  } else {
    // No timezone indicator - Supabase timestamptz is always UTC
    let normalized = timestampStr;
    
    // Replace space with T for ISO 8601 format
    if (normalized.includes(' ') && !normalized.includes('T')) {
      normalized = normalized.replace(' ', 'T');
    }
    
    // Ensure we have seconds if missing
    if (normalized.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
      normalized = normalized + ':00';
    }
    
    // Append Z if not present to indicate UTC
    if (!normalized.endsWith('Z') && !normalized.match(/[+-]\d{2}:?\d{2}$/)) {
      normalized = normalized + 'Z';
    }
    
    date = new Date(normalized);
  }
  
  // Validate the parsed date
  if (isNaN(date.getTime())) {
    // Fallback: try parsing with explicit UTC interpretation
    const match = timestampStr.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      date = new Date(Date.UTC(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(minute, 10),
        parseInt(second, 10)
      ));
    } else {
      date = new Date(timestampStr);
      if (isNaN(date.getTime())) {
        throw new Error(`Invalid timestamp: ${timestampStr}`);
      }
    }
  }
  
  return date;
}

/**
 * Get the hour in Asia/Manila timezone for a given UTC date
 * This is the key function to fix the timezone display issue
 */
export function getLocalHour(date: Date): number {
  // Use Intl.DateTimeFormat to get hour in Asia/Manila timezone
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: USER_TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(date),
    10
  );
}

/**
 * Get date components in Asia/Manila timezone
 */
export function getLocalDateComponents(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => {
    const part = parts.find(p => p.type === type);
    return part ? parseInt(part.value, 10) : 0;
  };
  
  return {
    year: getPart('year'),
    month: getPart('month') - 1, // JavaScript months are 0-indexed
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  };
}

/**
 * Normalize a date to the start of day in Asia/Manila timezone
 * Returns a Date object that represents midnight in Asia/Manila
 */
export function normalizeToStartOfDay(date: Date): Date {
  const local = getLocalDateComponents(date);
  // Create UTC date representing midnight in Asia/Manila
  // Asia/Manila is UTC+8, so midnight Manila = 4 PM previous day UTC
  const utcMidnight = new Date(Date.UTC(local.year, local.month, local.day, 0, 0, 0, 0));
  // Subtract 8 hours to get the UTC time that represents midnight in Manila
  utcMidnight.setUTCHours(utcMidnight.getUTCHours() - 8);
  return utcMidnight;
}

/**
 * Get start of week (Monday) in Asia/Manila timezone
 */
export function getStartOfWeek(date: Date): Date {
  const local = getLocalDateComponents(date);
  // Create date for today in Manila timezone
  const todayManila = new Date(Date.UTC(local.year, local.month, local.day, 0, 0, 0, 0));
  todayManila.setUTCHours(todayManila.getUTCHours() - 8);
  
  // Get day of week in Manila timezone (0 = Sunday, 1 = Monday, etc.)
  // We need to calculate this by creating a date and using getUTCDay
  // But we need to account for the timezone offset
  const tempDate = new Date(todayManila.getTime() + 8 * 60 * 60 * 1000);
  let dayOfWeek = tempDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Convert to Monday-based (0 = Monday, 6 = Sunday)
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  // Subtract days to get to Monday
  const monday = new Date(todayManila);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return monday;
}

/**
 * Format a date to a string in Asia/Manila timezone
 */
export function formatLocalDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: USER_TIMEZONE,
    ...options,
  }).format(date);
}

/**
 * Get the end of day in Asia/Manila timezone (23:59:59.999)
 */
export function normalizeToEndOfDay(date: Date): Date {
  const local = getLocalDateComponents(date);
  // Create UTC date representing end of day (23:59:59.999) in Asia/Manila
  const utcEndOfDay = new Date(Date.UTC(local.year, local.month, local.day, 23, 59, 59, 999));
  // Subtract 8 hours to get the UTC time that represents end of day in Manila
  utcEndOfDay.setUTCHours(utcEndOfDay.getUTCHours() - 8);
  return utcEndOfDay;
}

/**
 * Check if a date is within a range (inclusive) in Asia/Manila timezone
 */
export function isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
  const dateTime = date.getTime();
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  return dateTime >= startTime && dateTime <= endTime;
}

