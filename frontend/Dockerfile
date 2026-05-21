FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_KEY=$VITE_API_KEY

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/app/ app/
COPY frontend/env.d.ts .
COPY frontend/react-router.config.ts .
COPY frontend/tsconfig.json .
COPY frontend/vite.config.ts .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/build/client /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
