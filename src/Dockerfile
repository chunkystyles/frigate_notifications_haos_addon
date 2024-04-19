ARG BUILD_FROM
FROM $BUILD_FROM
CMD ["/run.sh"]
COPY package.json ./
COPY package-lock.json ./
RUN apk add --no-cache \
    nodejs \
    npm
RUN npm ci --no-audit
COPY run.sh ./
RUN chmod a+x /run.sh
COPY app.js ./
