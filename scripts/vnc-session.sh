#!/usr/bin/env bash
# Xvfb + openbox + x11vnc + noVNC(websockify) + 一个 xterm，供 iPad 通过 noVNC 使用。
# 由 systemd 单元 bci-vnc.service 拉起。
set -u
DISPLAY_NUM=":99"
RFB_PORT=5900
WEB_PORT=6080
GEOMETRY="1600x1000x24"
VNC_DIR=/srv/amadeus/vnc
WS=/mnt/c/Users/LEGION/Desktop/bme学习

export DISPLAY="$DISPLAY_NUM"
export XDG_RUNTIME_DIR=/tmp/xdg-99
export QT_QPA_PLATFORM=xcb
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
mkdir -p "$VNC_DIR"

cleanup() {
  for pid in ${XTERM_PID:-} ${WS_PID:-} ${X11VNC_PID:-} ${WM_PID:-} ${XVFB_PID:-}; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY_NUM" -screen 0 "$GEOMETRY" -nolisten tcp >"$VNC_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
sleep 2

openbox >"$VNC_DIR/openbox.log" 2>&1 &
WM_PID=$!
sleep 1

x11vnc -display "$DISPLAY_NUM" -rfbport "$RFB_PORT" -localhost \
  -rfbauth "$VNC_DIR/passwd" -forever -shared -repeat \
  -o "$VNC_DIR/x11vnc.log" >/dev/null 2>&1 &
X11VNC_PID=$!

websockify --web=/usr/share/novnc "127.0.0.1:$WEB_PORT" "localhost:$RFB_PORT" \
  >"$VNC_DIR/websockify.log" 2>&1 &
WS_PID=$!

xterm -fa 'Noto Sans Mono CJK SC' -fs 12 -bg black -fg white \
  -geometry 100x30 -title "BCI 终端" \
  -e bash -lc "cd '$WS' && source bci-env.sh && clear && \
     echo '===== MNE 交互浏览器 · 使用方法 ====='; \
     echo '  python _diag/mne_interactive.py      # 打开本地 sample EEG'; \
     echo '  python _diag/smoke_gpu.py            # GPU 冒烟测试'; \
     echo '  bci-mne                              # 同上（快捷命令）'; \
     echo '====================================='; \
     exec bash" \
  >"$VNC_DIR/xterm.log" 2>&1 &
XTERM_PID=$!

wait
