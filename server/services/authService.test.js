const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Use a test-only secret. Never use your real production secret here.
const TEST_SECRET = "test-only-secret-that-is-at-least-32-characters-long";

process.env.JWT_SECRET = TEST_SECRET;

const pool = require("../db");
const { registerUser, loginUser } = require("./authService");

after(async () => {
  await pool.end();
});

// Registration tests

test("registerUser: registers a user and hashes the password", async (t) => {
  const fakeUser = {
    id: 1,
    username: "test_user",
    email: "test@example.com",
    created_at: new Date(),
  };

  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [fakeUser],
  }));

  const result = await registerUser({
    username: "  test_user  ",
    email: " TEST@EXAMPLE.COM ",
    password: "password123",
  });

  assert.deepEqual(result, fakeUser);
  assert.equal(queryMock.mock.calls.length, 1);

  const queryArgs = queryMock.mock.calls[0].arguments[1];

  assert.equal(queryArgs[0], "test_user");
  assert.equal(queryArgs[1], "test@example.com");
  assert.notEqual(queryArgs[2], "password123");
  assert.equal(await bcrypt.compare("password123", queryArgs[2]), true);
});

test("registerUser: rejects an invalid username", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  await assert.rejects(
    registerUser({
      username: "ab",
      email: "test@example.com",
      password: "password123",
    }),
    /Username must be 3-30 characters/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});

test("registerUser: rejects an invalid email", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  await assert.rejects(
    registerUser({
      username: "test_user",
      email: "invalid-email",
      password: "password123",
    }),
    /Please provide a valid email address/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});

test("registerUser: rejects a short password", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  await assert.rejects(
    registerUser({
      username: "test_user",
      email: "test@example.com",
      password: "short",
    }),
    /Password must be between 8 and 72 characters/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});

test("registerUser: handles duplicate username or email", async (t) => {
  t.mock.method(pool, "query", async () => {
    const error = new Error("Duplicate key");
    error.code = "23505";
    throw error;
  });

  await assert.rejects(
    registerUser({
      username: "test_user",
      email: "test@example.com",
      password: "password123",
    }),
    /Username or email is already registered/,
  );
});

// Login tests

test("loginUser: logs in successfully and returns a valid JWT", async (t) => {
  const passwordHash = await bcrypt.hash("password123", 10);

  const fakeUser = {
    id: 1,
    username: "test_user",
    email: "test@example.com",
    password_hash: passwordHash,
  };

  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [fakeUser],
  }));

  const result = await loginUser({
    email: " TEST@EXAMPLE.COM ",
    password: "password123",
  });

  assert.ok(result.token);
  assert.deepEqual(result.user, {
    id: 1,
    username: "test_user",
    email: "test@example.com",
  });

  const queryArgs = queryMock.mock.calls[0].arguments[1];
  assert.equal(queryArgs[0], "test@example.com");

  const decoded = jwt.verify(result.token, TEST_SECRET, {
    issuer: "codecollab",
  });

  assert.equal(decoded.sub, "1");
  assert.equal(decoded.username, "test_user");
});

test("loginUser: rejects an incorrect password", async (t) => {
  const passwordHash = await bcrypt.hash("correct-password", 10);

  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 1,
        username: "test_user",
        email: "test@example.com",
        password_hash: passwordHash,
      },
    ],
  }));

  await assert.rejects(
    loginUser({
      email: "test@example.com",
      password: "wrong-password",
    }),
    /Invalid email or password/,
  );
});

test("loginUser: rejects an email that does not exist", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  await assert.rejects(
    loginUser({
      email: "unknown@example.com",
      password: "password123",
    }),
    /Invalid email or password/,
  );
});

test("loginUser: rejects missing email or password", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  await assert.rejects(
    loginUser({ email: "", password: "password123" }),
    /Invalid email or password/,
  );

  await assert.rejects(
    loginUser({ email: "test@example.com" }),
    /Email and password are required/,
  );

  assert.equal(queryMock.mock.calls.length, 1);
});

test("registerUser: rejects non-string username", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  // Username
  await assert.rejects(
    registerUser({
      username: 12345,
      email: "test@example.com",
      password: "password123",
    }),
    /Username must be 3-30 characters/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});

test("registerUser: rejects non-string email", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  // Email
  await assert.rejects(
    registerUser({
      username: "test_user",
      email: 12345,
      password: "password123",
    }),
    /Please provide a valid email address/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});

test("registerUser: rejects non-string password", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  // Password
  await assert.rejects(
    registerUser({
      username: "test_user",
      email: "test@example.com",
      password: 12345,
    }),
    /Password must be between 8 and 72 characters/,
  );

  assert.equal(queryMock.mock.calls.length, 0);
});
