const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

const router = express.Router();

/**
 * GET /api/deletion/preferences
 * Get user's auto-delete preferences
 */
router.get('/preferences', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      enabled: user.autoDeletePreferences.enabled,
      retentionDays: user.autoDeletePreferences.retentionDays,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/deletion/preferences
 * Update user's auto-delete preferences
 */
router.put('/preferences', authMiddleware, async (req, res) => {
  try {
    const { enabled, retentionDays } = req.body;

    // Validate retention days
    if (retentionDays && (retentionDays < 7 || retentionDays > 90)) {
      return res.status(400).json({
        error: 'Retention days must be between 7 and 90',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        'autoDeletePreferences.enabled': enabled !== undefined ? enabled : false,
        'autoDeletePreferences.retentionDays': retentionDays || 30,
      },
      { new: true, runValidators: true }
    );

    res.json({
      message: `Auto-delete ${enabled ? 'enabled' : 'disabled'} successfully`,
      preferences: {
        enabled: user.autoDeletePreferences.enabled,
        retentionDays: user.autoDeletePreferences.retentionDays,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/deletion/audit-logs
 * Get deletion audit logs for current user
 */
router.get('/audit-logs', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const logs = await AuditLog.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await AuditLog.countDocuments({ userId: req.user.id });

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/deletion/audit-logs/:logId
 * Get specific audit log entry
 */
router.get('/audit-logs/:logId', authMiddleware, async (req, res) => {
  try {
    const log = await AuditLog.findOne({
      _id: req.params.logId,
      userId: req.user.id,
    }).lean();

    if (!log) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    res.json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
