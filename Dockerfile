FROM node:24-bookworm-slim

ARG GIT_COMMIT=unknown
ARG INSTALLED_CHANNEL=stable

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY src ./src
COPY db ./db
COPY portal ./portal
COPY tsconfig.json ./tsconfig.json
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV GIT_COMMIT=${GIT_COMMIT}
ENV INSTALLED_CHANNEL=${INSTALLED_CHANNEL}

EXPOSE 3000
EXPOSE 3001

CMD ["npm", "start"]
