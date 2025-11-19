import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import path from "path";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
dotenv.config();
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import fs from "fs";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:5500"],
    credentials: true
}));

const JWT_SECRET = process.env.JWT_SECRET;
const db = await mysql.createConnection({
  host: "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: "items",
});
let mail_pass = process.env.MAIL_PASS
let mail_user = process.env.MAIL_USER
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, 
  auth: {
    user: mail_user,
    pass: mail_pass
  },
  connectionTimeout: 5000,
  socketTimeout: 5000
});
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email service error:", error.message);
    console.error("Error code:", error.code);
  } else {
    console.log("✓ Email service ready");
  }
});
console.log(mail_pass, mail_user, JWT_SECRET)
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// IMPORTANT: Define API routes FIRST, before static files
// ========== PASSWORDLESS AUTH ROUTES ==========

// Send OTP for Email Login/Signup
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const { email, isSignup } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Check if user exists
    const [existingUser] = await db.query("SELECT id FROM users WHERE email = ?", [email]);

    if (isSignup && existingUser.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }

    if (!isSignup && existingUser.length === 0) {
      return res.status(404).json({ message: "Email not registered" });
    }

    // Store OTP in database
    await db.query(
      "INSERT INTO otp_verifications (email, otp, purpose, expires_at) VALUES (?, ?, 'login', ?)",
      [email, otp, expiresAt]
    );

    // Send OTP via email
    try {
      await transporter.sendMail({
        from: mail_user,
        to: email,
        subject: "Your Lost & Found Login Code",
        html: `
          <h2>Your Verification Code</h2>
          <p>Enter this code to continue:</p>
          <h1 style="letter-spacing: 2px; color: #2563eb;">${otp}</h1>
          <p>This code expires in 5 minutes.</p>
          <p>Do not share this code with anyone.</p>
        `,
      });
    } catch (emailError) {
      console.error("Email send error:", emailError);
      return res.status(500).json({ message: "Failed to send OTP email" });
    }

    res.json({ message: "OTP sent to email" });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Verify OTP and Create/Login User
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp, name, rememberMe, isSignup } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    // Verify OTP
    const [otpRecords] = await db.query(
      "SELECT id FROM otp_verifications WHERE email = ? AND otp = ? AND used = FALSE AND expires_at > NOW() AND purpose = 'login'",
      [email, otp]
    );

    if (otpRecords.length === 0) {
      return res.status(401).json({ message: "Invalid or expired OTP" });
    }

    // Mark OTP as used
    await db.query("UPDATE otp_verifications SET used = TRUE WHERE id = ?", [otpRecords[0].id]);

    let user;

    if (isSignup) {
      // Create new user
      if (!name) {
        return res.status(400).json({ message: "Name required for signup" });
      }

      const [existingUser] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
      if (existingUser.length > 0) {
        return res.status(400).json({ message: "Email already registered" });
      }

      await db.query("INSERT INTO users (email, name, login_type) VALUES (?, ?, 'email')", [
        email,
        name,
      ]);

      const [newUser] = await db.query("SELECT id, email, name FROM users WHERE email = ?", [email]);
      user = newUser[0];
    } else {
      // Login existing user
      const [existingUser] = await db.query("SELECT id, email, name FROM users WHERE email = ?", [email]);
      if (existingUser.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      user = existingUser[0];
    }

    // Create JWT with expiry based on rememberMe
    const expiresIn = rememberMe ? "30d" : "15d";
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn,
    });

    // Set httpOnly cookie
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 15 * 24 * 60 * 60 * 1000;
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
    });

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✓ Firebase Admin SDK initialized");
} else {
  console.warn("⚠ serviceAccountKey.json not found. Google login disabled.");
}

// Google Login - Verify ID Token from Frontend
app.post("/api/auth/google-login", async (req, res) => {
  try {
    const { idToken, rememberMe } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "ID token required" });
    }

    // Verify the ID token with Firebase Admin SDK
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error("Token verification error:", error.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    const { email, name, uid } = decodedToken;

    // Check if user exists
    const [existingUser] = await db.query(
      "SELECT id, email, name FROM users WHERE email = ? OR firebase_uid = ?",
      [email, uid]
    );

    let user;

    if (existingUser.length > 0) {
      // Update firebase_uid if not set
      user = existingUser[0];
      if (!user.firebase_uid) {
        await db.query("UPDATE users SET firebase_uid = ? WHERE id = ?", [uid, user.id]);
      }
    } else {
      // Create new user
      await db.query(
        "INSERT INTO users (email, name, firebase_uid, google_id, login_type) VALUES (?, ?, ?, ?, 'google')",
        [email, name || email, uid, uid]
      );

      const [newUser] = await db.query("SELECT id, email, name FROM users WHERE email = ?", [email]);
      user = newUser[0];
    }

    // Create JWT with 30-day expiry for Google login
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "30d",
    });

    // Set httpOnly cookie with 30-day maxAge
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      message: "Google login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ========== OLD AUTH ROUTES (DEPRECATED - Keeping for backward compatibility) ==========
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: "All fields are required" });
    }
    const [existingUser] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", [
      email,
      hashedPassword,
      name,
    ]);
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }
    const [users] = await db.query("SELECT id, email, password, name FROM users WHERE email = ?", [
      email,
    ]);
    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.post("/api/auth/password", async (req, res) => {
  try {
    const { email } = req.body;
    console.log("Forgot password request for:", email);
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    const [users] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = users[0];
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.query(
      "DELETE FROM otp_verifications WHERE user_id = ? AND purpose = 'password_reset'",
      [user.id]
    );
    await db.query(
      "INSERT INTO otp_verifications (user_id, otp, purpose, expires_at) VALUES (?, ?, 'password_reset', ?)",
      [user.id, otp, expiresAt]
    );
    try {
      await transporter.sendMail({
        from: mail_user,
        to: email,
        subject: "🔐 Your Password Reset OTP",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>We received a request to reset your password. Use this OTP to proceed:</p>
            <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <h1 style="color: #2563eb; letter-spacing: 2px;">${otp}</h1>
            </div>
            <p style="color: #666;">This OTP will expire in 10 minutes.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
          </div>
        `
      });
      console.log("✓ OTP sent to:", email);
    } catch (emailError) {
      console.error("❌ Email sending error:", emailError.message);
      return res.status(500).json({ message: "Failed to send OTP email" });
    }
    res.json({ message: "OTP sent to your email" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (otp.length !== 6 || isNaN(otp)) {
      return res.status(400).json({ message: "Invalid OTP format" });
    }
    const [users] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const user = users[0];
    const [otpRecords] = await db.query(
      "SELECT id FROM otp_verifications WHERE user_id = ? AND otp = ? AND used = FALSE AND expires_at > NOW() AND purpose = 'password_reset'",
      [user.id, otp]
    );
    if (otpRecords.length === 0) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [
      hashedPassword,
      user.id,
    ]);
    await db.query("UPDATE otp_verifications SET used = TRUE WHERE id = ?", [
      otpRecords[0].id,
    ]);
    res.json({ message: "Password reset successfully. Please login with your new password." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/api/items", async (req, res) => {
  try {
    const { type, status, search } = req.query;
    let query = `SELECT i.*, u.name as resolved_by_name, u.email as resolved_by_email, fc.claimed_by_user_id, fc.description as claim_description, fc.location as claim_location, fc.contact_email as claim_contact_email, fc.contact_phone as claim_contact_phone, cu.name as claim_user_name, cu.email as claim_user_email
                 FROM items i
                 LEFT JOIN users u ON i.resolved_by_user_id = u.id
                 LEFT JOIN found_claims fc ON i.accepted_claim_id = fc.id
                 LEFT JOIN users cu ON fc.claimed_by_user_id = cu.id
                 WHERE i.status != 'resolved'`;
    let params = [];
    if (type) {
      query += " AND i.item_type = ?";
      params.push(type);
    }
    if (status) {
      query += " AND i.status = ?";
      params.push(status);
    }
    if (search) {
      query += " AND (i.title LIKE ? OR i.description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY i.created_at DESC";
    const [items] = await db.query(query, params);
    res.json(items);
  } catch (error) {
    console.error("Get items error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/api/items/user", verifyToken, async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT i.*, u.name as resolved_by_name, u.email as resolved_by_email, fc.claimed_by_user_id, fc.description as claim_description, fc.location as claim_location, fc.contact_email as claim_contact_email, fc.contact_phone as claim_contact_phone, cu.name as claim_user_name, cu.email as claim_user_email
       FROM items i
       LEFT JOIN users u ON i.resolved_by_user_id = u.id
       LEFT JOIN found_claims fc ON i.accepted_claim_id = fc.id
       LEFT JOIN users cu ON fc.claimed_by_user_id = cu.id
       WHERE i.user_id = ? ORDER BY i.created_at DESC`,
      [req.userId]
    );
    res.json(items);
  } catch (error) {
    console.error("Get user items error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/api/items/:id", async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT i.*, u.name as resolved_by_name, u.email as resolved_by_email, fc.claimed_by_user_id, fc.description as claim_description, fc.location as claim_location, fc.contact_email as claim_contact_email, fc.contact_phone as claim_contact_phone, cu.name as claim_user_name, cu.email as claim_user_email
       FROM items i
       LEFT JOIN users u ON i.resolved_by_user_id = u.id
       LEFT JOIN found_claims fc ON i.accepted_claim_id = fc.id
       LEFT JOIN users cu ON fc.claimed_by_user_id = cu.id
       WHERE i.id = ?`,
      [req.params.id]
    );
    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }
    res.json(items[0]);
  } catch (error) {
    console.error("Get item error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.post("/api/items", verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      item_type,
      category,
      location,
      item_date,
      contact_email,
      contact_phone,
    } = req.body;
    if (!title || !item_type) {
      return res.status(400).json({ message: "Title and type are required" });
    }
    await db.query(
      "INSERT INTO items (user_id, title, description, item_type, category, location, item_date, contact_email, contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        req.userId,
        title,
        description,
        item_type,
        category,
        location,
        item_date,
        contact_email,
        contact_phone,
      ]
    );
    res.status(201).json({ message: "Item added successfully" });
  } catch (error) {
    console.error("Add item error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.put("/api/items/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      item_type,
      category,
      location,
      item_date,
      status,
      contact_email,
      contact_phone,
    } = req.body;
    const [items] = await db.query("SELECT user_id FROM items WHERE id = ?", [id]);
    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    await db.query(
      "UPDATE items SET title = ?, description = ?, item_type = ?, category = ?, location = ?, item_date = ?, status = ?, contact_email = ?, contact_phone = ? WHERE id = ?",
      [
        title,
        description,
        item_type,
        category,
        location,
        item_date,
        status,
        contact_email,
        contact_phone,
        id,
      ]
    );
    res.json({ message: "Item updated successfully" });
  } catch (error) {
    console.error("Edit item error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.delete("/api/items/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [items] = await db.query("SELECT user_id FROM items WHERE id = ?", [id]);
    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    await db.query("DELETE FROM items WHERE id = ?", [id]);
    res.json({ message: "Item deleted successfully" });
  } catch (error) {
    console.error("Delete item error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark Lost Item as Found
app.put("/api/items/:id/mark-found", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [items] = await db.query("SELECT user_id, item_type FROM items WHERE id = ?", [id]);
    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (items[0].item_type !== 'lost') {
      return res.status(400).json({ message: "Only lost items can be marked as found" });
    }
    await db.query("UPDATE items SET status = 'found' WHERE id = ?", [id]);
    res.json({ message: "Item marked as found successfully" });
  } catch (error) {
    console.error("Mark found error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark Found Item as Claimed
app.put("/api/items/:id/mark-claimed", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [items] = await db.query("SELECT user_id, item_type FROM items WHERE id = ?", [id]);
    if (items.length === 0) {
      return res.status(404).json({ message: "Item not found" });
    }
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    if (items[0].item_type !== 'found') {
      return res.status(400).json({ message: "Only found items can be marked as claimed" });
    }
    await db.query("UPDATE items SET status = 'claimed' WHERE id = ?", [id]);
    res.json({ message: "Item marked as claimed successfully" });
  } catch (error) {
    console.error("Mark claimed error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create a Found Claim for a Lost Item
app.post("/api/found-claims", verifyToken, async (req, res) => {
  try {
    const { original_item_id, description, location, contact_email, contact_phone } = req.body;
    
    if (!original_item_id) {
      return res.status(400).json({ message: "Original item ID is required" });
    }
    
    const [items] = await db.query(
      "SELECT id, item_type FROM items WHERE id = ? AND item_type = 'lost'",
      [original_item_id]
    );
    
    if (items.length === 0) {
      return res.status(404).json({ message: "Lost item not found" });
    }
    
    await db.query(
      "INSERT INTO found_claims (original_item_id, claimed_by_user_id, description, location, contact_email, contact_phone) VALUES (?, ?, ?, ?, ?, ?)",
      [original_item_id, req.userId, description, location, contact_email, contact_phone]
    );
    
    res.status(201).json({ message: "Found claim created successfully" });
  } catch (error) {
    console.error("Create found claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get Found Claims for a Lost Item
app.get("/api/found-claims/item/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const [claims] = await db.query(
      `SELECT fc.id, fc.description, fc.location, fc.contact_email, fc.contact_phone, 
              fc.status, fc.created_at, u.name, u.email
       FROM found_claims fc
       JOIN users u ON fc.claimed_by_user_id = u.id
       WHERE fc.original_item_id = ?
       ORDER BY fc.created_at DESC`,
      [itemId]
    );
    
    res.json(claims);
  } catch (error) {
    console.error("Get found claims error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get User's Found Claims
app.get("/api/found-claims/user", verifyToken, async (req, res) => {
  try {
    const [claims] = await db.query(
      `SELECT fc.id, fc.original_item_id, i.title, i.description, fc.location, 
              fc.status, fc.created_at, i.category
       FROM found_claims fc
       JOIN items i ON fc.original_item_id = i.id
       WHERE fc.claimed_by_user_id = ?
       ORDER BY fc.created_at DESC`,
      [req.userId]
    );
    
    res.json(claims);
  } catch (error) {
    console.error("Get user found claims error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Accept a Found Claim and Award Points
app.put("/api/found-claims/:claimId/accept", verifyToken, async (req, res) => {
  try {
    const { claimId } = req.params;
    
    const [claims] = await db.query(
      "SELECT original_item_id, claimed_by_user_id FROM found_claims WHERE id = ?",
      [claimId]
    );
    
    if (claims.length === 0) {
      return res.status(404).json({ message: "Claim not found" });
    }
    
    const [items] = await db.query(
      "SELECT user_id FROM items WHERE id = ?",
      [claims[0].original_item_id]
    );
    
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    // Award 10 points to the user who found the item
    const claimedByUserId = claims[0].claimed_by_user_id;
    await db.query("UPDATE users SET points = points + 10 WHERE id = ?", [claimedByUserId]);
    
    // Update claim status
    await db.query("UPDATE found_claims SET status = 'accepted' WHERE id = ?", [claimId]);
    
    // Update item status to resolved with resolver info
    await db.query(
      "UPDATE items SET status = 'resolved', resolved_by_user_id = ?, accepted_claim_id = ?, resolved_at = NOW() WHERE id = ?",
      [req.userId, claimId, claims[0].original_item_id]
    );
    
    res.json({ message: "Claim accepted and 10 points awarded" });
  } catch (error) {
    console.error("Accept claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Reject a Found Claim
app.put("/api/found-claims/:claimId/reject", verifyToken, async (req, res) => {
  try {
    const { claimId } = req.params;
    
    const [claims] = await db.query(
      "SELECT original_item_id FROM found_claims WHERE id = ?",
      [claimId]
    );
    
    if (claims.length === 0) {
      return res.status(404).json({ message: "Claim not found" });
    }
    
    const [items] = await db.query(
      "SELECT user_id FROM items WHERE id = ?",
      [claims[0].original_item_id]
    );
    
    if (items[0].user_id !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    
    await db.query("UPDATE found_claims SET status = 'rejected' WHERE id = ?", [claimId]);
    
    res.json({ message: "Claim rejected" });
  } catch (error) {
    console.error("Reject claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get User Points
app.get("/api/users/points", verifyToken, async (req, res) => {
  try {
    const [users] = await db.query("SELECT points FROM users WHERE id = ?", [req.userId]);
    
    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json({ points: users[0].points });
  } catch (error) {
    console.error("Get points error:", error);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/api/debug", (req, res) => {
  res.json({ 
    message: "Server is running", 
    timestamp: new Date(),
    origin: req.get('origin')
  });
});

// THEN serve static files (this must be AFTER all API routes)
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


app.listen(3000, "0.0.0.0", () => {
  console.log("✓ API running on port 3000");
  console.log("✓ Access at http://localhost:3000");
});

// Google OAuth2 Client Configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/google-callback`
);

// Store OAuth state for verification
const oauthSessions = new Map();

// Generate Google Auth URL
app.post("/api/auth/google-url", async (req, res) => {
  try {
    const state = require('crypto').randomBytes(32).toString('hex');
    const sessionId = require('crypto').randomBytes(16).toString('hex');
    
    // Store session
    oauthSessions.set(sessionId, {
      state,
      createdAt: Date.now()
    });

    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      include_granted_scopes: true,
      prompt: 'consent'
    });

    // Store state in session for callback verification
    oauthSessions.set(state, {
      sessionId,
      createdAt: Date.now()
    });

    res.json({ authUrl, sessionId });
  } catch (error) {
    console.error('Google URL generation error:', error);
    res.status(500).json({ message: 'Failed to generate Google auth URL' });
  }
});

// Google Callback Handler
app.get("/api/auth/google-callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).html('<h1>Missing auth code or state</h1>');
    }

    // Verify state
    if (!oauthSessions.has(state)) {
      return res.status(400).html('<h1>Invalid state parameter</h1>');
    }

    // Check if state is not too old (5 minutes)
    const session = oauthSessions.get(state);
    if (Date.now() - session.createdAt > 5 * 60 * 1000) {
      oauthSessions.delete(state);
      return res.status(400).html('<h1>Auth request expired</h1>');
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const { email, name, picture, id: googleId } = userInfo.data;

    if (!email) {
      oauthSessions.delete(state);
      return res.status(400).html('<h1>Could not retrieve email from Google</h1>');
    }

    // Check or create user in database
    const [existingUser] = await db.query(
      "SELECT id, email, name FROM users WHERE email = ? OR google_id = ?",
      [email, googleId]
    );

    let user;

    if (existingUser.length > 0) {
      user = existingUser[0];
      // Update google_id if not set
      if (!user.google_id) {
        await db.query("UPDATE users SET google_id = ?, login_type = 'google' WHERE id = ?", [
          googleId,
          user.id
        ]);
      }
    } else {
      // Create new user
      await db.query(
        "INSERT INTO users (email, name, google_id, login_type) VALUES (?, ?, ?, 'google')",
        [email, name || email, googleId]
      );

      const [newUser] = await db.query("SELECT id, email, name FROM users WHERE email = ?", [email]);
      user = newUser[0];
    }

    // Create JWT token (30 days for Google login)
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "30d"
    });

    // Store token temporarily (1 minute) for the popup to retrieve
    const tempTokenId = require('crypto').randomBytes(16).toString('hex');
    oauthSessions.set(tempTokenId, {
      token,
      user,
      expiresAt: Date.now() + 60 * 1000
    });

    // Clean up old session
    oauthSessions.delete(state);

    // Return HTML that closes popup and notifies parent window
    res.send(`
      <html>
        <head>
          <title>Google Sign-In</title>
          <script>
            // Store token in sessionStorage
            sessionStorage.setItem('googleAuthToken', '${token}');
            sessionStorage.setItem('googleAuthUser', '${JSON.stringify(user).replace(/"/g, '\\"')}');
            
            // Close popup
            window.close();
          </script>
        </head>
        <body>
          <p>Authentication successful. Closing...</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Google callback error:', error);
    oauthSessions.delete(req.query.state);
    res.status(500).html('<h1>Authentication failed. Please try again.</h1>');
  }
});

// Check Google Auth Status (called after popup closes)
app.get("/api/auth/google-status", async (req, res) => {
  try {
    // In a real scenario, you'd check if the user is authenticated via the JWT
    // For now, we'll return success if they have a valid token
    
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ authenticated: false });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const [user] = await db.query("SELECT id, email, name FROM users WHERE id = ?", [decoded.id]);
      
      if (user.length === 0) {
        return res.status(401).json({ authenticated: false });
      }

      res.json({
        authenticated: true,
        token,
        user: user[0]
      });
    } catch (error) {
      res.status(401).json({ authenticated: false });
    }
  } catch (error) {
    console.error('Google status check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
