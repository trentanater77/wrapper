FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server ./server

ENV NODE_ENV=production

CMD ["node", "server/controller.js"]
