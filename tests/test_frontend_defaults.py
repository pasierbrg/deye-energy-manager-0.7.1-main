from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CARD_PATHS = (
    ROOT / "custom_components" / "deye_energy_manager" / "www" / "deye-energy-manager-card.js",
    ROOT / "www" / "deye-energy-manager-card.js",
)


def extract_method(source: str, signature: str) -> str:
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 0
    quote = None
    escaped = False
    for index in range(opening, len(source)):
        character = source[index]
        if quote:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in ('"', "'", "`"):
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise AssertionError(f"Nie znaleziono końca metody: {signature}")


class FrontendDefaultRestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = [path.read_text(encoding="utf-8") for path in CARD_PATHS]

    def test_distributed_card_copies_are_identical(self):
        self.assertEqual(CARD_PATHS[0].read_bytes(), CARD_PATHS[1].read_bytes())

    def test_apply_defaults_uses_one_backend_service_call_only(self):
        method = extract_method(self.sources[0], "async applyDefaultValues()")
        self.assertEqual(method.count("this.callService("), 1)
        self.assertIn(
            'this.callService("deye_energy_manager", "restore_defaults", {})',
            method,
        )
        for forbidden in (
            "select_option",
            "set_value",
            "default_work_mode",
            "default_sell_power",
            "default_discharge_current",
            "default_charge_current",
            "default_grid_charge_current",
            "Zero Export To Load",
            "numberState(",
        ):
            self.assertNotIn(forbidden, method)

    def test_apply_defaults_blocks_duplicates_and_reports_all_states(self):
        method = extract_method(self.sources[0], "async applyDefaultValues()")
        for required in (
            "if (this._defaultsApplying) return false",
            "Stosowanie ustawień domyślnych…",
            "Zastosowano ustawienia domyślne",
            "Nie udało się potwierdzić pełnego zestawu ustawień domyślnych",
        ):
            self.assertIn(required, method)
        self.assertIn("data-default-action", self.sources[0])
        self.assertIn("button.disabled = this._defaultsApplying", self.sources[0])

    def test_stop_manager_reuses_the_same_backend_path(self):
        method = extract_method(self.sources[0], "async stopManager()")
        self.assertIn("return this.applyDefaultValues()", method)
        self.assertNotIn("callService", method)


if __name__ == "__main__":
    unittest.main()
