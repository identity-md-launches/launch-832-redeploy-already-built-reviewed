"""Offline preservation check against the SHA-256 inventory of launch 814.

Run: python3 script/check_source.py
The inventory is recorded in SOURCE.json from the pinned source archive.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = json.loads((ROOT / "SOURCE.json").read_text())
changed = []
for name, expected in source["originalSha256"].items():
    actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    if actual != expected:
        changed.append(name)

allowed = {
    "launch.json",
    "script/Deploy.s.sol",
    "src/KingHook.sol",
    "test/Deploy.t.sol",
    "test/KingBase.sol",
    "test/KingHook.Security.t.sol",
    "test/fork/KingHookFork.t.sol",
}
assert set(changed) <= allowed, f"Unexpected source changes: {set(changed) - allowed}"
hook = (ROOT / "src/KingHook.sol").read_text()
old = hook.replace(
    "if (key.fee != 12_500)",
    "if (key.fee != 500 && key.fee != 3000 && key.fee != 10_000)",
)
assert hashlib.sha256(old.encode()).hexdigest() == source["originalSha256"]["src/KingHook.sol"], (
    "KingHook changed beyond its LP fee guard"
)
manifest = json.loads((ROOT / "launch.json").read_text())
assert manifest["pool"]["fee"] == 12500
assert manifest["pool"]["tickSpacing"] == 60
assert manifest["pool"]["initialPrice"] == "792281625142643375935439503360000"
assert manifest["hook"]["constructorArgs"] == ["$poolManager", "$token"]
print("PASS: only permitted fee-policy paths changed; production logic, dependencies and compiler preserved.")
