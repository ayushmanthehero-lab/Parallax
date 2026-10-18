# The packaged redis-server needs GLIBC_2.38 and GLIBCXX_3.4.32.
# Bookworm is too old for this verified binary; Trixie supplies compatible ABIs.
FROM node:24-trixie-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3t64 libgomp1 libsystemd0 libstdc++6 gosu util-linux tini \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/gateway/package.json deploy/gateway/package-lock.json ./
# Binaries are an explicit pinned dependency. Disable Lite's downloading
# postinstall so builds cannot silently select a different FalkorDB release.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && node_modules/@falkordblite/linux-x64/bin/redis-server --version
COPY deploy/gateway/server.mjs deploy/gateway/main.mjs deploy/gateway/smoke.mjs deploy/gateway/entrypoint.sh ./
RUN chmod 755 /app/entrypoint.sh \
    && node /app/smoke.mjs
ENV NODE_ENV=production PORT=8080 FALKORDB_DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
