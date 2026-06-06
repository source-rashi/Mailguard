const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const cache = require('../../utils/cache');

jest.mock('../../models/User');
jest.mock('../../utils/cache');
jest.mock('@clerk/clerk-sdk-node', () => ({
  clerkClient: {
    verifyToken: jest.fn().mockResolvedValue({ sub: 'test-admin-id' }),
    users: {
      getUser: jest.fn().mockResolvedValue({
        id: 'test-admin-id',
        emailAddresses: [
          {
            id: 'email-1',
            emailAddress: 'admin@test.com',
            verification: { status: 'verified' }
          }
        ],
        primaryEmailAddressId: 'email-1',
        firstName: 'Admin',
        lastName: 'User'
      })
    }
  }
}));

const mongoose = require('mongoose');

describe('Admin Cache Routes - Integration Tests', () => {
  beforeAll(() => {
    process.env.CLERK_SECRET_KEY = 'test-secret';
    process.env.NODE_ENV = 'development'; // To bypass ENCRYPTION_KEY requirement
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/admin/cache/stats', () => {
    it('should allow access for admin user', async () => {
      User.findOne.mockResolvedValue({ _id: 'admin-mongo-id', clerkId: 'test-admin-id', role: 'admin' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: 'admin-mongo-id', role: 'admin', email: 'admin@test.com' })
      });
      cache.getStats.mockReturnValue({ hits: 10, misses: 5 });
      cache.getSize.mockReturnValue({ keys: 15 });

      const res = await request(app)
        .get('/api/admin/cache/stats')
        .set('Authorization', 'Bearer valid-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cache).toBeDefined();
    });

    it('should deny access for non-admin user', async () => {
      User.findOne.mockResolvedValue({ _id: 'user-mongo-id', clerkId: 'test-admin-id', role: 'user' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: 'user-mongo-id', role: 'user', email: 'user@test.com' })
      });

      const res = await request(app)
        .get('/api/admin/cache/stats')
        .set('Authorization', 'Bearer valid-token');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Admin privileges required');
    });

    it('should deny access for unauthenticated user', async () => {
      const res = await request(app).get('/api/admin/cache/stats');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/admin/cache/flush', () => {
    it('should allow access for admin user', async () => {
      User.findOne.mockResolvedValue({ _id: 'admin-mongo-id', clerkId: 'test-admin-id', role: 'admin' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: 'admin-mongo-id', role: 'admin', email: 'admin@test.com' })
      });

      const res = await request(app)
        .post('/api/admin/cache/flush')
        .set('Authorization', 'Bearer valid-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(cache.flush).toHaveBeenCalled();
    });

    it('should deny access for non-admin user', async () => {
      User.findOne.mockResolvedValue({ _id: 'user-mongo-id', clerkId: 'test-admin-id', role: 'user' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: 'user-mongo-id', role: 'user', email: 'user@test.com' })
      });

      const res = await request(app)
        .post('/api/admin/cache/flush')
        .set('Authorization', 'Bearer valid-token');

      expect(res.statusCode).toBe(403);
      expect(cache.flush).not.toHaveBeenCalled();
    });
  });
});
