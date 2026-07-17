FROM node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

ARG PI_VERSION=0.80.9
ARG RTK_VERSION=0.42.3
ARG RTK_SHA256=2b7fa09d06f8dbf334c55482fad2e7ce4a1f8564bc9ed1f65d9f5992db8e5527

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl git make \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global "@earendil-works/pi-coding-agent@${PI_VERSION}"

RUN curl --fail --location --silent --show-error \
      "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/rtk-aarch64-unknown-linux-gnu.tar.gz" \
      --output /tmp/rtk.tar.gz \
    && echo "${RTK_SHA256}  /tmp/rtk.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/rtk.tar.gz --directory /usr/local/bin rtk \
    && chmod 0755 /usr/local/bin/rtk \
    && rm /tmp/rtk.tar.gz

RUN groupadd --gid 65532 bossman \
    && useradd --uid 65532 --gid 65532 --no-create-home --home-dir /tmp/home --shell /usr/sbin/nologin bossman

WORKDIR /workspace
USER 65532:65532
ENTRYPOINT ["pi"]
