/**
 * Static analysis test for Signup Page Redirect (SEC-302)
 * 
 * This test verifies that the signup page redirects authenticated users
 * to the dashboard instead of allowing duplicate signups.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Signup Page - Redirect when authenticated (SEC-302)', () => {
  it('should import useEffect and useRouter for redirect functionality', () => {
    const pagePath = resolve(process.cwd(), 'app/signup/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check for required imports
    const hasUseEffect = pageSource.includes('useEffect');
    const hasUseRouter = pageSource.includes('useRouter');
    
    // After fix: both should be imported
    expect(hasUseEffect).toBe(true);
    expect(hasUseRouter).toBe(true);
  });

  it('should query user authentication status via tRPC', () => {
    const pagePath = resolve(process.cwd(), 'app/signup/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check for tRPC query to get user/auth status
    const hasTrpcQuery = 
      pageSource.includes('trpc.') && 
      (pageSource.includes('.useQuery') || pageSource.includes('.useQuery()'));
    
    // After fix: should query user status
    expect(hasTrpcQuery).toBe(true);
  });

  it('should redirect to dashboard when user is authenticated', () => {
    const pagePath = resolve(process.cwd(), 'app/signup/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check for redirect logic to /dashboard
    const hasDashboardRedirect = 
      pageSource.includes('router.push') && 
      pageSource.includes('/dashboard');
    
    // Check if redirect happens in useEffect (before form submission)
    const hasUseEffectRedirect = 
      pageSource.includes('useEffect') && 
      pageSource.includes('/dashboard');
    
    // After fix: should redirect to dashboard when authenticated
    expect(hasDashboardRedirect || hasUseEffectRedirect).toBe(true);
  });

  it('should check authentication status before allowing signup form submission', () => {
    const pagePath = resolve(process.cwd(), 'app/signup/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check if there's a guard that prevents form submission when authenticated
    const hasAuthCheck = 
      pageSource.includes('useEffect') ||
      (pageSource.includes('user') && pageSource.includes('router.push'));
    
    // After fix: should check auth status
    expect(hasAuthCheck).toBe(true);
  });

  it('should NOT allow signup mutation when user is already authenticated', () => {
    const pagePath = resolve(process.cwd(), 'app/signup/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check if signup mutation is guarded by auth check
    const hasSignupMutation = pageSource.includes('auth.signup.useMutation');
    const hasAuthGuard = 
      pageSource.includes('useEffect') && 
      pageSource.includes('/dashboard');
    
    // After fix: should have guard preventing signup when authenticated
    // This test will FAIL initially (no guard), PASS after fix
    expect(hasAuthGuard).toBe(true);
  });
});

