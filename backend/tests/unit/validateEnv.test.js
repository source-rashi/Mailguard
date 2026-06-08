const { validateMLServiceReachability } = require('../../config/validateEnv');

// Mock global fetch
global.fetch = jest.fn();

describe('validateMLServiceReachability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env.ML_SERVICE_URL = 'http://mock-ml-service:8000';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    delete process.env.ML_SERVICE_URL;
  });

  it('should return true when ML service is reachable and healthy', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok', model_loaded: true, model_version: '1.0.0' })
    });

    const resultPromise = validateMLServiceReachability(1, 0);
    // Fetch happens in a promise, so we need to flush it
    await Promise.resolve(); 
    const result = await resultPromise;
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry and eventually return true if first attempt fails but second succeeds', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', model_loaded: true })
      });

    const resultPromise = validateMLServiceReachability(2, 2000);
    
    // First attempt fails, delay timer starts
    await Promise.resolve();
    await Promise.resolve();
    
    // Fast-forward through the delay
    jest.advanceTimersByTime(2000);
    
    // Second attempt happens
    await Promise.resolve();
    await Promise.resolve();
    
    const result = await resultPromise;
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should return false after all retries fail', async () => {
    global.fetch.mockRejectedValue(new Error('Persistent error'));

    const resultPromise = validateMLServiceReachability(3, 2000);
    
    // Attempt 1 fails, Delay 1 starts
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2000); 
    
    // Attempt 2 fails, Delay 2 starts
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(4000); 
    
    // Attempt 3 fails
    await Promise.resolve();
    await Promise.resolve();
    
    const result = await resultPromise;
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('should return false if response is not ok', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500
    });

    const resultPromise = validateMLServiceReachability(2, 2000);
    
    // Attempt 1 fails (not ok), Delay 1 starts
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    
    // Attempt 2 fails
    await Promise.resolve();
    await Promise.resolve();
    
    const result = await resultPromise;
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should return false if ML_SERVICE_URL is not set', async () => {
    delete process.env.ML_SERVICE_URL;
    const result = await validateMLServiceReachability();
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
