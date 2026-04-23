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
# Note: Worker needs the same schema path as API
RUN npx prisma generate --schema=./servanza-services/api/prisma/schema.prisma

# Build the Workers service
RUN npm run build --workspace=@servanza-services/workers

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

EXPOSE 3001

ENV NODE_ENV=production

# Run the production worker
CMD ["npm", "run", "start:prod", "--workspace=@servanza-services/workers"]