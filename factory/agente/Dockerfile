# The agent image: one agent works one task in a throwaway container. It holds no credential:
# the model key stays outside (a proxy) and ANTHROPIC_BASE_URL is set when the container starts.
# Build from the repository root: npm run agente:imagen
FROM node:26-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

RUN apt-get update \
  && apt-get install -y --no-install-recommends git chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# Claude Code, at an exact version
RUN npm install -g @anthropic-ai/claude-code@2.1.316 && npm cache clean --force

# The repository's dependencies, installed once; a task links them into its copy of the repo.
# (owned by the agent user: the build writes its caches inside node_modules)
RUN mkdir /opt/limonia /work && chown node:node /opt/limonia /work
USER node
WORKDIR /opt/limonia
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY --chmod=755 factory/agente/entrada.sh /usr/local/bin/entrada
ENV FACTORY_BROWSER=chromium LIMONIA_DEPS=/opt/limonia/node_modules DISABLE_AUTOUPDATER=1

# The task's copy of the repository is mounted here
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/entrada"]
CMD ["bash"]
