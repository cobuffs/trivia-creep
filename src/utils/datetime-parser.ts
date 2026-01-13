/**
 * Parse user-friendly datetime strings into Date objects
 * Supports various formats like:
 * - "tomorrow at 8pm"
 * - "2024-01-15 20:00"
 * - "in 2 hours"
 * - "next friday at 7pm"
 * - "jan 15 8pm"
 * - "1/15/2024 8:00 PM"
 */

export interface ParseResult {
  date: Date | null;
  error: string | null;
}

export function parseDateTime(input: string): ParseResult {
  if (!input || input.trim().length === 0) {
    return { date: null, error: 'Empty datetime string' };
  }

  const normalized = input.trim().toLowerCase();
  const now = new Date();

  // Try relative time formats first
  // "in X minutes/hours/days"
  const relativeMatch = normalized.match(/^in\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const date = new Date(now);
    
    if (unit.startsWith('minute')) {
      date.setMinutes(date.getMinutes() + amount);
    } else if (unit.startsWith('hour')) {
      date.setHours(date.getHours() + amount);
    } else if (unit.startsWith('day')) {
      date.setDate(date.getDate() + amount);
    }
    
    return { date, error: null };
  }

  // "tomorrow at [time]"
  if (normalized.startsWith('tomorrow')) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    
    const timeMatch = normalized.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3];
      
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      date.setHours(hours, minutes, 0, 0);
    }
    
    return { date, error: null };
  }

  // "next [day] at [time]"
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayMatch = normalized.match(/^next\s+(\w+)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (dayMatch) {
    const dayName = dayMatch[1];
    const dayIndex = dayNames.findIndex(d => d.startsWith(dayName));
    
    if (dayIndex !== -1) {
      const date = new Date(now);
      const currentDay = date.getDay();
      let daysUntil = (dayIndex - currentDay + 7) % 7;
      if (daysUntil === 0) daysUntil = 7; // Next week if today
      
      date.setDate(date.getDate() + daysUntil);
      date.setHours(0, 0, 0, 0);
      
      if (dayMatch[2]) {
        let hours = parseInt(dayMatch[2], 10);
        const minutes = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0;
        const ampm = dayMatch[4];
        
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        
        date.setHours(hours, minutes, 0, 0);
      }
      
      return { date, error: null };
    }
  }

  // Try ISO format: "2024-01-15 20:00" or "2024-01-15T20:00"
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+|\s*t\s*)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hours = parseInt(isoMatch[4], 10);
    const minutes = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const seconds = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;
    
    const date = new Date(year, month, day, hours, minutes, seconds);
    if (date.getTime() && !isNaN(date.getTime())) {
      return { date, error: null };
    }
  }

  // Try US format: "1/15/2024 8:00 PM" or "01/15/2024 20:00"
  const usMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10) - 1;
    const day = parseInt(usMatch[2], 10);
    const year = parseInt(usMatch[3], 10);
    
    let hours = 0;
    let minutes = 0;
    
    if (usMatch[4]) {
      hours = parseInt(usMatch[4], 10);
      minutes = usMatch[5] ? parseInt(usMatch[5], 10) : 0;
      const ampm = usMatch[6];
      
      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }
    
    const date = new Date(year, month, day, hours, minutes, 0);
    if (date.getTime() && !isNaN(date.getTime())) {
      return { date, error: null };
    }
  }

  // Try month name format: "jan 15 8pm" or "january 15, 2024 8:00 PM"
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
  const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                        'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const monthMatch = normalized.match(/^(\w+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/);
  if (monthMatch) {
    const monthName = monthMatch[1];
    const day = parseInt(monthMatch[2], 10);
    const year = monthMatch[3] ? parseInt(monthMatch[3], 10) : now.getFullYear();
    
    let monthIndex = monthNames.findIndex(m => m.startsWith(monthName));
    if (monthIndex === -1) {
      monthIndex = monthAbbrevs.findIndex(m => m.startsWith(monthName));
    }
    
    if (monthIndex !== -1) {
      let hours = 0;
      let minutes = 0;
      
      if (monthMatch[4]) {
        hours = parseInt(monthMatch[4], 10);
        minutes = monthMatch[5] ? parseInt(monthMatch[5], 10) : 0;
        const ampm = monthMatch[6];
        
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
      }
      
      const date = new Date(year, monthIndex, day, hours, minutes, 0);
      if (date.getTime() && !isNaN(date.getTime())) {
        return { date, error: null };
      }
    }
  }

  // Try simple time format: "8pm" or "20:00" (assumes today or tomorrow if past)
  const timeOnlyMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (timeOnlyMatch) {
    let hours = parseInt(timeOnlyMatch[1], 10);
    const minutes = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2], 10) : 0;
    const ampm = timeOnlyMatch[3];
    
    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    
    // If time has passed today, assume tomorrow
    if (date.getTime() < now.getTime()) {
      date.setDate(date.getDate() + 1);
    }
    
    return { date, error: null };
  }

  // Try native Date parsing as last resort
  const nativeDate = new Date(input);
  if (nativeDate.getTime() && !isNaN(nativeDate.getTime())) {
    return { date: nativeDate, error: null };
  }

  return { 
    date: null, 
    error: 'Could not parse datetime. Try formats like: "tomorrow at 8pm", "2024-01-15 20:00", "in 2 hours", or "next friday at 7pm"' 
  };
}

/**
 * Format a date for display in a user-friendly way
 */
export function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  };
  
  return date.toLocaleString('en-US', options);
}

/**
 * Get relative time string (e.g., "in 2 hours", "in 15 minutes")
 */
export function getRelativeTimeString(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  
  if (diffMs < 0) {
    return 'in the past';
  }
  
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMinutes < 60) {
    return `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
  } else if (diffHours < 24) {
    return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  } else {
    return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  }
}
