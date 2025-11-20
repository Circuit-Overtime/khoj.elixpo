import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import path from "path";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import fs from "fs";
import { google } from "googleapis";

dotenv.config();

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
  } else {
  console.log("✓ Email service ready");
  }
});

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

const sendNotificationEmails = async (item, currentUserId) => {
  try {
    // Get all users with lost item notifications enabled
    const [users] = await db.query(
      `SELECT u.id, u.email, u.name FROM users u
       LEFT JOIN user_notification_preferences unp ON u.id = unp.user_id
       WHERE u.id != ? AND (unp.lost_item_notifications = TRUE OR unp.id IS NULL)
       AND u.email IS NOT NULL`,
      [currentUserId]
    );

    if (users.length === 0) return;

    const itemTypeLabel = item.item_type === 'lost' ? 'Lost' : 'Found';
    const emailTemplate = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #007bff;">New ${itemTypeLabel} Item Posted!</h2>
        <p>Hello USER_NAME,</p>
        <p>A new <strong>${itemTypeLabel}</strong> item has been posted on the Lost & Found system:</p>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Title:</strong> ${item.title}</p>
          <p><strong>Type:</strong> ${item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1)}</p>
          ${item.category ? `<p><strong>Category:</strong> ${item.category}</p>` : ''}
          <p><strong>Description:</strong> ${item.description || 'N/A'}</p>
          ${item.location ? `<p><strong>Location:</strong> ${item.location}</p>` : ''}
          ${item.item_date ? `<p><strong>Date:</strong> ${new Date(item.item_date).toLocaleDateString()}</p>` : ''}
        </div>
        <p style="color: #666; font-size: 14px;">If you find this item or have any information, please log in to the Lost & Found system and claim it.</p>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">You received this email because you have lost item notifications enabled. You can manage your notification preferences in your account settings.</p>
      </div>
    `;

    // Send emails to all users (batch)
    for (const user of users) {
      await transporter.sendMail({
        from: mail_user,
        to: user.email,
        subject: `New ${itemTypeLabel} Item Posted: ${item.title}`,
        html: emailTemplate.replace('USER_NAME', user.name),
      }).catch(err => {
        console.error(`Failed to send email to ${user.email}:`, err.message);
      });
    }

    console.log(`✓ Sent ${item.item_type} item notification to ${users.length} users`);
  } catch (error) {
    console.error('Error sending notification emails:', error);
  }
};

const serviceAccountPath = path.join(__dirname, "service.json");
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  });
  console.log("✓ Firebase Admin SDK initialized");
} else {
  console.warn("⚠ service.json not found. Google login disabled.");
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/google-callback`
);

const oauthSessions = new Map();

app.post("/api/auth/send-otp", async (req, res) => {
  try {
  const { email, isSignup } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const [existingUser] = await db.query(
    "SELECT id, login_type FROM users WHERE email = ?", 
    [email]
  );

  if (existingUser.length > 0 && existingUser[0].login_type === 'google') {
    return res.status(400).json({ 
    message: "⚠️ This email is registered with Google Sign-In. Please use 'Sign in with Google' button instead." 
    });
  }

  if (isSignup && existingUser.length > 0) {
    return res.status(400).json({ message: "Email already registered" });
  }

  await db.query(
    "INSERT INTO otp_verifications (email, otp, purpose, expires_at) VALUES (?, ?, 'login', ?)",
    [email, otp, expiresAt]
  );

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

app.post("/api/auth/check-email", async (req, res) => {
  try {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const [users] = await db.query(
    "SELECT id, login_type FROM users WHERE email = ?",
    [email]
  );

  if (users.length === 0) {
    return res.json({
    exists: false,
    message: "Email not registered"
    });
  }

  res.json({
    exists: true,
    login_type: users[0].login_type,
    message: `Email registered with ${users[0].login_type} login`
  });
  } catch (error) {
  console.error("Check email error:", error);
  res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
  const { email, otp, name, rememberMe, isSignup, isAutoRegister } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP required" });
  }

  const [otpRecords] = await db.query(
    "SELECT id FROM otp_verifications WHERE email = ? AND otp = ? AND used = FALSE AND expires_at > NOW() AND purpose = 'login'",
    [email, otp]
  );

  if (otpRecords.length === 0) {
    return res.status(401).json({ message: "Invalid or expired OTP" });
  }

  await db.query("UPDATE otp_verifications SET used = TRUE WHERE id = ?", [otpRecords[0].id]);

  let user;
  let isNewUser = false;

  const [existingUsers] = await db.query(
    "SELECT id, email, name, login_type FROM users WHERE email = ?",
    [email]
  );

  if (existingUsers.length > 0) {
    user = existingUsers[0];
    
    if (user.login_type === 'google') {
    return res.status(400).json({ 
      message: "This email is registered with Google Sign-In. Please use Google login instead." 
    });
    }
  } else {
    if (isAutoRegister || !isSignup) {
    const namePart = email.split('@')[0];
    const autoName = name || namePart.charAt(0).toUpperCase() + namePart.slice(1);
    
    await db.query(
      "INSERT INTO users (email, name, login_type) VALUES (?, ?, 'email')",
      [email, autoName]
    );

    const [newUser] = await db.query(
      "SELECT id, email, name FROM users WHERE email = ?",
      [email]
    );
    user = newUser[0];
    isNewUser = true;
    } else if (isSignup) {
    if (!name) {
      return res.status(400).json({ message: "Name required for signup" });
    }

    await db.query(
      "INSERT INTO users (email, name, login_type) VALUES (?, ?, 'email')",
      [email, name]
    );

    const [newUser] = await db.query(
      "SELECT id, email, name FROM users WHERE email = ?",
      [email]
    );
    user = newUser[0];
    isNewUser = true;
    } else {
    return res.status(404).json({ message: "User not found" });
    }
  }

  const expiresIn = rememberMe ? "30d" : "15d";
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn,
  });

  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 15 * 24 * 60 * 60 * 1000;
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
  });

  res.json({
    message: isNewUser ? "Account created and logged in successfully" : "Login successful",
    token,
    isNewUser,
    user: { id: user.id, email: user.email, name: user.name },
  });
  } catch (error) {
  console.error("Verify OTP error:", error);
  res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/auth/google-url", async (req, res) => {
  try {
  const state = crypto.randomBytes(32).toString('hex');
  const sessionId = crypto.randomBytes(16).toString('hex');
  
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

app.get("/api/auth/google-callback", async (req, res) => {
  try {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('<h1>Missing auth code or state</h1>');
  }

  if (!oauthSessions.has(state)) {
    return res.status(400).send('<h1>Invalid state parameter</h1>');
  }

  const session = oauthSessions.get(state);
  if (Date.now() - session.createdAt > 5 * 60 * 1000) {
    oauthSessions.delete(state);
    return res.status(400).send('<h1>Auth request expired</h1>');
  }

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const { email, name, id: googleId } = userInfo.data;

  if (!email) {
    oauthSessions.delete(state);
    return res.status(400).send('<h1>Could not retrieve email from Google</h1>');
  }

  const [existingUser] = await db.query(
    "SELECT id, email, name FROM users WHERE email = ? OR google_id = ?",
    [email, googleId]
  );

  let user;

  if (existingUser.length > 0) {
    user = existingUser[0];
    if (!user.google_id) {
    await db.query("UPDATE users SET google_id = ?, login_type = 'google' WHERE id = ?", [
      googleId,
      user.id
    ]);
    }
  } else {
    await db.query(
    "INSERT INTO users (email, name, google_id, login_type) VALUES (?, ?, ?, 'google')",
    [email, name || email, googleId]
    );

    const [newUser] = await db.query("SELECT id, email, name FROM users WHERE email = ?", [email]);
    user = newUser[0];
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d"
  });

  oauthSessions.delete(state);

  res.send(`
    <html>
    <head>
      <title>Google Sign-In</title>
      <script>
      // Store token in localStorage
      localStorage.setItem('token', '${token}');
      localStorage.setItem('user', '${JSON.stringify(user).replace(/'/g, "\\'")}');
      
      // Notify parent window
      if (window.opener) {
        window.opener.postMessage({
        type: 'GOOGLE_AUTH_SUCCESS',
        token: '${token}',
        user: ${JSON.stringify(user)}
        }, window.location.origin);
      }
      
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
  res.status(500).send('<h1>Authentication failed. Please try again.</h1>');
  }
});

app.get("/api/auth/google-status", async (req, res) => {
  try {
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
  const result = await db.query(
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
  
  // Send notifications to users with notifications enabled
  const newItem = {
    title,
    description,
    item_type,
    category,
    location,
    item_date
  };
  
  sendNotificationEmails(newItem, req.userId);
  
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
  
  const claimedByUserId = claims[0].claimed_by_user_id;
  await db.query("UPDATE users SET points = points + 10 WHERE id = ?", [claimedByUserId]);
  
  await db.query("UPDATE found_claims SET status = 'accepted' WHERE id = ?", [claimId]);
  
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

app.get("/api/notifications/preferences", verifyToken, async (req, res) => {
  try {
    const [prefs] = await db.query(
      "SELECT lost_item_notifications, found_item_notifications, claim_notifications FROM user_notification_preferences WHERE user_id = ?",
      [req.userId]
    );
    
    if (prefs.length === 0) {
      // Return default preferences if none exist
      return res.json({
        lost_item_notifications: true,
        found_item_notifications: true,
        claim_notifications: true
      });
    }
    
    res.json(prefs[0]);
  } catch (error) {
    console.error("Get notification preferences error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/notifications/preferences", verifyToken, async (req, res) => {
  try {
    const {
      lost_item_notifications,
      found_item_notifications,
      claim_notifications
    } = req.body;
    
    // Check if preferences exist
    const [existing] = await db.query(
      "SELECT id FROM user_notification_preferences WHERE user_id = ?",
      [req.userId]
    );
    
    if (existing.length > 0) {
      // Update existing preferences
      await db.query(
        "UPDATE user_notification_preferences SET lost_item_notifications = ?, found_item_notifications = ?, claim_notifications = ? WHERE user_id = ?",
        [lost_item_notifications, found_item_notifications, claim_notifications, req.userId]
      );
    } else {
      // Create new preferences
      await db.query(
        "INSERT INTO user_notification_preferences (user_id, lost_item_notifications, found_item_notifications, claim_notifications) VALUES (?, ?, ?, ?)",
        [req.userId, lost_item_notifications, found_item_notifications, claim_notifications]
      );
    }
    
    res.json({ message: "Notification preferences updated successfully" });
  } catch (error) {
    console.error("Update notification preferences error:", error);
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

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, "0.0.0.0", () => {
  console.log("✓ API running on port 3000");
  console.log("✓ Access at http://localhost:3000");
});
