"""
Prediction result caching for ML service.

Provides in-memory caching of prediction results to avoid redundant ML inference
for identical email texts. Cache is automatically invalidated when model is reloaded.

Key Features:
- Hash-based caching (SHA-256 of text + model version)
- Automatic invalidation on model reload
- Thread-safe operations
- Memory-efficient (configurable max size)
- Performance metrics (hit rate tracking)
"""

import sys
import hashlib

# Fix Windows console encoding for Unicode characters
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
        sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')
import time
from threading import Lock
from typing import Optional, Dict, Any
from collections import OrderedDict


class PredictionCache:
    """
    Thread-safe LRU cache for ML prediction results.
    
    Cache Key: hash(email_text + model_version)
    Cache Value: prediction result dict + timestamp
    
    Automatically invalidates when model version changes.
    """
    def _cleanup_expired(self) -> None:
        """
        Remove all expired entries from the cache.
        """
        current_time = time.time()
        keys_to_delete = [
            key for key, entry in self.cache.items()
            if current_time - entry["cached_at"] > self.ttl_seconds
        ]

        for key in keys_to_delete:
            del self.cache[key]
    
    def __init__(self, max_size: int = 10000, ttl_seconds: int = 3600):
        """
        Initialize prediction cache.
        
        Args:
            max_size: Maximum number of cached predictions (LRU eviction)
            ttl_seconds: Time-to-live for cache entries (default: 1 hour)
        """
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self.cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self.lock = Lock()
        
        # Performance metrics
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.invalidations = 0
        
        # Current model version (for invalidation)
        self.current_model_version = "unknown"
        
        print(f"✅ Prediction cache initialized (max_size={max_size}, ttl={ttl_seconds}s)")
    
    def _generate_cache_key(self, text: str, model_version: str) -> str:
        """
        Generate cache key from email text and model version.
        
        Uses SHA-256 hash to create fixed-length key regardless of text length.
        
        Args:
            text: Email text content
            model_version: Current model version
            
        Returns:
            Cache key string (hex digest)
        """
        # Normalize text (strip whitespace, lowercase)
        normalized_text = text.strip().lower()
        
        # Create composite key: text + model version
        key_material = f"{normalized_text}::{model_version}"
        
        # Hash to fixed-length key
        return hashlib.sha256(key_material.encode('utf-8')).hexdigest()
    
    def get(self, text: str, model_version: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached prediction result.
        
        Args:
            text: Email text content
            model_version: Current model version
            
        Returns:
            Cached prediction result dict, or None if not found/expired
        """
        cache_key = self._generate_cache_key(text, model_version)
        
        with self.lock:
            # Check if key exists
            if cache_key not in self.cache:
                self.misses += 1
                return None
            
            # Get cached entry
            entry = self.cache[cache_key]
            
            # Check if expired
            current_time = time.time()
            if current_time - entry["cached_at"] > self.ttl_seconds:
                # Expired - remove and count as miss
                del self.cache[cache_key]
                self.misses += 1
                return None
            
            # Valid cache hit - move to end (LRU)
            self.cache.move_to_end(cache_key)
            self.hits += 1
            
            return entry["result"]
    
    def set(self, text: str, model_version: str, result: Dict[str, Any]) -> None:
        """
        Store prediction result in cache.
        """
        cache_key = self._generate_cache_key(text, model_version)

        with self.lock:
        
            self._cleanup_expired()

            # Check if we need to evict (LRU)
            if len(self.cache) >= self.max_size and cache_key not in self.cache:
                self.cache.popitem(last=False)
                self.evictions += 1
            
            # Store entry with timestamp
            self.cache[cache_key] = {
                "result": result,
                "cached_at": time.time()
            }
            
            # Move to end (most recently used)
            self.cache.move_to_end(cache_key)
    
    def invalidate_all(self, new_model_version: str) -> int:
        """
        Invalidate all cached predictions (called on model reload).
        
        Args:
            new_model_version: New model version after reload
            
        Returns:
            Number of entries invalidated
        """
        with self.lock:
            count = len(self.cache)
            self.cache.clear()
            self.current_model_version = new_model_version
            self.invalidations += count
            
            if count > 0:
                print(f"🔄 Prediction cache invalidated: {count} entries cleared (new model: {new_model_version})")
            
            return count
    
    def clear(self) -> int:
        """
        Clear all cache entries.
        
        Returns:
            Number of entries cleared
        """
        with self.lock:
            count = len(self.cache)
            self.cache.clear()
            return count
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get cache performance statistics.
        
        Returns:
            Dictionary with cache metrics:
            - size: Current number of cached entries
            - max_size: Maximum cache size
            - hits: Number of cache hits
            - misses: Number of cache misses
            - hit_rate: Cache hit rate (0-1)
            - evictions: Number of LRU evictions
            - invalidations: Number of entries invalidated on model reload
            - model_version: Current model version
        """
        with self.lock:
            total_requests = self.hits + self.misses
            hit_rate = (self.hits / total_requests) if total_requests > 0 else 0.0
            
            return {
                "size": len(self.cache),
                "max_size": self.max_size,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(hit_rate, 4),
                "evictions": self.evictions,
                "invalidations": self.invalidations,
                "model_version": self.current_model_version,
                "total_requests": total_requests
            }
    
    def reset_stats(self) -> None:
        """Reset performance counters (for testing/monitoring)."""
        with self.lock:
            self.hits = 0
            self.misses = 0
            self.evictions = 0
            self.invalidations = 0


# Global cache instance (initialized in predictor.py)
prediction_cache: Optional[PredictionCache] = None


def init_cache(max_size: int = 10000, ttl_seconds: int = 3600) -> PredictionCache:
    """
    Initialize global prediction cache.
    
    Args:
        max_size: Maximum number of cached predictions
        ttl_seconds: Time-to-live for cache entries
        
    Returns:
        Initialized PredictionCache instance
    """
    global prediction_cache
    prediction_cache = PredictionCache(max_size=max_size, ttl_seconds=ttl_seconds)
    return prediction_cache


def get_cache() -> Optional[PredictionCache]:
    """Get global prediction cache instance."""
    return prediction_cache
