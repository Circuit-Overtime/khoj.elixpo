#!/bin/bash
set -euo pipefail
SRC="/root/sqlpr"
DEST="/var/www/khoj.elixpo.com"
SERVICE="khoj.service"
echo "🚀 Starting Deployment..."
mkdir -p "$DEST"
rsync -av --exclude=".env" "$SRC/" "$DEST/"
chown -R www-data:www-data "$DEST"
systemctl restart "$SERVICE"
echo "🔄 Deployment completed successfully!"
