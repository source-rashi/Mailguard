const adminAuth = require('../../middleware/adminAuth');
const User = require('../../models/User');

jest.mock('../../models/User');

describe('Admin Auth Middleware - Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      mongoUserId: 'user123',
      method: 'GET',
      originalUrl: '/api/admin/test'
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('should call next() if user is admin', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'user123',
        email: 'admin@test.com',
        role: 'admin'
      })
    });

    await adminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 403 if user is not admin', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'user123',
        email: 'user@test.com',
        role: 'user'
      })
    });

    await adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'Access denied. Admin privileges required.'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if mongoUserId is missing', async () => {
    req.mongoUserId = undefined;

    await adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'User not authenticated'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 404 if user is not found', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null)
    });

    await adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'User not found'
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 500 if database error occurs', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('DB Error'))
    });

    await adminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'Authorization check failed'
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
