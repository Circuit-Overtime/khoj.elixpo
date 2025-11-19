#!/bin/bash

# Create user using sudo to access root without password prompt
sudo mysql -h localhost -u root << EOF
CREATE USER IF NOT EXISTS 'elixpo'@'localhost' IDENTIFIED BY 'elixpo';
GRANT ALL PRIVILEGES ON *.* TO 'elixpo'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;
EOF

# Connect as elixpo user with password from file
mysql -h localhost -u elixpo -pelixpo < schema.sql