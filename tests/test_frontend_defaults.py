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


    def test_resume_manager_uses_dedicated_backend_service(self):
        method = extract_method(self.sources[0], "async resumeManager()")
        self.assertEqual(method.count("this.callService("), 1)
        self.assertIn('this.callService("deye_energy_manager", "resume_manager", {})', method)
        self.assertIn("data-resume-manager", self.sources[0])
        self.assertIn("SCHEDULE APPLY ERROR", self.sources[0])

    def test_ai_dialog_contains_approved_navigation_and_controls(self):
        source = self.sources[0]
        for required in (
            "Przegląd",
            "Proponowane zmiany",
            "Plan na dziś",
            "Plan na jutro",
            "Plan energii 48h",
            "Jakość danych",
            "Zaznacz wszystkie",
            "Odznacz wszystkie",
            "Pełne 24h",
            "save_future_plan",
            "cancel_future_plan",
            "Produkcja rzeczywista",
            "Prognoza Solcast",
            "Prognoza skorygowana",
            "Przedział prognozy",
            "data-ai-chart-point",
            "data-ai-weather-mode",
            "aiReadableEnergyChart",
            "aiReadableDayChart",
            "ai-crisp-weather-grid",
            "data-ai-chart-series",
            "ai-readable-weather",
            "ai-status-sell",
            "ai-status-charge",
            "ai-status-tariff",
        ):
            self.assertIn(required, source)
        self.assertNotIn(">P50<", source)

    def test_documentation_uses_current_card_cache_revision(self):
        for name in ("README.md", "INSTALL_PL.md"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn("deye-energy-manager-card.js?v=0773", source)
            self.assertNotIn("deye-energy-manager-card.js?v=0772", source)
            self.assertNotIn("deye-energy-manager-card.js?v=0765", source)

    def test_card_has_explicit_direct_edit_path_for_physical_tou_entities(self):
        source = self.sources[0]
        self.assertIn("data-open-tou", source)
        tou_dialog = extract_method(source, "renderDialog(slots, touStarts)")
        for required in (
            "this.timeInput(tou.",
            "this.numberInput(tou.",
            "this.pill(tou.grid)",
        ):
            self.assertIn(required, tou_dialog)

    def test_unconfirmed_logical_tou_soc_never_renders_as_zero(self):
        source = self.sources[0]
        self.assertIn("touSocInput(entityId)", source)
        self.assertIn('placeholder="wymaga potwierdzenia"', source)
        dialog = extract_method(source, "renderDialog(slots, touStarts)")
        self.assertIn("this.touSocInput(entities.touSoc)", dialog)
        self.assertNotIn("this.numberInput(entities.touSoc", dialog)

    def test_mapping_distinguishes_charge_from_grid_permission(self):
        source = self.sources[0]
        self.assertIn("chargeMode: isCharge", source)
        self.assertIn('item.chargeMode ? "Charge" : "Limit SOC"', source)

    def test_charge_profile_save_uses_one_backend_service_only(self):
        method = extract_method(self.sources[0], "async saveChargeProfile()")
        self.assertEqual(method.count("this.callService("), 1)
        self.assertIn(
            'this.callService("deye_energy_manager", "save_charge_profile", values)',
            method,
        )
        for forbidden in (
            "number.set_value",
            "switch.turn_on",
            "switch.turn_off",
            "select.select_option",
            "setNumber(",
            "turnSwitch(",
            "setSelect(",
        ):
            self.assertNotIn(forbidden, method)

    def test_charge_current_input_keeps_draft_and_physical_range_without_zero_fallback(self):
        method = extract_method(self.sources[0], "chargeProfileInput(name, entityId, unit = \"\")")
        for required in (
            "this._chargeProfileDraft",
            '["unknown", "unavailable", ""]',
            "entity?.attributes?.min",
            "entity?.attributes?.max",
            "entity?.attributes?.step",
            'type="number"',
            'data-charge-profile-number=',
            "fallback.min",
            "fallback.max",
        ):
            self.assertIn(required, method)
        for forbidden in ("?? 0", "|| 0", 'value="0"'):
            self.assertNotIn(forbidden, method)

    def test_charge_profile_draft_survives_input_change_and_rerender(self):
        source = self.sources[0]
        self.assertIn(
            "this._chargeProfileDraft[el.dataset.chargeProfileNumber] = el.value",
            source,
        )
        self.assertIn('el.addEventListener("input", saveDraft)', source)
        self.assertIn('el.addEventListener("change", saveDraft)', source)
        self.assertIn(
            'this.chargeProfileInput("charge_current", this.entity("number", "charge_profile_charge_current"), "A")',
            source,
        )

    def test_settings_menu_and_forms_follow_the_approved_layout(self):
        source = self.sources[0]
        dialog = extract_method(source, "renderDialog(slots, touStarts)")
        self.assertIn('tabButton("defaults", "Ustawienia Tryb', dialog)
        self.assertNotIn('tabButton("charge"', dialog)
        defaults_heading = dialog.index("Ustawienia domy")
        charge_heading = dialog.index("Ustawienia ", defaults_heading + 1)
        self.assertGreater(charge_heading, defaults_heading)
        self.assertIn("data-save-default-settings", dialog)
        self.assertIn("data-save-charge-profile", dialog)

    def test_default_and_charge_forms_have_independent_backend_calls(self):
        default_method = extract_method(self.sources[0], "async saveDefaultSettings()")
        charge_method = extract_method(self.sources[0], "async saveChargeProfile()")
        self.assertIn('"save_default_settings"', default_method)
        self.assertNotIn('"save_charge_profile"', default_method)
        self.assertIn('"save_charge_profile"', charge_method)
        self.assertNotIn('"save_default_settings"', charge_method)

    def test_charge_slot_is_editable_and_profile_is_only_a_template(self):
        source = self.sources[0]
        dialog = extract_method(source, "renderDialog(slots, touStarts)")
        charge_start = dialog.index("const slotFields = isCharge ?")
        non_charge_start = dialog.index(": `", charge_start)
        charge_block = dialog[charge_start:non_charge_start]
        for required in (
            "numberInput(entities.chargeCurrent",
            "numberInput(entities.dischargeCurrent",
            "numberInput(entities.gridChargeCurrent",
            "touSocInput(entities.touSoc)",
            "pill(entities.chargeEnabled)",
            "Wartości początkowe skopiowano",
        ):
            self.assertIn(required, charge_block)
        self.assertIn("pill(entities.chargeEnabled)", dialog)

    def test_settings_dialog_scrolls_on_desktop_tablet_and_phone(self):
        source = self.sources[0]
        self.assertIn(".settings-content{min-width:0;overflow:auto", source)
        self.assertIn("@media(max-width:980px)", source)
        self.assertIn(".settings-layout{grid-template-columns:1fr", source)
        self.assertIn("@media(max-width:620px)", source)
        self.assertIn(".settings-content{padding:9px}", source)

    def test_diagnostics_show_logical_and_physical_soc_separately(self):
        method = extract_method(self.sources[0], "renderDiagnostics(slots)")
        for required in (
            "active_slot_control",
            "physical_tou",
            "minimum_sell_soc",
            "tou_soc",
            "charge_profile_target_soc",
            "effective_tou_soc",
            "physical_soc_actual",
            "grid_charge_expected",
            "grid_charge_actual",
            "currents",
        ):
            self.assertIn(required, method)


if __name__ == "__main__":
    unittest.main()
