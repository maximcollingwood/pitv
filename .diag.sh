echo "=== deployed bundle ==="
ls -la /opt/pitv-frontend/dist/assets/index-*.js | head
echo
echo "=== new useDarkMode signature present? ==="
grep -o "setDarkAndPersist\|pitv_dark" /opt/pitv-frontend/dist/assets/index-*.js | sort | uniq -c
echo
echo "=== current pitv_dark writes (in time order) ==="
sudo -u kiosk python3 - <<'PY'
import os
path = "/home/kiosk/.kiosk-profile/Default/Local Storage/leveldb"
for f in sorted(os.listdir(path)):
    full = os.path.join(path, f)
    if not os.path.isfile(full): continue
    try:
        data = open(full, "rb").read()
    except Exception as e:
        print(f"{f}: cannot read ({e})"); continue
    hits, i = [], 0
    while True:
        j = data.find(b"pitv_dark", i)
        if j < 0: break
        hits.append(j); i = j + 1
    if not hits: continue
    print(f"--- {f}: {len(hits)} total ---")
    for h in hits[-6:]:
        s, e = max(0, h-2), min(len(data), h+14)
        print(repr(data[s:e]))
PY
