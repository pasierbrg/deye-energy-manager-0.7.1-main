from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JS_TEST = ROOT / "tests" / "test_normal_profile_card.js"


class NormalProfileCardBehaviorTests(unittest.TestCase):
    def test_card_behavior_suite_passes(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node.js is required for card behavior tests")
        result = subprocess.run(
            [node, str(JS_TEST)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            self.fail(f"JS behavior tests failed:\n{result.stdout}\n{result.stderr}")
        self.assertIn("All normal profile card behavior tests passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
