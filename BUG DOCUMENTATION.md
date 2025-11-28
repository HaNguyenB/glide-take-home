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
- Summary: Encrypt SSNs at rest and enforce masked displays.
- Tickets: [SEC-301](#ticket-sec-301)
  - Root causes:
    - SSNs are stored in plaintext (no encryption/hashing)
    - SSNs are included in API responses
    - SSNs are accessible via the application context
    - No SSN-specific encryption mechanism is applied (passwords use bcrypt, SSNs did not)

### PR 2 – XSS Mitigation
- Summary: Escape transaction descriptions and audit rendering paths for XSS.
- Tickets: [SEC-303](#ticket-sec-303)

### PR 3 – Session Controls
- Summary: Enforce single active session and invalidate near-expiring sessions.
- Tickets: [SEC-304](#ticket-sec-304), [PERF-403](#ticket-perf-403)

### PR 4 – Resource Leak Fix
- Summary: Close lingering DB connections and add monitoring alerts.
- Tickets: [PERF-408](#ticket-perf-408)

### PR 5 – Account Creation Error
- Summary: Prevent incorrect default balances when account creation DB writes fail.
- Tickets: [PERF-401](#ticket-perf-401)

### PR 6 – Funding & Transaction Accuracy
- Summary: Stabilize balances, ensure every funding event persists, and make transaction ordering deterministic.
- Tickets: [PERF-406](#ticket-perf-406), [PERF-405](#ticket-perf-405), [PERF-404](#ticket-perf-404)

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

<a id="ticket-sec-304"></a>
### Ticket SEC-304: Session Management
- Reporter: DevOps Team
- Priority: High
- Description: "Multiple valid sessions per user, no invalidation"
- Impact: Security risk from unauthorized access

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

