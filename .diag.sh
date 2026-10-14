#!/bin/sh
# Read-only PiTV appliance diagnostics. No database changes or service restarts.
printf '\nPiTV services\n'
systemctl --no-pager status kiosk pitv-backend nginx || true
printf '\nNative dependencies\n'
command -v pitv-native
gst-inspect-1.0 qml6glsink | head -n 14
gst-inspect-1.0 pulsesink | head -n 14
printf '\nLocal service and player status\n'
curl --max-time 3 -fsS http://127.0.0.1:3000/api/health || true
printf '\n'
curl --max-time 3 -fsS http://127.0.0.1:3000/api/device/status || true
printf '\nStorage\n'
df -h /var/lib/pitv
printf '\nRecent application logs\n'
journalctl --no-pager -u kiosk -u pitv-backend -b -n 80
printf '\nPi power and temperature (if available)\n'
if command -v vcgencmd >/dev/null 2>&1; then
  vcgencmd get_throttled
  vcgencmd measure_temp
fi
