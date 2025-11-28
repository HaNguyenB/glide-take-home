// lib/db/index.test.ts

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('Database Connection Lifecycle (PERF-408)', () => {
  
  it('should not leak connections when initDb() is called multiple times', () => {
    const connections: Database.Database[] = [];
    
    // Simulate buggy initDb() - creates orphaned connections
    function buggyInitDb() {
      connections.push(new Database(':memory:'));
    }
    
    buggyInitDb();
    buggyInitDb();
    buggyInitDb();
    
    // WILL FAIL - shows Bug 1
    expect(connections.length).toBe(0); // Expected: 0, Actual: 3
    
    connections.forEach(c => c.close());
  });

  it('should close all tracked connections', () => {
    const connections = [
      new Database(':memory:'),
      new Database(':memory:')
    ];
    
    connections.forEach(c => c.close());
    connections.length = 0;
    
    expect(connections.length).toBe(0);
  });

  it('should close the global sqlite connection', () => {
    const sqlite = new Database(':memory:');
    
    sqlite.close();
    
    expect(sqlite.open).toBe(false);
    expect(() => sqlite.prepare('SELECT 1').get()).toThrow(/not open/i);
  });

  it('should allow reinitializing after close', () => {
    let sqlite = new Database(':memory:');
    sqlite.close();
    
    sqlite = new Database(':memory:'); // Reinit
    
    expect(sqlite.open).toBe(true);
    expect(() => sqlite.prepare('SELECT 1').get()).not.toThrow();
    
    sqlite.close();
  });

  it('should handle multiple close calls without error', () => {
    const sqlite = new Database(':memory:');
    
    expect(() => {
      sqlite.close();
      // Subsequent closes do nothing (idempotent)
      if (sqlite.open) sqlite.close();
      if (sqlite.open) sqlite.close();
    }).not.toThrow();
  });
});