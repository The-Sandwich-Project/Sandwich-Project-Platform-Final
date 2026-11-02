import { Router } from 'express';
import type { RouterDependencies } from '../types';
import { onboardingService } from '../services/onboarding-service';
import { logger } from '../utils/production-safe-logger';

export function createOnboardingRouter(deps: RouterDependencies) {
  const router = Router();
  const { isAuthenticated } = deps;

  // Get challenges for current user
  router.get('/challenges', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const challenges = await onboardingService.getChallengesForUser(userId);
    res.json(challenges);
  } catch (error) {
    logger.error('Error fetching challenges:', error);
    res.status(500).json({ message: 'Failed to fetch challenges' });
  }
});

// Track challenge completion
  router.post('/track/:actionKey', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { actionKey } = req.params;
    const metadata = req.body.metadata || {};

    const result = await onboardingService.trackChallengeCompletion(
      userId,
      actionKey,
      metadata
    );

    if (result.success) {
      res.json(result);
    } else {
      // For non-critical errors (challenge not found, already completed), return 200
      // This prevents console errors since challenge tracking is optional
      if (result.message?.includes('not found') || result.message?.includes('already completed')) {
        res.json(result);
      } else {
        // For actual errors, return 400
        res.status(400).json(result);
      }
    }
  } catch (error) {
    logger.error('Error tracking challenge:', error);
    res.status(500).json({ message: 'Failed to track challenge' });
  }
});

// Get user stats
  router.get('/stats', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const stats = await onboardingService.getUserStats(userId);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// Get leaderboard
  router.get('/leaderboard', isAuthenticated, async (req: any, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const leaderboard = await onboardingService.getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    logger.error('Error fetching leaderboard:', error);
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

// Admin: Get all users with their onboarding challenge completion status
router.get('/admin/users-progress', isAuthenticated, async (req: any, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const usersProgress = await onboardingService.getAllUsersProgress();
    res.json(usersProgress);
  } catch (error) {
    logger.error('Error fetching users progress:', error);
    res.status(500).json({ message: 'Failed to fetch users progress' });
  }
});

// Admin: Initialize default challenges
  router.post('/admin/initialize', isAuthenticated, async (req: any, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    await onboardingService.initializeDefaultChallenges();
    res.json({ message: 'Challenges initialized successfully' });
  } catch (error) {
    logger.error('Error initializing challenges:', error);
    res.status(500).json({ message: 'Failed to initialize challenges' });
  }
});

// Admin: Migrate challenges to updated schema
router.post('/admin/migrate', isAuthenticated, async (req: any, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { migrateOnboardingChallenges } = await import('../scripts/migrate-onboarding-challenges');
    await migrateOnboardingChallenges();
    res.json({ message: 'Migration completed successfully' });
  } catch (error: any) {
    logger.error('Error running migration:', error);
    res.status(500).json({ message: 'Failed to run migration', error: error.message });
  }
});

// Admin: Send onboarding challenge announcement email
router.post('/admin/send-announcement', isAuthenticated, async (req: any, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { sendEmail } = await import('../sendgrid');
    const { users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const { db } = await import('../db');

    // Get all active users
    const activeUsers = await db
      .select({
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.isActive, true));

    const emailTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #236383 0%, #236383 100%); color: white; padding: 30px 20px; text-align: center; }
    .content { padding: 30px 20px; background: #f9f9f9; }
    .highlight-box { background: #E6F4F6; border-left: 4px solid #236383; padding: 15px; margin: 20px 0; }
    .cta-button { display: inline-block; background: #A31C41; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎉 Onboarding Challenges Are Live!</h1>
  </div>
  <div class="content">
    <p>Hi there,</p>

    <p>We're excited to introduce our <strong>Onboarding Challenges</strong> – a fun, optional way to explore the platform and get familiar with all its features!</p>

    <div class="highlight-box">
      <h3>🎯 Here's what you need to know:</h3>
      <ul>
        <li><strong>Zero pressure</strong> – These challenges are completely optional and self-paced</li>
        <li><strong>Learn by doing</strong> – Each challenge helps you discover a different feature</li>
        <li><strong>Track your progress</strong> – See your accomplishments and earn points along the way</li>
        <li><strong>Go at your own pace</strong> – Complete them whenever it works for you</li>
      </ul>
    </div>

    <p>The challenges are designed to help you feel confident navigating the platform. Whether you complete one, some, or all of them is entirely up to you!</p>

    <p><strong>How to get started:</strong></p>
    <ol>
      <li>Log into the platform</li>
      <li>Look for the trophy icon in the top navigation</li>
      <li>Explore the challenges at your leisure</li>
    </ol>

    <p style="text-align: center;">
      <a href="${process.env.APP_URL || 'https://app.thesandwichproject.org'}/dashboard" class="cta-button">
        View Challenges
      </a>
    </p>

    <p>Remember: there's no deadline and no expectation. These are here as a helpful resource whenever you need them.</p>

    <p>Happy exploring!</p>

    <p>Best,<br>The Sandwich Project Team</p>
  </div>
  <div class="footer">
    <p>The Sandwich Project | Building Community Through Service</p>
  </div>
</body>
</html>
`;

    const failedEmails: string[] = [];
    let successCount = 0;

    // Send emails to all active users
    for (const user of activeUsers) {
      try {
        await sendEmail({
          to: user.email,
          subject: '🎉 Onboarding Challenges Are Now Live!',
          html: emailTemplate,
        });
        successCount++;
      } catch (error) {
        logger.error(`Failed to send email to ${user.email}:`, error);
        failedEmails.push(user.email);
      }
    }

    res.json({
      message: 'Announcement emails sent',
      totalUsers: activeUsers.length,
      successCount,
      failedCount: failedEmails.length,
      failedEmails,
    });
  } catch (error) {
    logger.error('Error sending announcement:', error);
    res.status(500).json({ message: 'Failed to send announcement' });
  }
});

  return router;
}

