const axios = require("axios");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

// Test-only JWT secret
const TEST_SECRET =
  "test-only-secret-that-is-at-least-32-characters-long";

process.env.JWT_SECRET = TEST_SECRET;

const pool = require("./db");
const { app } = require("./server");

const ROOM_ID = "123e4567-e89b-42d3-a456-426614174000";

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  await pool.end();
});

function createToken(userId) {
  return jwt.sign(
    {
      sub: String(userId),
      username: `user${userId}`,
    },
    TEST_SECRET,
    {
      expiresIn: "1h",
      issuer: "codecollab",
    }
  );
}

async function inviteUser(roomId, email, userId, token = true) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${createToken(userId)}`;
  }

  return fetch(`${baseUrl}/rooms/${roomId}/invite`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
}

// 1. Room owner successfully invites a registered user

test("Room owner can invite a registered user", async (t) => {
  const queryMock = t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("SELECT id FROM rooms")) {
      return { rows: [{ id: ROOM_ID }] };
    }

    if (sql.includes("SELECT id, username, email FROM users")) {
      return {
        rows: [{
          id: 2,
          username: "ramu",
          email: "ramu@example.com",
        }],
      };
    }

    if (sql.includes("INSERT INTO room_members")) {
      return {
        rows: [{ room_id: ROOM_ID, user_id: 2 }],
      };
    }

    throw new Error("Unexpected database query");
  });

  const response = await inviteUser(
    ROOM_ID,
    "RAMU@EXAMPLE.COM",
    1
  );

  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.message, "ramu has been invited successfully.");
  assert.equal(data.member.email, "ramu@example.com");
  assert.equal(queryMock.mock.calls.length, 3);
});

// 2. Non-owner cannot invite users

test("Non-owner cannot invite users", async (t) => {
  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  const response = await inviteUser(
    ROOM_ID,
    "ramu@example.com",
    2
  );

  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(
    data.message,
    "Only the room owner can invite users."
  );
  assert.equal(queryMock.mock.calls.length, 1);
});

// 3. Unregistered email is rejected

test("Invitation to an unregistered email returns 404", async (t) => {
  const queryMock = t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("SELECT id FROM rooms")) {
      return { rows: [{ id: ROOM_ID }] };
    }

    if (sql.includes("SELECT id, username, email FROM users")) {
      return { rows: [] };
    }

    throw new Error("Unexpected database query");
  });

  const response = await inviteUser(
    ROOM_ID,
    "unknown@example.com",
    3
  );

  const data = await response.json();

  assert.equal(response.status, 404);
  assert.equal(
    data.message,
    "No registered user found with this email."
  );
  assert.equal(queryMock.mock.calls.length, 2);
});

// 4. Duplicate invitation is rejected

test("Duplicate invitation returns 409", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("SELECT id FROM rooms")) {
      return { rows: [{ id: ROOM_ID }] };
    }

    if (sql.includes("SELECT id, username, email FROM users")) {
      return {
        rows: [{
          id: 4,
          username: "ramu",
          email: "ramu@example.com",
        }],
      };
    }

    if (sql.includes("INSERT INTO room_members")) {
      return { rows: [] };
    }

    throw new Error("Unexpected database query");
  });

  const response = await inviteUser(
    ROOM_ID,
    "ramu@example.com",
    1
  );

  const data = await response.json();

  assert.equal(response.status, 409);
  assert.equal(
    data.message,
    "This user is already a room member."
  );
});

// 5. Invalid room ID is rejected

test("Invalid room ID returns 400", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  const response = await inviteUser(
    "invalid-room-id",
    "ramu@example.com",
    5
  );

  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Invalid room ID.");
  assert.equal(queryMock.mock.calls.length, 0);
});

// 6. Missing email is rejected

test("Missing email returns 400", async (t) => {
  const queryMock = t.mock.method(pool, "query");

  const response = await inviteUser(
    ROOM_ID,
    "",
    6
  );

  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.message, "Email is required.");
  assert.equal(queryMock.mock.calls.length, 0);
});

// 7. Missing authentication is rejected

test("Unauthenticated invitation returns 401", async () => {
  const response = await inviteUser(
    ROOM_ID,
    "ramu@example.com",
    7,
    false
  );

  const data = await response.json();

  assert.equal(response.status, 401);
  assert.equal(data.message, "Authentication required.");
});



const RUN_URL = "/run";

const SAMPLE_CODE = "console.log('Hello CodeCollab');";

const MOCK_JUDGE0_RESPONSE = {
  data: {
    stdout: "Hello CodeCollab\n",
    stderr: null,
    status: {
      id: 3,
      description: "Accepted",
    },
    time: "0.01",
    memory: 1000,
  },
};

async function runCode(roomId, userId) {
  return fetch(`${baseUrl}${RUN_URL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${createToken(userId)}`,
    },
    body: JSON.stringify({
      code: SAMPLE_CODE,
      language: "javascript",
      roomId,
    }),
  });
}

// 1. Room owner can execute code

test("Room owner can execute code in their room", async (t) => {
  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [{ "?column?": 1 }],
  }));

  const axiosMock = t.mock.method(
    axios,
    "post",
    async () => MOCK_JUDGE0_RESPONSE
  );

  const response = await runCode(ROOM_ID, 1);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.stdout, "Hello CodeCollab\n");
  assert.equal(data.exitCode, 0);

  assert.equal(queryMock.mock.calls.length, 1);
  assert.equal(axiosMock.mock.calls.length, 1);
});

// 2. Invited member can execute code

test("Invited room member can execute code", async (t) => {
  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [{ "?column?": 1 }],
  }));

  const axiosMock = t.mock.method(
    axios,
    "post",
    async () => MOCK_JUDGE0_RESPONSE
  );

  const response = await runCode(ROOM_ID, 2);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.exitCode, 0);

  const sql = queryMock.mock.calls[0].arguments[0];

  assert.match(sql, /room_members/);
  assert.match(sql, /owner_id/);
  assert.equal(axiosMock.mock.calls.length, 1);
});

// 3. Uninvited user cannot execute code

test("Uninvited user cannot execute code", async (t) => {
  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  const axiosMock = t.mock.method(axios, "post");

  const response = await runCode(ROOM_ID, 3);
  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(
    data.message,
    "You are not authorized to execute code in this room."
  );

  assert.equal(queryMock.mock.calls.length, 1);
  assert.equal(axiosMock.mock.calls.length, 0);
});

// 4. User cannot execute code in a nonexistent room

test("User cannot execute code in a nonexistent room", async (t) => {
  const queryMock = t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  const axiosMock = t.mock.method(axios, "post");

  const response = await runCode(ROOM_ID, 4);
  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(
    data.message,
    "You are not authorized to execute code in this room."
  );

  assert.equal(queryMock.mock.calls.length, 1);
  assert.equal(axiosMock.mock.calls.length, 0);
});

// 5. Invalid room ID is rejected

test("Invalid room ID cannot be used to execute code", async (t) => {
  const queryMock = t.mock.method(pool, "query");
  const axiosMock = t.mock.method(axios, "post");

  const response = await runCode("invalid-room-id", 5);
  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(
    data.message,
    "You are not authorized to execute code in this room."
  );

  assert.equal(queryMock.mock.calls.length, 0);
  assert.equal(axiosMock.mock.calls.length, 0);
});


// RATE LIMITING TESTS

// 1. Registration rate limit: 5 requests per hour

test("Registration blocks requests after 5 attempts", async () => {
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
  }

  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const data = await response.json();

  assert.equal(response.status, 429);
  assert.match(data.message, /Too many registration attempts/);
});

// 2. Login rate limit: 5 requests per 15 minutes

test("Login blocks requests after 5 attempts", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "wrongpassword",
      }),
    });

    assert.equal(response.status, 401);
  }

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test@example.com",
      password: "wrongpassword",
    }),
  });

  const data = await response.json();

  assert.equal(response.status, 429);
  assert.match(data.message, /Too many login attempts/);
});

// 3. Invitation rate limit: 10 requests per 15 minutes per user

test("Room invitations block requests after 10 attempts", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  for (let i = 0; i < 10; i++) {
    const response = await inviteUser(
      ROOM_ID,
      "ramu@example.com",
      100
    );

    assert.equal(response.status, 403);
  }

  const response = await inviteUser(
    ROOM_ID,
    "ramu@example.com",
    100
  );

  const data = await response.json();

  assert.equal(response.status, 429);
  assert.match(data.message, /Too many invitations/);
});

// 4. Code execution rate limit: 10 requests per minute per IP
// The five earlier execution tests have already used five requests.

test("Code execution blocks requests after 10 attempts", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [],
  }));

  for (let i = 0; i < 5; i++) {
    const response = await runCode(ROOM_ID, 200);

    assert.equal(response.status, 403);
  }

  const response = await runCode(ROOM_ID, 200);
  const data = await response.json();

  assert.equal(response.status, 429);
  assert.match(data.message, /Too many code execution requests/);
});

test("API rejects oversized JSON request bodies", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: "a".repeat(60000),
      email: "test@example.com",
      password: "password123",
    }),
  });

  assert.equal(response.status, 413);
});

test("API rejects malformed JSON request bodies", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: '{"username":',
  });

  assert.equal(response.status, 400);
});
