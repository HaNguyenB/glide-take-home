/**
 * Reproduction script for SEC-304: Multiple valid sessions per user, no invalidation
 * 
 * This script demonstrates the bug by:
 * 1. Creating a user
 * 2. Logging in multiple times
 * 3. Showing that all sessions remain valid
 * 4. Demonstrating logout only invalidates one session
 * 
 * Run the script by running: npm run reproduce:session-bug
 */

const Database = require("better-sqlite3");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "..", "bank.db");
const db = new Database(dbPath);

// Helper to create session token (matches auth.ts)
function createSessionToken(userId) {
  return jwt.sign(
    { userId, sessionId: require("crypto").randomUUID() },
    process.env.JWT_SECRET || "temporary-secret-for-interview",
    {
      expiresIn: "7d",
    }
  );
}

async function reproduceBug() {
  console.log("\n=== Reproducing SEC-304: Multiple Sessions Bug ===\n");

  // Step 1: Create a test user
  console.log("Step 1: Creating test user...");
  const email = `test-${Date.now()}@example.com`;
  const password = "password123";
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    db.prepare(`
      INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, ssn, address, city, state, zip_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email,
      hashedPassword,
      "Test",
      "User",
      "+1234567890",
      "1990-01-01",
      "123456789",
      "123 Main St",
      "City",
      "NY",
      "12345"
    );
  } catch (error) {
    console.error("Error creating user:", error.message);
    return;
  }

  const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  console.log(`✓ User created: ${user.email} (ID: ${user.id})\n`);

  // Step 2: Simulate first login (creates session 1)
  console.log("Step 2: First login (simulating login mutation)...");
  const token1 = createSessionToken(user.id);
  const expiresAt1 = new Date();
  expiresAt1.setDate(expiresAt1.getDate() + 7);

  db.prepare(`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, token1, expiresAt1.toISOString());

  let sessions = db.prepare(`
    SELECT id, token, expires_at 
    FROM sessions 
    WHERE user_id = ?
  `).all(user.id);

  console.log(`✓ Sessions after first login: ${sessions.length}`);
  sessions.forEach((s, i) => {
    console.log(`  Session ${i + 1}: ${s.token.substring(0, 30)}... (expires: ${s.expires_at})`);
  });

  // Step 3: Simulate second login (creates session 2 - BUG: should invalidate session 1)
  console.log("\nStep 3: Second login (BUG: creates new session without invalidating old one)...");
  const token2 = createSessionToken(user.id);
  const expiresAt2 = new Date();
  expiresAt2.setDate(expiresAt2.getDate() + 7);

  db.prepare(`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, token2, expiresAt2.toISOString());

  sessions = db.prepare(`
    SELECT id, token, expires_at 
    FROM sessions 
    WHERE user_id = ?
  `).all(user.id);

  console.log(`✗ BUG CONFIRMED: Sessions after second login: ${sessions.length} (should be 1)`);
  sessions.forEach((s, i) => {
    console.log(`  Session ${i + 1}: ${s.token.substring(0, 30)}... (expires: ${s.expires_at})`);
  });

  // Step 4: Simulate third login (creates session 3)
  console.log("\nStep 4: Third login (creates yet another session)...");
  const token3 = createSessionToken(user.id);
  const expiresAt3 = new Date();
  expiresAt3.setDate(expiresAt3.getDate() + 7);

  db.prepare(`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, token3, expiresAt3.toISOString());

  sessions = db.prepare(`
    SELECT id, token, expires_at 
    FROM sessions 
    WHERE user_id = ?
  `).all(user.id);

  console.log(`✗ BUG CONFIRMED: Sessions after third login: ${sessions.length} (should be 1)`);
  sessions.forEach((s, i) => {
    console.log(`  Session ${i + 1}: ${s.token.substring(0, 30)}...`);
  });

  // Step 5: Verify all tokens are still valid
  console.log("\nStep 5: Verifying all tokens are still valid...");
  const JWT_SECRET = process.env.JWT_SECRET || "temporary-secret-for-interview";
  
  sessions.forEach((session, i) => {
    try {
      const decoded = jwt.verify(session.token, JWT_SECRET);
      const isExpired = new Date(session.expires_at) < new Date();
      console.log(`  Session ${i + 1}: ${isExpired ? "EXPIRED" : "VALID"} (user: ${decoded.userId})`);
    } catch (error) {
      console.log(`  Session ${i + 1}: INVALID (${error.message})`);
    }
  });

  // Step 6: Simulate logout (only deletes one session)
  console.log("\nStep 6: Simulating logout (BUG: only deletes current session token)...");
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token3);

  sessions = db.prepare(`
    SELECT id, token, expires_at 
    FROM sessions 
    WHERE user_id = ?
  `).all(user.id);

  console.log(`✗ BUG CONFIRMED: Sessions after logout: ${sessions.length} (should be 0)`);
  console.log(`  Remaining sessions: ${sessions.length}`);
  sessions.forEach((s, i) => {
    console.log(`  Session ${i + 1}: ${s.token.substring(0, 30)}... (STILL ACTIVE!)`);
  });

  // Summary
  console.log("\n=== Bug Summary ===");
  console.log("✓ Multiple sessions can exist per user");
  console.log("✓ Login does not invalidate existing sessions");
  console.log("✓ Logout only invalidates the current session token");
  console.log("✓ Other sessions remain valid after logout");
  console.log("\n=== Security Impact ===");
  console.log("• Compromised session tokens remain valid");
  console.log("• Users cannot force logout from all devices");
  console.log("• No way to invalidate all sessions at once");

  // Cleanup
  console.log("\nCleaning up test data...");
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  console.log("✓ Cleanup complete\n");
}

// Run the reproduction
reproduceBug()
  .then(() => {
    db.close();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    db.close();
    process.exit(1);
  });

