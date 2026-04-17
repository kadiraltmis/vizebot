FROM node:22-slim

# Playwright Chromium browser (bundled, no X server needed)
RUN npx playwright install chromium --with-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

# Download Playwright Chromium browser (required even though system chromium is installed)
RUN npx playwright install chromium --with-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
