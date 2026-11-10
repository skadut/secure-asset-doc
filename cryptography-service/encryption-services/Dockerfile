FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /crypt-module .
# Dir runtime dimiliki uid 65532 (nonroot). Named volume di path yang tidak ada di image jadi milik root.
RUN mkdir -p /var/log/crypto-api && chown 65532:65532 /var/log/crypto-api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /crypt-module /crypt-module
COPY --from=build --chown=65532:65532 /var/log/crypto-api /var/log/crypto-api
EXPOSE 2796
ENTRYPOINT ["/crypt-module"]
