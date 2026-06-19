# apps/api/Dockerfile
# This file tells Docker how to build the API server container

# Start from the official Node.js 20 image (LTS version)
FROM node:20-alpine

# Set the working directory inside the container
# All subsequent commands run from here
WORKDIR /app

# Copy package files first (before copying source code)
# Docker caches layers — if package.json hasn't changed,
# it skips npm install on the next build (much faster)
COPY package*.json ./

# Copy the api package.json
COPY apps/api/package*.json ./apps/api/

# Install dependencies
RUN npm install

# Add workspace node_modules/.bin to PATH
# This makes tsx, knex, and all other CLI tools available everywhere
ENV PATH="/app/node_modules/.bin:$PATH"

# Copy the api source code
COPY apps/api/ ./apps/api/

# Expose port 3001 so Docker knows this container uses it
EXPOSE 3001

# Command to start the API server
# tsx runs TypeScript directly — no compile step needed in development
CMD ["npm", "run", "dev", "--workspace=apps/api"]