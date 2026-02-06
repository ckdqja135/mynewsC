"""
Simple in-memory cache for search results
"""
import time
from typing import Dict, Tuple, Any, Optional
import hashlib
import json


class SearchCache:
    """Simple in-memory cache with TTL"""

    def __init__(self, ttl: int = 300):
        """
        Initialize cache

        Args:
            ttl: Time to live in seconds (default: 300 = 5 minutes)
        """
        self.ttl = ttl
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._last_cleanup = time.time()
        self._cleanup_interval = 60  # Clean up every 60 seconds

    def _generate_key(self, **kwargs) -> str:
        """Generate cache key from kwargs"""
        # Sort keys for consistent hashing
        sorted_items = sorted(kwargs.items())
        key_string = json.dumps(sorted_items, sort_keys=True)
        return hashlib.md5(key_string.encode()).hexdigest()

    def _cleanup_expired(self):
        """Remove expired cache entries"""
        now = time.time()

        # Only cleanup periodically to avoid overhead
        if now - self._last_cleanup < self._cleanup_interval:
            return

        self._last_cleanup = now
        expired_keys = [
            key for key, (timestamp, _) in self._cache.items()
            if now - timestamp > self.ttl
        ]

        for key in expired_keys:
            del self._cache[key]

        if expired_keys:
            print(f"[CACHE] Cleaned up {len(expired_keys)} expired entries")

    def get(self, **kwargs) -> Optional[Any]:
        """
        Get cached result

        Args:
            **kwargs: Parameters to generate cache key

        Returns:
            Cached result if found and not expired, None otherwise
        """
        self._cleanup_expired()

        cache_key = self._generate_key(**kwargs)

        if cache_key not in self._cache:
            return None

        timestamp, result = self._cache[cache_key]

        # Check if expired
        if time.time() - timestamp > self.ttl:
            del self._cache[cache_key]
            return None

        print(f"[CACHE] Hit for key: {cache_key[:8]}... (age: {int(time.time() - timestamp)}s)")
        return result

    def set(self, result: Any, **kwargs):
        """
        Set cache result

        Args:
            result: Result to cache
            **kwargs: Parameters to generate cache key
        """
        cache_key = self._generate_key(**kwargs)
        self._cache[cache_key] = (time.time(), result)
        print(f"[CACHE] Stored result for key: {cache_key[:8]}... (total entries: {len(self._cache)})")

    def clear(self):
        """Clear all cache"""
        count = len(self._cache)
        self._cache.clear()
        print(f"[CACHE] Cleared {count} entries")

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        now = time.time()
        valid_entries = sum(
            1 for timestamp, _ in self._cache.values()
            if now - timestamp <= self.ttl
        )

        return {
            "total_entries": len(self._cache),
            "valid_entries": valid_entries,
            "expired_entries": len(self._cache) - valid_entries,
            "ttl": self.ttl
        }


# Global cache instances
keyword_search_cache = SearchCache(ttl=300)  # 5 minutes for keyword search
semantic_search_cache = SearchCache(ttl=300)  # 5 minutes for semantic search
analysis_cache = SearchCache(ttl=600)  # 10 minutes for analysis (more expensive)
