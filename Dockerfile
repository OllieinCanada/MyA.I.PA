FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps
RUN npx prisma generate

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "run", "server:prod"]
