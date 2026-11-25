/**
 * Compliance: centralized email footer with opt-out text.
 * The email helper also adds a per-recipient "Manage email preferences /
 * unsubscribe" link to every email (server/services/email/preferences.ts).
 */

export const EMAIL_FOOTER_TEXT = `
---
The Sandwich Project
Fighting food insecurity one sandwich at a time

To unsubscribe from these emails, please contact us at katie@thesandwichproject.org.
`;

export const EMAIL_FOOTER_HTML = `
<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
  <p style="color: #888; font-size: 12px; margin: 0 0 10px 0;">
    The Sandwich Project<br>
    Fighting food insecurity one sandwich at a time
  </p>
  <p style="color: #888; font-size: 11px; margin: 0;">
    To unsubscribe from these emails, please contact us at
    <a href="mailto:katie@thesandwichproject.org?subject=Unsubscribe" style="color: #236383;">katie@thesandwichproject.org</a>.
  </p>
</div>
`;
