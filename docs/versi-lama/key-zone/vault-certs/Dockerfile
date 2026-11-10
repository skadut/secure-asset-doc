FROM alpine:3.20
RUN apk add --no-cache openssl
COPY certs.sh /certs.sh
ENTRYPOINT ["sh","/certs.sh"]
