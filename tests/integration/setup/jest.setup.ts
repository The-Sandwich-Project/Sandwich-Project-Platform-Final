/**
 * Jest Setup for Integration Tests
 *
 * Runs before all tests to set up the test environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

// Increase timeout for integration tests
// jest.setTimeout(10000);  // Comment out for now - can be set in individual tests

// Mock external services if needed
// beforeAll(() => {
//   // Mock the email service (server/services/email) if needed
//   // Mock Google services if needed
// });

// Clean up after all tests
// afterAll(async () => {
//   // Close database connections
//   // await db.end();
// });
