FROM node:24.16.0-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# /data is created here and owned by the app's user, so a new named volume starts out writable.
RUN node scripts/compress-assets.mjs && chmod -R a+rX /app && mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/kidtube.sqlite PUBLIC_DIR=/app/public
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.mjs"]
