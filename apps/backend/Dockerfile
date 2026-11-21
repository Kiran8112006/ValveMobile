FROM node:24-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# === Production stage ===
FROM node:24-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json ./
RUN npm ci --omit=dev

# Copy built output
COPY --from=builder /app/dist ./dist

# Expose server port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]