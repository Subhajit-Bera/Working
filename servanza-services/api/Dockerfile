# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies for Prisma
RUN apk add --no-cache openssl

# Copy root package files
COPY package.json package-lock.json ./

# Copy service-specific package files
COPY servanza-services/api/package.json ./servanza-services/api/
COPY servanza-services/workers/package.json ./servanza-services/workers/
COPY servanza-packages/shared/package.json ./servanza-packages/shared/

# Install all monorepo dependencies
RUN npm install

# Copy all source code
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=./servanza-services/api/prisma/schema.prisma

# Build the API service
RUN npm run build --workspace=@service-marketplace/api

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app

# Install production dependencies for Prisma
RUN apk add --no-cache openssl

# Copy root package files
COPY package.json package-lock.json ./

# Copy service-specific package files
COPY servanza-services/api/package.json ./servanza-services/api/
COPY servanza-services/workers/package.json ./servanza-services/workers/
COPY servanza-packages/shared/package.json ./servanza-packages/shared/

# Install ONLY production dependencies
RUN npm install --omit=dev

# Copy built code from builder stage
# We copy the entire monorepo build context first
COPY --from=builder /app .

# Clean up source files, leaving only dist and node_modules
RUN rm -rf servanza-packages/shared/src
RUN rm -rf servanza-services/api/src
RUN rm -rf servanza-services/workers/src
RUN rm -rf servanza-services/api/tests
RUN find . -name "tsconfig.json" -delete
RUN find . -name ".eslintrc.json" -delete

# Copy Prisma schema for runtime
COPY servanza-services/api/prisma/schema.prisma ./servanza-services/api/prisma/

EXPOSE 3000

ENV NODE_ENV=production

# Run the production server
CMD ["npm", "run", "start:prod", "--workspace=@service-marketplace/api"]