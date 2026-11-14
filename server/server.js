const { randomUUID } = require("node:crypto");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const http = require("http");
const net = require("node:net");
const cors = require("cors");
const { Server } = require("socket.io");
const { YSocketIO } = require("y-socket.io/dist/server");
const axios = require("axios");
const executeCode = require("./services/executeCode.js");
const pool = require("./db.js");
const { setupYjsPersistence } = require("./services/yjsPersistence.js");
const { runMigrations } = require("./migrate.js");
const authenticateToken = require("./middleware/authMiddleware");
const { registerUser, loginUser } = require("./services/authService");

const allowedOrigins = [
  "https://code-collab-chi-nine.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

const app = express();
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  }),
);
app.use(express.json({ limit: "50kb" }));

// Rate limiter for user registration
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many registration attempts. Please try again after an hour.",
  },
});

// Rate limiter for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

// Rate limiter for room invitations
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `user:${req.user.sub}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many invitations. Please try again after 15 minutes.",
  },
});

// Rate limiter for code execution
const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      "Too many code execution requests. Please try again after a minute.",
  },
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

function getAuthenticatedUser(handshake) {
  const token = handshake.auth?.token;

  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "codecollab",
    });
  } catch (error) {
    return null;
  }
}

const ysocketio = new YSocketIO(io, {
  authenticate: (handshake) => {
    return Boolean(getAuthenticatedUser(handshake));
  },
});

setupYjsPersistence(ysocketio, pool);
ysocketio.initialize();
console.log("[YSocketIO startup]", {
  renderCommit: process.env.RENDER_GIT_COMMIT || "unavailable",
  renderService: process.env.RENDER_SERVICE_NAME || "unavailable",
  workingDirectory: process.cwd(),
  serverEntry: __filename,
  packageEntry: require.resolve("y-socket.io/dist/server"),
  packageVersion: require("y-socket.io/package.json").version,
  constructionSucceeded: true,
  initializeSucceeded: true,
  namespaceRegistered: Boolean(ysocketio.nsp),
  namespacePattern: "/^\\/yjs\\|.*$/",
});

ysocketio.on("document-loaded", (doc) => {
  console.log(`[YSocketIO Server] Document loaded for room: "${doc.name}"`);
});

ysocketio.on("document-update", (doc, update) => {
  console.log(
    `[YSocketIO Server] Document update on room: "${doc.name}" (${update.length} bytes)`,
  );
});

ysocketio.on("all-document-connections-closed", (doc) => {
  console.log(
    `[YSocketIO Server] All connections closed for room: "${doc.name}"`,
  );
});

const yjsNsp = ysocketio.nsp;
// Verify room ownership before allowing Yjs connections
yjsNsp.use(async (socket, next) => {
  try {
    console.log("[Yjs Middleware Reached]", {
      namespace: socket.nsp.name,
      socketId: socket.id,
    });
    const roomId = socket.nsp.name.replace("/yjs|", "");
    const user = getAuthenticatedUser(socket.handshake);

    if (!user) {
      console.log("[Yjs Connection Attempt]", socket.nsp.name);
      return next(new Error("Authentication required."));
    }

    const hasAccess = await canAccessRoom(roomId, user.sub);
    console.log("[Yjs Authorization Check]", {
      username: user.username,
      userId: user.sub,
      roomId,
      hasAccess,
    });

    if (!hasAccess) {
      return next(new Error("You are not authorized to access this room."));
    }

    next();
  } catch (error) {
    console.error("Yjs room authorization error:", error.message);
    next(new Error("Room authorization failed."));
  }
});
yjsNsp.on("connection", (socket) => {
  console.log(
    `[YSocketIO Server] Client ${socket.id} connected to Yjs namespace: ${socket.nsp.name}`,
  );
});

const userSocketMap = {};

const PORT = Number(process.env.PORT) || 5000;

function isPortTaken(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once("error", (error) => {
      if (error.code === "EADDRNOTAVAIL") {
        resolve(false);
        return;
      }

      resolve(true);
    });

    probe.once("listening", () => {
      probe.close(() => resolve(false));
    });

    probe.listen(port, host);
  });
}

async function getAvailablePort(startPort = PORT) {
  let candidatePort = startPort;

  while (true) {
    const ipv4Busy = await isPortTaken(candidatePort, "127.0.0.1");
    if (!ipv4Busy) {
      const ipv6Busy = await isPortTaken(candidatePort, "::1");
      if (!ipv6Busy) {
        return candidatePort;
      }
    }

    candidatePort += 1;
  }
}

async function startServer(port = PORT) {
  if (!process.env.DATABASE_URL) {
    const errorMsg =
      "[Startup] FATAL: DATABASE_URL is not set. Refusing to start without persistence.";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const applied = await runMigrations(pool);
    console.log(
      `[Startup] PostgreSQL connected and migrations verified (newly applied: ${applied.length}).`,
    );
  } catch (err) {
    console.error("[Startup] FATAL: Database migration failed:", err.message);
    throw err;
  }

  const availablePort = await getAvailablePort(port);

  if (availablePort !== port) {
    console.warn(
      `[Server] Port ${port} is busy. Starting on port ${availablePort} instead.`,
    );
  }

  return new Promise((resolve) => {
    server.listen(availablePort, "0.0.0.0", () => {
      console.log(`Server running on port ${availablePort}`);
      resolve(availablePort);
    });
  });
}

app.get("/", (req, res) => {
  res.send("CodeNest Server Running");
});
// Register API
app.post("/auth/register", registerLimiter, async (req, res) => {
  try {
    const user = await registerUser(req.body);

    res.status(201).json({
      message: "Account created successfully.",
      user,
    });
  } catch (error) {
    const status = error.message.includes("already registered") ? 409 : 400;

    res.status(status).json({
      message: error.message,
    });
  }
});

// Login API
app.post("/auth/login", loginLimiter, async (req, res) => {
  try {
    const result = await loginUser(req.body);
    res.json(result);
  } catch (error) {
    res.status(401).json({
      message: error.message,
    });
  }
});
// Get logged-in user profile
app.get("/auth/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, created_at
       FROM users
       WHERE id = $1`,
      [req.user.sub],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error("Profile error:", error.message);

    res.status(500).json({
      message: "Unable to retrieve profile.",
    });
  }
});
// Create a new room
app.post("/rooms", authenticateToken, async (req, res) => {
  try {
    const roomId = randomUUID();
    const ownerId = req.user.sub;

    const result = await pool.query(
      `INSERT INTO rooms (id, name, owner_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, owner_id, created_at`,
      [roomId, "Untitled Room", ownerId],
    );

    res.status(201).json({
      message: "Room created successfully.",
      room: result.rows[0],
    });
  } catch (error) {
    console.error("Room creation error:", error.message);

    res.status(500).json({
      message: "Unable to create room.",
    });
  }
});

app.post(
  "/rooms/:roomId/invite",
  authenticateToken,
  inviteLimiter,
  async (req, res) => {
    try {
      const { roomId } = req.params;
      const { email } = req.body;
      const ownerId = req.user.sub;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (!uuidRegex.test(roomId)) {
        return res.status(400).json({ message: "Invalid room ID." });
      }

      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({ message: "Email is required." });
      }

      const normalizedEmail = email.trim().toLowerCase();

      const room = await pool.query(
        "SELECT id FROM rooms WHERE id = $1 AND owner_id = $2",
        [roomId, ownerId],
      );

      if (room.rows.length === 0) {
        return res.status(403).json({
          message: "Only the room owner can invite users.",
        });
      }

      const invitedUser = await pool.query(
        "SELECT id, username, email FROM users WHERE email = $1",
        [normalizedEmail],
      );

      if (invitedUser.rows.length === 0) {
        return res.status(404).json({
          message: "No registered user found with this email.",
        });
      }

      const user = invitedUser.rows[0];

      if (String(user.id) === String(ownerId)) {
        return res.status(400).json({
          message: "You are already the room owner.",
        });
      }

      const result = await pool.query(
        `INSERT INTO room_members (room_id, user_id, invited_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) DO NOTHING
       RETURNING room_id, user_id`,
        [roomId, user.id, ownerId],
      );

      if (result.rows.length === 0) {
        return res.status(409).json({
          message: "This user is already a room member.",
        });
      }

      return res.status(201).json({
        message: `${user.username} has been invited successfully.`,
        member: { username: user.username, email: user.email },
      });
    } catch (error) {
      console.error("Room invitation error:", error.message);
      res.status(500).json({ message: "Unable to invite user." });
    }
  },
);

async function canAccessRoom(roomId, userId) {
  try {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(roomId)) {
      return false;
    }

    const result = await pool.query(
      `SELECT 1
       FROM rooms r
       WHERE r.id = $1
       AND (
         r.owner_id = $2
         OR EXISTS (
           SELECT 1
           FROM room_members rm
           WHERE rm.room_id = r.id
           AND rm.user_id = $2
         )
       )`,
      [roomId, userId],
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error("Room authorization error:", error.message);
    return false;
  }
}

function getAllConnectedClients(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId] || "Unknown user",
      };
    },
  );
}


app.post(
  "/run",
  authenticateToken,
  runLimiter,
  async (req, res) => {
    try {
      const { code, language, roomId } = req.body;

      // Validate room ID
      if (typeof roomId !== "string" || !roomId.trim()) {
        return res.status(400).json({
          message: "Room ID is required.",
        });
      }

      // Validate code
      if (typeof code !== "string" || !code.trim()) {
        return res.status(400).json({
          message: "Code cannot be empty.",
        });
      }

      if (code.length > 20000) {
        return res.status(413).json({
          message: "Code exceeds the 20,000 character limit.",
        });
      }

      // Validate programming language
      const allowedLanguages = [
        "javascript",
        "python",
        "java",
        "cpp",
      ];

      if (!allowedLanguages.includes(language)) {
        return res.status(400).json({
          message: "Unsupported programming language.",
        });
      }

      // Verify room membership
      const hasAccess = await canAccessRoom(
        roomId,
        req.user.sub
      );

      if (!hasAccess) {
        return res.status(403).json({
          message: "You are not authorized to execute code in this room.",
        });
      }

      // Execute code
      const result = await executeCode(code, language);

      return res.json(result);

    } catch (error) {
      console.error("Error running code:", error.message);

      return res.status(400).json({
        stdout: "",
        stderr: error.message || "Code execution failed.",
        exitCode: 1,
      });
    }
  }
);


io.use((socket, next) => {
  const user = getAuthenticatedUser(socket.handshake);

  if (!user) {
    return next(new Error("Authentication required."));
  }

  socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.on("connection-quality:ping", (clientSentAt, callback) => {
    if (typeof callback !== "function") return;

    callback({
      clientSentAt,
      serverReceivedAt: Date.now(),
    });
  });

  socket.on("join", async ({ roomId } = {}) => {
    if (typeof roomId !== "string" || !roomId.trim() || roomId.length > 255) {
      return;
    }

    const user = socket.data.user;
    const username = user.username;

    // Verify room ownership
    const hasAccess = await canAccessRoom(roomId, user.sub);

    if (!hasAccess) {
      socket.emit("room:error", {
        message: "You are not authorized to access this room.",
      });
      return;
    }

    userSocketMap[socket.id] = username;
    console.log(
      `[DEBUG] Sending user-joined for ${username} in room ${roomId}`,
    );

    socket.join(roomId);

    console.log(`${username} joined room: ${roomId}`);

    io.to(roomId).emit("joined", {
      clients: getAllConnectedClients(roomId),
      socketId: socket.id,
      username,
    });
    socket.to(roomId).emit("user-joined", {
      username,
      message: `${username} joined the room.`,
    });
  });
  socket.on("reliability-test-result", ({ roomId, result }) => {
    if (!roomId || !result || !socket.rooms.has(roomId)) {
      return;
    }

    io.to(roomId).emit("reliability-test-result", {
      result,
      createdAt: new Date().toISOString(),
      user: userSocketMap[socket.id] || "Anonymous",
    });
  });
  socket.on("disconnecting", () => {
    const username = userSocketMap[socket.id] || "Unknown user";

    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        io.to(roomId).emit("joined", {
          clients: getAllConnectedClients(roomId).filter(
            (client) => client.socketId !== socket.id,
          ),
          socketId: socket.id,
          username,
        });

        socket.to(roomId).emit("user-left", {
          username,
          message: `${username} left the room.`,
        });
      }
    }

    delete userSocketMap[socket.id];

    console.log(`${username} disconnected:`, socket.id);
  });
});

// Centralized API error handler
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  // Request body exceeds the configured limit
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      message: "Request body is too large. Maximum allowed size is 50 KB.",
    });
  }

  // Malformed JSON request
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "Invalid JSON request body.",
    });
  }

  // Unexpected server errors
  console.error("[API Error]", error.message);

  const status =
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;

  return res.status(status).json({
    message:
      status >= 500
        ? "Internal server error."
        : "Invalid request.",
  });
});


if (require.main === module) {
  startServer(PORT).catch(() => {
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  getAvailablePort,
  startServer,
  ysocketio,
};
