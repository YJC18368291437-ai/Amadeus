#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ! -r "${AMADEUS_CONFIG}" ]]; then
  echo "Mount a readable Amadeus configuration at ${AMADEUS_CONFIG}." >&2
  exit 1
fi

mkdir -p /data/code-server/User /data/code-server/extensions
if [[ ! -e /data/code-server/User/settings.json ]]; then
  cp /app/deploy/code-server-settings.json /data/code-server/User/settings.json
fi
# Seed bundled extensions on upgrades as well as on the first volume creation.
# Other user-installed extensions remain in the persistent directory.
for extension in /opt/amadeus-extensions/*/; do
  cp -a "$extension" /data/code-server/extensions/
done

editor_pid=''
app_pid=''
cleanup() {
  trap - EXIT INT TERM
  for pid in "$app_pid" "$editor_pid"; do
    if [[ -n "$pid" ]]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  done
  # Kill lingering compilation/extension children before Docker's stop deadline.
  for ((attempt=0; attempt<100; attempt++)); do
    alive=false
    for pid in "$app_pid" "$editor_pid"; do
      if [[ -n "$pid" ]] && kill -0 -- "-$pid" 2>/dev/null; then alive=true; fi
    done
    if [[ "$alive" == false ]]; then break; fi
    sleep 0.1
  done
  for pid in "$app_pid" "$editor_pid"; do
    if [[ -n "$pid" ]]; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Keep the unauthenticated editor private; Amadeus authenticates its HTTP/WS proxy.
setsid code-server --bind-addr 127.0.0.1:8080 --auth none \
  --disable-telemetry --disable-update-check --disable-workspace-trust \
  --user-data-dir /data/code-server \
  --extensions-dir /data/code-server/extensions /workspace &
editor_pid=$!

node --input-type=module <<'NODE'
const deadline = Date.now() + 60000;
while (true) {
  try {
    const response = await fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch {}
  if (Date.now() > deadline) throw new Error('code-server did not become ready within 60 seconds');
  await new Promise(resolve => setTimeout(resolve, 500));
}
NODE

setsid npm start &
app_pid=$!
# Failure of either service stops its peer; the container restart policy can recover.
set +e
wait -n "$editor_pid" "$app_pid"
status=$?
set -e
exit "$status"
