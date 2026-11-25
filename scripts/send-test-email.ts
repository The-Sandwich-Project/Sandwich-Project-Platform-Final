/**
 * Send ONE test email through Twilio Email, using the same helper the app uses
 * (server/services/email). Run it in the Replit Shell, where the secrets are:
 *
 *   npm run email:test -- you@example.com
 *   npm run email:test -- you@example.com --from someone@thesandwichproject.org
 *
 * Needs TWILIO_EMAIL_API_KEY, TWILIO_EMAIL_API_SECRET and EMAIL_FROM_ADDRESS.
 * Prints whether Twilio accepted it (202 + operation id) or the status code
 * and response body it returned. Never prints the key or secret.
 *
 * The email also checks that literal {{ ... }} text survives: Twilio runs
 * Liquid templating over every email and rejects undeclared {{ variables }},
 * so the helper escapes them. The "Liquid check" line should arrive showing
 * {{ liquid_check }} with its braces.
 */
import { sendEmailWithResult, missingEmailConfig } from '../server/services/email';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== arg('--from'));
  if (!to || !to.includes('@')) {
    console.error('Usage: npm run email:test -- you@example.com [--from sender@thesandwichproject.org]');
    process.exit(1);
  }
  const missing = missingEmailConfig();
  if (missing.length > 0) {
    console.error(`Not configured: ${missing.join(', ')}. Add them in Replit Secrets.`);
    process.exit(1);
  }

  const from = arg('--from') || process.env.EMAIL_FROM_ADDRESS!;
  const sentAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  console.log(`Sending a test email from ${from} to ${to} ...`);

  const result = await sendEmailWithResult({
    emailStream: 'operational',
    adminCopy: false,
    from: { email: from, name: 'The Sandwich Project' },
    to,
    subject: `Twilio Email test (${sentAt})`,
    text: [
      'This is a test email from the TSP platform, sent through Twilio Email.',
      `Sent: ${sentAt} (Eastern)`,
      '',
      'Liquid check: the next line should show two curly braces on each side.',
      '{{ liquid_check }}',
    ].join('\n'),
    html: `<div style="font-family: Arial, sans-serif;">
<p>This is a test email from the TSP platform, sent through <strong>Twilio Email</strong>.</p>
<p>Sent: ${sentAt} (Eastern)</p>
<p>Liquid check: the next line should show two curly braces on each side.</p>
<p><code>{{ liquid_check }}</code></p>
</div>`,
  });

  if (result.success) {
    console.log('✅ Accepted by Twilio (202).');
    console.log(`   Operation id(s): ${(result.operationIds || []).join(', ') || '(none returned)'}`);
    console.log('   Check the inbox (and spam folder). Delivery status is in the Twilio Console.');
    process.exit(0);
  }
  console.error(`❌ Not sent${result.status ? ` (HTTP ${result.status})` : ''}: ${result.error}`);
  if (result.suppressed) {
    console.error('   That address is on email_suppressions. Remove it from the preferences page or the table to test with it.');
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
