"""The source VERSION and embedded bundle metadata must retain the release identity."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class BundleVersionTest(unittest.TestCase):
    def test_native_version_accepts_exact_semver_and_rejects_ambiguous_channels(self):
        tool = Path(__file__).resolve().parents[1] / "docker" / "release.py"
        with tempfile.TemporaryDirectory(prefix="community-version-") as directory:
            root = Path(directory)
            for version in ["1.2.3", "1.2.3-dev.0", "1.2.3-dev.10"]:
                (root / "VERSION").write_text(version + "\n")
                result = subprocess.run([sys.executable, str(tool), "version", "--name", "fixture-docs"], cwd=root, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["version"], version)
            for version in ["1.2.3.dev0", "1.2.3-rc.1", "01.2.3", "1.2.3-dev.01", "not-a-version"]:
                (root / "VERSION").write_text(version)
                result = subprocess.run([sys.executable, str(tool), "version", "--name", "fixture-docs"], cwd=root, text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0, version)


if __name__ == "__main__":
    unittest.main()
