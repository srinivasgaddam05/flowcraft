FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
COPY packages packages
COPY prisma prisma
RUN npm ci
COPY apps/api apps/api
RUN npx prisma generate && npm run build --workspace @workflow/api
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start --workspace @workflow/api"]