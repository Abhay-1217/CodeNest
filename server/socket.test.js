
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { io: createClient } = require("socket.io-client");

const TEST_SECRET =
  "test-only-secret-that-is-at-least-32-characters-long";

process.env.JWT_SECRET = TEST_SECRET;

const pool = require("./db");
const { server } = require("./server");

const ROOM_ID = "123e4567-e89b-42d3-a456-426614174000";

const connectedSockets = new Set();

let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of connectedSockets) {
    socket.disconnect();
  }

  connectedSockets.clear();

  if (server.listening) {
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

function connectSocket(url, auth = {}) {
  const socket = createClient(url, {
    auth,
    forceNew: true,
    reconnection: false,
    timeout: 5000,
  });

  return new Promise((resolve, reject) => {
    socket.once("connect", () => {
      connectedSockets.add(socket);
      resolve(socket);
    });

    socket.once("connect_error", (error) => {
      socket.close();
      reject(error);
    });
  });
}

function mockRoomAccess(t, allowedUserId) {
  t.mock.method(pool, "query", async (sql, params) => {
    if (
      typeof sql === "string" &&
      sql.includes("FROM rooms r")
    ) {
      return {
        rows:
          String(params[1]) === String(allowedUserId)
            ? [{ "?column?": 1 }]
            : [],
      };
    }

    return { rows: [] };
  });
}

// 1. Reject connections without a JWT.

test("Socket.IO rejects connections without authentication", async () => {
  await assert.rejects(
    connectSocket(baseUrl),
    /Authentication required/
  );
});

// 2. Reject connections with an invalid JWT.

test("Socket.IO rejects connections with an invalid JWT", async () => {
  await assert.rejects(
    connectSocket(baseUrl, {
      token: "invalid-token",
    }),
    /Authentication required/
  );
});

// 3. Allow connections with a valid JWT.

test("Socket.IO allows authenticated users", async () => {
  const socket = await connectSocket(baseUrl, {
    token: createToken(100),
  });

  assert.equal(socket.connected, true);

  socket.disconnect();
  connectedSockets.delete(socket);
});

// 4. Allow room owners and invited members into Yjs rooms.

test("Yjs allows the room owner to connect", async (t) => {
  mockRoomAccess(t, 100);

  const socket = await connectSocket(
    `${baseUrl}/yjs|${ROOM_ID}`,
    { token: createToken(100) }
  );

  assert.equal(socket.connected, true);

  socket.disconnect();
  connectedSockets.delete(socket);
});

test("Yjs allows an invited room member to connect", async (t) => {
  mockRoomAccess(t, 200);

  const socket = await connectSocket(
    `${baseUrl}/yjs|${ROOM_ID}`,
    { token: createToken(200) }
  );

  assert.equal(socket.connected, true);

  socket.disconnect();
  connectedSockets.delete(socket);
});

// 5. Reject users who are not room members.

test("Yjs rejects users who are not authorized for the room", async (t) => {
  mockRoomAccess(t, 100);

  await assert.rejects(
    connectSocket(
      `${baseUrl}/yjs|${ROOM_ID}`,
      { token: createToken(300) }
    ),
    /not authorized to access this room/
  );
});

function waitForEvent(socket, eventName, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeout);

    function onEvent(data) {
      clearTimeout(timer);
      resolve(data);
    }

    socket.once(eventName, onEvent);
  });
}

function disconnectSocket(socket) {
  socket.disconnect();
  connectedSockets.delete(socket);
}

// 7. Room owner can join a collaboration room.

test("Socket.IO allows the room owner to join a room", async (t) => {
  mockRoomAccess(t, 100);

  const socket = await connectSocket(baseUrl, {
    token: createToken(100),
  });

  const joinedEvent = waitForEvent(socket, "joined");

  socket.emit("join", { roomId: ROOM_ID });

  const result = await joinedEvent;

  assert.equal(result.username, "user100");
  assert.equal(result.clients.length, 1);

  disconnectSocket(socket);
});

// 8. Invited member can join a collaboration room.

test("Socket.IO allows an invited member to join a room", async (t) => {
  mockRoomAccess(t, 200);

  const socket = await connectSocket(baseUrl, {
    token: createToken(200),
  });

  const joinedEvent = waitForEvent(socket, "joined");

  socket.emit("join", { roomId: ROOM_ID });

  const result = await joinedEvent;

  assert.equal(result.username, "user200");
  assert.equal(result.clients.length, 1);

  disconnectSocket(socket);
});

// 9. Uninvited user cannot join a collaboration room.

test("Socket.IO rejects an uninvited user from joining a room", async (t) => {
  mockRoomAccess(t, 100);

  const socket = await connectSocket(baseUrl, {
    token: createToken(300),
  });

  const errorEvent = waitForEvent(socket, "room:error");

  socket.emit("join", { roomId: ROOM_ID });

  const result = await errorEvent;

  assert.equal(
    result.message,
    "You are not authorized to access this room."
  );

  disconnectSocket(socket);
});

// 10. Invalid room IDs cannot be joined.

test("Socket.IO rejects invalid room IDs", async () => {
  const socket = await connectSocket(baseUrl, {
    token: createToken(100),
  });

  let joined = false;
  socket.on("joined", () => {
    joined = true;
  });

  socket.emit("join", { roomId: "invalid-room-id" });

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(joined, false);

  disconnectSocket(socket);
});

// 11. A user who has not joined cannot broadcast room events.

test("Socket.IO blocks reliability events from users outside the room", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    if (typeof sql === "string" && sql.includes("FROM rooms r")) {
      return {
        rows:
          String(params[1]) === "100"
            ? [{ "?column?": 1 }]
            : [],
      };
    }

    return { rows: [] };
  });

  // Authorized user joins the room.
  const ownerSocket = await connectSocket(baseUrl, {
    token: createToken(100),
  });

  const joinedEvent = waitForEvent(ownerSocket, "joined");

  ownerSocket.emit("join", { roomId: ROOM_ID });

  await joinedEvent;

  // Uninvited user connects but does not join the room.
  const outsiderSocket = await connectSocket(baseUrl, {
    token: createToken(300),
  });

  const receivedEvent = waitForEvent(
    ownerSocket,
    "reliability-test-result",
    300
  );

  outsiderSocket.emit("reliability-test-result", {
    roomId: ROOM_ID,
    result: { status: "unauthorized" },
  });

  await assert.rejects(receivedEvent, /Timed out/);

  disconnectSocket(ownerSocket);
  disconnectSocket(outsiderSocket);
});
