FROM zenika/alpine-chrome:with-puppeteer

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "index.js"]