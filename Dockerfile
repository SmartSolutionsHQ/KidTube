# Pinned by digest (the multi-arch index for amd64 and arm64), so a rebuild gets exactly this Node and Alpine 3.24.
# Dependabot proposes updates; bump the tag and digest together.
FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a
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
