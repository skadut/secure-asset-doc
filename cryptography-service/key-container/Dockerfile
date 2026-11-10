FROM rust:1.85-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked && mkdir -p /run/keyd /var/lib/keyd /var/log/keyd /run/keyd-pub
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder --chown=65532:65532 /run/keyd /run/keyd
COPY --from=builder --chown=65532:65532 /var/lib/keyd /var/lib/keyd
COPY --from=builder --chown=65532:65532 /var/log/keyd /var/log/keyd
COPY --from=builder --chown=65532:65532 /run/keyd-pub /run/keyd-pub
COPY --from=builder /src/target/release/keyd /keyd
USER 65532:65532
ENTRYPOINT ["/keyd"]
