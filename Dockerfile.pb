FROM alpine:latest
ARG PB_VERSION=0.27.0
RUN apk add --no-cache unzip ca-certificates curl wget
WORKDIR /pb
RUN case "$(uname -m)" in \
      x86_64|amd64) ARCH=amd64;; \
      aarch64|arm64) ARCH=arm64;; \
      *) echo "unsupported arch: $(uname -m)" && exit 1;; \
    esac && \
    curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip" -o /tmp/pb.zip && \
    unzip /tmp/pb.zip pocketbase && rm /tmp/pb.zip && chmod +x pocketbase
COPY pb-entrypoint.sh ./
RUN chmod +x pb-entrypoint.sh
EXPOSE 8090
VOLUME ["/pb_data"]
ENTRYPOINT ["./pb-entrypoint.sh"]
