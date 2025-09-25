/**
 * Smart in-memory cache with LRU eviction and adaptive TTL
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  size: number;
  hits: number;
}

interface CacheOptions {
  maxSize?: number; // Max size in bytes (default: 50MB)
  defaultTTL?: number; // Default TTL in ms
  cleanupInterval?: number; // Cleanup interval in ms
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private sizeUsed = 0;
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly ttlByPattern: Map<RegExp, number>;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50 * 1024 * 1024; // 50MB default
    this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000; // 5 minutes default
    
    // Adaptive TTL based on content type
    this.ttlByPattern = new Map([
      [/^subreddit:.*:hot$/, 5 * 60 * 1000],    // Hot posts: 5 minutes
      [/^subreddit:.*:new$/, 2 * 60 * 1000],    // New posts: 2 minutes  
      [/^subreddit:.*:top$/, 30 * 60 * 1000],   // Top posts: 30 minutes
      [/^post:/, 10 * 60 * 1000],               // Individual posts: 10 minutes
      [/^user:/, 15 * 60 * 1000],               // User data: 15 minutes
      [/^search:/, 10 * 60 * 1000],             // Search results: 10 minutes
    ]);

    // Start cleanup interval
    if (options.cleanupInterval !== 0) {
      this.startCleanup(options.cleanupInterval ?? 60000); // Every minute
    }
  }

  /**
   * Get item from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    const ttl = this.getTTLForKey(key);
    if (Date.now() - entry.timestamp > ttl) {
      this.delete(key);
      return null;
    }

    // Update hit count for LRU tracking
    entry.hits++;
    
    return entry.data as T;
  }

  /**
   * Set item in cache with automatic size management
   */
  set<T>(key: string, data: T, _customTTL?: number): void {
    const size = this.estimateSize(data);
    
    // Evict entries if needed to make room
    while (this.sizeUsed + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      size,
      hits: 0
    };

    this.cache.set(key, entry);
    this.sizeUsed += size;
  }

  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.sizeUsed -= entry.size;
    return this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.sizeUsed = 0;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalHits = Array.from(this.cache.values())
      .reduce((sum, entry) => sum + entry.hits, 0);

    return {
      entries: this.cache.size,
      sizeUsed: this.sizeUsed,
      maxSize: this.maxSize,
      sizeUsedMB: (this.sizeUsed / 1024 / 1024).toFixed(2),
      maxSizeMB: (this.maxSize / 1024 / 1024).toFixed(2),
      hitRate: this.cache.size > 0 ? (totalHits / this.cache.size).toFixed(2) : 0,
      oldestEntry: this.getOldestEntry(),
      mostUsed: this.getMostUsedKeys(5)
    };
  }

  /**
   * Generate cache key
   */
  static createKey(...parts: (string | number | boolean | undefined)[]): string {
    return parts
      .filter(p => p !== undefined && p !== null)
      .join(':')
      .toLowerCase();
  }

  /**
   * Private: Get TTL for a specific key based on patterns
   */
  private getTTLForKey(key: string): number {
    for (const [pattern, ttl] of this.ttlByPattern) {
      if (pattern.test(key)) {
        return ttl;
      }
    }
    return this.defaultTTL;
  }

  /**
   * Private: Estimate size of data in bytes
   */
  private estimateSize(data: any): number {
    try {
      return JSON.stringify(data).length * 2; // Rough estimate (UTF-16)
    } catch {
      return 1024; // Default 1KB for non-serializable
    }
  }

  /**
   * Private: Evict least recently used entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let minScore = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      // Score based on hits and age
      const age = Date.now() - entry.timestamp;
      const score = entry.hits / (age / 1000); // Hits per second
      
      if (score < minScore) {
        minScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  /**
   * Private: Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const ttl = this.getTTLForKey(key);
      if (now - entry.timestamp > ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
  }

  /**
   * Private: Start cleanup timer
   */
  private startCleanup(interval: number): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
  }

  /**
   * Private: Get oldest cache entry
   */
  private getOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Private: Get most used keys
   */
  private getMostUsedKeys(count: number): string[] {
    return Array.from(this.cache.entries())
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, count)
      .map(([key]) => key);
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}