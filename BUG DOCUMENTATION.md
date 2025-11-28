# BUG DOCUMENTATION

## Assignee: Ha Nguyen  

## Tech stack:  
- Frontend: Next.js 14 (App Router), TypeScript, React, Tailwind CSS  
- Backend: tRPC for type-safe APIs  
- Database: SQLite with Drizzle ORM  
- Auth: JWT-based sessions  
- Forms: React Hook Form  

## Progress-Based Grouping

### PR 1 – SSN Storage Hardening
- Summary: Keep SSNs hidden, encrypted, and out of responses.
- Tickets: [SEC-301](#ticket-sec-301)
  - Root causes:
    - SSNs sat in the database as plain text.
    - APIs returned SSNs as part of the user payload.
    - The application context could access decrypted SSNs.
    - Passwords used bcrypt, but SSNs had zero protection.
  - How it was fixed:
    - Wrote failing tests showing SSNs were stored and returned in clear text.
    - Added AES-256-GCM helpers (`encryptSSN` / `decryptSSN`) and enforced the `ENCRYPTION_KEY` env var.
    - Updated signup to encrypt before saving and sanitized all auth responses so SSNs never leave the server.
  - Preventive measures:
    - Only handle SSNs via the helpers in `lib/encryption.ts`; no raw strings anywhere else.
    - Always send user objects through `sanitizeUser`, and keep tests that prove SSNs never leak.
    - Treat `ENCRYPTION_KEY` as mandatory config and document how to rotate it safely.

### PR 2 – XSS Vulnerability
- Summary: Render descriptions as plain text so untrusted HTML never executes.
- Tickets: [SEC-303](#ticket-sec-303)
  - Root causes:
    - `TransactionList` used `dangerouslySetInnerHTML` for `transaction.description`, injecting raw HTML.
    - No sanitization, so any HTML/JS in descriptions ran in the browser.
  - How it was fixed:
    - Replaced `dangerouslySetInnerHTML` with `{transaction.description || "-"}` so React auto-escapes content.
    - Left an inline comment documenting the fix.
  - Tests:
    - `components/TransactionList.test.tsx` ensures the component uses safe rendering (no `dangerouslySetInnerHTML`).
    - `server/routers/account.test.ts` confirms backend returns raw data and catches malicious payload patterns.
  - Preventive measures:
    - Avoid `dangerouslySetInnerHTML` unless absolutely necessary; require sanitization + tests if used.
    - Add a lint/review check for components that render user-generated content.

### PR 3 – Session Controls
- Summary: Tighten how sessions are created, checked, and cleaned up.
- Tickets: [SEC-304](#ticket-sec-304), [PERF-403](#ticket-perf-403), [PERF-402](#ticket-perf-402)

  - **Ticket SEC-304 – Session Management**
    - Root causes:
      - Signup and login both created new sessions without deleting existing ones.
      - The login page didn’t check if the user was already authenticated, so sessions could pile up.
    - How it was fixed:
      - Added checks so signup/login refuse to run if the requester already has an active session.
      - When issuing a new token, existing sessions for that user are revoked first.
    - Preventive measures:
      - Treat “one active session per user” as a rule and test for it.
      - Review any new auth flows to make sure they clean up old sessions before adding new ones.

  - **Ticket PERF-403 – Session Expiry**
    - Root causes:
      - Session tokens were considered valid right up to the exact expiry time.
      - There was no buffer to account for clock drift or near-expiry edge cases.
    - How it was fixed:
      - Tightened expiry checks so sessions close to or past their expiry are treated as invalid.
      - Updated validation logic so “almost expired” sessions are refreshed or rejected instead of silently accepted.
    - Preventive measures:
      - Add tests around the expiry boundary (just before and just after) to lock in the behavior.
      - Prefer central helpers for “isSessionValid” instead of ad-hoc timestamp checks.

  - **Ticket PERF-402 – Logout Issues**
    - Root causes:
      - Logout only looked at `ctx.req.cookies`, which could be `{}` even when a `Cookie` header was present.
      - Because of that, the token was never found or deleted, leaving the session row untouched.
    - How it was fixed:
      - Changed the logic to require a real `cookies.session` value; if it’s missing, fall back to parsing the `Cookie` header.
      - Centralized token extraction into a shared helper so all logout paths use the same logic.
    - Impacts:
      - Sessions are now reliably deleted on logout, even in environments where cookies aren’t populated on `ctx.req`.
      - Users can log out confidently, and “ghost sessions” no longer linger.
    - Preventive measures:
      - Use a shared `getSessionToken(ctx)` helper as the single source of truth for token extraction.
      - Add tests for logout across different environments (cookies vs. headers) so this flow can’t silently break again.

### PR 4 – Resource Leak Fix
- Summary: Stop leaking SQLite connections and make DB lifecycle explicit.
- Tickets: [PERF-408](#ticket-perf-408)
  - Root causes:
    - The app created new SQLite connections without reliably closing old ones.
    - There was no single place to manage DB startup/shutdown or track open handles.
  - How it was fixed:
    - Centralized DB setup in `lib/db/index.ts` with `initDb`, `getSqliteConnection`, and `closeDb`.
    - Made `initDb` idempotent and ensured `closeDb` actually closes the connection and resets state.
    - Simplified `getConnectionCount` so we can quickly confirm we’re not leaking extra connections.
  - Preventive measures:
    - Always use the shared DB helpers instead of creating raw `new Database()` instances.
    - Add tests (or health checks) that assert a stable connection count before and after high-traffic operations.

### PR 5 – Account Creation Error
- Summary: Make account creation fail loudly instead of returning a fake $100 balance.
- Tickets: [PERF-401](#ticket-perf-401)
  - Root causes:
    - `createAccount` used a hard-coded fallback object (with `balance: 100` and `status: "pending"`) when the post-insert fetch returned `null` or `undefined`.
    - There was no proper error handling for failed inserts, unlike `authRouter.signup`, which throws when the user fetch fails.
  - How it was fixed:
    - Updated `account.createAccount` to throw a `TRPCError("INTERNAL_SERVER_ERROR")` when the follow-up fetch fails instead of returning the bogus fallback account.
    - Brought the error-handling pattern in line with `authRouter` so both flows behave consistently on DB failure.
  - Tests:
    - Added tests around “Account Creation – Error Handling (PERF-401)” to cover both failure paths: a `null` fetch and an insert that throws.
    - These tests ensure no silent fallbacks or phantom $100 accounts can slip through again.
  - Preventive measures:
    - Use a shared pattern for create flows: `insert → fetch → if missing, throw TRPCError`, never return synthetic records.
    - Prefer explicit error paths over “best effort” fallbacks when dealing with money and account state.

### PR 6 – Funding & Transaction Accuracy
- Summary: Stabilize balances, ensure every funding event persists, and make transaction ordering deterministic.
- Tickets: [PERF-406](#ticket-perf-406), [PERF-405](#ticket-perf-405), [PERF-404](#ticket-perf-404)
  - **Ticket PERF-406 – Balance Calculation**
    - Root causes:
      - `accounts.balance` and `transactions.amount` were stored as floating-point values, so many deposits/withdrawals caused rounding errors and drift.
      - `fundAccount` recalculated the returned balance via repeated float additions instead of trusting the single source of truth in the database.
    - How it was fixed:
      - Switched `accounts.balance` and `transactions.amount` to integer cents so all math is exact.
      - Converted incoming dollar amounts to cents on write, and divided by 100 on read for API responses.
      - Removed the incremental floating-point loop in `fundAccount` and now return the authoritative balance directly from the DB.
    - Technical debt:
      - The migration that converts existing balances to cents lives inside `lib/db/index.ts` (`SCHEMA_VERSION` + `migrateBalancesToCents`), mixing schema upgrades with app bootstrap instead of using a proper migration tool.
    - Preventive measures:
      - Make “money is always stored as integer cents” a hard rule, enforced via code review and tests.
      - Centralize currency conversion helpers and require their use anywhere amounts cross the API/DB boundary.
      - Add regression tests that compare the stored balance to the sum of all transactions to ensure they always match.

### PR 7 – Account Validation Bug
- Summary: Tighten email, DOB, state, phone, and password rules during account setup.
- Tickets: [VAL-201](#ticket-val-201), [VAL-202](#ticket-val-202), [VAL-203](#ticket-val-203), [VAL-204](#ticket-val-204), [VAL-208](#ticket-val-208)

### PR 8 – Transaction & Funding Validation
- Summary: Strengthen card, routing, zero-amount, amount-format, and card-type validations.
- Tickets: [VAL-206](#ticket-val-206), [VAL-207](#ticket-val-207), [VAL-210](#ticket-val-210), [VAL-205](#ticket-val-205), [VAL-209](#ticket-val-209)

### PR 9 – Insecure Random Numbers
- Summary: Replace `Math.random()` account number generation with a cryptographically secure approach.
- Tickets: [SEC-302](#ticket-sec-302)

### Direct-to-Main Fixes (No PR)
- Summary: Hotfixes applied directly to main for UI and performance regressions.
- Tickets: [UI-101](#ticket-ui-101), [PERF-407](#ticket-perf-407)

## UI Issues

<a id="ticket-ui-101"></a>
### Ticket UI-101: Dark Mode Text Visibility
- Reporter: Sarah Chen
- Priority: Medium
- Description: "When using dark mode, the text I type into forms appears white on a white background, making it impossible to see what I'm typing."
- Steps to Reproduce:
  1. Enable dark mode
  2. Navigate to any input form
  3. Start typing
- Expected: Text should be clearly visible against the background
- Actual: Text is white on white background

## Validation Issues

<a id="ticket-val-201"></a>
### Ticket VAL-201: Email Validation Problems
- Reporter: James Wilson
- Priority: High
- Description: "The system accepts invalid email formats and doesn't handle special cases properly."
- Examples:
  - Accepts "TEST@example.com" but converts to lowercase without notifying user
  - No validation for common typos like ".con" instead of ".com"

<a id="ticket-val-202"></a>
### Ticket VAL-202: Date of Birth Validation
- Reporter: Maria Garcia
- Priority: Critical
- Description: "I accidentally entered my birth date as 2025 and the system accepted it."
- Impact: Potential compliance issues with accepting minors

<a id="ticket-val-203"></a>
### Ticket VAL-203: State Code Validation
- Reporter: Alex Thompson
- Priority: Medium
- Description: "The system accepted 'XX' as a valid state code."
- Impact: Address verification issues for banking communications

<a id="ticket-val-204"></a>
### Ticket VAL-204: Phone Number Format
- Reporter: John Smith
- Priority: Medium
- Description: "International phone numbers aren't properly validated. The system accepts any string of numbers."
- Impact: Unable to contact customers for important notifications

<a id="ticket-val-205"></a>
### Ticket VAL-205: Zero Amount Funding
- Reporter: Lisa Johnson
- Priority: High
- Description: "I was able to submit a funding request for $0.00"
- Impact: Creates unnecessary transaction records

<a id="ticket-val-206"></a>
### Ticket VAL-206: Card Number Validation
- Reporter: David Brown
- Priority: Critical
- Description: "System accepts invalid card numbers"
- Impact: Failed transactions and customer frustration

<a id="ticket-val-207"></a>
### Ticket VAL-207: Routing Number Optional
- Reporter: Support Team
- Priority: High
- Description: "Bank transfers are being submitted without routing numbers"
- Impact: Failed ACH transfers

<a id="ticket-val-208"></a>
### Ticket VAL-208: Weak Password Requirements
- Reporter: Security Team
- Priority: Critical
- Description: "Password validation only checks length, not complexity"
- Impact: Account security risks

<a id="ticket-val-209"></a>
### Ticket VAL-209: Amount Input Issues
- Reporter: Robert Lee
- Priority: Medium
- Description: "System accepts amounts with multiple leading zeros"
- Impact: Confusion in transaction records

<a id="ticket-val-210"></a>
### Ticket VAL-210: Card Type Detection
- Reporter: Support Team
- Priority: High
- Description: "Card type validation only checks basic prefixes, missing many valid cards"
- Impact: Valid cards being rejected

## Security Issues

<a id="ticket-sec-301"></a>
### Ticket SEC-301: SSN Storage
- Reporter: Security Audit Team
- Priority: Critical
- Description: "SSNs are stored in plaintext in the database"
- Impact: Severe privacy and compliance risk

<a id="ticket-sec-302"></a>
### Ticket SEC-302: Insecure Random Numbers
- Reporter: Security Team
- Priority: High
- Description: "Account numbers generated using Math.random()"
- Impact: Potentially predictable account numbers

<a id="ticket-sec-303"></a>
### Ticket SEC-303: XSS Vulnerability
- Reporter: Security Audit
- Priority: Critical
- Description: "Unescaped HTML rendering in transaction descriptions"
- Impact: Potential for cross-site scripting attacks
- How to reproduce:
  1. Load the Transactions page in dark mode.
  2. Open the browser console and run the script below to check for unsafe rendering and attempt payload injection.
  3. Observe that injected HTML executes when descriptions are rendered without escaping.

- Testing script (click to expand):

<details>
  <summary>View XSS probe script</summary>

```js
// Step 1: First, let's check if dangerouslySetInnerHTML is actually used
console.log("🔍 Step 1: Checking for dangerouslySetInnerHTML in the page source...");

// Look for React dev tools props
const descriptionCells = document.querySelectorAll('tbody td:nth-child(3)');

let foundDangerous = false;

descriptionCells.forEach(cell => {
  // Check if the cell has __reactProps or similar
  const innerHTML = cell.innerHTML;

  if (innerHTML.includes('<') && innerHTML.includes('>')) {
    console.log("⚠️  Found HTML in description cell:", innerHTML);
    foundDangerous = true;
  }
});

if (!foundDangerous) {
  console.log("ℹ️  No HTML detected in current descriptions. Proceeding with injection test...");
}

// Step 2: Fetch and test
fetch("http://localhost:3000/api/trpc/account.getTransactions?batch=1&input=%7B%220%22%3A%7B%22accountId%22%3A1%7D%7D", {
  "headers": {
    "accept": "*/*",
    "sec-fetch-site": "same-origin"
  },
  "method": "GET",
  "credentials": "include"
})
.then(response => response.json())
.then(data => {
  console.log("\n📦 Step 2: Fetched transaction data");

  if (data[0]?.result?.data && Array.isArray(data[0].result.data)) {
    const transactions = data[0].result.data;

    if (transactions.length === 0) {
      console.log("❌ No transactions found. Create one first!");
      return;
    }

    console.log(`✅ Found ${transactions.length} transaction(s)`);

    // Test multiple payloads
    const payloads = [
      '<img src=x onerror="alert(\'IMG XSS\')">', // Event handler
      '<svg onload="alert(\'SVG XSS\')"></svg>',  // SVG vector
      '<iframe src="javascript:alert(\'IFRAME XSS\')"></iframe>' // iframe
    ];

    console.log("\n🔴 Step 3: Testing XSS payloads...\n");

    const tbody = document.querySelector('tbody');
    if (!tbody) {
      console.log("❌ Transaction table not found!");
      return;
    }

    const rows = tbody.querySelectorAll('tr');

    payloads.forEach((payload, index) => {
      if (rows[index]) {
        const cells = rows[index].querySelectorAll('td');
        if (cells.length >= 3) {
          const descCell = cells[2];
          const originalContent = descCell.innerHTML;

          console.log(`\nTest ${index + 1}:`);
          console.log(`  Payload: ${payload}`);

          // Inject payload
          descCell.innerHTML = payload;

          // Check if it executed
          setTimeout(() => {
            const injected = descCell.querySelector('img, svg, iframe');
            if (injected) {
              console.log(`  ✅ Payload injected successfully`);
              console.log(`  🔍 Element in DOM:`, injected.outerHTML.substring(0, 100));
            } else {
              console.log(`  ❌ Payload was sanitized or failed`);
            }

            // Restore original content
            descCell.innerHTML = originalContent;
          }, 100 * (index + 1));
        }
      }
    });

    console.log("\n" + "=".repeat(60));
    console.log("🎯 REAL TEST: Check if the React component uses dangerouslySetInnerHTML");
    console.log("   1. Open React DevTools");
    console.log("   2. Find the transaction description component");
    console.log("   3. Look for 'dangerouslySetInnerHTML' in props");
    console.log("=".repeat(60));

  } else {
    console.log("❌ Unexpected response format");
  }
})
.catch(error => {
  console.error("❌ Error:", error);
});
```

</details>

<a id="ticket-sec-304"></a>
### Ticket SEC-304: Session Management
- Reporter: DevOps Team
- Priority: High
- Description: "Multiple valid sessions per user, no invalidation"
- Impact: Security risk from unauthorized access
- How to reproduce:
  1. Sign up for a new account.
  2. Run `npm run db:list-sessions` to confirm a single session exists.
  3. Go to `http://localhost:3000/signup` and sign in with the same credentials.
  4. Run `npm run db:list-sessions` again and observe there are now two sessions.
  5. Click “Log out” in the UI.
  6. Run `npm run db:list-sessions` one more time — both sessions are still present, showing logout did not invalidate them.

## Logic and Performance Issues

<a id="ticket-perf-401"></a>
### Ticket PERF-401: Account Creation Error
- Reporter: Support Team
- Priority: Critical
- Description: "New accounts show $100 balance when DB operations fail"
- Impact: Incorrect balance displays

<a id="ticket-perf-402"></a>
### Ticket PERF-402: Logout Issues
- Reporter: QA Team
- Priority: Medium
- Description: "Logout always reports success even when session remains active"
- Impact: Users think they're logged out when they're not

<a id="ticket-perf-403"></a>
### Ticket PERF-403: Session Expiry
- Reporter: Security Team
- Priority: High
- Description: "Expiring sessions still considered valid until exact expiry time"
- Impact: Security risk near session expiration

<a id="ticket-perf-404"></a>
### Ticket PERF-404: Transaction Sorting
- Reporter: Jane Doe
- Priority: Medium
- Description: "Transaction order seems random sometimes"
- Impact: Confusion when reviewing transaction history

<a id="ticket-perf-405"></a>
### Ticket PERF-405: Missing Transactions
- Reporter: Multiple Users
- Priority: Critical
- Description: "Not all transactions appear in history after multiple funding events"
- Impact: Users cannot verify all their transactions

<a id="ticket-perf-406"></a>
### Ticket PERF-406: Balance Calculation
- Reporter: Finance Team
- Priority: Critical
- Description: "Account balances become incorrect after many transactions"
- Impact: Critical financial discrepancies

<a id="ticket-perf-407"></a>
### Ticket PERF-407: Performance Degradation
- Reporter: DevOps
- Priority: High
- Description: "System slows down when processing multiple transactions"
- Impact: Poor user experience during peak usage

<a id="ticket-perf-408"></a>
### Ticket PERF-408: Resource Leak
- Reporter: System Monitoring
- Priority: Critical
- Description: "Database connections remain open"
- Impact: System resource exhaustion

