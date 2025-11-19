USE items;

-- Users table with authentication
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  points INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- OTP verification table
CREATE TABLE IF NOT EXISTS otp_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp VARCHAR(6) NOT NULL,
  purpose ENUM('password_reset', 'email_verification') DEFAULT 'password_reset',
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add new columns for resolved items tracking
ALTER TABLE items ADD COLUMN IF NOT EXISTS resolved_by_user_id INT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS accepted_claim_id INT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL;
ALTER TABLE items ADD FOREIGN KEY IF NOT EXISTS (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE items ADD FOREIGN KEY IF NOT EXISTS (accepted_claim_id) REFERENCES found_claims(id) ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_otp_user_id ON otp_verifications(user_id);

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
