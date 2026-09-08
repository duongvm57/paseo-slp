#!/usr/bin/env bash
set -euo pipefail
slp_source=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
slp_destination=${SLP_HOME:-"${HOME}/.local/share/paseo-slp"}
slp_paseo_home=${PASEO_HOME:-"${HOME}/.paseo"}
mkdir -p -- "$(dirname -- "$slp_destination")"
exec node "$slp_source/bin/slp.mjs" install "$slp_destination" --paseo-home "$slp_paseo_home" --apply --reload "$@"
