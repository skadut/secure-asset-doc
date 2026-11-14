FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs reveal.mjs traffic.mjs uploads.mjs protection.mjs auth.mjs session.mjs grc-filter.mjs tokens.mjs auth-routes.mjs audit-purge.mjs grants.mjs router.mjs crypto-client.mjs derive.mjs levels.mjs dbview.mjs viewer.mjs dashboard.mjs controls.mjs asset-manage.mjs assets-write.mjs doc-upload.mjs doc-create.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
