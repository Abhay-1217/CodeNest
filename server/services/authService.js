
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long.");
}

async function registerUser({ username, email, password }) {
  if (typeof username === "string") {
  username = username.trim();
}

if (typeof email === "string") {
  email = email.trim().toLowerCase();
}

  if (
    typeof username !== "string" ||
    username.length < 3 ||
    username.length > 30 ||
    !/^[a-zA-Z0-9_]+$/.test(username)
  ) {
    throw new Error("Username must be 3-30 characters (letters, numbers, underscores).");
  }

  if (
    typeof email !== "string" ||
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Please provide a valid email address.");
  }

  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    throw new Error("Password must be between 8 and 72 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );

    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw new Error("Username or email is already registered.");
    }
    throw error;
  }
}

async function loginUser({ email, password }) {
  if (typeof email !== "string" || typeof password !== "string") {
    throw new Error("Email and password are required.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  const result = await pool.query(
    `SELECT id, username, email, password_hash
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new Error("Invalid email or password.");
  }

  const token = jwt.sign(
    { sub: String(user.id), username: user.username },
    JWT_SECRET,
    { expiresIn: "1h", issuer: "codecollab" }
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
  };
}

module.exports = {
  registerUser,
  loginUser,
};
