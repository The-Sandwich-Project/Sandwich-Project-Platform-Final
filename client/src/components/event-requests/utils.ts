import { SANDWICH_TYPES } from './constants';
import { logger } from '@/lib/logger';

// Utility function to convert 24-hour time to 12-hour format
export const formatTime12Hour = (time24: string): string => {
  if (!time24 || typeof time24 !== 'string') return '';

  // If already formatted (contains AM/PM), return as-is
  if (time24.includes('AM') || time24.includes('PM') || time24.includes('am') || time24.includes('pm')) {
    return time24;
  }

  // Parse HH:MM or HH:MM:SS format
  const match = time24.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return ''; // Return empty if format not recognized

  const hours = match[1];
  const minutes = match[2];
  const hour24 = parseInt(hours, 10);

  if (isNaN(hour24) || hour24 < 0 || hour24 > 23) return '';

  if (hour24 === 0) return `12:${minutes} AM`;
  if (hour24 < 12) return `${hour24}:${minutes} AM`;
  if (hour24 === 12) return `12:${minutes} PM`;

  return `${hour24 - 12}:${minutes} PM`;
};

// Utility function to convert 24-hour time to 12-hour format for input display
export const formatTimeForInput = (time24: string): string => {
  if (!time24 || typeof time24 !== 'string') return '';

  // If contains AM/PM, strip it and parse
  const timeWithoutPeriod = time24.replace(/\s*(AM|PM|am|pm)\s*/g, '').trim();
  
  // Parse HH:MM or HH:MM:SS or H:MM format
  const match = timeWithoutPeriod.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';

  const hours = match[1];
  const minutes = match[2];

  // For HTML time input, we need HH:MM in 24-hour format
  return `${hours.padStart(2, '0')}:${minutes}`;
};

// Helper function to get sandwich types summary for new standardized format
export const getSandwichTypesSummary = (request: any) => {
  // Handle new standardized sandwich types format (array of {type, quantity})
  let sandwichTypes = request.sandwichTypes;

  // If sandwichTypes is a string, try to parse it as JSON
  if (typeof sandwichTypes === 'string') {
    try {
      sandwichTypes = JSON.parse(sandwichTypes);
    } catch (e) {
      logger.warn('Failed to parse sandwich types JSON:', sandwichTypes);
      sandwichTypes = null;
    }
  }

  if (sandwichTypes && Array.isArray(sandwichTypes)) {
    const total = sandwichTypes.reduce(
      (sum: number, item: any) => sum + (item.quantity || 0),
      0
    );

    if (sandwichTypes.length === 1) {
      // Single type
      const type = sandwichTypes[0].type;
      const typeLabel =
        SANDWICH_TYPES.find((t) => t.value === type)?.label || type;
      return {
        total,
        breakdown: `${total} ${typeLabel}`,
        hasBreakdown: true,
      };
    } else if (sandwichTypes.length > 1) {
      // Multiple types
      const breakdown = sandwichTypes
        .filter((item: any) => item.quantity > 0)
        .map((item: any) => {
          const typeLabel =
            SANDWICH_TYPES.find((t) => t.value === item.type)?.label ||
            item.type;
          return `${item.quantity} ${typeLabel}`;
        })
        .join(', ');
      return {
        total,
        breakdown,
        hasBreakdown: true,
      };
    }
  }

  // Legacy format fallback
  if (request.estimatedSandwichCount) {
    const total = request.estimatedSandwichCount;
    const type = request.sandwichType || 'Unknown';
    // Convert sandwich type code to readable label
    const typeLabel =
      type !== 'Unknown' && type !== 'unknown'
        ? SANDWICH_TYPES.find((t) => t.value === type)?.label || type
        : 'Unknown';
    return {
      total,
      breakdown:
        typeLabel !== 'Unknown'
          ? `${total} ${typeLabel}`
          : `${total} sandwiches`,
      hasBreakdown: typeLabel !== 'Unknown',
    };
  }

  return { total: 0, breakdown: 'Unknown', hasBreakdown: false };
};

// Enhanced date formatting with day-of-week and color coding
export const formatEventDate = (dateString: string) => {
  try {
    if (!dateString)
      return { text: 'No date provided', className: 'text-tsp-teal' };

    // Parse the date string safely - handle database timestamps, YYYY-MM-DD, and ISO dates
    let date: Date;
    if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    ) {
      // Database timestamp format: "2025-09-03 00:00:00"
      // Extract just the date part and create at noon to avoid timezone issues
      const dateOnly = dateString.split(' ')[0];
      date = new Date(dateOnly + 'T12:00:00');
    } else if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)
    ) {
      // ISO format with midnight time (e.g., "2025-09-03T00:00:00.000Z")
      // Extract just the date part and create at noon to avoid timezone issues
      const dateOnly = dateString.split('T')[0];
      date = new Date(dateOnly + 'T12:00:00');
    } else if (dateString.includes('T') || dateString.includes('Z')) {
      date = new Date(dateString);
    } else if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2}$/)
    ) {
      // For YYYY-MM-DD format, add noon to prevent timezone shift
      date = new Date(dateString + 'T12:00:00');
    } else {
      date = new Date(dateString);
    }

    if (isNaN(date.getTime())) return { text: 'Invalid date', className: '' };

    // Date is already in local time (either from T12:00:00 or direct Date object)
    // No timezone manipulation needed - just use the local methods
    const dayOfWeek = date.getDay();
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dateFormatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const isWedOrThu = dayOfWeek === 3 || dayOfWeek === 4;
    let className = 'text-[#1A2332] font-medium';

    return {
      text: dateFormatted,
      className,
      dayName,
      isWedOrThu,
    };
  } catch (error) {
    return { text: 'Invalid date', className: '' };
  }
};

// Helper function to format date for input field
export const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return '';

  // If it's already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }

  // Try to parse various date formats and convert to YYYY-MM-DD
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (error) {
    logger.warn('Error formatting date:', error);
    return '';
  }
};

// Timezone-safe toolkit date formatter - prevents date shifting by a day
export const formatToolkitDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '';

  try {
    // Parse the date string safely - handle database timestamps, ISO dates, and other formats
    let date: Date;
    if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    ) {
      // Database timestamp format: "2025-09-03 00:00:00"
      // Extract just the date part and create at noon to avoid timezone issues
      const dateOnly = dateString.split(' ')[0];
      date = new Date(dateOnly + 'T12:00:00');
    } else if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d{3})?Z?$/)
    ) {
      // ISO format with midnight time (e.g., "2025-09-03T00:00:00.000Z")
      // Extract just the date part and create at noon to avoid timezone issues
      const dateOnly = dateString.split('T')[0];
      date = new Date(dateOnly + 'T12:00:00');
    } else if (dateString.includes('T') || dateString.includes('Z')) {
      // Handle full ISO timestamps by parsing them directly
      date = new Date(dateString);
    } else if (
      dateString &&
      typeof dateString === 'string' &&
      dateString.match(/^\d{4}-\d{2}-\d{2}$/)
    ) {
      // For YYYY-MM-DD format, add noon to prevent timezone shift
      date = new Date(dateString + 'T12:00:00');
    } else {
      // Fallback for other formats - use noon to prevent shifts
      const tempDate = new Date(dateString);
      if (isNaN(tempDate.getTime())) return 'Invalid date';
      
      // Extract date components and recreate at noon to avoid timezone issues
      const year = tempDate.getFullYear();
      const month = String(tempDate.getMonth() + 1).padStart(2, '0');
      const day = String(tempDate.getDate()).padStart(2, '0');
      date = new Date(`${year}-${month}-${day}T12:00:00`);
    }

    if (isNaN(date.getTime())) return 'Invalid date';

    // Format the date safely
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  } catch (error) {
    logger.warn('Error formatting toolkit date:', error);
    return 'Invalid date';
  }
};

// Utility functions for pickup date and time formatting with backward compatibility

/**
 * Formats pickup time for display with full date and time support
 * Handles both legacy pickupTime (time only) and new pickupDateTime (full datetime) fields
 * @param pickupDateTime - Full datetime string (preferred)
 * @param pickupTime - Legacy time string (fallback)
 * @param eventDate - Event date for context when only time is available
 * @returns Formatted pickup datetime string or fallback
 */
export const formatPickupDateTime = (
  pickupDateTime?: string | null,
  pickupTime?: string | null,
  eventDate?: string | null
): string => {
  try {
    // Priority 1: Use pickupDateTime if available (new format)
    if (pickupDateTime) {
      const date = new Date(pickupDateTime);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }
    }

    // Priority 2: Combine pickupTime with eventDate (legacy format)
    if (pickupTime && eventDate) {
      try {
        // Parse the event date
        let baseDateStr = eventDate;
        if (eventDate.includes('T')) {
          baseDateStr = eventDate.split('T')[0];
        }
        
        // Combine date and time
        const combinedDateTime = new Date(`${baseDateStr}T${pickupTime}:00`);
        if (!isNaN(combinedDateTime.getTime())) {
          return combinedDateTime.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
        }
      } catch (error) {
        logger.warn('Error combining pickupTime with eventDate:', error);
      }
    }

    // Priority 3: Show just the time if no date context available
    if (pickupTime) {
      return `${formatTime12Hour(pickupTime)} (time only)`;
    }

    return 'Not set';
  } catch (error) {
    logger.warn('Error formatting pickup datetime:', error);
    return pickupTime ? `${formatTime12Hour(pickupTime)} (time only)` : 'Not set';
  }
};

/**
 * Formats pickup time for display with enhanced context
 * Similar to formatPickupDateTime but with more compact output
 * @param pickupDateTime - Full datetime string (preferred)
 * @param pickupTime - Legacy time string (fallback)
 * @param eventDate - Event date for context when only time is available
 * @returns Formatted pickup datetime string or fallback
 */
export const formatPickupTimeDisplay = (
  pickupDateTime?: string | null,
  pickupTime?: string | null,
  eventDate?: string | null
): string => {
  try {
    // Priority 1: Use pickupDateTime if available (new format)
    if (pickupDateTime) {
      const date = new Date(pickupDateTime);
      if (!isNaN(date.getTime())) {
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        
        if (isToday) {
          return `Today at ${date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })}`;
        } else {
          return `${date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
          })} at ${date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })}`;
        }
      }
    }

    // Priority 2: Combine pickupTime with eventDate (legacy format)
    if (pickupTime && eventDate) {
      try {
        let baseDateStr = eventDate;
        if (eventDate.includes('T')) {
          baseDateStr = eventDate.split('T')[0];
        }
        
        const combinedDateTime = new Date(`${baseDateStr}T${pickupTime}:00`);
        if (!isNaN(combinedDateTime.getTime())) {
          const today = new Date();
          const isToday = combinedDateTime.toDateString() === today.toDateString();
          
          if (isToday) {
            return `Today at ${formatTime12Hour(pickupTime)}`;
          } else {
            return `${combinedDateTime.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: combinedDateTime.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
            })} at ${formatTime12Hour(pickupTime)}`;
          }
        }
      } catch (error) {
        logger.warn('Error combining pickupTime with eventDate:', error);
      }
    }

    // Priority 3: Show just the time if no date context available
    if (pickupTime) {
      return formatTime12Hour(pickupTime);
    }

    return 'Not set';
  } catch (error) {
    logger.warn('Error formatting pickup time display:', error);
    return pickupTime ? formatTime12Hour(pickupTime) : 'Not set';
  }
};

/**
 * Gets the effective pickup datetime value for editing purposes
 * Prioritizes pickupDateTime over pickupTime
 * @param pickupDateTime - Full datetime string (preferred)
 * @param pickupTime - Legacy time string (fallback)
 * @param eventDate - Event date for context when only time is available
 * @returns ISO datetime string for input fields
 */
export const getPickupDateTimeForInput = (
  pickupDateTime?: string | null,
  pickupTime?: string | null,
  eventDate?: string | null
): string => {
  try {
    // Priority 1: Use pickupDateTime if available
    if (pickupDateTime) {
      const date = new Date(pickupDateTime);
      if (!isNaN(date.getTime())) {
        // Create local datetime string without timezone conversion
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      }
    }

    // Priority 2: Combine pickupTime with eventDate
    if (pickupTime && eventDate) {
      try {
        let baseDateStr = eventDate;
        if (eventDate.includes('T')) {
          baseDateStr = eventDate.split('T')[0];
        }
        
        const combinedDateTime = new Date(`${baseDateStr}T${pickupTime}:00`);
        if (!isNaN(combinedDateTime.getTime())) {
          // Create local datetime string without timezone conversion
          const year = combinedDateTime.getFullYear();
          const month = String(combinedDateTime.getMonth() + 1).padStart(2, '0');
          const day = String(combinedDateTime.getDate()).padStart(2, '0');
          const hours = String(combinedDateTime.getHours()).padStart(2, '0');
          const minutes = String(combinedDateTime.getMinutes()).padStart(2, '0');
          return `${year}-${month}-${day}T${hours}:${minutes}`;
        }
      } catch (error) {
        logger.warn('Error combining pickupTime with eventDate for input:', error);
      }
    }

    return '';
  } catch (error) {
    logger.warn('Error getting pickup datetime for input:', error);
    return '';
  }
};

/**
 * Parses PostgreSQL array format and normalizes recipient IDs
 * Supports legacy numeric IDs and new prefixed format (host:ID, recipient:ID, custom:text)
 *
 * PostgreSQL array formats handled:
 * - {1,2,3} - simple numeric values
 * - {"host:5","recipient:10","custom:Hall, Room 2"} - quoted strings with prefixes
 * - {"value with ""quotes"""} - escaped quotes (doubled)
 * - {"value,with,commas"} - commas inside quoted strings
 *
 * @param ids - PostgreSQL array string, JSON array, or raw array
 * @returns Normalized array of prefixed ID strings
 */
export const parsePostgresArray = (ids: unknown): string[] => {
  if (!ids) return [];

  let rawIds: unknown[] = [];

  // Handle PostgreSQL array format: {1,2,3} or {"host:5","recipient:10","custom:Hall, Room 2"}
  if (typeof ids === 'string' && ids.startsWith('{') && ids.endsWith('}')) {
    const arrayContent = ids.slice(1, -1); // Remove { and }

    // Explicitly handle empty PostgreSQL array "{}"
    if (!arrayContent) {
      rawIds = [];
    } else {
      // Parse PostgreSQL array format respecting quoted strings
      // PostgreSQL escapes quotes as "" (doubled) or \" (backslash)
      const parsed: string[] = [];
      let current = '';
      let inQuotes = false;
      let backslashCount = 0; // Number of consecutive backslashes just seen inside quotes

      for (let i = 0; i < arrayContent.length; i++) {
        const char = arrayContent[i];
        const nextChar = i < arrayContent.length - 1 ? arrayContent[i + 1] : null;

        if (char === '"') {
          if (inQuotes && backslashCount % 2 === 1) {
            // Backslash-escaped quote (\") with an odd number of preceding backslashes
            // Replace the last backslash with a quote
            current = current.slice(0, -1) + '"';
            backslashCount = 0;
          } else if (inQuotes && nextChar === '"') {
            // Doubled quote ("") inside quoted string = escaped quote, add one quote
            current += '"';
            i++; // Skip the next quote
            backslashCount = 0;
          } else {
            // Regular quote - toggle quote state
            inQuotes = !inQuotes;
            backslashCount = 0;
          }
        } else if (char === '\\' && inQuotes) {
          // Track backslashes inside quoted strings to determine if following quotes are escaped
          current += char;
          backslashCount += 1;
        } else if (char === ',' && !inQuotes) {
          // Comma outside quotes = separator
          if (current.trim()) {
            parsed.push(current.trim());
          }
          current = '';
          backslashCount = 0;
        } else {
          current += char;
          backslashCount = 0;
        }
      }

      // Don't forget the last value
      if (current.trim()) {
        parsed.push(current.trim());
      }

      rawIds = parsed;
    }
  }
  // Handle JSON string format: '["host:5","recipient:10"]'
  else if (typeof ids === 'string') {
    try {
      const parsed = JSON.parse(ids);
      if (Array.isArray(parsed)) {
        rawIds = parsed;
      }
    } catch (error) {
      // If JSON parsing fails, fall through and return the default empty array
      logger.warn('Failed to parse ids JSON string in parsePostgresArray', { error, ids });
    }
  }
  // Handle JSON array format when ids is already an array
  else if (Array.isArray(ids)) {
    rawIds = ids;
  }

  // Convert to new format with prefixes
  return rawIds.map(id => {
    const idStr = String(id);

    // If already has a prefix (host:, recipient:, custom:), keep as-is
    if (idStr.includes(':')) {
      return idStr;
    }

    // Legacy numeric ID - assume it's a recipient ID
    const numId = parseInt(idStr, 10);
    if (!isNaN(numId)) {
      return `recipient:${numId}`;
    }

    // Fallback - treat as custom text
    return `custom:${idStr}`;
  });
};