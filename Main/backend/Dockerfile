FROM ubuntu:22.04

WORKDIR /usr/src/app

RUN apt-get update && \
    apt-get install -y build-essential curl python3

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
RUN apt-get install -y nodejs

# Copy package files
COPY package*.json ./
RUN npm install

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

EXPOSE 3000

# Run the compiled JavaScript
CMD ["node", "dist/server.js"]