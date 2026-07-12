FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "run", "server:prod"]
