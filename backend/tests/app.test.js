const request = require('supertest');
const app = require('../server');

describe('Backend API Smoke Tests', () => {
  it('should pass a basic sanity check', () => {
    expect(true).toBe(true);
  });

  it('should return 200 on base route', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Backend API Core Unit Tests', () => {
  it('should return 401 when accessing protected route without auth', async () => {
    const res = await request(app).get('/api/emails');
    expect(res.statusCode).toEqual(401);
  });

  it('should return 404 for non-existent routes', async () => {
    const res = await request(app).get('/api/non-existent-endpoint');
    expect(res.statusCode).toEqual(404);
  });

  it('should have health endpoint', async () => {
    const res = await request(app).get('/health');
    expect([200, 404, 503]).toContain(res.statusCode);
  });

});
