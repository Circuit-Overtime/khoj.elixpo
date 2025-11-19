#!/bin/bash

sudo apt update
sudo apt install -y mariadb-server
sudo systemctl enable mariadb
sudo systemctl start mariadb

# Run MySQL commands directly without interactive prompt
sudo mysql -u root << EOF
CREATE DATABASE myproject;
CREATE USER 'myuser'@'localhost' IDENTIFIED BY 'mypassword';
GRANT ALL PRIVILEGES ON myproject.* TO 'myuser'@'localhost';
FLUSH PRIVILEGES;
EOF

# Install npm package
npm install mysql2
