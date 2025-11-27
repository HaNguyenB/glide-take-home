# TDD Approach for XSS Vulnerability Fix (SEC-303)

## Overview

This document outlines the Test-Driven Development (TDD) approach for fixing the XSS vulnerability in transaction descriptions.

## TDD Cycle: Red → Green → Refactor

### Step 1: RED - Write Failing Tests

We've created two test files:

1. **`server/routers/account.test.ts`** - Tests backend behavior (should PASS)
   - Verifies backend returns transaction data as-is
   - Confirms backend is not the issue (backend is fine)

2. **`components/TransactionList.test.tsx`** - Tests component security (will FAIL initially)
   - Verifies `dangerouslySetInnerHTML` is NOT used
   - Confirms HTML is properly escaped

### Step 2: Run Tests (They Should Fail)

```bash
# Run all tests
npm test

# Run specific test file
npm test account.test.ts
npm test TransactionList.test.tsx
```

**Expected Result:**
- ✅ `account.test.ts` - PASSES (backend is fine)
- ❌ `TransactionList.test.tsx` - FAILS (vulnerability exists)

### Step 3: GREEN - Fix the Code

Fix the vulnerability in `components/TransactionList.tsx`:

**Current (Vulnerable) Code:**
```tsx
{transaction.description ? <span dangerouslySetInnerHTML={{ __html: transaction.description }} /> : "-"}
```

**Fixed Code:**
```tsx
{transaction.description || "-"}
```

### Step 4: Run Tests Again (They Should Pass)

```bash
npm test
```

**Expected Result:**
- ✅ `account.test.ts` - Still PASSES
- ✅ `TransactionList.test.tsx` - Now PASSES

### Step 5: REFACTOR (Optional)

- Clean up any comments
- Verify no other uses of `dangerouslySetInnerHTML` exist
- Document the fix

## Test Coverage

### Backend Tests (`account.test.ts`)

- ✅ Returns transaction descriptions as-is (backend is not responsible for sanitization)
- ✅ Handles various XSS payload patterns

### Component Tests (`TransactionList.test.tsx`)

- ✅ Verifies `dangerouslySetInnerHTML` is not used
- ✅ Confirms safe rendering pattern exists

## Advanced Testing (Optional)

For full integration testing with React components, install:

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Then update `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    environment: 'jsdom', // Change from 'node' to 'jsdom'
    // ... rest of config
  },
});
```

This allows full React component rendering tests.

## Manual Testing

After fixing, manually verify:

1. **Chrome DevTools Test:**
   - Inject XSS payload into database
   - View transaction list
   - Verify NO alert popup appears
   - Check Elements tab - HTML should be escaped as text

2. **Functional Test:**
   - Create a transaction with description "Funding from card"
   - Verify it displays correctly
   - Verify special characters like `<`, `>`, `&` display as text, not HTML

## Success Criteria

✅ All tests pass
✅ No `dangerouslySetInnerHTML` in component
✅ Manual testing confirms no XSS execution
✅ Transaction descriptions display correctly

