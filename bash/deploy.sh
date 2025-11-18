set -e
SERVER_IP="51.15.192.6"
APP_PORT="6000"
DOMAIN="khoj.elixpo.com"
WEBROOT="/var/www/$DOMAIN"
SERVICE="khoj.service"
echo "🔄 Starting deployment for $DOMAIN..."
echo "Checking if backend is reachable..."
if ! nc -z $SERVER_IP $APP_PORT 2>/dev/null; then
    echo "❌ Error: Backend is NOT running at $SERVER_IP:$APP_PORT"
    exit 1
fi
echo "✓ Backend reachable"
echo "Deploying frontend files..."
mkdir -p $WEBROOT
cp -r /root/sqlpr/* $WEBROOT/
chown -R www-data:www-data $WEBROOT
echo "✓ Frontend deployed to $WEBROOT"
echo "Restarting backend service: $SERVICE"
systemctl restart $SERVICE
systemctl enable $SERVICE
echo "✓ Backend restarted"
echo "Configuring Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;
    ssl_protocols TLSv1.3;
    ssl_prefer_server_ciphers off;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000" always;
    location / {
        try_files \$uri @backend;
    }
    location @backend {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
echo "Testing nginx config..."
nginx -t
systemctl reload nginx
echo "✓ Nginx reloaded"
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    echo "Issuing SSL certificate for $DOMAIN..."
    certbot --nginx --agree-tos --email admin@$DOMAIN -d $DOMAIN
    echo "✓ SSL certificate issued"
else
    echo "SSL certificate exists — renewing silently..."
    certbot renew --quiet
fi
systemctl reload nginx
echo "✓ SSL active"
echo ""
echo "🎉 Deployment complete!"
echo "🌐 Site: https://$DOMAIN"
echo "📦 Backend service: $SERVICE"
