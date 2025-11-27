import { describe, it, expect } from 'vitest';
import { encryptSSN, decryptSSN } from './encryption';

describe('encryptSSN', () => {
  it('should encrypt SSN with proper format and properties', () => {
    const ssn = '123456789';
    const encrypted = encryptSSN(ssn);
    
    // Basic properties
    expect(typeof encrypted).toBe('string');
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(ssn);
    expect(encrypted.length).toBeGreaterThan(ssn.length);
    
    // Format: iv:authTag:encryptedData
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    expect(parts.every(part => part.length > 0)).toBe(true);
  });

  it('should produce different encrypted values for same input (random IV)', () => {
    const ssn = '123456789';
    expect(encryptSSN(ssn)).not.toBe(encryptSSN(ssn));
  });
  it('should throw on tampered ciphertext', () => {
    const encrypted = encryptSSN('123456789');
    const [iv, tag, data] = encrypted.split(':');
    const tampered = `${iv}:${tag}:${data}X`; // Corrupt data
    expect(() => decryptSSN(tampered)).toThrow();
  });
  
  it('should handle edge cases', () => {
    expect(() => encryptSSN('')).toThrow();
    expect(() => encryptSSN('12345')).toThrow(); // Wrong length
    expect(() => encryptSSN('abcdefghi')).toThrow(); // Non-numeric
  });
  
  it('should preserve leading zeros', () => {
    expect(decryptSSN(encryptSSN('000000001'))).toBe('000000001');
  });
});

describe('decryptSSN', () => {
  it('should decrypt encrypted SSN back to original', () => {
    const testSSNs = ['123456789', '987654321', '000000000', '999999999'];
    
    testSSNs.forEach(ssn => {
      expect(decryptSSN(encryptSSN(ssn))).toBe(ssn);
    });
  });

  it('should throw error for invalid encrypted format', () => {
    expect(() => decryptSSN('invalid-format')).toThrow();
    expect(() => decryptSSN('not:enough:parts:here')).toThrow();
  });
  
});


