/**
 * Email: everything the app sends goes through here (Twilio Email API).
 * See twilio-email.ts for details.
 */
export * from './twilio-email';
export {
  createEmailPreferencesRouter,
  preferencesUrl,
  PREFERENCES_LINK_TEXT,
} from './preferences';
export { addSuppression, getSuppressionScopes, removeUnsubscribes } from './suppressions';
