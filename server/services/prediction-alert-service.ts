/**
 * Prediction Alert Service
 *
 * Runs monthly via cron. Generates AI sandwich demand predictions for the
 * upcoming month and sends an IMPORTANT-tier email to Katie when the
 * alert level is 'high' (projected 30%+ above average) or 'low' (30%+ below).
 * Includes the AI-generated recommendations so they're actionable.
 */

import { sendEmailOrThrow, isEmailConfigured } from './email';
import { predictMonthlySandwichNeeds, type PredictionResult } from './ai-predictions';
import { EMAIL_FOOTER_HTML } from '../utils/email-footer';
import { getAppBaseUrl } from '../config/constants';
import { createServiceLogger } from '../utils/logger';

const log = createServiceLogger('prediction-alerts');

// Only Katie receives these alerts
const ALERT_RECIPIENT = 'katie@thesandwichproject.org';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Generate predictions for next month and email Katie if alert level
 * is high or low.
 */
export async function processPredictionAlerts(): Promise<{
  monthChecked: string;
  alertLevel: string;
  emailSent: boolean;
  error?: string;
}> {
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1; // 1-indexed
  const monthLabel = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`;

  try {
    log.info(`Running prediction alert check for ${monthLabel}`);

    const prediction = await predictMonthlySandwichNeeds(targetYear, targetMonth);

    log.info(`Prediction result for ${monthLabel}`, {
      predicted: prediction.predictedSandwichCount,
      average: prediction.basedOnData.averageSandwiches,
      alertLevel: prediction.alertLevel,
      trend: prediction.basedOnData.trend,
    });

    // Only send email for non-normal alert levels
    if (prediction.alertLevel === 'normal') {
      log.info(`Alert level is normal for ${monthLabel} — no email needed`);
      return { monthChecked: monthLabel, alertLevel: 'normal', emailSent: false };
    }

    const emailSent = await sendPredictionAlertEmail(prediction, monthLabel);

    return {
      monthChecked: monthLabel,
      alertLevel: prediction.alertLevel,
      emailSent,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Prediction alert failed for ${monthLabel}:`, error);
    return { monthChecked: monthLabel, alertLevel: 'unknown', emailSent: false, error: msg };
  }
}

/**
 * Build and send the alert email to Katie.
 */
async function sendPredictionAlertEmail(
  prediction: PredictionResult,
  monthLabel: string,
): Promise<boolean> {
  if (!isEmailConfigured()) {
    log.warn('Twilio Email not configured — skipping prediction alert email');
    return false;
  }

  const isHigh = prediction.alertLevel === 'high';
  const pctChange = Math.round(
    ((prediction.predictedSandwichCount - prediction.basedOnData.averageSandwiches) /
      prediction.basedOnData.averageSandwiches) *
      100,
  );
  const pctLabel = pctChange > 0 ? `${pctChange}% above` : `${Math.abs(pctChange)}% below`;
  const appUrl = getAppBaseUrl();
  const forecastUrl = `${appUrl}/dashboard?section=predictions`;

  const subject = isHigh
    ? `Demand Alert: ${monthLabel} projected at ${prediction.predictedSandwichCount.toLocaleString()} sandwiches (${pctLabel} average)`
    : `Low Demand Alert: ${monthLabel} projected at ${prediction.predictedSandwichCount.toLocaleString()} sandwiches (${pctLabel} average)`;

  const accentColor = isHigh ? '#A31C41' : '#236383';
  const headerBg = isHigh
    ? 'linear-gradient(135deg, #A31C41 0%, #D4365C 100%)'
    : 'linear-gradient(135deg, #236383 0%, #2D8AA3 100%)';
  const icon = isHigh ? '📈' : '📉';
  const trendEmoji =
    prediction.basedOnData.trend === 'increasing'
      ? '↗️ Increasing'
      : prediction.basedOnData.trend === 'decreasing'
        ? '↘️ Decreasing'
        : '→ Stable';

  const recommendationsHtml = prediction.recommendations
    .map((r) => `<li style="margin-bottom: 8px;">${r}</li>`)
    .join('');

  const recommendationsText = prediction.recommendations
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${headerBg}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
        .stat-box { background: white; padding: 15px; border-left: 4px solid ${accentColor}; margin: 15px 0; }
        .stat-row { display: flex; justify-content: space-between; margin: 6px 0; }
        .recommendations { background: #FFF8E7; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .reasoning { background: #F0F4F8; padding: 15px; border-radius: 8px; margin: 15px 0; font-style: italic; color: #555; }
        .btn { display: inline-block; background: ${accentColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${icon} ${monthLabel} Demand Forecast</h1>
          <p style="margin: 0; opacity: 0.9;">${isHigh ? 'Higher than usual demand expected' : 'Lower than usual demand expected'}</p>
        </div>
        <div class="content">
          <p>Hi Katie,</p>
          <p>The AI demand forecast for <strong>${monthLabel}</strong> is flagged as <strong style="color: ${accentColor};">${prediction.alertLevel.toUpperCase()}</strong> — ${pctLabel} your 12-month average.</p>

          <div class="stat-box">
            <p style="margin: 6px 0;"><strong>Projected Sandwiches:</strong> ${prediction.predictedSandwichCount.toLocaleString()}</p>
            <p style="margin: 6px 0;"><strong>Confidence Range:</strong> ${prediction.confidenceLow.toLocaleString()} – ${prediction.confidenceHigh.toLocaleString()}</p>
            <p style="margin: 6px 0;"><strong>12-Month Average:</strong> ${prediction.basedOnData.averageSandwiches.toLocaleString()}</p>
            <p style="margin: 6px 0;"><strong>Projected Events:</strong> ${prediction.predictedEventCount}</p>
            <p style="margin: 6px 0;"><strong>Trend:</strong> ${trendEmoji}</p>
          </div>

          <div class="reasoning">
            <strong>AI Analysis:</strong><br>
            ${prediction.reasoning}
          </div>

          <div class="recommendations">
            <h3 style="margin-top: 0; color: ${accentColor};">Recommendations</h3>
            <ol style="margin: 0; padding-left: 20px;">
              ${recommendationsHtml}
            </ol>
          </div>

          <a href="${forecastUrl}" class="btn">View Full Forecast</a>

          ${EMAIL_FOOTER_HTML}
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
${icon} ${monthLabel} DEMAND FORECAST — ${prediction.alertLevel.toUpperCase()}

Projected Sandwiches: ${prediction.predictedSandwichCount.toLocaleString()} (${pctLabel} average)
Confidence Range: ${prediction.confidenceLow.toLocaleString()} – ${prediction.confidenceHigh.toLocaleString()}
12-Month Average: ${prediction.basedOnData.averageSandwiches.toLocaleString()}
Projected Events: ${prediction.predictedEventCount}
Trend: ${prediction.basedOnData.trend}

AI Analysis:
${prediction.reasoning}

Recommendations:
${recommendationsText}

View forecast: ${forecastUrl}

---
The Sandwich Project
To unsubscribe, contact katie@thesandwichproject.org.
  `.trim();

  try {
    await sendEmailOrThrow({
      to: ALERT_RECIPIENT,
      from: 'katie@thesandwichproject.org',
      subject,
      html,
      text,
      emailStream: 'operational',
    });
    log.info(`Prediction alert email sent to ${ALERT_RECIPIENT} for ${monthLabel}`);
    return true;
  } catch (error) {
    log.error('Failed to send prediction alert email:', error);
    return false;
  }
}
