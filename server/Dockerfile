# 先在仓库根目录执行 npm run server:build，再以仓库根目录为上下文构建：
#   docker build -f server/Dockerfile -t forge-server .
FROM node:24-alpine
WORKDIR /app
COPY server/dist/index.mjs ./index.mjs
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/forge.db ENV_FILE=/app/.env
VOLUME /data
EXPOSE 8787
CMD ["node", "index.mjs"]
