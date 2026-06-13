FROM mcr.microsoft.com/playwright:v1.60.0-noble

ENV CI=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_PATH=/opt/shiplight/node_modules
ENV PATH="/opt/shiplight/node_modules/.bin:${PATH}"

WORKDIR /repo

COPY e2e/oidc/package*.json /opt/shiplight/
RUN cd /opt/shiplight && npm ci

CMD ["node", "e2e/oidc/run.mjs"]
