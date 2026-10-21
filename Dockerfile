FROM node:24.16.0-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
RUN node scripts/compress-assets.mjs && chmod -R a+rX /app
USER node
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/kidtube.sqlite PUBLIC_DIR=/app/public
EXPOSE 3000
CMD ["node", "server/index.mjs"]
