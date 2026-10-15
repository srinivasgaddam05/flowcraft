FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY apps/web/package*.json apps/web/
COPY apps/api/package*.json apps/api/
COPY packages packages
COPY prisma prisma
RUN npm ci
COPY apps/web apps/web
RUN npm run build --workspace @workflow/web
CMD ["npm", "run", "start", "--workspace", "@workflow/web"]