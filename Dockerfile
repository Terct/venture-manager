FROM node:16.20.2

WORKDIR /app
COPY . .
RUN rm -rf node_modules
RUN npm install
CMD ["node", "app.js"]

EXPOSE 61854