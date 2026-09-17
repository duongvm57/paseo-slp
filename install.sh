#!/usr/bin/env bash
set -euo pipefail
slp_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec node "$slp_source/bin/slp.mjs" install ${SLP_HOME:+"$SLP_HOME"} --paseo-home ${PASEO_HOME:+"$PASEO_HOME"} --apply --reload "$@"
