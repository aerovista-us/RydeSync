FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY docs ./docs
ENV NODE_ENV=production
EXPOSE 9000
CMD ["node", "apps/api/server.js"]
