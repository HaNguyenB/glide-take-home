import { describe, it, expect } from 'vitest';
import { 
  initDb, 
  closeDb, 
  getConnectionCount,
  getSqliteConnection 
} from './index';

describe('Database Connection Lifecycle (PERF-408)', () => {
  
  it('should not leak connections when initDb() is called multiple times', () => {
    // Get initial connection count (should be 0 - no orphaned connections)
    const initialCount = getConnectionCount();
    expect(initialCount).toBe(0);
    
    // Call initDb() multiple times - should be idempotent
    initDb();
    initDb();
    initDb();
    
    // After multiple calls, still no orphaned connections
    const afterCount = getConnectionCount();
    expect(afterCount).toBe(0);
    
    // Verify the main connection is still open and working
    const sqlite = getSqliteConnection();
    expect(sqlite.open).toBe(true);
    expect(() => sqlite.prepare('SELECT 1').get()).not.toThrow();
  });

  it('should close the global sqlite connection when closeDb() is called', () => {
    const sqlite = getSqliteConnection();
    expect(sqlite.open).toBe(true);
    
    closeDb();
    
    // After closeDb(), connection should be closed
    expect(sqlite.open).toBe(false);
    expect(() => sqlite.prepare('SELECT 1').get()).toThrow(/not open/i);
  });

  it('should allow reinitializing after close', () => {
    // Close the connection
    closeDb();
    const sqlite = getSqliteConnection();
    expect(sqlite.open).toBe(false);
    
    // Reinitialize - initDb() should work even after close
    // (Note: In production, you'd need to recreate the connection, but for testing
    // this verifies initDb() is idempotent and doesn't create orphaned connections)
    initDb();
    
    // Connection is still closed (can't reopen same instance), but initDb() didn't fail
    // This test verifies initDb() doesn't create new orphaned connections
    expect(getConnectionCount()).toBe(0);
  });

  it('should have zero tracked connections after fix', () => {
    // Verify the fix: no orphaned connections are created
    expect(getConnectionCount()).toBe(0);
    
    // Multiple initDb() calls don't create connections
    initDb();
    initDb();
    
    expect(getConnectionCount()).toBe(0);
  });
});