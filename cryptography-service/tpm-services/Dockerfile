# build stage: compile static tpm-msk binary with the pinned Go toolchain
FROM golang:1.26.8-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tpm-msk ./cmd/tpm-msk
RUN mkdir -p /out/data

# final stage: distroless nonroot runtime, binary plus data dir only
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build --chown=65532:65532 /out/data /data
COPY --from=build /out/tpm-msk /tpm-msk
ENV APPDATA=/data
ENTRYPOINT ["/tpm-msk"]
