// Admin Controller
// Handles administrative operations like model retraining

const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');

// ============================================
// ML OPERATION LOCK & STATUS TRACKING
// ============================================

// Lock state to prevent overlapping retrain/reload operations
let mlOperationLock = {
    isLocked: false,
    currentOperation: null,  // 'retrain' or 'reload'
    startedAt: null,
    userId: null
};

// Status tracking for the operation
let mlOperationStatus = {
    isRunning: false,
    operation: null,
    startedAt: null,
    progress: 0,  // 0-100
    step: null,   // 'dataset_building', 'retraining', 'reloading', 'reclassifying'
    error: null,
    lastCompleted: null
};

// Lock wrapper function
async function withMLLock(operation, userId, callback) {
    // Check if already locked
    if (mlOperationLock.isLocked) {
        return {
            success: false,
            error: `${mlOperationLock.currentOperation} already in progress. Please wait.`,
            status: 409,
            currentOperation: mlOperationLock.currentOperation,
            startedAt: mlOperationLock.startedAt
        };
    }
    
    // Acquire lock
    mlOperationLock = {
        isLocked: true,
        currentOperation: operation,
        startedAt: new Date(),
        userId: userId
    };
    
    mlOperationStatus = {
        isRunning: true,
        operation: operation,
        startedAt: new Date(),
        progress: 0,
        step: 'starting',
        error: null,
        lastCompleted: mlOperationStatus.lastCompleted
    };
    
    try {
        const result = await callback(updateProgress);
        
        // Update status on success
        mlOperationStatus = {
            ...mlOperationStatus,
            progress: 100,
            step: 'completed',
            isRunning: false,
            lastCompleted: new Date()
        };
        
        return result;
    } catch (error) {
        // Update status on error
        mlOperationStatus = {
            ...mlOperationStatus,
            error: error.message,
            isRunning: false,
            step: 'failed'
        };
        throw error;
    } finally {
        // Release lock
        mlOperationLock = {
            isLocked: false,
            currentOperation: null,
            startedAt: null,
            userId: null
        };
    }
}

// Progress update helper
function updateProgress(step, progress) {
    mlOperationStatus = {
        ...mlOperationStatus,
        step: step,
        progress: progress
    };
}

/**
 * Get ML operation status
 * GET /api/admin/ml/status
 */
exports.getMLOperationStatus = async (req, res) => {
    try {
        return res.json({
            success: true,
            ...mlOperationStatus,
            lockHeld: mlOperationLock.isLocked,
            currentLockedOperation: mlOperationLock.currentOperation
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Trigger model retraining
 * POST /api/admin/retrain
 *
 * This endpoint:
 * 1. Runs the Python retraining script
 * 2. Waits for completion
 * 3. Triggers model reload in ML service
 * 4. Returns comprehensive status
 */
exports.triggerRetraining = async (req, res) => {
    // Use the lock to prevent concurrent operations
    const lockResult = await withMLLock('retrain', req.mongoUserId, async (updateProgress) => {
        
        console.log('🔐 Retraining request received...');
        updateProgress('starting', 5);

        // Configuration
        const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
        const DATASET_BUILDER_PATH = path.join(__dirname, '../../ml-service/dataset_builder.py');
        const RETRAIN_SCRIPT_PATH = path.join(__dirname, '../../ml-service/retrain.py');
        const TRAINING_DATA = req.body.dataFile || 'training.csv';
        const MODEL_TYPE = req.body.modelType || 'random_forest';

        updateProgress('checking_ml_service', 10);

        // Step 1: Check if ML service is available
        try {
            await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
        } catch (error) {
            throw new Error('ML service is not available. Please start it first.');
        }

        updateProgress('building_dataset', 20);

        // Step 2: Build training dataset from feedback
        const datasetResult = await new Promise((resolve, reject) => {
            const args = [
                DATASET_BUILDER_PATH,
                '--output', TRAINING_DATA
            ];

            const pythonProcess = spawn(process.env.PYTHON_BIN || 'python', args, {
                cwd: path.join(__dirname, '../../ml-service')
            });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                process.stdout.write(text);
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, stdout, stderr, code });
                } else {
                    reject({ success: false, stdout, stderr, code });
                }
            });

            pythonProcess.on('error', (error) => {
                reject({ success: false, error: error.message });
            });

            setTimeout(() => {
                pythonProcess.kill();
                reject({ success: false, error: 'Dataset building timeout (2 minutes)' });
            }, 2 * 60 * 1000);
        });

        updateProgress('retraining', 50);

        // Step 3: Run retraining script
        const retrainResult = await new Promise((resolve, reject) => {
            const args = [
                RETRAIN_SCRIPT_PATH,
                '--data', TRAINING_DATA,
                '--model', MODEL_TYPE
            ];

            const pythonProcess = spawn(process.env.PYTHON_BIN || 'python', args, {
                cwd: path.join(__dirname, '../../ml-service')
            });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                process.stdout.write(text);
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true, stdout, stderr, code });
                } else {
                    reject({ success: false, stdout, stderr, code });
                }
            });

            pythonProcess.on('error', (error) => {
                reject({ success: false, error: error.message });
            });

            setTimeout(() => {
                pythonProcess.kill();
                reject({ success: false, error: 'Retraining timeout (5 minutes)' });
            }, 5 * 60 * 1000);
        });

        updateProgress('reloading_model', 80);

        // Step 4: Reload model in ML service
        try {
            const reloadResponse = await axios.post(
                `${ML_SERVICE_URL}/reload`,
                {},
                { timeout: 10000 }
            );

            if (!reloadResponse.data.success) {
                throw new Error('Model reload returned non-success status');
            }

            console.log('✅ Model reloaded successfully in ML service');
        } catch (error) {
            throw new Error('Retraining succeeded but model reload failed: ' + error.message);
        }

        updateProgress('reclassifying', 90);

        // Step 5: Trigger automatic reclassification of all emails with new model
        console.log('🔄 Triggering automatic reclassification of emails...');
        let reclassifyStats = null;
        try {
            const Email = require('../models/Email');
            const emailCount = await Email.countDocuments();

            if (emailCount > 0) {
                const emailController = require('./emailController');

                const mockReq = {
                    mongoUserId: req.mongoUserId,
                    body: { forceReclassify: true }
                };

                const mockRes = {
                    status: (code) => mockRes,
                    json: (data) => {
                        reclassifyStats = data.stats;
                        console.log(`✅ Reclassification triggered: ${data.stats?.processed || 0} emails will be processed`);
                        return mockRes;
                    }
                };

                emailController.classifyEmails(mockReq, mockRes).catch(err => {
                    console.warn('⚠️ Background reclassification failed:', err.message);
                });
            } else {
                console.log('ℹ️ No emails to reclassify (database empty)');
            }
        } catch (error) {
            console.warn('⚠️ Could not trigger reclassification:', error.message);
        }

        console.log('\n✅ Complete retraining pipeline finished successfully!\n');

        return {
            success: true,
            message: 'Model retrained, reloaded, and reclassification triggered successfully',
            steps: {
                datasetBuilding: 'completed',
                retraining: 'completed',
                reload: 'completed',
                reclassification: reclassifyStats ? 'triggered' : 'skipped'
            },
            config: {
                dataFile: TRAINING_DATA,
                modelType: MODEL_TYPE
            },
            reclassifyStats,
            timestamp: new Date().toISOString()
        };
    });

    // Check if lock was acquired
    if (lockResult.success === false && lockResult.status === 409) {
        return res.status(409).json(lockResult);
    }

    return res.json(lockResult);
};

/**
 * Get retraining status/info
 * GET /api/admin/retrain/status
 */
exports.getRetrainingStatus = async (req, res) => {
    try {
        const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

        // Get model status from ML service
        const response = await axios.get(`${ML_SERVICE_URL}/model/status`);

        return res.json({
            success: true,
            mlService: {
                available: true,
                url: ML_SERVICE_URL,
                modelStatus: response.data
            },
            operationStatus: {
                isRunning: mlOperationStatus.isRunning,
                operation: mlOperationStatus.operation,
                progress: mlOperationStatus.progress,
                step: mlOperationStatus.step,
                startedAt: mlOperationStatus.startedAt,
                error: mlOperationStatus.error,
                lastCompleted: mlOperationStatus.lastCompleted
            }
        });

    } catch (error) {
        return res.status(503).json({
            success: false,
            error: 'ML service not available',
            details: error.message
        });
    }
};

/**
 * Build dataset before retraining
 * POST /api/admin/dataset/build
 */
exports.buildDataset = async (req, res) => {
    try {
        console.log('📊 Dataset build request received...');

        const DATASET_BUILDER_PATH = path.join(__dirname, '../../ml-service/dataset_builder.py');
        const OUTPUT_FILE = req.body.outputFile || 'training.csv';

        console.log(`   Output file: ${OUTPUT_FILE}`);

        const buildResult = await new Promise((resolve, reject) => {
            const args = [DATASET_BUILDER_PATH, '--output', OUTPUT_FILE];

            console.log(`   Command: python ${args.join(' ')}`);

            const pythonProcess = spawn(process.env.PYTHON_BIN || 'python', args, {
                cwd: path.join(__dirname, '../../ml-service')
            });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                process.stdout.write(text);
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Dataset built successfully');
                    resolve({ success: true, stdout, stderr, code });
                } else {
                    console.log(`❌ Dataset build failed with code ${code}`);
                    reject({ success: false, stdout, stderr, code });
                }
            });

            pythonProcess.on('error', (error) => {
                reject({ success: false, error: error.message });
            });

            setTimeout(() => {
                pythonProcess.kill();
                reject({ success: false, error: 'Dataset build timeout (2 minutes)' });
            }, 2 * 60 * 1000);
        });

        return res.json({
            success: true,
            message: 'Dataset built successfully',
            outputFile: OUTPUT_FILE,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error building dataset:', error);

        return res.status(500).json({
            success: false,
            error: 'Dataset build failed',
            details: error.message || error.stderr || 'Unknown error'
        });
    }
};

/**
 * Reload ML models (without retraining)
 * POST /api/admin/ml/reload
 */
exports.reloadMLModels = async (req, res) => {
    const lockResult = await withMLLock('reload', req.mongoUserId, async (updateProgress) => {
        updateProgress('reloading', 10);
        
        const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
        
        updateProgress('calling_ml_service', 50);
        
        const reloadResponse = await axios.post(
            `${ML_SERVICE_URL}/reload`,
            {},
            { timeout: 30000 }
        );
        
        updateProgress('completed', 100);
        
        return {
            success: true,
            message: 'ML models reloaded successfully',
            details: reloadResponse.data
        };
    });
    
    if (lockResult.success === false && lockResult.status === 409) {
        return res.status(409).json(lockResult);
    }
    
    return res.json(lockResult);
};