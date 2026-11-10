FROM hashicorp/vault:1.18.5
RUN apk add --no-cache nodejs
RUN mkdir -p /dash-data && chown 100:1000 /dash-data
COPY *.mjs /dash/
COPY public/ /dash/public/
COPY scripts/ /scripts/
COPY policies/ /policies/
USER 100:1000
EXPOSE 8090
ENTRYPOINT ["node","/dash/server.mjs"]
