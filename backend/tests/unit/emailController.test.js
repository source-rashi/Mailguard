jest.mock('../../models/Email');
jest.mock('../../models/User');
jest.mock('../../models/Classification');
jest.mock('../../services/mlService', () => ({
  checkHealth: jest.fn().mockResolvedValue(true),
  predictEmail: jest.fn().mockResolvedValue({
    prediction: 'safe',
    confidence: 0.95,
    probabilities: { safe: 0.95, phishing: 0.05 },
    explanation: { top_signals: [], method: 'tfidf' }
  })
}));
jest.mock('csurf', () => {
  return () => (req, res, next) => next();
});
jest.mock('@clerk/clerk-sdk-node', () => ({
  clerkClient: {
    verifyToken: jest.fn().mockResolvedValue({ sub: 'test-user-id' }),
    users: {
      getUser: jest.fn().mockResolvedValue({
        id: 'test-user-id',
        emailAddresses: [
          {
            id: 'email-1',
            emailAddress: 'test@example.com',
            verification: { status: 'verified' }
          }
        ],
        primaryEmailAddressId: 'email-1',
        firstName: 'Test',
        lastName: 'User'
      })
    }
  }
}));

const request = require('supertest');
const app = require('../../server');
const Email = require('../../models/Email');
const User = require('../../models/User');
const Classification = require('../../models/Classification');
const cache = require('../../utils/cache');

describe('Email Controller - Unit Tests', () => {
  beforeAll(() => {
    process.env.CLERK_SECRET_KEY = 'test-secret';
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Flush in-memory cache so that cached 200 responses from prior tests
    // do not mask controller errors (e.g. DB failures) in subsequent tests.
    cache.flush();
  });

  beforeEach(() => {
    // Reset implementations to baseline
    User.findOne.mockResolvedValue({ _id: 'mock-mongo-id', email: 'test@example.com' });
    User.create.mockResolvedValue({ _id: 'mock-mongo-id', email: 'test@example.com' });
    User.findById.mockResolvedValue({ _id: 'mock-mongo-id', email: 'test@example.com' });
    
    Email.aggregate.mockResolvedValue([]);
    Email.find.mockReturnValue({
      limit: jest.fn().mockResolvedValue([])
    });
    
    Classification.distinct.mockResolvedValue([]);
    Classification.findOneAndUpdate.mockResolvedValue({ isNew: true });
    Classification.aggregate.mockResolvedValue([]);
  });

  describe('GET /api/emails', () => {
    it('should fetch emails for authenticated user', async () => {
      const mockEmails = [
        { _id: '1', subject: 'Test 1', sender: 'test1@example.com' },
        { _id: '2', subject: 'Test 2', sender: 'test2@example.com' }
      ];
      
      // First call for total count, second for actual data
      Email.aggregate
        .mockResolvedValueOnce([{ total: 2 }])
        .mockResolvedValueOnce(mockEmails);
      
      const res = await request(app)
        .get('/api/emails')
        .set('Authorization', 'Bearer fake-token');
      
      expect(res.statusCode).toBe(200);
      expect(res.body.emails).toHaveLength(2);
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app).get('/api/emails');
      expect(res.statusCode).toBe(401);
    });

    it('should handle database errors gracefully', async () => {
      Email.aggregate.mockRejectedValue(new Error('DB Error'));
      
      const res = await request(app)
        .get('/api/emails')
        .set('Authorization', 'Bearer fake-token');
      
      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /api/emails/classify', () => {
    it('should classify an email correctly', async () => {
      const emailData = {
        from: 'sender@example.com',
        subject: 'Click here to verify',
        body: 'Suspicious content'
      };
      
      const res = await request(app)
        .post('/api/emails/classify')
        .set('Authorization', 'Bearer fake-token')
        .send(emailData);
      
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('stats');
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/emails/classify')
        .set('Authorization', 'Bearer fake-token')
        .send({ forceReclassify: 'invalid-boolean' });
      
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('errors');
    });
  });
});
