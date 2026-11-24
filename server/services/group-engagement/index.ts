import { db } from '../../db';
import { eventRequests, sandwichCollections, organizationEngagementScores } from '../../../shared/schema';
import { eq, sql, desc, and, gte, isNotNull } from 'drizzle-orm';
import { logger } from '../../utils/production-safe-logger';
import { canonicalizeOrgName } from '../../utils/organization-canonicalization';
import { getEffectiveEventDate } from '../../../shared/event-validation-utils';

// ============================================================================
// Types
// ============================================================================

export interface EngagementMetrics {
  totalEvents: number;
  completedEvents: number;
  totalSandwiches: number;
  daysSinceLastEvent: number | null;
  daysSinceFirstEvent: number | null;
  lastEventDate: Date | null;
  firstEventDate: Date | null;
  averageEventInterval: number | null;
  eventDates: Date[];
  // New fields for better frequency analysis
  typicalEventInterval: number | null;  // Median interval (more robust than average)
  frequencyPattern: 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'irregular' | 'one-time' | 'none';
  daysOverdue: number | null;  // How many days past their typical interval
  overduePercent: number | null;  // Percentage overdue (100% = 2x their interval)
}

export interface EngagementScores {
  overall: number;
  frequency: number;
  recency: number;
  volume: number;
  completion: number;
  consistency: number;
}

export interface EngagementInsight {
  type: 'warning' | 'opportunity' | 'positive' | 'info';
  title: string;
  description: string;
  priority: number;
}

export interface RecommendedAction {
  action: string;
  reason: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
}

export interface ProgramSuitability {
  program: string;
  score: number;
  reason: string;
}

export interface OrganizationEngagement {
  organizationName: string;
  canonicalName: string;
  category: string | null;
  scores: EngagementScores;
  metrics: EngagementMetrics;
  engagementLevel: 'active' | 'at_risk' | 'dormant' | 'new';
  engagementTrend: 'increasing' | 'decreasing' | 'stable' | 'new';
  trendPercentChange: number;
  outreachPriority: 'urgent' | 'high' | 'normal' | 'low';
  insights: EngagementInsight[];
  recommendedActions: RecommendedAction[];
  programSuitability: ProgramSuitability[];
  lastCalculatedAt: Date;
}

export interface GroupInsightsSummary {
  totalOrganizations: number;
  engagementDistribution: {
    active: number;
    atRisk: number;
    dormant: number;
    new: number;
  };
  outreachPriorities: {
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  categoryBreakdown: Record<string, {
    count: number;
    avgEngagementScore: number;
  }>;
  averageEngagementScore: number;
  topPerformers: OrganizationEngagement[];
  needsAttention: OrganizationEngagement[];
  newOpportunities: OrganizationEngagement[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate median of an array of numbers (more robust than average for intervals)
 */
function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate intervals between consecutive event dates
 */
function calculateIntervals(eventDates: Date[]): number[] {
  if (eventDates.length < 2) return [];
  const sortedDates = [...eventDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push(daysBetween(sortedDates[i-1], sortedDates[i]));
  }
  return intervals;
}

/**
 * Determine the frequency pattern based on median interval
 */
function determineFrequencyPattern(
  medianInterval: number | null,
  totalEvents: number
): 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'irregular' | 'one-time' | 'none' {
  if (totalEvents === 0) return 'none';
  if (totalEvents === 1) return 'one-time';
  if (medianInterval === null) return 'irregular';

  // Monthly: 15-45 days
  if (medianInterval >= 15 && medianInterval <= 45) return 'monthly';
  // Quarterly: 60-120 days
  if (medianInterval >= 60 && medianInterval <= 120) return 'quarterly';
  // Semi-annual: 150-210 days
  if (medianInterval >= 150 && medianInterval <= 210) return 'semi-annual';
  // Annual: 300-450 days
  if (medianInterval >= 300 && medianInterval <= 450) return 'annual';

  return 'irregular';
}

/**
 * Get human-readable label for frequency pattern
 */
function getFrequencyPatternLabel(pattern: string): string {
  const labels: Record<string, string> = {
    'monthly': 'Monthly',
    'quarterly': 'Quarterly',
    'semi-annual': 'Semi-Annual',
    'annual': 'Annual',
    'irregular': 'Irregular',
    'one-time': 'One-Time',
    'none': 'No Events'
  };
  return labels[pattern] || pattern;
}

/**
 * Calculate frequency score (0-100)
 * Based on events per year - more frequent events = higher score
 */
function calculateFrequencyScore(metrics: EngagementMetrics): number {
  if (metrics.totalEvents === 0) return 0;
  if (metrics.daysSinceFirstEvent === null || metrics.daysSinceFirstEvent === 0) {
    return metrics.totalEvents > 0 ? 50 : 0; // New org with at least one event
  }

  const yearsActive = metrics.daysSinceFirstEvent / 365;
  const eventsPerYear = metrics.totalEvents / Math.max(yearsActive, 0.25); // Min 3 months

  // Scale: 0 events = 0, 1/year = 25, 2/year = 50, 4/year = 75, 6+/year = 100
  if (eventsPerYear >= 6) return 100;
  if (eventsPerYear >= 4) return 75 + (eventsPerYear - 4) * 12.5;
  if (eventsPerYear >= 2) return 50 + (eventsPerYear - 2) * 12.5;
  if (eventsPerYear >= 1) return 25 + (eventsPerYear - 1) * 25;
  return eventsPerYear * 25;
}

/**
 * Calculate recency score (0-100)
 * Based on days since last event - more recent = higher score
 */
function calculateRecencyScore(metrics: EngagementMetrics): number {
  if (metrics.daysSinceLastEvent === null) return 0;

  const days = metrics.daysSinceLastEvent;

  // Scale: 0-30 days = 100, 30-90 = 75-100, 90-180 = 50-75, 180-365 = 25-50, 365+ = 0-25
  if (days <= 30) return 100;
  if (days <= 90) return 100 - ((days - 30) / 60) * 25;
  if (days <= 180) return 75 - ((days - 90) / 90) * 25;
  if (days <= 365) return 50 - ((days - 180) / 185) * 25;
  if (days <= 730) return 25 - ((days - 365) / 365) * 15;
  return Math.max(0, 10 - ((days - 730) / 365) * 10);
}

/**
 * Calculate volume score (0-100)
 * Based on total sandwiches made
 */
function calculateVolumeScore(metrics: EngagementMetrics): number {
  const sandwiches = metrics.totalSandwiches;

  // Scale: 0 = 0, 100 = 20, 500 = 50, 1000 = 75, 5000+ = 100
  if (sandwiches >= 5000) return 100;
  if (sandwiches >= 1000) return 75 + ((sandwiches - 1000) / 4000) * 25;
  if (sandwiches >= 500) return 50 + ((sandwiches - 500) / 500) * 25;
  if (sandwiches >= 100) return 20 + ((sandwiches - 100) / 400) * 30;
  return (sandwiches / 100) * 20;
}

/**
 * Calculate completion score (0-100)
 * Based on ratio of completed events to total requests
 */
function calculateCompletionScore(metrics: EngagementMetrics): number {
  if (metrics.totalEvents === 0) return 0;

  const completionRate = metrics.completedEvents / metrics.totalEvents;
  return Math.round(completionRate * 100);
}

/**
 * Calculate consistency score (0-100)
 * Based on regularity of events (low variance in intervals)
 */
function calculateConsistencyScore(metrics: EngagementMetrics): number {
  if (metrics.eventDates.length < 2) return 0;
  if (metrics.averageEventInterval === null) return 0;

  // Calculate standard deviation of intervals
  const sortedDates = [...metrics.eventDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];

  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push(daysBetween(sortedDates[i-1], sortedDates[i]));
  }

  if (intervals.length === 0) return 0;

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => {
    return sum + Math.pow(interval - avgInterval, 2);
  }, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (lower = more consistent)
  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;

  // Convert to score: CV of 0 = 100, CV of 1 = 50, CV of 2+ = 0
  if (cv <= 0.5) return 100;
  if (cv <= 1) return 100 - (cv - 0.5) * 100;
  if (cv <= 2) return 50 - (cv - 1) * 50;
  return 0;
}

/**
 * Calculate overall engagement score (weighted average)
 */
function calculateOverallScore(scores: Omit<EngagementScores, 'overall'>): number {
  // Weights for each component
  const weights = {
    recency: 0.30,    // Most important - recent activity
    frequency: 0.25,  // Regular engagement
    completion: 0.20, // Follow-through on commitments
    volume: 0.15,     // Impact/scale
    consistency: 0.10 // Predictability
  };

  const weighted =
    scores.recency * weights.recency +
    scores.frequency * weights.frequency +
    scores.completion * weights.completion +
    scores.volume * weights.volume +
    scores.consistency * weights.consistency;

  return Math.round(weighted * 100) / 100;
}

/**
 * Calculate the expected interval between events based on historical frequency.
 * This helps determine dynamic thresholds for when an org is "overdue" for contact.
 */
function calculateExpectedInterval(metrics: EngagementMetrics): number {
  // If they have an average interval from past events, use that
  if (metrics.averageEventInterval !== null && metrics.averageEventInterval > 0) {
    return metrics.averageEventInterval;
  }
  
  // Calculate from total events and time span
  if (metrics.totalEvents >= 2 && metrics.daysSinceFirstEvent !== null && metrics.daysSinceFirstEvent > 0) {
    return metrics.daysSinceFirstEvent / (metrics.totalEvents - 1);
  }
  
  // Default: assume yearly if we can't calculate
  return 365;
}

/**
 * Calculate how "overdue" an organization is based on their typical event frequency.
 * Returns a multiplier: 1.0 = on schedule, 2.0 = 2x overdue, etc.
 */
function calculateOverdueMultiplier(metrics: EngagementMetrics): number {
  if (metrics.daysSinceLastEvent === null || metrics.daysSinceLastEvent === 0) {
    return 0;
  }
  
  const expectedInterval = calculateExpectedInterval(metrics);
  return metrics.daysSinceLastEvent / expectedInterval;
}

/**
 * Determine engagement level based on overall score AND frequency-adjusted thresholds.
 * Simplified to 4 levels: active, at_risk, dormant, new
 */
function determineEngagementLevel(
  score: number,
  metrics: EngagementMetrics
): OrganizationEngagement['engagementLevel'] {
  // Check for organizations that have NEVER had an event with us
  // These aren't "at risk" - they were never engaged to begin with
  if (metrics.totalEvents === 0) {
    return 'new';  // Treat as new/prospect - not "at risk"
  }

  // Check for new organizations (less than 90 days since first event)
  if (metrics.daysSinceFirstEvent !== null && metrics.daysSinceFirstEvent < 90) {
    return 'new';
  }

  // Calculate how overdue they are based on their typical frequency
  const overdueMultiplier = calculateOverdueMultiplier(metrics);
  const expectedInterval = calculateExpectedInterval(metrics);
  
  // Dynamic dormant threshold: 
  // - Frequent contributors (monthly): dormant after ~3x their interval (3 months)
  // - Yearly contributors: dormant after ~1.5x their interval (18 months)
  // We use a sliding scale based on frequency
  let dormantMultiplier: number;
  if (expectedInterval <= 30) {
    // Monthly or more frequent: 3x overdue = dormant
    dormantMultiplier = 3.0;
  } else if (expectedInterval <= 90) {
    // Quarterly: 2.5x overdue = dormant
    dormantMultiplier = 2.5;
  } else if (expectedInterval <= 180) {
    // Semi-annual: 2x overdue = dormant
    dormantMultiplier = 2.0;
  } else {
    // Yearly or less: 1.5x overdue = dormant
    dormantMultiplier = 1.5;
  }
  
  // Check for dormant based on frequency-adjusted threshold
  if (overdueMultiplier >= dormantMultiplier) {
    return 'dormant';
  }
  
  // Simplified levels: active (score >= 50) or at_risk (score < 50 or overdue)
  // If significantly overdue, they're at_risk regardless of historical score
  if (overdueMultiplier >= 1.5) {
    return 'at_risk';
  }

  // Score-based levels
  if (score >= 50) return 'active';
  return 'at_risk';
}

/**
 * Check if organization was a regular contributor (had consistent activity)
 */
function wasRegularContributor(metrics: EngagementMetrics): boolean {
  // Need at least 2 events to be considered a "regular" contributor
  if (metrics.totalEvents < 2) return false;

  // Either had meaningful volume OR multiple completed events
  return metrics.totalSandwiches >= 300 || metrics.completedEvents >= 2;
}

/**
 * Determine outreach priority based on engagement patterns with DYNAMIC thresholds.
 * 
 * Priority logic (based on overdue multiplier relative to their typical frequency):
 * - URGENT: 1.2x - 1.75x overdue (catch before they go cold)
 * - HIGH: 1.75x - 2.25x overdue (still recoverable)
 * - NORMAL: 2.25x+ overdue but not yet dormant
 * - LOW: Never engaged, highly engaged (no outreach needed), or fully dormant
 */
function determineOutreachPriority(
  engagementLevel: OrganizationEngagement['engagementLevel'],
  metrics: EngagementMetrics,
  scores: EngagementScores
): OrganizationEngagement['outreachPriority'] {
  // Never-engaged organizations are low priority - they're prospects, not at-risk partners
  if (metrics.totalEvents === 0) {
    return 'low';
  }

  // Active partners don't need urgent outreach
  if (engagementLevel === 'active') {
    return 'low';
  }

  // Dormant partners are low priority (too far gone for urgent outreach)
  if (engagementLevel === 'dormant') {
    return 'low';
  }

  const daysSinceLastEvent = metrics.daysSinceLastEvent;
  if (daysSinceLastEvent === null) {
    return 'low';
  }

  const wasRegular = wasRegularContributor(metrics);
  const overdueMultiplier = calculateOverdueMultiplier(metrics);

  // Only prioritize outreach for organizations that were regular contributors
  if (wasRegular) {
    // Just becoming overdue (1.2x - 1.75x their interval) - urgent, catch them now
    if (overdueMultiplier >= 1.2 && overdueMultiplier < 1.75) {
      return 'urgent';
    }
    // Significantly overdue (1.75x - 2.25x) - high priority, still recoverable
    if (overdueMultiplier >= 1.75 && overdueMultiplier < 2.25) {
      return 'high';
    }
    // Very overdue but not dormant - normal priority
    if (overdueMultiplier >= 2.25) {
      return 'normal';
    }
  }

  // Default for other cases
  return 'normal';
}

/**
 * Generate insights based on metrics and scores
 */
function generateInsights(
  metrics: EngagementMetrics,
  scores: EngagementScores,
  engagementLevel: OrganizationEngagement['engagementLevel']
): EngagementInsight[] {
  const insights: EngagementInsight[] = [];
  const daysSinceLastEvent = metrics.daysSinceLastEvent;
  const pattern = metrics.frequencyPattern;
  const typicalInterval = metrics.typicalEventInterval;
  const daysOverdue = metrics.daysOverdue;
  const overduePercent = metrics.overduePercent;
  const wasRegular = wasRegularContributor(metrics);

  // Use actual frequency pattern for better insights
  const patternLabel = getFrequencyPatternLabel(pattern);

  // ============================================
  // ANNUAL PARTNER ANNIVERSARY ALERTS
  // ============================================
  if (pattern === 'annual' && metrics.lastEventDate && daysSinceLastEvent !== null) {
    const lastEventDate = new Date(metrics.lastEventDate);
    const anniversaryMonth = lastEventDate.toLocaleDateString('en-US', { month: 'long' });
    const daysUntilAnniversary = typicalInterval ? (typicalInterval - daysSinceLastEvent) : (365 - daysSinceLastEvent);

    // 1-2 months before anniversary - time to reach out
    if (daysUntilAnniversary >= 30 && daysUntilAnniversary <= 60) {
      insights.push({
        type: 'opportunity',
        title: 'Annual Event Planning Time',
        description: `This group typically hosts an annual event in ${anniversaryMonth}. Now is a good time to reach out about planning their next event (~${Math.round(daysUntilAnniversary / 7)} weeks out).`,
        priority: 1
      });
    }
    // Past their anniversary - overdue
    else if (daysUntilAnniversary < 0 && daysOverdue && daysOverdue > 30) {
      insights.push({
        type: 'warning',
        title: 'Missed Annual Event Window',
        description: `This group's annual event (usually in ${anniversaryMonth}) is ${Math.abs(Math.round(daysUntilAnniversary / 7))} weeks overdue. Check in to see if they want to schedule.`,
        priority: 1
      });
    }
  }

  // ============================================
  // FREQUENCY-BASED DROP-OFF ALERTS
  // ============================================
  if (pattern !== 'none' && pattern !== 'one-time' && pattern !== 'irregular') {
    // Groups with established patterns who are becoming overdue
    if (overduePercent !== null && daysOverdue !== null && typicalInterval !== null) {

      // Monthly partners: Alert when 20-75% overdue (about 1-3 weeks late)
      if (pattern === 'monthly' && overduePercent >= 20 && overduePercent < 75) {
        insights.push({
          type: 'warning',
          title: 'Monthly Partner Overdue',
          description: `This monthly partner is ${daysOverdue} days past their typical event interval (every ~${Math.round(typicalInterval)} days). Reach out now.`,
          priority: 1
        });
      }
      // Monthly partners: Seriously overdue
      else if (pattern === 'monthly' && overduePercent >= 75) {
        insights.push({
          type: 'warning',
          title: 'Monthly Partner At Risk',
          description: `This monthly partner hasn't had an event in ${daysSinceLastEvent} days (usually every ~${Math.round(typicalInterval)} days). Urgent outreach needed.`,
          priority: 1
        });
      }

      // Quarterly partners: Alert when 25-75% overdue
      else if (pattern === 'quarterly' && overduePercent >= 25 && overduePercent < 75) {
        insights.push({
          type: 'warning',
          title: 'Quarterly Partner Overdue',
          description: `This quarterly partner is ${daysOverdue} days past their typical event interval. Consider reaching out.`,
          priority: 2
        });
      }
      else if (pattern === 'quarterly' && overduePercent >= 75) {
        insights.push({
          type: 'warning',
          title: 'Quarterly Partner At Risk',
          description: `This quarterly partner hasn't had an event in ${daysSinceLastEvent} days (usually every ~${Math.round(typicalInterval)} days). Schedule a check-in.`,
          priority: 1
        });
      }

      // Semi-annual partners
      else if (pattern === 'semi-annual' && overduePercent >= 30) {
        insights.push({
          type: 'warning',
          title: 'Semi-Annual Partner Overdue',
          description: `This semi-annual partner is ${daysOverdue} days past their typical event interval.`,
          priority: 2
        });
      }
    }
  }

  // Recency insights
  if (daysSinceLastEvent !== null) {
    if (daysSinceLastEvent > 365) {
      insights.push({
        type: 'info',
        title: 'Long Dormant',
        description: `No activity in ${Math.floor(daysSinceLastEvent / 30)} months. May be worth a re-engagement effort if they had meaningful history.`,
        priority: 4
      });
    } else if (daysSinceLastEvent > 180 && !wasRegular) {
      insights.push({
        type: 'info',
        title: 'Inactive',
        description: `Last event was ${Math.floor(daysSinceLastEvent / 30)} months ago.`,
        priority: 4
      });
    } else if (daysSinceLastEvent <= 30 && metrics.completedEvents > 0) {
      insights.push({
        type: 'positive',
        title: 'Recently Active',
        description: 'This organization had an event within the last month.',
        priority: 5
      });
    }
  }

  // Volume insights
  if (metrics.totalSandwiches >= 1000) {
    insights.push({
      type: 'positive',
      title: 'High Impact Partner',
      description: `Has made ${metrics.totalSandwiches.toLocaleString()} sandwiches total.`,
      priority: 4
    });
  }

  // Frequency insights
  if (scores.frequency >= 75) {
    insights.push({
      type: 'positive',
      title: 'Frequent Partner',
      description: 'This organization hosts events regularly.',
      priority: 4
    });
  } else if (scores.frequency < 25 && metrics.totalEvents >= 2) {
    insights.push({
      type: 'opportunity',
      title: 'Engagement Opportunity',
      description: 'Has hosted before but events are infrequent. Could benefit from more regular scheduling.',
      priority: 3
    });
  }

  // Completion insights
  if (scores.completion < 50 && metrics.totalEvents >= 3) {
    insights.push({
      type: 'warning',
      title: 'Low Completion Rate',
      description: `Only ${Math.round(scores.completion)}% of events completed. Review pending requests.`,
      priority: 2
    });
  }

  // Consistency insights
  if (scores.consistency >= 75) {
    insights.push({
      type: 'positive',
      title: 'Consistent Partner',
      description: 'Events are scheduled at regular intervals.',
      priority: 5
    });
  }

  // New organization insight
  if (engagementLevel === 'new') {
    insights.push({
      type: 'info',
      title: 'New Partnership',
      description: 'This is a relatively new organization. Focus on building the relationship.',
      priority: 3
    });
  }

  return insights.sort((a, b) => a.priority - b.priority);
}

/**
 * Generate recommended actions based on engagement analysis
 */
function generateRecommendedActions(
  metrics: EngagementMetrics,
  scores: EngagementScores,
  engagementLevel: OrganizationEngagement['engagementLevel'],
  outreachPriority: OrganizationEngagement['outreachPriority']
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  // Actions based on engagement level
  switch (engagementLevel) {
    case 'dormant':
      actions.push({
        action: 'Schedule re-engagement call or email',
        reason: 'Organization has been inactive for over a year',
        priority: 'urgent'
      });
      if (metrics.totalSandwiches > 500) {
        actions.push({
          action: 'Review past event history and prepare personalized outreach',
          reason: 'High-value dormant partner worth re-engaging',
          priority: 'high'
        });
      }
      break;

    case 'at_risk':
      actions.push({
        action: 'Send check-in email to maintain relationship',
        reason: 'Engagement is declining - prevent becoming dormant',
        priority: 'high'
      });
      actions.push({
        action: 'Schedule follow-up to discuss future events',
        reason: 'Organization shows potential but needs nurturing',
        priority: 'normal'
      });
      break;

    case 'new':
      actions.push({
        action: 'Send thank you note and schedule follow-up',
        reason: 'Build relationship with new partner',
        priority: 'normal'
      });
      if (metrics.completedEvents > 0) {
        actions.push({
          action: 'Ask for feedback on first event experience',
          reason: 'Learn from new partner experience to improve',
          priority: 'normal'
        });
      }
      break;

    case 'active':
      actions.push({
        action: 'Consider for ambassador or partnership program',
        reason: 'Strong engagement - potential for deeper partnership',
        priority: 'low'
      });
      if (scores.frequency < 50) {
        actions.push({
          action: 'Propose recurring event schedule',
          reason: 'Could benefit from more regular engagement',
          priority: 'normal'
        });
      }
      break;
  }

  // Additional actions based on specific metrics
  if (scores.completion < 50 && metrics.totalEvents - metrics.completedEvents >= 2) {
    actions.push({
      action: 'Review and follow up on pending event requests',
      reason: `${metrics.totalEvents - metrics.completedEvents} pending requests need attention`,
      priority: 'high'
    });
  }

  return actions;
}

/**
 * Determine program suitability based on organization profile
 * Now uses actual frequency patterns instead of generic scores
 */
function determineProgramSuitability(
  metrics: EngagementMetrics,
  scores: EngagementScores,
  engagementLevel: OrganizationEngagement['engagementLevel'],
  category: string | null
): ProgramSuitability[] {
  const programs: ProgramSuitability[] = [];
  const pattern = metrics.frequencyPattern;
  const typicalInterval = metrics.typicalEventInterval;

  // Monthly events program - ONLY for groups with ACTUAL monthly patterns
  if (pattern === 'monthly' && scores.completion >= 70) {
    programs.push({
      program: 'Regular Monthly Events',
      score: Math.min(100, Math.round(scores.consistency + 20)),
      reason: `Actually holds events every ~${Math.round(typicalInterval || 30)} days with good completion rate`
    });
  }

  // Quarterly events program - for groups with quarterly patterns
  if (pattern === 'quarterly' && scores.completion >= 60) {
    programs.push({
      program: 'Quarterly Events Partner',
      score: Math.round((scores.frequency + scores.completion) / 2),
      reason: `Holds events every ~${Math.round(typicalInterval || 90)} days`
    });
  }

  // Annual events program - for groups with annual patterns
  if (pattern === 'annual') {
    const anniversary = metrics.lastEventDate
      ? new Date(metrics.lastEventDate).toLocaleDateString('en-US', { month: 'long' })
      : 'unknown month';
    programs.push({
      program: 'Annual Event Partner',
      score: 70,
      reason: `Typically holds annual event (last was in ${anniversary})`
    });
  }

  // High-volume program
  if (metrics.totalSandwiches >= 500 || (metrics.completedEvents > 0 && metrics.totalSandwiches / metrics.completedEvents >= 100)) {
    programs.push({
      program: 'Large-Scale Events',
      score: Math.min(100, Math.round(scores.volume + 20)),
      reason: 'Has capacity for high-volume sandwich making'
    });
  }

  // Ambassador program
  if (engagementLevel === 'active' && metrics.totalEvents >= 3) {
    programs.push({
      program: 'Partner Ambassador Program',
      score: Math.round(scores.overall),
      reason: 'Strong engagement makes them excellent ambassadors'
    });
  }

  // Re-engagement program - for dormant partners with established patterns
  if (engagementLevel === 'dormant' && metrics.totalEvents >= 2) {
    const wasFrequent = pattern === 'monthly' || pattern === 'quarterly';
    programs.push({
      program: 'Partner Re-engagement Initiative',
      score: wasFrequent ? 90 : 70,
      reason: wasFrequent
        ? `Previously active ${pattern} partner - high priority to re-engage`
        : 'Prior relationship worth re-establishing'
    });
  }

  // Category-specific programs
  if (category === 'school') {
    programs.push({
      program: 'School Lunch Support Program',
      score: 75,
      reason: 'Schools benefit from regular sandwich support'
    });
  } else if (category === 'church_faith' || category === 'religious') {
    programs.push({
      program: 'Faith Community Outreach',
      score: 70,
      reason: 'Faith organizations often have strong community volunteer networks'
    });
  } else if (category === 'corp' || category === 'small_medium_corp' || category === 'large_corp') {
    programs.push({
      program: 'Corporate Volunteer Partnership',
      score: 70,
      reason: 'Corporate partners can provide volunteers and resources'
    });
  }

  return programs.sort((a, b) => b.score - a.score);
}

/**
 * Calculate engagement trend by comparing recent vs historical activity
 */
function calculateEngagementTrend(
  metrics: EngagementMetrics
): { trend: OrganizationEngagement['engagementTrend']; percentChange: number } {
  if (metrics.eventDates.length < 2) {
    return { trend: 'new', percentChange: 0 };
  }

  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // Count events in recent 6 months vs previous 6 months
  const recentEvents = metrics.eventDates.filter(d => d >= sixMonthsAgo).length;
  const olderEvents = metrics.eventDates.filter(d => d >= oneYearAgo && d < sixMonthsAgo).length;

  if (olderEvents === 0) {
    if (recentEvents > 0) return { trend: 'increasing', percentChange: 100 };
    return { trend: 'stable', percentChange: 0 };
  }

  const percentChange = ((recentEvents - olderEvents) / olderEvents) * 100;

  if (percentChange >= 20) return { trend: 'increasing', percentChange: Math.round(percentChange) };
  if (percentChange <= -20) return { trend: 'decreasing', percentChange: Math.round(percentChange) };
  return { trend: 'stable', percentChange: Math.round(percentChange) };
}

// ============================================================================
// Main Service Functions
// ============================================================================

/**
 * Gather metrics for a single organization
 */
async function gatherOrganizationMetrics(
  canonicalName: string,
  allEventRequests: any[],
  allCollections: any[]
): Promise<EngagementMetrics & { displayName: string; category: string | null }> {
  const now = new Date();

  // Filter event requests for this organization
  const orgRequests = allEventRequests.filter(
    req => canonicalizeOrgName(req.organizationName || '') === canonicalName
  );

  // Filter collections for this organization
  const orgCollections = allCollections.filter(collection => {
    const matchesGroup1 = collection.group1Name &&
      canonicalizeOrgName(collection.group1Name) === canonicalName;
    const matchesGroup2 = collection.group2Name &&
      canonicalizeOrgName(collection.group2Name) === canonicalName;
    let matchesGroupCollections = false;
    if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
      matchesGroupCollections = collection.groupCollections.some(
        (group: any) => group.name && canonicalizeOrgName(group.name) === canonicalName
      );
    }
    return matchesGroup1 || matchesGroup2 || matchesGroupCollections;
  });

  // Calculate sandwich totals from collections
  let totalSandwiches = 0;
  orgCollections.forEach(collection => {
    if (collection.group1Name && canonicalizeOrgName(collection.group1Name) === canonicalName) {
      totalSandwiches += collection.group1Count || 0;
    }
    if (collection.group2Name && canonicalizeOrgName(collection.group2Name) === canonicalName) {
      totalSandwiches += collection.group2Count || 0;
    }
    if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
      collection.groupCollections.forEach((group: any) => {
        if (group.name && canonicalizeOrgName(group.name) === canonicalName) {
          totalSandwiches += group.count || 0;
        }
      });
    }
  });

  // Add estimated sandwiches from completed requests
  orgRequests
    .filter(req => req.status === 'completed' || req.status === 'contact_completed')
    .forEach(req => {
      totalSandwiches += req.actualSandwichCount || req.estimatedSandwichCount || 0;
    });

  // Gather all event dates
  const eventDates: Date[] = [];

  orgRequests.forEach(req => {
    const date = getEffectiveEventDate(req);
    if (date) {
      eventDates.push(new Date(date));
    }
  });

  orgCollections.forEach(collection => {
    if (collection.collectionDate) {
      eventDates.push(new Date(collection.collectionDate));
    }
  });

  // Sort and dedupe dates (same day = same event)
  const uniqueDates = Array.from(
    new Set(eventDates.map(d => d.toISOString().split('T')[0]))
  ).map(s => new Date(s)).sort((a, b) => a.getTime() - b.getTime());

  // Build set of completed event dates (deduped by date)
  // A date is "completed" if it has either a completed request OR a collection
  const completedEventDates = new Set<string>();

  // Add dates from completed requests
  orgRequests
    .filter(req => req.status === 'completed' || req.status === 'contact_completed')
    .forEach(req => {
      const date = getEffectiveEventDate(req);
      if (date) {
        completedEventDates.add(new Date(date).toISOString().split('T')[0]);
      }
    });

  // Add dates from collections (all collections are inherently completed)
  orgCollections.forEach(collection => {
    if (collection.collectionDate) {
      completedEventDates.add(new Date(collection.collectionDate).toISOString().split('T')[0]);
    }
  });

  // Calculate metrics - include both requests AND collections as events
  // Total events = unique dates from both sources (already deduped)
  const totalEvents = uniqueDates.length;

  // Completed events = unique dates with completed activity (deduped to avoid >100% completion)
  const completedEvents = completedEventDates.size;

  const firstEventDate = uniqueDates.length > 0 ? uniqueDates[0] : null;
  const lastEventDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null;

  const daysSinceFirstEvent = firstEventDate ? daysBetween(firstEventDate, now) : null;
  const daysSinceLastEvent = lastEventDate ? daysBetween(lastEventDate, now) : null;

  // Calculate intervals between events
  const intervals = calculateIntervals(uniqueDates);
  const averageEventInterval = intervals.length > 0
    ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
    : null;

  // Calculate median interval (more robust than average for outliers)
  const typicalEventInterval = calculateMedian(intervals);

  // Determine frequency pattern based on actual intervals
  const frequencyPattern = determineFrequencyPattern(typicalEventInterval, totalEvents);

  // Calculate how overdue they are based on their typical interval
  let daysOverdue: number | null = null;
  let overduePercent: number | null = null;

  if (typicalEventInterval !== null && daysSinceLastEvent !== null) {
    daysOverdue = Math.max(0, daysSinceLastEvent - typicalEventInterval);
    overduePercent = typicalEventInterval > 0
      ? Math.round((daysSinceLastEvent / typicalEventInterval - 1) * 100)
      : null;
  }

  // Get display name and category - must match the canonical name source
  let displayName: string = canonicalName;
  
  // First try event requests
  if (orgRequests.length > 0 && orgRequests[0]?.organizationName) {
    displayName = orgRequests[0].organizationName;
  } else if (orgCollections.length > 0) {
    // Find the correct display name from collections by checking which field matches
    for (const collection of orgCollections) {
      if (collection.group1Name && canonicalizeOrgName(collection.group1Name) === canonicalName) {
        displayName = collection.group1Name;
        break;
      }
      if (collection.group2Name && canonicalizeOrgName(collection.group2Name) === canonicalName) {
        displayName = collection.group2Name;
        break;
      }
      if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
        const matchingGroup = collection.groupCollections.find(
          (group: any) => group.name && canonicalizeOrgName(group.name) === canonicalName
        );
        if (matchingGroup) {
          displayName = matchingGroup.name;
          break;
        }
      }
    }
  }

  const category = orgRequests[0]?.category || null;

  return {
    displayName,
    category,
    totalEvents,
    completedEvents,
    totalSandwiches,
    daysSinceLastEvent,
    daysSinceFirstEvent,
    lastEventDate,
    firstEventDate,
    averageEventInterval,
    typicalEventInterval,
    frequencyPattern,
    daysOverdue,
    overduePercent,
    eventDates: uniqueDates
  };
}

/**
 * Calculate engagement for a single organization
 */
export async function calculateOrganizationEngagement(
  canonicalName: string,
  allEventRequests?: any[],
  allCollections?: any[]
): Promise<OrganizationEngagement> {
  // Fetch data if not provided
  if (!allEventRequests) {
    allEventRequests = await db.query.eventRequests.findMany();
  }
  if (!allCollections) {
    allCollections = await db.query.sandwichCollections.findMany();
  }

  const metrics = await gatherOrganizationMetrics(canonicalName, allEventRequests, allCollections);

  // Calculate individual scores
  const frequencyScore = calculateFrequencyScore(metrics);
  const recencyScore = calculateRecencyScore(metrics);
  const volumeScore = calculateVolumeScore(metrics);
  const completionScore = calculateCompletionScore(metrics);
  const consistencyScore = calculateConsistencyScore(metrics);

  const scores: EngagementScores = {
    frequency: Math.round(frequencyScore * 100) / 100,
    recency: Math.round(recencyScore * 100) / 100,
    volume: Math.round(volumeScore * 100) / 100,
    completion: Math.round(completionScore * 100) / 100,
    consistency: Math.round(consistencyScore * 100) / 100,
    overall: 0
  };

  scores.overall = calculateOverallScore(scores);

  // Determine engagement status
  const engagementLevel = determineEngagementLevel(scores.overall, metrics);
  const outreachPriority = determineOutreachPriority(engagementLevel, metrics, scores);
  const { trend: engagementTrend, percentChange: trendPercentChange } = calculateEngagementTrend(metrics);

  // Generate insights and recommendations
  const insights = generateInsights(metrics, scores, engagementLevel);
  const recommendedActions = generateRecommendedActions(metrics, scores, engagementLevel, outreachPriority);
  const programSuitability = determineProgramSuitability(metrics, scores, engagementLevel, metrics.category);

  return {
    organizationName: metrics.displayName,
    canonicalName,
    category: metrics.category,
    scores,
    metrics: {
      totalEvents: metrics.totalEvents,
      completedEvents: metrics.completedEvents,
      totalSandwiches: metrics.totalSandwiches,
      daysSinceLastEvent: metrics.daysSinceLastEvent,
      daysSinceFirstEvent: metrics.daysSinceFirstEvent,
      lastEventDate: metrics.lastEventDate,
      firstEventDate: metrics.firstEventDate,
      averageEventInterval: metrics.averageEventInterval,
      typicalEventInterval: metrics.typicalEventInterval,
      frequencyPattern: metrics.frequencyPattern,
      daysOverdue: metrics.daysOverdue,
      overduePercent: metrics.overduePercent,
      eventDates: metrics.eventDates
    },
    engagementLevel,
    engagementTrend,
    trendPercentChange,
    outreachPriority,
    insights,
    recommendedActions,
    programSuitability,
    lastCalculatedAt: new Date()
  };
}

/**
 * Calculate engagement scores for all organizations
 */
export async function calculateAllOrganizationEngagement(): Promise<OrganizationEngagement[]> {
  logger.info('Calculating engagement scores for all organizations');

  // Fetch all data once
  const allEventRequests = await db.query.eventRequests.findMany();
  const allCollections = await db.query.sandwichCollections.findMany();

  // Build set of all unique organization canonical names
  const orgNames = new Set<string>();

  allEventRequests.forEach(req => {
    if (req.organizationName) {
      orgNames.add(canonicalizeOrgName(req.organizationName));
    }
  });

  allCollections.forEach(collection => {
    if (collection.group1Name) {
      orgNames.add(canonicalizeOrgName(collection.group1Name));
    }
    if (collection.group2Name) {
      orgNames.add(canonicalizeOrgName(collection.group2Name));
    }
    if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
      collection.groupCollections.forEach((group: any) => {
        if (group.name) {
          orgNames.add(canonicalizeOrgName(group.name));
        }
      });
    }
  });

  // Filter out empty names
  orgNames.delete('');

  logger.info(`Found ${orgNames.size} unique organizations to score`);

  // Calculate engagement for each organization
  const engagements: OrganizationEngagement[] = [];
  const orgNamesArray = Array.from(orgNames);

  for (const canonicalName of orgNamesArray) {
    try {
      const engagement = await calculateOrganizationEngagement(
        canonicalName,
        allEventRequests,
        allCollections
      );
      engagements.push(engagement);
    } catch (error) {
      logger.warn(`Failed to calculate engagement for ${canonicalName}`, { error });
    }
  }

  // Sort by engagement score (lowest first for priority attention)
  engagements.sort((a, b) => a.scores.overall - b.scores.overall);

  logger.info(`Calculated engagement scores for ${engagements.length} organizations`);

  return engagements;
}

/**
 * Get summary insights for the entire groups catalog
 */
export async function getGroupInsightsSummary(): Promise<GroupInsightsSummary> {
  const engagements = await calculateAllOrganizationEngagement();

  // Calculate distribution
  const engagementDistribution = {
    active: 0,
    atRisk: 0,
    dormant: 0,
    new: 0
  };

  const outreachPriorities = {
    urgent: 0,
    high: 0,
    normal: 0,
    low: 0
  };

  const categoryBreakdown: Record<string, { count: number; totalScore: number }> = {};

  engagements.forEach(eng => {
    // Count engagement levels
    switch (eng.engagementLevel) {
      case 'active': engagementDistribution.active++; break;
      case 'at_risk': engagementDistribution.atRisk++; break;
      case 'dormant': engagementDistribution.dormant++; break;
      case 'new': engagementDistribution.new++; break;
    }

    // Count outreach priorities
    outreachPriorities[eng.outreachPriority]++;

    // Aggregate by category
    const cat = eng.category || 'uncategorized';
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { count: 0, totalScore: 0 };
    }
    categoryBreakdown[cat].count++;
    categoryBreakdown[cat].totalScore += eng.scores.overall;
  });

  // Calculate category averages
  const categoryBreakdownFinal: Record<string, { count: number; avgEngagementScore: number }> = {};
  for (const [cat, data] of Object.entries(categoryBreakdown)) {
    categoryBreakdownFinal[cat] = {
      count: data.count,
      avgEngagementScore: Math.round((data.totalScore / data.count) * 100) / 100
    };
  }

  // Calculate overall average
  const totalScore = engagements.reduce((sum, eng) => sum + eng.scores.overall, 0);
  const averageEngagementScore = engagements.length > 0
    ? Math.round((totalScore / engagements.length) * 100) / 100
    : 0;

  // Get top performers (highest engagement)
  const topPerformers = engagements
    .filter(eng => eng.engagementLevel === 'active')
    .sort((a, b) => b.scores.overall - a.scores.overall)
    .slice(0, 10);

  // Get organizations needing attention (urgent/high priority)
  const needsAttention = engagements
    .filter(eng => eng.outreachPriority === 'urgent' || eng.outreachPriority === 'high')
    .sort((a, b) => {
      // Urgent first, then by score
      if (a.outreachPriority === 'urgent' && b.outreachPriority !== 'urgent') return -1;
      if (b.outreachPriority === 'urgent' && a.outreachPriority !== 'urgent') return 1;
      return a.scores.overall - b.scores.overall;
    })
    .slice(0, 10);

  // Get new opportunities (new orgs with completed events)
  const newOpportunities = engagements
    .filter(eng => eng.engagementLevel === 'new' && eng.metrics.completedEvents > 0)
    .sort((a, b) => b.scores.overall - a.scores.overall)
    .slice(0, 10);

  return {
    totalOrganizations: engagements.length,
    engagementDistribution,
    outreachPriorities,
    categoryBreakdown: categoryBreakdownFinal,
    averageEngagementScore,
    topPerformers,
    needsAttention,
    newOpportunities
  };
}

/**
 * Save engagement scores to database (for caching/historical tracking)
 */
export async function saveEngagementScores(engagements: OrganizationEngagement[]): Promise<void> {
  logger.info(`Saving ${engagements.length} engagement scores to database`);

  for (const eng of engagements) {
    try {
      await db.insert(organizationEngagementScores)
        .values({
          organizationName: eng.organizationName,
          canonicalName: eng.canonicalName,
          category: eng.category,
          overallEngagementScore: eng.scores.overall.toString(),
          frequencyScore: eng.scores.frequency.toString(),
          recencyScore: eng.scores.recency.toString(),
          volumeScore: eng.scores.volume.toString(),
          completionScore: eng.scores.completion.toString(),
          consistencyScore: eng.scores.consistency.toString(),
          engagementTrend: eng.engagementTrend,
          trendPercentChange: eng.trendPercentChange.toString(),
          totalEvents: eng.metrics.totalEvents,
          completedEvents: eng.metrics.completedEvents,
          totalSandwiches: eng.metrics.totalSandwiches,
          daysSinceLastEvent: eng.metrics.daysSinceLastEvent,
          daysSinceFirstEvent: eng.metrics.daysSinceFirstEvent,
          lastEventDate: eng.metrics.lastEventDate,
          firstEventDate: eng.metrics.firstEventDate,
          averageEventInterval: eng.metrics.averageEventInterval,
          engagementLevel: eng.engagementLevel,
          outreachPriority: eng.outreachPriority,
          recommendedActions: eng.recommendedActions,
          insights: eng.insights,
          programSuitability: eng.programSuitability,
          lastCalculatedAt: eng.lastCalculatedAt,
          calculationVersion: '1.0'
        })
        .onConflictDoUpdate({
          target: organizationEngagementScores.canonicalName,
          set: {
            organizationName: eng.organizationName,
            category: eng.category,
            overallEngagementScore: eng.scores.overall.toString(),
            frequencyScore: eng.scores.frequency.toString(),
            recencyScore: eng.scores.recency.toString(),
            volumeScore: eng.scores.volume.toString(),
            completionScore: eng.scores.completion.toString(),
            consistencyScore: eng.scores.consistency.toString(),
            engagementTrend: eng.engagementTrend,
            trendPercentChange: eng.trendPercentChange.toString(),
            totalEvents: eng.metrics.totalEvents,
            completedEvents: eng.metrics.completedEvents,
            totalSandwiches: eng.metrics.totalSandwiches,
            daysSinceLastEvent: eng.metrics.daysSinceLastEvent,
            daysSinceFirstEvent: eng.metrics.daysSinceFirstEvent,
            lastEventDate: eng.metrics.lastEventDate,
            firstEventDate: eng.metrics.firstEventDate,
            averageEventInterval: eng.metrics.averageEventInterval,
            engagementLevel: eng.engagementLevel,
            outreachPriority: eng.outreachPriority,
            recommendedActions: eng.recommendedActions,
            insights: eng.insights,
            programSuitability: eng.programSuitability,
            lastCalculatedAt: eng.lastCalculatedAt,
            calculationVersion: '1.0',
            updatedAt: new Date()
          }
        });
    } catch (error) {
      logger.warn(`Failed to save engagement score for ${eng.canonicalName}`, { error });
    }
  }

  logger.info('Finished saving engagement scores');
}

// ============================================================================
// Event History for Organizations
// ============================================================================

export interface OrganizationEventHistoryItem {
  date: Date;
  source: 'event_request' | 'collection';
  eventName: string | null;
  sandwichCount: number;
  status: string | null;
  eventType: string | null;
  address: string | null;
  notes: string | null;
  id: number | null;
}

export interface OrganizationEventHistory {
  canonicalName: string;
  organizationName: string;
  events: OrganizationEventHistoryItem[];
  totalEvents: number;
  totalSandwiches: number;
}

/**
 * Get detailed event history for an organization
 */
export async function getOrganizationEventHistory(
  canonicalName: string
): Promise<OrganizationEventHistory> {
  const allRequests = await db.query.eventRequests.findMany();
  const allCollections = await db.query.sandwichCollections.findMany();

  const events: OrganizationEventHistoryItem[] = [];
  let organizationName = canonicalName;

  // Find matching event requests
  const matchingRequests = allRequests.filter(req => {
    const orgName = req.organizationName;
    if (!orgName) return false;
    const reqCanonical = canonicalizeOrgName(orgName);
    if (reqCanonical === canonicalName) {
      organizationName = orgName; // Use the actual display name
      return true;
    }
    return false;
  });

  // Add event requests to the list
  matchingRequests.forEach(req => {
    const eventDate = getEffectiveEventDate(req);
    if (eventDate) {
      events.push({
        date: new Date(eventDate),
        source: 'event_request',
        eventName: req.organizationName || null,
        sandwichCount: req.estimatedSandwichCount || 0,
        status: req.status || null,
        eventType: req.eventType || null,
        address: req.eventAddress || null,
        notes: req.notesForScheduling || null,
        id: req.id,
      });
    }
  });

  // Find matching collections
  allCollections.forEach(collection => {
    let matchedCount = 0;

    // Check group1
    if (collection.group1Name && canonicalizeOrgName(collection.group1Name) === canonicalName) {
      if (!organizationName || organizationName === canonicalName) {
        organizationName = collection.group1Name;
      }
      matchedCount = collection.group1Count || 0;
    }

    // Check group2
    if (collection.group2Name && canonicalizeOrgName(collection.group2Name) === canonicalName) {
      if (!organizationName || organizationName === canonicalName) {
        organizationName = collection.group2Name;
      }
      matchedCount = collection.group2Count || 0;
    }

    // Check groupCollections
    if (collection.groupCollections && Array.isArray(collection.groupCollections)) {
      collection.groupCollections.forEach((group: any) => {
        if (group.name && canonicalizeOrgName(group.name) === canonicalName) {
          if (!organizationName || organizationName === canonicalName) {
            organizationName = group.name;
          }
          matchedCount += group.count || 0;
        }
      });
    }

    if (matchedCount > 0 && collection.collectionDate) {
      // Check if we already have an event request for this date
      const eventDate = new Date(collection.collectionDate);
      const existingEvent = events.find(e =>
        e.date.toISOString().split('T')[0] === eventDate.toISOString().split('T')[0] &&
        e.source === 'event_request'
      );

      if (existingEvent) {
        // Update sandwich count from collection if it's higher
        if (matchedCount > existingEvent.sandwichCount) {
          existingEvent.sandwichCount = matchedCount;
        }
      } else {
        // Add as a collection-only event
        events.push({
          date: eventDate,
          source: 'collection',
          eventName: organizationName,
          sandwichCount: matchedCount,
          status: 'completed',
          eventType: null,
          address: null,
          notes: null,
          id: collection.id,
        });
      }
    }
  });

  // Sort by date descending (most recent first)
  events.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Calculate totals
  const totalEvents = events.length;
  const totalSandwiches = events.reduce((sum, e) => sum + e.sandwichCount, 0);

  return {
    canonicalName,
    organizationName,
    events,
    totalEvents,
    totalSandwiches,
  };
}
