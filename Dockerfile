# Static PayLab frontend served by nginx as a NON-root user (uid 101 "nginx").
FROM nginxinc/nginx-unprivileged:1.27.5-alpine

USER root
# nginx site config: port 3000, /health, no-cache for config.js
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Runs at container start (before nginx) and writes /config.js from $API_BASE
COPY 40-paylab-config.sh /docker-entrypoint.d/40-paylab-config.sh
# The static site (HTML/CSS/JS, no build step)
COPY site/ /usr/share/nginx/html/
# The nginx user must own the web root so the start-up script can write config.js there.
RUN chmod 0755 /docker-entrypoint.d/40-paylab-config.sh \
 && rm -f /usr/share/nginx/html/50x.html \
 && chown -R 101:101 /usr/share/nginx/html
USER 101

# "" = call the API on the same origin (on AWS the ALB sends /api/* to api-gateway)
ENV API_BASE=""
EXPOSE 3000
