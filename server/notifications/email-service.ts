import { sendEmailOrThrow, isEmailConfigured } from '../services/email';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  variables: string[];
}

export interface EmailNotification {
  to: string | string[];
  template: string;
  variables?: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    type?: string;
  }>;
  priority?: 'low' | 'normal' | 'high';
  scheduledFor?: Date;
}

export class EmailService {
  private static templates: Map<string, EmailTemplate> = new Map();

  static {
    // Initialize default templates
    this.registerTemplate({
      id: 'report_generated',
      name: 'Report Generated',
      subject: 'Your {{reportType}} Report is Ready',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">{{reportTitle}}</h2>
          <p>Your {{reportType}} report has been generated successfully.</p>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Report Summary:</h3>
            <ul>
              <li>Date Range: {{dateRange}}</li>
              <li>Total Records: {{totalRecords}}</li>
              <li>Generated At: {{generatedAt}}</li>
            </ul>
          </div>
          
          {{#if downloadLink}}
          <p>
            <a href="{{downloadLink}}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Download Report
            </a>
          </p>
          {{/if}}
          
          <p style="color: #64748b; font-size: 14px;">
            This is an automated message from The Sandwich Project management system.
          </p>
        </div>
      `,
      textContent: `
{{reportTitle}}

Your {{reportType}} report has been generated successfully.

Report Summary:
- Date Range: {{dateRange}}
- Total Records: {{totalRecords}}
- Generated At: {{generatedAt}}

{{#if downloadLink}}
Download your report: {{downloadLink}}
{{/if}}

This is an automated message from The Sandwich Project management system.
      `,
      variables: [
        'reportType',
        'reportTitle',
        'dateRange',
        'totalRecords',
        'generatedAt',
        'downloadLink',
      ],
    });

    this.registerTemplate({
      id: 'milestone_achieved',
      name: 'Milestone Achieved',
      subject: 'Congratulations! {{milestoneTitle}} Milestone Reached',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 8px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">🎉 Milestone Achieved!</h1>
            <h2 style="margin: 10px 0 0 0; font-weight: normal;">{{milestoneTitle}}</h2>
          </div>
          
          <div style="padding: 30px;">
            <p style="font-size: 18px; color: #374151;">
              We're excited to share that you've reached an important milestone!
            </p>
            
            <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #0369a1;">Achievement Details:</h3>
              <ul style="color: #475569;">
                <li>Total Sandwiches: <strong>{{totalSandwiches:number}}</strong></li>
                <li>Active Hosts: <strong>{{activeHosts}}</strong></li>
                <li>Date Achieved: <strong>{{achievedDate}}</strong></li>
              </ul>
            </div>
            
            <p style="color: #6b7280;">
              Thank you for your continued dedication to The Sandwich Project mission!
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{dashboardLink}}" style="background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                View Impact Dashboard
              </a>
            </div>
          </div>
        </div>
      `,
      textContent: `
🎉 MILESTONE ACHIEVED! 🎉

{{milestoneTitle}}

We're excited to share that you've reached an important milestone!

Achievement Details:
- Total Sandwiches: {{totalSandwiches:number}}
- Active Hosts: {{activeHosts}}
- Date Achieved: {{achievedDate}}

Thank you for your continued dedication to The Sandwich Project mission!

View your impact dashboard: {{dashboardLink}}
      `,
      variables: [
        'milestoneTitle',
        'totalSandwiches',
        'activeHosts',
        'achievedDate',
        'dashboardLink',
      ],
    });

    this.registerTemplate({
      id: 'project_deadline_reminder',
      name: 'Project Deadline Reminder',
      subject: 'Reminder: {{projectTitle}} Due {{dueDate}}',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px;">
            <h2 style="margin-top: 0; color: #92400e;">⏰ Project Deadline Reminder</h2>
            <h3 style="color: #78350f;">{{projectTitle}}</h3>
          </div>
          
          <div style="padding: 20px;">
            <p>This is a friendly reminder that your project deadline is approaching:</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h4 style="margin-top: 0;">Project Details:</h4>
              <ul>
                <li><strong>Title:</strong> {{projectTitle}}</li>
                <li><strong>Due Date:</strong> {{dueDate}}</li>
                <li><strong>Priority:</strong> {{priority}}</li>
                <li><strong>Status:</strong> {{status}}</li>
                {{#if assignedTo}}
                <li><strong>Assigned To:</strong> {{assignedTo}}</li>
                {{/if}}
              </ul>
            </div>
            
            {{#if description}}
            <div style="margin: 20px 0;">
              <h4>Description:</h4>
              <p style="color: #6b7280;">{{description}}</p>
            </div>
            {{/if}}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{projectLink}}" style="background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                View Project Details
              </a>
            </div>
          </div>
        </div>
      `,
      textContent: `
⏰ PROJECT DEADLINE REMINDER

{{projectTitle}}

This is a friendly reminder that your project deadline is approaching:

Project Details:
- Title: {{projectTitle}}
- Due Date: {{dueDate}}
- Priority: {{priority}}
- Status: {{status}}
{{#if assignedTo}}
- Assigned To: {{assignedTo}}
{{/if}}

{{#if description}}
Description: {{description}}
{{/if}}

View project details: {{projectLink}}
      `,
      variables: [
        'projectTitle',
        'dueDate',
        'priority',
        'status',
        'assignedTo',
        'description',
        'projectLink',
      ],
    });

    this.registerTemplate({
      id: 'weekly_summary',
      name: 'Weekly Summary',
      subject: 'Weekly Summary - {{weekEnding}}',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0;">Weekly Summary</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Week ending {{weekEnding}}</p>
          </div>
          
          <div style="padding: 30px;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
              <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0; color: #059669; font-size: 32px;">{{sandwichesThisWeek:number}}</h3>
                <p style="margin: 5px 0 0 0; color: #065f46;">Sandwiches This Week</p>
              </div>
              <div style="background: #eff6ff; padding: 20px; border-radius: 8px; text-align: center;">
                <h3 style="margin: 0; color: #2563eb; font-size: 32px;">{{collectionsThisWeek}}</h3>
                <p style="margin: 5px 0 0 0; color: #1e40af;">Collections This Week</p>
              </div>
            </div>
            
            <h3>Top Performing Hosts This Week:</h3>
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px;">
              {{#each topHosts}}
              <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                <span>{{name}}</span>
                <strong>{{sandwiches}} sandwiches</strong>
              </div>
              {{/each}}
            </div>
            
            {{#if upcomingDeadlines}}
            <h3 style="color: #dc2626;">Upcoming Project Deadlines:</h3>
            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626;">
              {{#each upcomingDeadlines}}
              <div style="margin-bottom: 10px;">
                <strong>{{title}}</strong> - Due {{dueDate}}
              </div>
              {{/each}}
            </div>
            {{/if}}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{dashboardLink}}" style="background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px;">
                View Full Dashboard
              </a>
            </div>
          </div>
        </div>
      `,
      textContent: `
WEEKLY SUMMARY - {{weekEnding}}

This Week's Numbers:
- Sandwiches: {{sandwichesThisWeek:number}}
- Collections: {{collectionsThisWeek}}

Top Performing Hosts This Week:
{{#each topHosts}}
- {{name}}: {{sandwiches}} sandwiches
{{/each}}

{{#if upcomingDeadlines}}
Upcoming Project Deadlines:
{{#each upcomingDeadlines}}
- {{title}} - Due {{dueDate}}
{{/each}}
{{/if}}

View full dashboard: {{dashboardLink}}
      `,
      variables: [
        'weekEnding',
        'sandwichesThisWeek',
        'collectionsThisWeek',
        'topHosts',
        'upcomingDeadlines',
        'dashboardLink',
      ],
    });
  }

  static registerTemplate(template: EmailTemplate): void {
    this.templates.set(template.id, template);
  }

  static async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      if (!isEmailConfigured()) {
        console.warn(
          'Twilio Email not configured. Email notification skipped.'
        );
        return false;
      }

      const template = this.templates.get(notification.template);
      if (!template) {
        throw new Error(`Email template '${notification.template}' not found`);
      }

      const recipients = Array.isArray(notification.to)
        ? notification.to
        : [notification.to];
      const variables = notification.variables || {};

      // Process template variables
      const subject = this.processTemplate(template.subject, variables);
      const htmlContent = this.processTemplate(template.htmlContent, variables);
      const textContent = this.processTemplate(template.textContent, variables);

      // Import compliance footer
      const { EMAIL_FOOTER_TEXT, EMAIL_FOOTER_HTML } = await import('../utils/email-footer');

      const emailData = {
        to: recipients,
        from: process.env.FROM_EMAIL || 'katie@thesandwichproject.org',
        subject,
        html: htmlContent + EMAIL_FOOTER_HTML,
        text: textContent + EMAIL_FOOTER_TEXT,
        attachments: notification.attachments,
      };

      if (notification.scheduledFor && notification.scheduledFor > new Date()) {
        // For scheduled emails, store them for later processing
        console.log('Email scheduled for:', notification.scheduledFor);
        return true;
      }

      const result = await sendEmailOrThrow({ ...emailData, emailStream: 'newsletter' });
      console.log('Email sent:', result.suppressed ? 'skipped (unsubscribed)' : result.operationIds);
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  static async sendBulkEmails(notifications: EmailNotification[]): Promise<{
    successful: number;
    failed: number;
    errors: string[];
  }> {
    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const notification of notifications) {
      try {
        const success = await this.sendEmail(notification);
        if (success) {
          results.successful++;
        } else {
          results.failed++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(error.message);
      }
    }

    return results;
  }

  private static processTemplate(
    template: string,
    variables: Record<string, any>
  ): string {
    let processed = template;

    // Handle simple variable substitution {{variableName}}
    processed = processed.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName]?.toString() || '';
    });

    // Handle formatted numbers {{variableName:number}}
    processed = processed.replace(/\{\{(\w+):number\}\}/g, (match, varName) => {
      const value = variables[varName];
      return typeof value === 'number'
        ? value.toLocaleString()
        : value?.toString() || '';
    });

    // Handle conditional blocks {{#if variable}}...{{/if}}
    processed = processed.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (match, varName, content) => {
        return variables[varName] ? content : '';
      }
    );

    // Handle arrays {{#each array}}...{{/each}}
    processed = processed.replace(
      /\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, varName, itemTemplate) => {
        const array = variables[varName];
        if (!Array.isArray(array)) return '';

        return array
          .map((item) => {
            let itemContent = itemTemplate;
            Object.keys(item).forEach((key) => {
              itemContent = itemContent.replace(
                new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
                item[key]?.toString() || ''
              );
            });
            return itemContent;
          })
          .join('');
      }
    );

    return processed;
  }

  static getAvailableTemplates(): EmailTemplate[] {
    return Array.from(this.templates.values());
  }

  static async sendReportNotification(
    reportData: any,
    recipients: string[]
  ): Promise<boolean> {
    return this.sendEmail({
      to: recipients,
      template: 'report_generated',
      variables: {
        reportType: reportData.metadata.title,
        reportTitle: reportData.metadata.title,
        dateRange: reportData.metadata.dateRange,
        totalRecords: reportData.metadata.totalRecords,
        generatedAt: new Date(reportData.metadata.generatedAt).toLocaleString(),
        downloadLink: `/api/reports/download/${reportData.id}`,
      },
    });
  }

  static async sendMilestoneNotification(
    milestone: any,
    recipients: string[]
  ): Promise<boolean> {
    return this.sendEmail({
      to: recipients,
      template: 'milestone_achieved',
      variables: {
        milestoneTitle: milestone.title,
        totalSandwiches: milestone.totalSandwiches,
        activeHosts: milestone.activeHosts,
        achievedDate: new Date().toLocaleDateString(),
        dashboardLink: '/impact',
      },
    });
  }

  static async sendProjectDeadlineReminder(
    project: any,
    recipients: string[]
  ): Promise<boolean> {
    return this.sendEmail({
      to: recipients,
      template: 'project_deadline_reminder',
      variables: {
        projectTitle: project.title,
        dueDate: new Date(project.dueDate).toLocaleDateString(),
        priority: project.priority,
        status: project.status,
        assignedTo: project.assignedTo,
        description: project.description,
        projectLink: `/projects/${project.id}`,
      },
    });
  }

  static async sendWeeklySummary(
    summaryData: any,
    recipients: string[]
  ): Promise<boolean> {
    return this.sendEmail({
      to: recipients,
      template: 'weekly_summary',
      variables: {
        weekEnding: summaryData.weekEnding,
        sandwichesThisWeek: summaryData.sandwichesThisWeek,
        collectionsThisWeek: summaryData.collectionsThisWeek,
        topHosts: summaryData.topHosts,
        upcomingDeadlines: summaryData.upcomingDeadlines,
        dashboardLink: '/',
      },
    });
  }
}
