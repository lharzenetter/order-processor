# Built from the repo root: docker build -f server/Dockerfile .
# The .nvmrc version: Node runs server/*.ts directly through type stripping, with no build step.
FROM node:24.21-slim
WORKDIR /app
COPY server/ /app/server/
# The default DATA_DIR for a container without a bind mount; on the Pi, data/ is mounted here and
# must belong to uid 1000 (the node user).
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8443
CMD ["node", "server/main.ts"]
