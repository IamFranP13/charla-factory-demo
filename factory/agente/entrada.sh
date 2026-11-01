#!/bin/sh
# Links the pre-installed node_modules into the mounted copy of the repository, then runs the command given.
set -e
if [ ! -e /work/node_modules ] && [ -d "$LIMONIA_DEPS" ]; then
  ln -s "$LIMONIA_DEPS" /work/node_modules
fi
exec "$@"
