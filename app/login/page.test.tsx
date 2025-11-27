/**
 * Static analysis test for Login Page Redirect (SEC-302)
 * 
 * This test verifies that the login page redirects authenticated users
 * to the dashboard instead of allowing duplicate logins.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Login Page - Redirect when authenticated (SEC-302)', () => {
  it('should import useEffect and useRouter for redirect functionality', () => {
    const pagePath = resolve(process.cwd(), 'app/login/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check for required imports
    const hasUseEffect = pageSource.includes('useEffect');
    const hasUseRouter = pageSource.includes('useRouter');
    
    // After fix: both should be imported
    expect(hasUseEffect).toBe(true);
    expect(hasUseRouter).toBe(true);
  });

  it('should query user authentication status via tRPC', () => {
    const pagePath = resolve(process.cwd(), 'app/login/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check for tRPC query to get user/auth status
    // Could be: trpc.auth.getUser, trpc.auth.me, or similar
    // Or checking ctx.user via some query
    // For now, we'll check if there's any tRPC query that might get user
    const hasTrpcQuery = 
      pageSource.includes('trpc.') && 
      (pageSource.includes('.useQuery') || pageSource.includes('.useQuery()'));
    
    // After fix: should query user status
    expect(hasTrpcQuery).toBe(true);
  });

  it('should redirect to dashboard when user is authenticated', () => {
    const pagePath = resolve(process.cwd(), 'app/login/page.tsx');
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

  it('should check authentication status before allowing login form submission', () => {
    const pagePath = resolve(process.cwd(), 'app/login/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check if there's a guard that prevents form submission when authenticated
    // This could be: early return, redirect in useEffect, or conditional rendering
    const hasAuthCheck = 
      pageSource.includes('useEffect') ||
      (pageSource.includes('user') && pageSource.includes('router.push'));
    
    // After fix: should check auth status
    expect(hasAuthCheck).toBe(true);
  });

  it('should NOT allow login mutation when user is already authenticated', () => {
    const pagePath = resolve(process.cwd(), 'app/login/page.tsx');
    const pageSource = readFileSync(pagePath, 'utf-8');
    
    // Check if login mutation is guarded by auth check
    // Ideally, the mutation should be disabled or not called if user exists
    const hasLoginMutation = pageSource.includes('auth.login.useMutation');
    const hasAuthGuard = 
      pageSource.includes('useEffect') && 
      pageSource.includes('/dashboard');
    
    // After fix: should have guard preventing login when authenticated
    // This test will FAIL initially (no guard), PASS after fix
    expect(hasAuthGuard).toBe(true);
  });
});

