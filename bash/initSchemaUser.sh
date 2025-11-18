mysql -h localhost -u root -p << EOF
CREATE USER IF NOT EXISTS 'elixpo'@'localhost' IDENTIFIED BY 'elixpo';
GRANT ALL PRIVILEGES ON *.* TO 'elixpo'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;
EOF

mysql -h localhost -u elixpo -pelixpo < schema.sqlx
