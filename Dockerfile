FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache build-base python3
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["npx", "tsx", "dist/server/index.js"]
