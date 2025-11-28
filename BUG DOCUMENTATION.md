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
  - **Ticket PERF-405 – Missing Transactions**
    - Root cause:
      - After funding an account, the app never invalidated or refetched the `account.getTransactions` query, so `TransactionList` kept showing a stale cache.
      - `FundingModal`’s success handler only closed the modal and refreshed account balances; it never told tRPC to refresh the transaction history.
    - How it was fixed:
      - Updated `DashboardPage` so a successful funding now also triggers `utils.account.getTransactions.invalidate(...)` for the funded account.
      - This forces the transaction list to refetch and include the new deposit(s) without a full page reload.
    - Tests:
      - Added a regression test in `components/TransactionList.test.tsx` that renders the dashboard and asserts we call `utils.account.getTransactions.invalidate(...)` when funding completes.
      - The test failed before the fix and now passes, protecting against future cache-related regressions.
    - Preventive measures:
      - Always refresh or invalidate the transaction list after funding.
      - Keep the regression test that checks this refresh happens so future changes can’t regress silently.

  - **Ticket PERF-404 – Transaction Sorting**
    - Root cause:
      - `accountRouter.getTransactions` ran without an `ORDER BY`, so SQLite returned rows in whatever order was convenient.
    - How it was fixed:
      - Added `.orderBy(desc(transactions.createdAt))` so the API always returns newest-first.
    - Tests:
      - Added a property-based test in `server/routers/account.test.ts` (PERF-404) that asserts results are sorted newest-first.
    - Preventive measures:
      - Make it standard that any endpoint returning lists must specify an explicit sort that matches UX expectations; never rely on the database’s default ordering.


### PR 7 – Account Validation Bug
- Summary: Tighten email, DOB, state, phone, and password rules during account setup.
- Tickets: [VAL-201](#ticket-val-201), [VAL-202](#ticket-val-202), [VAL-203](#ticket-val-203), [VAL-204](#ticket-val-204), [VAL-208](#ticket-val-208)
  - **Ticket VAL-201 – Email Validation Problems**
    - Root causes:
      - The signup schema lowercased email addresses silently and relied mostly on generic RFC-style validation.
      - Users were never told their email had been normalized, and obvious typo domains like `.con` passed through.
    - How it was fixed:
      - Introduced a shared `lib/validation/signup.ts` schema so client and server both use the same email rules.
      - Added `validator.js` syntax checks plus a lightweight `tlds` lookup so TLDs must be real (e.g., `.con` now fails).
      - Added `auth.validateEmail`, which normalizes the email, returns any notices (like casing changes), and blocks duplicates early.
    - Preventive measures:
      - Keep email validation logic centralized and unit-tested before changing auth or signup flows.
      - Clearly document normalization behavior (e.g., lowercasing) so it’s an intentional part of the API contract, not a surprise.
      - Watch metrics on rejected domains to quickly add new common typos to the validation strategy.
    - Trade-offs:
      - New dependencies (`validator`, `tlds`, and a small type stub) slightly increase bundle size and need occasional updates.
      - We still only check syntax + TLD, not mailbox deliverability; future work may add DNS or API-based checks if needed.
  - **Ticket VAL-202 – Date of Birth Validation**
    - Root causes:
      - The signup form accepted any text for `dateOfBirth` without checking if it was a real date or that the user was at least 18.
      - Problems only surfaced at the very end of the flow as vague backend errors, even for future dates or obvious underage users.
    - How it was fixed:
      - Added a shared `parseAdultDob` validator that uses the Temporal polyfill to safely parse ISO dates, calculate age, and return clear errors.
      - Updated the signup schema so `dateOfBirth` is always run through this validator, guaranteeing a clean ISO date and rejecting underage users consistently.
      - Wired the same validator into the Next.js form via React Hook Form rules, so users now see inline feedback like “You must be at least 18 years old to create an account” on the DOB step.
    - Preventive measures:
      - Keep complex rules such as age checks in shared validation modules used by both frontend and backend.
      - Add focused tests for each rule before changing any signup or business logic that depends on it.
      - Use robust date libraries (Temporal/date-fns) instead of hand-rolled age math.
  - **Ticket VAL-203 – State Code Validation**
    - Root causes:
      - The system only verified that `state` was two characters long.
      - Any two-character string such as `"XX"` or `"@@"` was accepted, even if it wasn’t a real USPS state code.
    - How it was fixed:
      - Introduced a shared `USPS_STATE_CODES` list with all valid two-letter abbreviations.
      - Updated the Zod schema and signup form to require that `state` exists in this list.
      - Invalid entries now immediately show an “Invalid state code” message in the form.
    - Preventive measures:
      - Prefer explicit allow-lists for constrained fields (states, countries, etc.) instead of loose length checks.
      - Reuse the same allow-list in both frontend and backend validation to keep behavior consistent.
  - **Ticket VAL-204 – Phone Number Format**
    - Root causes:
      - Phone validation was a simple regex that only checked for 10–15 digits with an optional leading `+`.
      - It didn’t enforce E.164 formatting, a valid country code, or require `+` for international numbers, so many bogus “international” numbers slipped through.
    - How it was fixed:
      - Added a shared `phoneSchema` that enforces true E.164 format: a `+`, a country code, and 9–14 digits.
      - Hooked this schema into both the signup backend and the React Hook Form rules so the same rule runs everywhere.
      - The form now shows a clear hint like “Use E.164 format (e.g., +14155551234)” when users enter invalid numbers.
    - Preventive measures:
      - Keep phone rules centralized in the shared validation module so client and server can’t drift.
      - Prefer well-known standards (like E.164) over custom, one-off regexes.
  - **Ticket VAL-208 – Weak Password Requirements**
    - Root causes:
      - Password validation only checked length, so weak strings like `password123` still passed.
      - There were no checks for character variety, making passwords easier to guess or brute-force.
    - How it was fixed:
      - Added a shared password schema that requires at least 8 characters plus one lowercase, one uppercase, one digit, and one symbol.
      - Hooked that schema into the signup form so users see the same requirements live as they type.
      - The form now gives instant feedback when a required character type is missing, instead of failing only at submit time.
    - Preventive measures:
      - Keep password rules centralized and reuse them anywhere credentials are created or changed.
      - Prefer standards-aligned complexity rules and update them as security guidance evolves.

### PR 8 – Transaction & Funding Validation
- Summary: Strengthen card, routing, zero-amount, amount-format, and card-type validations.
- Tickets: [VAL-206](#ticket-val-206), [VAL-207](#ticket-val-207), [VAL-210](#ticket-val-210), [VAL-205](#ticket-val-205), [VAL-209](#ticket-val-209)
  - **Ticket VAL-205 – Zero Amount Funding**
    - Root cause:
      - The funding form treated `0.00` as valid because the `min` validator was set to `0.0`, so users could submit $0 deposits that wasted backend resources.
    - How it was fixed:
      - Updated the form schema so the minimum amount is now `0.01`, matching the copy and backend expectations; zero-dollar requests never hit the API.
      - The backend double-checks the amount in cents to ensure nothing below one cent is persisted.
    - Preventive measures:
      - Keep validation limits (like minimum amounts) defined in a single shared schema so the UI and API never drift.
      - Add regression tests that explicitly try to submit zero or negative amounts to guarantee they’re rejected.
  - **Ticket VAL-206 – Card Number Validation**
    - Root causes:
      - The backend trusted whatever card number the UI sent, so any 16-digit string could fund an account—even if it failed Luhn or didn’t match a real brand.
    - How it was fixed:
      - Added `validateCardNumber` (built on `card-validator`) and called it inside `accountRouter.fundAccount` before any DB writes; requests that fail brand-specific length/Luhn checks are rejected immediately.
    - Tests:
      - Property-based tests cover invalid-length and invalid-Luhn scenarios to keep the validator honest.
    - Preventive measures:
      - Keep card validation logic centralized so new brands/prefixes only need to be added once.
      - Rely on well-maintained libraries (like `card-validator`) instead of custom, ad-hoc regexes.
  - **Ticket VAL-207 – Routing Number Optional**
    - Root causes:
      - `fundAccount` accepted a `fundingSource` object where `routingNumber` was optional, so bank transfers could be submitted without routing info.
      - `FundingModal` always sent the same payload regardless of funding type, so TypeScript couldn’t help enforce routing numbers for bank transfers.
    - How it was fixed:
      - Updated `FundingModal` to branch on `fundingType` and show an inline error if you try to submit a bank transfer without a routing number; the payloads are now distinct for card vs. bank sources.
      - Switched `accountRouter.fundAccount` to a Zod discriminated union where the “bank” variant requires `routingNumber` to be a 9-digit string; UI bypass attempts now fail validation server-side.
    - Preventive measures:
      - Prefer discriminated unions for multi-source inputs so each variant can enforce its own required fields.
      - Keep frontend and backend schemas in sync so optional vs. required fields don’t drift.
  - **Ticket VAL-210 – Card Type Detection**
    - Root causes:
      - The frontend only allowed Visa/Mastercard prefixes via a simple `startsWith` check.
      - Valid brands like AmEx and Discover were blocked, while some invalid numbers could still pass.
    - How it was fixed:
      - Updated `FundingModal` to import and use the shared card helper, so brand detection and validation now come from the same source as the backend.
      - The UI now surfaces the helper’s brand-aware error messages immediately when a number doesn’t match a supported card type.
    - Preventive measures:
      - Keep brand and prefix logic centralized in one helper so new brands or rule changes only need to be updated once.
      - Avoid duplicating card-type rules in the UI; always call into the shared validator instead.
  - **Ticket VAL-209 – Amount Input Issues**
    - Root cause:
      - The amount field’s regex (`^\d+\.?\d{0,2}$`) allowed values with multiple leading zeros (e.g., `00045.67`), so malformed amounts still made it to the backend.
      - The server lacked equivalent validation, so whatever the UI sent was treated as a valid deposit.
    - How it was fixed:
      - Tightened the amount regex to `^(?:0|[1-9]\d*)?(?:\.\d{1,2})?$`, which rejects numbers with multiple leading zeros while still allowing `0.xx` and standard whole-dollar values.
      - The form now blocks malformed inputs before submission, keeping the data clean without relying solely on server logic.
    - Technical debt:
      - Validation rules (regex, min/max) still live only in the frontend; the backend trusts the client. Any gaps in UI validation can still become production bugs.
    - Preventive measures:
      - Mirror amount validation on the backend so every request is re-validated server-side.
      - Move shared rules (regex, min/max) into a common schema to avoid drift between UI and API.

### PR 9 – Insecure Random Numbers
- Summary: Replace `Math.random()` account number generation with a cryptographically secure approach.
- Tickets: [SEC-302](#ticket-sec-302)
  - Root cause:
    - `generateAccountNumber` used `Math.random()` to build 10-digit account numbers, making them predictable.
  - How it was fixed:
    - Switched `generateAccountNumber` to use Node’s `crypto.randomInt`, which is cryptographically secure, before padding to 10 digits.
  - Preventive measures:
    - Always use cryptographically secure APIs (`crypto.randomInt`, `crypto.randomBytes`, Web Crypto, etc.) for any identifier, token, or secret that has security implications (accounts, session IDs, reset tokens).

### Direct-to-Main Fixes (No PR)
- Summary: Hotfixes applied directly to main for UI and performance regressions.
- Tickets: [UI-101](#ticket-ui-101), [PERF-407](#ticket-perf-407)
  - **Ticket UI-101 – Dark Mode Text Visibility**
    - Root cause:
      - The app relied on browser/system defaults for form controls and did not include any dark-mode-safe styling.
      - In system dark mode, the browser rendered input text as white while the input background could still be white, making typed text invisible.
    - (Hot) Fix:
      - Inputs now always render with dark text on a white background, even when the OS/browser is in dark mode, so the user can see what they’re typing.
    - Technical debt:
      - There is still no full theming system for the application; future work should introduce a proper light/dark theme instead of hard-coding light styles.
  - **Ticket PERF-407 – Performance Degradation**
    - Root cause:
      - An early attempt to “enrich” each transaction fetched account details inside a loop, creating an N+1 query pattern under load.
      - As the number of transactions grew, this per-transaction account lookup made the history endpoint noticeably slower.
    - Fix:
      - Simplified `getTransactions` to fetch the account once, fetch all transactions once, and then attach the already-known `accountType` in memory.
      - This keeps the work to a constant number of queries per request, even when there are many transactions.
    - Preventive measures:
      - Watch for N+1 query patterns when joining related data; prefer “fetch once + in-memory mapping” over per-row queries.
      - Add performance tests or query-count assertions around high-volume endpoints so accidental N+1 changes are caught early.

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
- Steps to Reproduce:
  1. Fund the same account multiple times within a single session.
  2. Observe that the account balance updates immediately.
  3. Notice that the transaction history does **not** show the new transactions until the page is manually reloaded.


<a id="ticket-perf-406"></a>
### Ticket PERF-406: Balance Calculation
- Reporter: Finance Team
- Priority: Critical
- Description: "Account balances become incorrect after many transactions"
- Impact: Critical financial discrepancies
- How to reproduce:
  - Run the script below to perform many small deposits on a single account and compare the expected vs. actual balance.
- Repro script (click to expand):

<details>
  <summary>View PERF-406 repro script</summary>

```ts
import { accountRouter } from "../server/routers/account";
import { createAuthenticatedContext } from "../server/test-utils";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const ctx = await createAuthenticatedContext();
  const caller = accountRouter.createCaller(ctx);

  const account = await caller.createAccount({ accountType: "checking" });

  const depositAmount = 0.1;
  const iterations = 2000;

  for (let i = 0; i < iterations; i++) {
    await caller.fundAccount({
      accountId: account.id,
      amount: depositAmount,
      fundingSource: { type: "card", accountNumber: "4111111111111111" },
    });
  }

  const dbRecord = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();

  const expected = Number((iterations * depositAmount).toFixed(2));

  console.log({
    iterations,
    depositAmount,
    expectedBalance: expected,
    actualBalance: dbRecord?.balance,
    difference: dbRecord ? dbRecord.balance - expected : null,
  });
}

main();
```

</details>

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

