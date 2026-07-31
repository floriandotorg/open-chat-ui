FROM alpine:latest
ARG PB_VERSION=0.27.0
RUN apk add --no-cache unzip ca-certificates curl wget
RUN case "$(uname -m)" in \
      x86_64|amd64) ARCH=amd64;; \
      aarch64|arm64) ARCH=arm64;; \
      *) echo "unsupported arch: $(uname -m)" && exit 1;; \
    esac && \
    curl -sL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip" -o pb.zip && \
    unzip pb.zip pocketbase && rm pb.zip && chmod +x pocketbase
WORKDIR /pb
COPY pb-entrypoint.sh ./
RUN chmod +x pb-entrypoint.sh
EXPOSE 8090
VOLUME ["/pb_data"]
ENTRYPOINT ["./pb-entrypoint.sh"]
