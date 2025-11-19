import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(cors({
    origin: ["http://localhost:6000", "http://51.15.192.6:6000"],
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
// Auth Routes
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
    let query = "SELECT * FROM items WHERE 1=1";
    let params = [];
    if (type) {
      query += " AND item_type = ?";
      params.push(type);
    }
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (search) {
      query += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY created_at DESC";
    const [items] = await db.query(query, params);
    res.json(items);
  } catch (error) {
    console.error("Get items error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/api/items/user", verifyToken, async (req, res) => {
  try {
    const [items] = await db.query("SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC", [
      req.userId,
    ]);
    res.json(items);
  } catch (error) {
    console.error("Get user items error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
app.get("/api/items/:id", async (req, res) => {
  try {
    const [items] = await db.query("SELECT * FROM items WHERE id = ?", [req.params.id]);
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
    
    // Update item status to resolved
    await db.query("UPDATE items SET status = 'resolved' WHERE id = ?", [claims[0].original_item_id]);
    
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


app.listen(6000, "0.0.0.0", () => {
  console.log("✓ API running on port 6000");
  console.log("✓ Access at http://localhost:6000");
});
