FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Core prerequisites — what a real clean machine would have.
# We keep apt lists so braseh can install packages at runtime.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        curl \
        sudo \
        git \
        ca-certificates \
        gpg \
        unzip \
        tar \
        iproute2

# Non-root test user with passwordless sudo
RUN useradd -m -s /bin/bash testuser && \
    echo "testuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Copy the braseh binary
COPY braseh /usr/local/bin/braseh
RUN chmod +x /usr/local/bin/braseh

USER testuser
WORKDIR /home/testuser

# Copy all suite configs and verify scripts
COPY --chown=testuser:testuser e2e/suites/basic/braseh.ts   /home/testuser/basic.ts
COPY --chown=testuser:testuser e2e/suites/basic/verify.sh  /home/testuser/verify-basic.sh
COPY --chown=testuser:testuser e2e/suites/basic/files/     /home/testuser/dotfiles/

COPY --chown=testuser:testuser e2e/suites/advanced/braseh.ts          /home/testuser/advanced.ts
COPY --chown=testuser:testuser e2e/suites/advanced/verify.sh         /home/testuser/verify-advanced.sh
COPY --chown=testuser:testuser e2e/suites/advanced/fixtures/         /home/testuser/fixtures/

COPY --chown=testuser:testuser e2e/suites/system/braseh.ts   /home/testuser/system.ts
COPY --chown=testuser:testuser e2e/suites/system/verify.sh  /home/testuser/verify-system.sh

COPY --chown=testuser:testuser e2e/suites/secrets/braseh.ts   /home/testuser/secrets.ts
COPY --chown=testuser:testuser e2e/suites/secrets/cyclic.ts  /home/testuser/cyclic.ts
COPY --chown=testuser:testuser e2e/suites/secrets/verify.sh  /home/testuser/verify-secrets.sh

RUN chmod +x /home/testuser/verify-*.sh

CMD ["/bin/bash"]
