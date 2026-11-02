/**
 * PDF Export Utilities for Planning Widgets
 * Generates stylized, easy-to-read PDFs for sandwich planning and staffing planning
 */

import type { EventRequest } from '@shared/schema';
import { getEffectiveEventDate } from '@shared/event-validation-utils';

// Brand colors
const COLORS = {
  primary: '#236383',
  primaryLight: '#F0FBFC',
  orange: '#FBAD3F',
  teal: '#236383',
  red: '#A31C41',
  green: '#22C55E',
  gray: '#646464',
  lightGray: '#F3F4F6',
  white: '#FFFFFF',
};

interface SandwichWeekData {
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  distributionDate?: string;
  events: EventRequest[];
  totalEstimated: number;
}

interface StaffingWeekData {
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  distributionDate: string;
  events: EventRequest[];
  totalDriversNeeded: number;
  totalVolunteersNeeded: number;
  totalVanDriversNeeded: number;
  driversAssigned: number;
  volunteersAssigned: number;
  vanDriversAssigned: number;
  unfulfilled: {
    drivers: number;
    volunteers: number;
    vanDrivers: number;
  };
}

// Helper to format dates consistently
const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'TBD';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'TBD';
  }
};

const formatTime = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '';
  try {
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  } catch {
    return timeStr;
  }
};

// Helper to get assignment count from PostgreSQL array format
const getAssignmentCount = (assignments: any): number => {
  if (!assignments) return 0;
  if (Array.isArray(assignments)) return assignments.length;
  if (typeof assignments === 'string') {
    if (assignments === '{}' || assignments === '') return 0;
    let cleaned = assignments.replace(/^{|}$/g, '');
    if (!cleaned) return 0;
    if (cleaned.includes('"')) {
      const matches = cleaned.match(/"[^"]*"|[^",]+/g);
      return matches ? matches.filter(item => item.trim()).length : 0;
    } else {
      return cleaned.split(',').filter(item => item.trim()).length;
    }
  }
  return 0;
};

// Get sandwich count for an event
const getSandwichCount = (event: EventRequest): number => {
  // For completed events, prefer actual count
  if (event.status === 'completed' && event.actualSandwichCount) {
    return event.actualSandwichCount;
  }

  // Check estimatedSandwichCount first
  if (event.estimatedSandwichCount && event.estimatedSandwichCount > 0) {
    return event.estimatedSandwichCount;
  }

  // Check for min/max range - use max if available, otherwise min
  if (event.estimatedSandwichCountMax && event.estimatedSandwichCountMax > 0) {
    return event.estimatedSandwichCountMax;
  }
  if (event.estimatedSandwichCountMin && event.estimatedSandwichCountMin > 0) {
    return event.estimatedSandwichCountMin;
  }

  // Fall back to summing sandwichTypes quantities
  const types = event.sandwichTypes as Array<{ type: string; quantity: number }> | undefined;
  if (types && Array.isArray(types) && types.length > 0) {
    return types.reduce((sum, t) => sum + (t.quantity || 0), 0);
  }

  return 0;
};

// Generate print-friendly styles
const generatePDFStyles = () => `
  <style>
    @page {
      margin: 0.4in;
      size: letter;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #333;
      line-height: 1.2;
      font-size: 10px;
      background: white;
    }

    .page {
      max-width: 7.7in;
      margin: 0 auto;
      padding: 8px;
    }

    .header {
      text-align: center;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 2px solid ${COLORS.primary};
    }

    .header h1 {
      color: ${COLORS.primary};
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 2px;
    }

    .header .subtitle {
      color: ${COLORS.gray};
      font-size: 9px;
    }

    .week-box {
      background-color: ${COLORS.primaryLight} !important;
      border: 2px solid ${COLORS.primary};
      border-radius: 4px;
      padding: 6px;
      margin-bottom: 8px;
      text-align: center;
    }

    .week-box .week-title {
      font-size: 13px;
      font-weight: 700;
      color: ${COLORS.primary};
    }

    .week-box .week-dates {
      font-size: 10px;
      color: ${COLORS.gray};
      margin-top: 2px;
    }

    .summary-box {
      background-color: ${COLORS.primary} !important;
      color: white !important;
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 10px;
      text-align: center;
    }

    .summary-box.success {
      background-color: ${COLORS.green} !important;
    }

    .summary-box.warning {
      background-color: ${COLORS.orange} !important;
    }

    .summary-box .big-number {
      font-size: 28px;
      font-weight: 700;
      color: white !important;
    }

    .summary-box .label {
      font-size: 11px;
      color: white !important;
      opacity: 0.95;
    }

    .staffing-grid {
      display: table;
      width: 100%;
      margin-bottom: 10px;
      border-collapse: separate;
      border-spacing: 4px;
    }

    .staffing-row {
      display: table-row;
    }

    .staffing-card {
      display: table-cell;
      width: 25%;
      background-color: white !important;
      border: 1px solid ${COLORS.lightGray};
      border-radius: 4px;
      padding: 6px 4px;
      text-align: center;
      vertical-align: top;
    }

    .staffing-card.filled {
      border-color: ${COLORS.green} !important;
      background-color: #F0FDF4 !important;
    }

    .staffing-card.needed {
      border-color: ${COLORS.red} !important;
      background-color: #FEF2F2 !important;
    }

    .staffing-card .icon {
      font-size: 16px;
      margin-bottom: 2px;
    }

    .staffing-card .role {
      font-size: 9px;
      font-weight: 600;
      color: ${COLORS.gray};
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }

    .staffing-card .count {
      font-size: 15px;
      font-weight: 700;
      color: #333;
      margin: 2px 0;
    }

    .staffing-card .status {
      font-size: 8px;
      color: ${COLORS.gray};
    }

    .staffing-card.needed .status {
      color: ${COLORS.red};
      font-weight: 600;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: ${COLORS.primary};
      margin-bottom: 6px;
      padding-bottom: 3px;
      border-bottom: 1px solid ${COLORS.lightGray};
    }

    .event-list {
      margin-bottom: 8px;
    }

    .event-item {
      background-color: white !important;
      border: 1px solid #E5E7EB;
      border-radius: 3px;
      padding: 6px;
      margin-bottom: 4px;
      page-break-inside: avoid;
    }

    .event-header {
      display: table;
      width: 100%;
    }

    .event-info {
      display: table-cell;
      vertical-align: top;
    }

    .event-count {
      display: table-cell;
      vertical-align: top;
      text-align: right;
      width: 80px;
    }

    .org-name {
      font-size: 11px;
      font-weight: 600;
      color: ${COLORS.primary};
      margin-bottom: 2px;
    }

    .event-details {
      font-size: 9px;
      color: ${COLORS.gray};
    }

    .event-details span {
      margin-right: 8px;
    }

    .sandwich-count {
      font-size: 14px;
      font-weight: 700;
      color: ${COLORS.teal};
    }

    .sandwich-types {
      font-size: 8px;
      color: ${COLORS.gray};
      margin-top: 1px;
    }

    .badges {
      margin-top: 4px;
    }

    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 8px;
      font-size: 8px;
      font-weight: 500;
      margin-right: 4px;
      margin-bottom: 2px;
    }

    .badge-red {
      background-color: #FEE2E2 !important;
      color: #991B1B !important;
    }

    .badge-yellow {
      background-color: #FEF3C7 !important;
      color: #92400E !important;
    }

    .badge-blue {
      background-color: ${COLORS.primaryLight} !important;
      color: ${COLORS.primary} !important;
    }

    .badge-purple {
      background-color: #F3E8FF !important;
      color: #7C3AED !important;
    }

    .no-events {
      text-align: center;
      padding: 15px;
      color: ${COLORS.gray};
      font-size: 10px;
    }

    .footer {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid ${COLORS.lightGray};
      text-align: center;
      color: ${COLORS.gray};
      font-size: 8px;
    }
  </style>
`;

/**
 * Generate Sandwich Planning PDF HTML
 */
export function generateSandwichPlanningPDF(weekData: SandwichWeekData): string {
  const events = weekData.events || [];
  const sortedEvents = [...events].sort((a, b) => {
    const dateA = getEffectiveEventDate(a);
    const dateB = getEffectiveEventDate(b);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  const weekTotal = sortedEvents.reduce((sum, e) => sum + getSandwichCount(e), 0);

  const eventsHTML = sortedEvents.length === 0
    ? '<div class="no-events">No events scheduled for this week.</div>'
    : sortedEvents.map(event => {
        const dateStr = getEffectiveEventDate(event);
        const count = getSandwichCount(event);
        const types = event.sandwichTypes as any[] | undefined;
        const typesStr = types && Array.isArray(types) && types.length > 0
          ? types.map((t: any) => `${t.quantity} ${t.type}`).join(', ')
          : '';

        const driversUnfulfilled = Math.max(0, (event.driversNeeded || 0) - getAssignmentCount(event.assignedDriverIds));

        return `
          <div class="event-item">
            <div class="event-header">
              <div class="event-info">
                <div class="org-name">${event.organizationName || 'Unknown Organization'}</div>
                <div class="event-details">
                  <span>📅 ${formatDate(dateStr?.toString())}</span>
                  ${event.eventStartTime ? `<span>🕐 ${formatTime(event.eventStartTime)}</span>` : ''}
                </div>
                ${typesStr ? `<div class="sandwich-types">Types: ${typesStr}</div>` : ''}
              </div>
              <div class="event-count">
                <div class="sandwich-count">🥪 ${count.toLocaleString()}</div>
              </div>
            </div>
            ${driversUnfulfilled > 0 ? `
              <div class="badges">
                <span class="badge badge-red">🚗 ${driversUnfulfilled} Driver${driversUnfulfilled > 1 ? 's' : ''} Needed</span>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sandwich Planning - ${weekData.distributionDate || weekData.weekEndDate}</title>
      ${generatePDFStyles()}
    </head>
    <body>
      <div class="page">
        <div class="header">
          <h1>🥪 Sandwich Planning Report</h1>
          <div class="subtitle">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>

        <div class="week-box">
          <div class="week-title">Week of ${weekData.weekStartDate}</div>
          <div class="week-dates">${weekData.weekStartDate} → ${weekData.weekEndDate}</div>
        </div>

        <div class="summary-box">
          <div class="big-number">${weekTotal.toLocaleString()}</div>
          <div class="label">Total Sandwiches This Week</div>
        </div>

        <div class="section-title">Events This Week (${sortedEvents.length} total)</div>
        <div class="event-list">
          ${eventsHTML}
        </div>

        <div class="footer">
          The Sandwich Project • Weekly Planning Report
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate Staffing Planning PDF HTML
 */
export function generateStaffingPlanningPDF(weekData: StaffingWeekData): string {
  const events = weekData.events || [];
  const sortedEvents = [...events].sort((a, b) => {
    const dateA = getEffectiveEventDate(a);
    const dateB = getEffectiveEventDate(b);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  const totalUnfulfilled = weekData.unfulfilled.drivers +
                           weekData.unfulfilled.volunteers + weekData.unfulfilled.vanDrivers;

  const eventsWithUnmetNeeds = sortedEvents.filter(event => {
    const driversNeeded = Math.max(0, (event.driversNeeded || 0) - getAssignmentCount(event.assignedDriverIds));
    const volunteersNeeded = Math.max(0, (event.volunteersNeeded || 0) - getAssignmentCount(event.assignedVolunteerIds));
    const vanDriverNeeded = Math.max(0, (event.vanDriverNeeded ? 1 : 0) - ((event.assignedVanDriverId ? 1 : 0) + (event.isDhlVan ? 1 : 0)));
    return driversNeeded + volunteersNeeded + vanDriverNeeded > 0;
  });

  const eventsHTML = eventsWithUnmetNeeds.length === 0
    ? '<div class="no-events">✅ All staffing needs have been met for this week!</div>'
    : eventsWithUnmetNeeds.map(event => {
        const dateStr = getEffectiveEventDate(event);
        const sandwichCount = getSandwichCount(event);

        const driversNeeded = Math.max(0, (event.driversNeeded || 0) - getAssignmentCount(event.assignedDriverIds));
        const volunteersNeeded = Math.max(0, (event.volunteersNeeded || 0) - getAssignmentCount(event.assignedVolunteerIds));
        const vanDriverNeeded = Math.max(0, (event.vanDriverNeeded ? 1 : 0) - ((event.assignedVanDriverId ? 1 : 0) + (event.isDhlVan ? 1 : 0)));

        return `
          <div class="event-item">
            <div class="event-header">
              <div class="event-info">
                <div class="org-name">${event.organizationName || 'Unknown Organization'}</div>
                <div class="event-details">
                  <span>📅 ${formatDate(dateStr?.toString())}</span>
                  ${event.eventStartTime ? `<span>🕐 ${formatTime(event.eventStartTime)}</span>` : ''}
                  ${sandwichCount > 0 ? `<span>🥪 ${sandwichCount.toLocaleString()}</span>` : ''}
                </div>
                ${event.eventAddress ? `<div class="event-details">📍 ${event.eventAddress}</div>` : ''}
              </div>
            </div>
            <div class="badges">
              ${driversNeeded > 0 ? `<span class="badge badge-red">🚗 ${driversNeeded} Driver${driversNeeded > 1 ? 's' : ''} Needed</span>` : ''}
              ${volunteersNeeded > 0 ? `<span class="badge badge-blue">👤 ${volunteersNeeded} Volunteer${volunteersNeeded > 1 ? 's' : ''} Needed</span>` : ''}
              ${vanDriverNeeded > 0 ? `<span class="badge badge-purple">🚐 Van Driver Needed</span>` : ''}
            </div>
          </div>
        `;
      }).join('');

  // Helper for staffing card class
  const getCardClass = (needed: number, assigned: number) => {
    if (needed === 0) return '';
    return assigned >= needed ? 'filled' : 'needed';
  };

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Staffing Planning - ${weekData.distributionDate}</title>
      ${generatePDFStyles()}
    </head>
    <body>
      <div class="page">
        <div class="header">
          <h1>👥 Staffing Planning Report</h1>
          <div class="subtitle">Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>

        <div class="week-box">
          <div class="week-title">Week of ${weekData.weekStartDate}</div>
          <div class="week-dates">${weekData.weekStartDate} → ${weekData.weekEndDate}</div>
        </div>

        <div class="summary-box ${totalUnfulfilled === 0 ? 'success' : 'warning'}">
          <div class="big-number">${totalUnfulfilled === 0 ? '✅' : totalUnfulfilled}</div>
          <div class="label">${totalUnfulfilled === 0 ? 'All Positions Filled!' : 'Positions Still Needed'}</div>
        </div>

        <div class="staffing-grid">
          <div class="staffing-row">
            <div class="staffing-card ${getCardClass(weekData.totalDriversNeeded, weekData.driversAssigned)}">
              <div class="icon">🚗</div>
              <div class="role">Drivers</div>
              <div class="count">${weekData.driversAssigned}/${weekData.totalDriversNeeded}</div>
              <div class="status">${weekData.unfulfilled.drivers > 0 ? `${weekData.unfulfilled.drivers} needed` : 'Filled'}</div>
            </div>
            <div class="staffing-card ${getCardClass(weekData.totalVolunteersNeeded, weekData.volunteersAssigned)}">
              <div class="icon">👤</div>
              <div class="role">Volunteers</div>
              <div class="count">${weekData.volunteersAssigned}/${weekData.totalVolunteersNeeded}</div>
              <div class="status">${weekData.unfulfilled.volunteers > 0 ? `${weekData.unfulfilled.volunteers} needed` : 'Filled'}</div>
            </div>
            <div class="staffing-card ${getCardClass(weekData.totalVanDriversNeeded, weekData.vanDriversAssigned)}">
              <div class="icon">🚐</div>
              <div class="role">Van Drivers</div>
              <div class="count">${weekData.vanDriversAssigned}/${weekData.totalVanDriversNeeded}</div>
              <div class="status">${weekData.unfulfilled.vanDrivers > 0 ? `${weekData.unfulfilled.vanDrivers} needed` : 'Filled'}</div>
            </div>
          </div>
        </div>

        <div class="section-title">Events Needing Staffing (${eventsWithUnmetNeeds.length} of ${sortedEvents.length} total)</div>
        <div class="event-list">
          ${eventsHTML}
        </div>

        <div class="footer">
          The Sandwich Project • Weekly Staffing Report
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Download HTML as PDF using browser print
 */
export function downloadPDF(htmlContent: string, filename: string): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to download the PDF');
    return;
  }

  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Wait for content and fonts to load
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };
}

/**
 * Export sandwich planning for current week
 */
export function exportSandwichPlanning(weekData: SandwichWeekData): void {
  const html = generateSandwichPlanningPDF(weekData);
  downloadPDF(html, `sandwich-planning-${weekData.weekKey || 'week'}.pdf`);
}

/**
 * Export staffing planning for current week
 */
export function exportStaffingPlanning(weekData: StaffingWeekData): void {
  const html = generateStaffingPlanningPDF(weekData);
  downloadPDF(html, `staffing-planning-${weekData.weekKey || 'week'}.pdf`);
}
