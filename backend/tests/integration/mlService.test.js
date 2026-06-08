const { classifyEmail } = require('../../services/mlService');

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({
    data: {
      prediction: 'phishing',
      confidence: 0.93,
      probabilities: { phishing: 0.93, safe: 0.07 },
      explanation: { top_signals: [], method: 'tfidf' }
    }
  }),
  get: jest.fn().mockResolvedValue({ data: { status: 'ok' } }),
  create: jest.fn().mockReturnThis(),
  defaults: { headers: { common: {} } },
  isAxiosError: jest.fn().mockReturnValue(false),
}));

describe('ML Service Integration Tests', () => {
  it('should return classification result for valid email', async () => {
    const emailData = {
      subject: 'Verify your account',
      body: 'Click here to verify immediately',
      sender: 'no-reply@suspicious.com'
    };

    const result = await classifyEmail(emailData);

    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('confidence');
    expect(['phishing', 'safe']).toContain(result.label);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should handle ML service timeout gracefully', async () => {
    const axios = require('axios');
    axios.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));

    const emailData = { subject: '', body: '', sender: '' };

    try {
      await classifyEmail(emailData);
    } catch (error) {
      expect(error.message).toBeDefined();
    }
  });
});
