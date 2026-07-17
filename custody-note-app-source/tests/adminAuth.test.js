/**
 * Tests for main/adminAuth.js
 * Run: npm run test:unit
 */
const fs = require('fs');
const path = require('path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const TEST_DIR = path.join(__dirname, '../.test-tmp-admin');
const mockApp = {
  getPath: () => TEST_DIR,
};

describe('adminAuth', () => {
  let adminAuth;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    adminAuth = require('../main/adminAuth');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    } catch (_) {}
  });

  it('hasAdminPassword returns false when no hash file', () => {
    assert.strictEqual(adminAuth.hasAdminPassword(mockApp), false);
  });

  it('setAdminPassword creates hash with valid token', () => {
    const orig = process.env.ADMIN_SETUP_TOKEN;
    process.env.ADMIN_SETUP_TOKEN = 'a'.repeat(16);
    try {
      const r = adminAuth.setAdminPassword(mockApp, 'password123', 'a'.repeat(16));
      assert.strictEqual(r.ok, true);
      assert.strictEqual(adminAuth.hasAdminPassword(mockApp), true);
    } finally {
      process.env.ADMIN_SETUP_TOKEN = orig;
    }
  });

  it('setAdminPassword rejects invalid token', () => {
    const orig = process.env.ADMIN_SETUP_TOKEN;
    process.env.ADMIN_SETUP_TOKEN = 'valid-token-16chars!!';
    try {
      const r = adminAuth.setAdminPassword(mockApp, 'password123', 'wrong-token');
      assert.strictEqual(r.ok, false);
      assert.ok(r.error.includes('Invalid'));
    } finally {
      process.env.ADMIN_SETUP_TOKEN = orig;
    }
  });

  it('login succeeds with correct password', () => {
    const orig = process.env.ADMIN_SETUP_TOKEN;
    process.env.ADMIN_SETUP_TOKEN = 'x'.repeat(16);
    try {
      adminAuth.setAdminPassword(mockApp, 'mypassword', 'x'.repeat(16));
      const r = adminAuth.login(mockApp, 'mypassword');
      assert.strictEqual(r.ok, true);
      assert.strictEqual(adminAuth.isAdminSession(), true);
    } finally {
      process.env.ADMIN_SETUP_TOKEN = orig;
    }
  });

  it('login fails with wrong password', () => {
    const orig = process.env.ADMIN_SETUP_TOKEN;
    process.env.ADMIN_SETUP_TOKEN = 'y'.repeat(16);
    try {
      adminAuth.setAdminPassword(mockApp, 'mypassword', 'y'.repeat(16));
      const r = adminAuth.login(mockApp, 'wrongpass');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error, 'Invalid password');
    } finally {
      process.env.ADMIN_SETUP_TOKEN = orig;
    }
  });
});
