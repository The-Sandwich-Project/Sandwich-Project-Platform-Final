/**
 * Organization-wide constants
 * Centralized configuration to avoid hardcoding values across the codebase
 */

// Email configuration
export const ORG_EMAIL = process.env.ADMIN_EMAIL || 'katie@thesandwichproject.org';
export const FROM_EMAIL = ORG_EMAIL;
export const ADMIN_EMAIL = ORG_EMAIL;
// Domain authenticated in Twilio Email (Email -> Domains): any address on it may be a From address.
export const SENDER_DOMAIN = 'thesandwichproject.org';

// Organization info
export const ORG_NAME = 'The Sandwich Project';
export const ORG_TAGLINE = 'Fighting food insecurity one sandwich at a time';

// Brand colors (for consistency in emails)
export const BRAND_PRIMARY = '#236383';
export const BRAND_SECONDARY = '#47B3CB';
