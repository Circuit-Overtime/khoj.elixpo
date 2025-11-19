
CREATE DATABASE items;
USE items;

-- Users table with authentication
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  points INT DEFAULT 0,
  google_id VARCHAR(255) UNIQUE,
  firebase_uid VARCHAR(255) UNIQUE,
  login_type ENUM('email', 'google') DEFAULT 'email',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- OTP verification table
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  email VARCHAR(255),
  otp VARCHAR(6) NOT NULL,
  purpose ENUM('password_reset', 'email_verification', 'login') DEFAULT 'login',
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_email (email),
  INDEX idx_otp (otp)
);

-- Lost and Found items table
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  item_type ENUM('lost', 'found') NOT NULL,
  category VARCHAR(100),
  location VARCHAR(255),
  item_date DATE,
  status ENUM('active', 'resolved', 'claimed', 'found') DEFAULT 'active',
  image_url VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(20),
  resolved_by_user_id INT,
  accepted_claim_id INT,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_items_user_id (user_id),
  INDEX idx_items_type (item_type),
  INDEX idx_items_status (status)
);

-- Found item claims table - tracks when users claim to have found lost items
CREATE TABLE IF NOT EXISTS found_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  original_item_id INT NOT NULL,
  claimed_by_user_id INT NOT NULL,
  description TEXT,
  location VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(20),
  status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (original_item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (claimed_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_original_item_id (original_item_id),
  INDEX idx_claimed_by_user_id (claimed_by_user_id),
  INDEX idx_status (status)
);

-- Add foreign keys to items table for resolved tracking (after found_claims is created)
ALTER TABLE items ADD CONSTRAINT fk_resolved_by 
  FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE items ADD CONSTRAINT fk_accepted_claim 
  FOREIGN KEY (accepted_claim_id) REFERENCES found_claims(id) ON DELETE SET NULL;

-- Create index for resolved items
CREATE INDEX IF NOT EXISTS idx_items_resolved_at ON items(resolved_at);
CREATE INDEX IF NOT EXISTS idx_items_resolved_by ON items(resolved_by_user_id);

-- Ensure login_type column exists and has proper values
ALTER TABLE users MODIFY COLUMN login_type ENUM('email', 'google') DEFAULT 'email';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_login_type ON users(login_type);
