FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_INGESTION_URL=http://localhost:5000
ARG VITE_REVIEW_URL=http://localhost:5002
ENV VITE_INGESTION_URL=$VITE_INGESTION_URL
ENV VITE_REVIEW_URL=$VITE_REVIEW_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
