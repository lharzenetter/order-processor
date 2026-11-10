# Built from the repo root: docker build -f server/Dockerfile .
# The .nvmrc version: Node runs server/*.ts directly through type stripping, with no build step.
FROM node:24.21-slim
WORKDIR /app
COPY server/ /app/server/
# The default DATA_DIR. On the venue machine the compose file's data volume is mounted here; a new
# volume takes this directory's owner, uid 1000 (the node user).
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8443
CMD ["node", "server/main.ts"]
