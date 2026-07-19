from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "custom_components" / "deye_energy_manager"


def _install_home_assistant_stubs() -> None:
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    helpers = types.ModuleType("homeassistant.helpers")
    event = types.ModuleType("homeassistant.helpers.event")
    storage = types.ModuleType("homeassistant.helpers.storage")
    util = types.ModuleType("homeassistant.util")
    dt = types.ModuleType("homeassistant.util.dt")

    core.HomeAssistant = object
    core.callback = lambda function: function
    event.async_track_time_interval = lambda *_args, **_kwargs: lambda: None
    event.async_track_point_in_time = lambda *_args, **_kwargs: lambda: None
    event.async_track_state_change_event = lambda *_args, **_kwargs: lambda: None

    class Store:
        def __init__(self, *_args, **_kwargs):
            pass

    storage.Store = Store
    dt.now = lambda: datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)

    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.helpers": helpers,
            "homeassistant.helpers.event": event,
            "homeassistant.helpers.storage": storage,
            "homeassistant.util": util,
            "homeassistant.util.dt": dt,
        }
    )


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


_install_home_assistant_stubs()
package = types.ModuleType("custom_components.deye_energy_manager")
package.__path__ = [str(PACKAGE)]
sys.modules[package.__name__] = package
const = _load_module(f"{package.__name__}.const", PACKAGE / "const.py")
manager = _load_module(f"{package.__name__}.manager", PACKAGE / "manager.py")
manager.ha_now = lambda: datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)


class FakeState:
    def __init__(self, state, attributes=None, entity_id=""):
        self.entity_id = entity_id
        self.state = str(state)
        self.attributes = attributes or {}


class FakeStates:
    def __init__(self, values=None):
        self.values = values or {}
        for entity_id, state in self.values.items():
            state.entity_id = entity_id

    def get(self, entity_id):
        return self.values.get(entity_id)

    def async_all(self, domain=None):
        prefix = f"{domain}." if domain else ""
        return [state for entity_id, state in self.values.items() if entity_id.startswith(prefix)]


class FakeServices:
    def __init__(self, hass):
        self.hass = hass
        self.calls = []
        self.failures = []

    def ignore_once(self, domain, service, *, entity_id=None, option=None):
        self.failures.append({"domain": domain, "service": service, "entity_id": entity_id, "option": option, "remaining": 1, "ignore": True})

    def fail_once(self, domain, service, *, entity_id=None, option=None):
        self.failures.append(
            {
                "domain": domain,
                "service": service,
                "entity_id": entity_id,
                "option": option,
                "remaining": 1,
            }
        )

    async def async_call(self, domain, service, data, blocking=False):
        self.calls.append((domain, service, dict(data), blocking))
        for failure in self.failures:
            if failure["remaining"] <= 0:
                continue
            if failure["domain"] != domain or failure["service"] != service:
                continue
            if failure["entity_id"] is not None and data.get("entity_id") != failure["entity_id"]:
                continue
            if failure["option"] is not None and data.get("option") != failure["option"]:
                continue
            failure["remaining"] -= 1
            if failure.get("ignore"):
                return
            raise RuntimeError(f"Injected {domain}.{service} failure")

        entity_id = data.get("entity_id")
        if not entity_id:
            return
        if domain == "select" and service == "select_option":
            value = data["option"]
        elif domain == "number" and service == "set_value":
            value = data["value"]
        elif domain == "switch":
            value = "on" if service == "turn_on" else "off"
        elif domain == "time" and service == "set_value":
            value = data["time"]
        else:
            return
        self.hass.states.values[entity_id] = FakeState(value, entity_id=entity_id)


class FakeHass:
    def __init__(self, states):
        self.states = FakeStates(states)
        self.services = FakeServices(self)

    def async_create_task(self, coroutine):
        coroutine.close()
        return None


def make_runtime(soc="50", price="0.50", default_mode=None):
    states = {
        const.DEFAULT_WORK_MODE_SELECT: FakeState(const.MODE_ZERO_EXPORT),
        const.DEFAULT_MAX_SELL_POWER: FakeState("0"),
        const.DEFAULT_DISCHARGE_CURRENT: FakeState("0"),
        const.DEFAULT_CHARGE_CURRENT: FakeState("0"),
        const.DEFAULT_GRID_CHARGE_CURRENT: FakeState("0"),
    }
    states["switch.deye_inverter_time_of_use"] = FakeState("off")
    for idx in range(1, 7):
        states[f"time.deye_inverter_time_of_use_{idx}_start"] = FakeState("00:00:00")
        states[f"number.deye_inverter_time_of_use_{idx}_soc"] = FakeState("20")
        states[f"switch.deye_inverter_time_of_use_{idx}_grid_charge"] = FakeState("off")
    if soc is not None:
        states[const.DEFAULT_BATTERY_SOC] = FakeState(soc)
    if price is not None:
        states[const.DEFAULT_PRICE_SENSOR] = FakeState(price)
    runtime = manager.DeyeEnergyManagerRuntime(
        hass=FakeHass(states),
        entry_id="test",
        data={
            const.CONF_WORK_MODE_SELECT: const.DEFAULT_WORK_MODE_SELECT,
            const.CONF_MAX_SELL_POWER_NUMBER: const.DEFAULT_MAX_SELL_POWER,
            const.CONF_DISCHARGE_CURRENT_NUMBER: const.DEFAULT_DISCHARGE_CURRENT,
            const.CONF_CHARGE_CURRENT_NUMBER: const.DEFAULT_CHARGE_CURRENT,
            const.CONF_GRID_CHARGE_CURRENT_NUMBER: const.DEFAULT_GRID_CHARGE_CURRENT,
            const.CONF_BATTERY_SOC_SENSOR: const.DEFAULT_BATTERY_SOC,
            const.CONF_PRICE_SENSOR: const.DEFAULT_PRICE_SENSOR,
        },
    )
    runtime.default_work_mode = default_mode or const.MODE_ZERO_EXPORT
    runtime.default_sell_power = 13000
    runtime.default_discharge_current = 120
    runtime.default_charge_current = 120
    runtime.default_grid_charge_current = 60
    return runtime


CONTROL_NUMBERS = {
    const.DEFAULT_MAX_SELL_POWER: 13000,
    const.DEFAULT_DISCHARGE_CURRENT: 120,
    const.DEFAULT_CHARGE_CURRENT: 120,
    const.DEFAULT_GRID_CHARGE_CURRENT: 60,
}


def configure_selling_slot(runtime):
    runtime.scheduler_enabled = True
    active = runtime.slots[runtime.active_slot_key()]
    active.enabled = True
    active.mode = const.MODE_SELLING_FIRST
    active.sell_power = 5000
    active.discharge_current = 120
    return active


def control_number_calls(runtime):
    return [
        call
        for call in runtime.hass.services.calls
        if call[:2] == ("number", "set_value") and call[2].get("entity_id") in CONTROL_NUMBERS
    ]


class SafetyTests(unittest.TestCase):
    def test_missing_soc_blocks_selling(self):
        runtime = make_runtime(soc=None)
        self.assertTrue(runtime.data_available)
        self.assertFalse(runtime.soc_ok)
        self.assertFalse(runtime.sell_allowed)

    def test_unavailable_and_non_finite_soc_block_selling(self):
        for value in ("unavailable", "unknown", "nan", "inf"):
            with self.subTest(value=value):
                runtime = make_runtime(soc=value)
                self.assertFalse(runtime.soc_ok)
                self.assertFalse(runtime.sell_allowed)

    def test_price_guard_fails_closed(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = True
        runtime.price_sell_threshold = 0.2
        self.assertTrue(runtime.data_available)
        self.assertFalse(runtime.price_ok)
        self.assertFalse(runtime.sell_allowed)

    def test_disabled_price_guard_does_not_require_price(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = False
        runtime.price_sell_threshold = 0.2
        self.assertTrue(runtime.data_available)
        self.assertTrue(runtime.price_ok)

    def test_slot_price_limit_is_enforced_without_global_guard(self):
        runtime = make_runtime(price=None)
        runtime.scheduler_enabled = True
        runtime.price_guard_enabled = False
        active = runtime.slots[runtime.active_slot_key()]
        active.enabled = True
        active.min_sell_price = 0.2
        self.assertTrue(runtime.data_available)
        self.assertFalse(runtime.price_ok)


class MappingAndTransactionTests(unittest.TestCase):
    def assert_safe_defaults(self, runtime, expected_mode=const.MODE_ZERO_EXPORT):
        calls = control_number_calls(runtime)
        self.assertTrue(calls)
        for entity_id, expected in CONTROL_NUMBERS.items():
            entity_calls = [call for call in calls if call[2]["entity_id"] == entity_id]
            self.assertTrue(entity_calls, entity_id)
            self.assertEqual(entity_calls[-1][2]["value"], expected, entity_id)
        self.assertFalse(
            any(call[2]["value"] == 0 for call in calls),
            "Control entities must never be automatically zeroed",
        )
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertTrue(select_calls)
        self.assertEqual(select_calls[-1][2]["option"], expected_mode)


    def test_stop_sell_applies_defaults_and_remains_latched(self):
        runtime = make_runtime()
        asyncio.run(runtime.async_request_stop())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)
        self.assertEqual(runtime.default_sell_power, 13000)
        self.assertEqual(runtime.default_discharge_current, 120)
        self.assertEqual(runtime.default_charge_current, 120)
        self.assertEqual(runtime.default_grid_charge_current, 60)
        runtime.hass.services.calls.clear()
        asyncio.run(runtime.async_tick())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)

    def test_emergency_stop_latches_stopped_control_mode(self):
        runtime = make_runtime()
        runtime.scheduler_enabled = True
        asyncio.run(runtime.async_emergency_stop())
        self.assertTrue(runtime.emergency_stop)
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)
        runtime.emergency_stop = False
        runtime.hass.services.calls.clear()
        asyncio.run(runtime.async_tick())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)

    def test_safe_defaults_preserve_a_configured_selling_first_mode(self):
        runtime = make_runtime(default_mode=const.MODE_SELLING_FIRST)
        asyncio.run(runtime.async_emergency_stop())
        self.assert_safe_defaults(runtime, const.MODE_SELLING_FIRST)

    def test_safe_defaults_preserve_zero_export_to_ct(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        asyncio.run(runtime.async_emergency_stop())
        self.assert_safe_defaults(runtime, const.MODE_ZERO_EXPORT_CT)

    def test_user_selected_zero_defaults_are_respected(self):
        runtime = make_runtime()
        runtime.default_sell_power = 0
        runtime.default_discharge_current = 0
        runtime.default_charge_current = 0
        runtime.default_grid_charge_current = 0
        asyncio.run(runtime.async_request_stop())
        calls = control_number_calls(runtime)
        self.assertEqual({call[2]["value"] for call in calls}, {0})

    def test_partial_safe_default_failure_is_reported_as_critical(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_CHARGE_CURRENT,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_safe_defaults("Test awarii")))
        self.assertIn("KRYTYCZNY", runtime.last_error)
        self.assertIn("Maximum Battery Charge Current", runtime.last_error)
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertTrue(select_calls)
        self.assertTrue(all(call[2]["option"] == const.MODE_ZERO_EXPORT_CT for call in select_calls))

    def test_missing_and_unavailable_soc_apply_defaults(self):
        for soc in (None, "unavailable", "unknown"):
            with self.subTest(soc=soc):
                runtime = make_runtime(soc=soc)
                configure_selling_slot(runtime)
                self.assertFalse(asyncio.run(runtime.async_apply_targets()))
                self.assert_safe_defaults(runtime)

    def test_price_error_applies_defaults(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = True
        runtime.price_sell_threshold = 0.2
        configure_selling_slot(runtime)
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_low_slot_soc_blocks_sale_without_schedule_error(self):
        runtime = make_runtime(soc="40")
        active = configure_selling_slot(runtime)
        active.minimum_sell_soc = 45

        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.manager_status, "SELL BLOCKED")
        self.assertIn("SOC", runtime.decision_reason)
        self.assertEqual(runtime.last_schedule_attempt["status"], "applied")
        self.assertEqual(runtime.last_error, "")
        self.assertEqual(
            runtime.hass.states.get(const.DEFAULT_WORK_MODE_SELECT).state,
            runtime.default_work_mode,
        )
        self.assertEqual(
            runtime.hass.states.get(const.DEFAULT_MAX_SELL_POWER).state,
            str(runtime.default_sell_power),
        )

        calls_after_first_block = list(runtime.hass.services.calls)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.hass.services.calls, calls_after_first_block)
        self.assertEqual(runtime.last_schedule_attempt["status"], "blocked")
        self.assertIn("SOC", runtime.last_action)

    def test_low_slot_price_blocks_sale_without_schedule_error(self):
        runtime = make_runtime(price="0.15")
        active = configure_selling_slot(runtime)
        active.min_sell_price = 0.20

        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.manager_status, "SELL BLOCKED")
        self.assertIn("cena", runtime.decision_reason)
        self.assertEqual(runtime.last_schedule_attempt["status"], "applied")
        self.assertEqual(runtime.last_error, "")
        self.assertEqual(
            runtime.hass.states.get(const.DEFAULT_WORK_MODE_SELECT).state,
            runtime.default_work_mode,
        )

    def test_direct_selling_is_blocked_without_soc(self):
        runtime = make_runtime(soc=None)
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_settings(const.MODE_SELLING_FIRST, 5000, 120, 0))
        self.assert_safe_defaults(runtime)

    def test_more_than_six_segments_is_rejected(self):
        runtime = make_runtime()
        for index, slot in enumerate(runtime.slots.values()):
            slot.enabled = True
            slot.minimum_sell_soc = 10 if index % 2 else 20
        self.assertTrue(runtime.mapping_error)
        self.assertGreater(len(runtime._compress_schedule_segments()), 6)
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_invalid_patch_rolls_back_and_keeps_safe_mode(self):
        runtime = make_runtime()
        updates = []
        for index, slot_key in enumerate(list(runtime.slots)[:8]):
            updates.append({"slot_key": slot_key, "enabled": True, "minimum_sell_soc": 10 if index % 2 else 20})
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_schedule_patch(updates))
        self.assertTrue(all(not slot.enabled for slot in runtime.slots.values()))
        self.assert_safe_defaults(runtime)

    def test_tou_write_error_restores_defaults(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once("time", "set_value")
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime, const.MODE_ZERO_EXPORT_CT)
        self.assertIn("ustawienia domyślne", runtime.last_error)

    def test_numeric_write_error_restores_defaults(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_MAX_SELL_POWER,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_target_mode_error_restores_defaults(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once(
            "select",
            "select_option",
            option=const.MODE_SELLING_FIRST,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_failed_schedule_patch_rolls_back_and_restores_defaults(self):
        runtime = make_runtime()
        slot_key = runtime.active_slot_key()
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_MAX_SELL_POWER,
        )
        with self.assertRaises(RuntimeError):
            asyncio.run(
                runtime.async_apply_schedule_patch(
                    [
                        {
                            "slot_key": slot_key,
                            "enabled": True,
                            "mode": const.MODE_SELLING_FIRST,
                            "sell_power": 5000,
                            "discharge_current": 120,
                        }
                    ]
                )
            )
        self.assertFalse(runtime.slots[slot_key].enabled)
        self.assert_safe_defaults(runtime)

    def test_selling_update_writes_numbers_before_target_mode(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_SELLING_FIRST)
        self.assertFalse(any(call[2]["value"] == 0 for call in control_number_calls(runtime)))
        ordered_control_calls = [
            call
            for call in runtime.hass.services.calls
            if call[:2] in (("select", "select_option"), ("number", "set_value"))
            and (
                call[2].get("entity_id") == const.DEFAULT_WORK_MODE_SELECT
                or call[2].get("entity_id") in CONTROL_NUMBERS
            )
        ]
        self.assertEqual(ordered_control_calls[-1][2]["option"], const.MODE_SELLING_FIRST)
        self.assertTrue(all(call[:2] == ("number", "set_value") for call in ordered_control_calls[:-1]))

    def test_delayed_work_mode_waits_without_rewriting_and_confirms(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.ignore_once(
            "select", "select_option", entity_id=const.DEFAULT_WORK_MODE_SELECT,
            option=const.MODE_SELLING_FIRST,
        )
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(len(select_calls), 1)
        self.assertEqual(runtime.last_schedule_attempt["status"], "pending")
        self.assertEqual(runtime.manager_status, "SELLING ACTIVE")
        # Deye may publish the selected mode later.  A fast confirmation
        # recheck must only read the first transaction, never write it again.
        runtime.hass.states.values[const.DEFAULT_WORK_MODE_SELECT] = FakeState(
            const.MODE_SELLING_FIRST,
            entity_id=const.DEFAULT_WORK_MODE_SELECT,
        )
        asyncio.run(runtime._async_recheck_pending_control())
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(len(select_calls), 1)
        self.assertEqual(runtime.last_schedule_attempt["status"], "applied")

    def test_failed_schedule_is_reported_instead_of_selling_active(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.control_confirmation_timeout = 0
        runtime.hass.services.ignore_once("select", "select_option", entity_id=const.DEFAULT_WORK_MODE_SELECT, option=const.MODE_SELLING_FIRST)
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.manager_status, "SCHEDULE APPLY ERROR")
        self.assertEqual(runtime.last_schedule_attempt["status"], "failed")
        self.assertIn("System Work Mode", runtime.last_schedule_attempt["message"])

    def test_resume_manager_enables_schedule_without_legacy_charge_scheduler(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.control_mode = "Stop Sell"
        runtime.scheduler_enabled = False
        asyncio.run(runtime.async_resume_manager())
        self.assertEqual(runtime.control_mode, "Schedule")
        self.assertTrue(runtime.scheduler_enabled)
        self.assertFalse(hasattr(runtime, "charge_scheduler_enabled"))
        self.assertEqual(runtime.hass.states.get(const.DEFAULT_WORK_MODE_SELECT).state, const.MODE_SELLING_FIRST)

    def test_direct_settings_do_not_use_transitional_zeroes(self):
        runtime = make_runtime()
        asyncio.run(runtime.async_apply_settings(const.MODE_SELLING_FIRST, 5000, 120, 120))
        self.assertFalse(any(call[2]["value"] == 0 for call in control_number_calls(runtime)))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(len(select_calls), 1)
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_SELLING_FIRST)

    def test_restore_defaults_uses_exact_mode_after_all_numeric_values(self):
        for mode in (
            const.MODE_ZERO_EXPORT,
            const.MODE_ZERO_EXPORT_CT,
            const.MODE_SELLING_FIRST,
        ):
            with self.subTest(mode=mode):
                runtime = make_runtime(default_mode=mode)
                runtime.scheduler_enabled = True

                asyncio.run(runtime.async_restore_defaults())

                ordered_control_calls = [
                    call
                    for call in runtime.hass.services.calls
                    if call[:2] in (("select", "select_option"), ("number", "set_value"))
                    and (
                        call[2].get("entity_id") == const.DEFAULT_WORK_MODE_SELECT
                        or call[2].get("entity_id") in CONTROL_NUMBERS
                    )
                ]
                self.assertEqual(
                    [call[2]["entity_id"] for call in ordered_control_calls[:-1]],
                    list(CONTROL_NUMBERS),
                )
                self.assertEqual(
                    [call[2]["value"] for call in ordered_control_calls[:-1]],
                    list(CONTROL_NUMBERS.values()),
                )
                self.assertEqual(ordered_control_calls[-1][2]["option"], mode)
                self.assertFalse(runtime.scheduler_enabled)
                self.assertEqual(runtime.last_error, "")

    def test_restore_defaults_raises_when_full_set_is_not_confirmed(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_CHARGE_CURRENT,
        )

        with self.assertRaisesRegex(RuntimeError, "KRYTYCZNY"):
            asyncio.run(runtime.async_restore_defaults())

        self.assertIn("Maximum Battery Charge Current", runtime.last_error)
        self.assertNotEqual(runtime.last_error, "")


class GridAndSlotSafetyTests(unittest.TestCase):
    def configure_charge_slot(self, runtime, grid: bool):
        runtime.scheduler_enabled = True
        slot = runtime.slots[runtime.active_slot_key()]
        slot.enabled = True
        slot.mode = const.MODE_CHARGE
        slot.charge_enabled = grid
        slot.charge_current = 120
        slot.grid_charge_current = 60
        slot.minimum_sell_soc = 90
        return slot

    def grid_switch_calls(self, runtime):
        return [
            call for call in runtime.hass.services.calls
            if call[:2] == ("switch", "turn_on")
            and "_grid_charge" in str(call[2].get("entity_id"))
        ]

    def test_charge_with_grid_no_never_enables_grid_charge(self):
        runtime = make_runtime()
        self.configure_charge_slot(runtime, grid=False)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(self.grid_switch_calls(runtime), [])
        self.assertEqual(
            runtime.hass.states.get(const.DEFAULT_GRID_CHARGE_CURRENT).state,
            "60",
        )

    def test_grid_no_repairs_an_externally_enabled_tou_grid_charge(self):
        runtime = make_runtime()
        self.configure_charge_slot(runtime, grid=False)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        runtime.hass.states.values["switch.deye_inverter_time_of_use_1_grid_charge"] = FakeState("on")
        runtime.hass.services.calls.clear()
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(
            runtime.hass.states.get("switch.deye_inverter_time_of_use_1_grid_charge").state,
            "off",
        )

    def test_charge_with_grid_yes_enables_grid_charge(self):
        runtime = make_runtime()
        self.configure_charge_slot(runtime, grid=True)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertTrue(self.grid_switch_calls(runtime))

    def test_legacy_charge_scheduler_flag_cannot_change_schedule_result(self):
        runtime = make_runtime()
        self.configure_charge_slot(runtime, grid=False)
        runtime.charge_scheduler_enabled = True  # Simulates an old restored value.
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(self.grid_switch_calls(runtime), [])

    def test_zero_export_with_battery_charge_current_and_grid_no(self):
        runtime = make_runtime()
        slot = runtime.slots[runtime.active_slot_key()]
        slot.enabled = True
        slot.mode = const.MODE_ZERO_EXPORT_CT
        slot.charge_current = 120
        slot.grid_charge_current = 0
        slot.charge_enabled = False
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.hass.states.get(const.DEFAULT_WORK_MODE_SELECT).state, const.MODE_ZERO_EXPORT_CT)
        self.assertEqual(runtime.hass.states.get(const.DEFAULT_CHARGE_CURRENT).state, "120")
        self.assertEqual(self.grid_switch_calls(runtime), [])

    def test_zero_export_does_not_require_price_or_sale_soc(self):
        runtime = make_runtime(soc=None, price=None)
        slot = runtime.slots[runtime.active_slot_key()]
        slot.enabled = True
        slot.mode = const.MODE_ZERO_EXPORT
        slot.charge_current = 120
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(runtime.hass.states.get(const.DEFAULT_WORK_MODE_SELECT).state, const.MODE_ZERO_EXPORT)

    def test_one_slot_soc_is_used_for_tou_mapping(self):
        runtime = make_runtime()
        for slot in runtime.slots.values():
            slot.enabled = True
            slot.minimum_sell_soc = 10 if int(slot.key[:2]) % 2 else 90
        signature_before = [segment["minimum_sell_soc"] for segment in runtime._compress_schedule_segments()]
        for slot in runtime.slots.values():
            slot.minimum_sell_soc = 99 - slot.minimum_sell_soc
        self.assertNotEqual(signature_before, [segment["minimum_sell_soc"] for segment in runtime._compress_schedule_segments()])
        self.assertEqual({10, 90}, set(signature_before))

    def test_same_slot_failure_restores_defaults_once_per_fingerprint(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once(
            "number", "set_value", entity_id=const.DEFAULT_MAX_SELL_POWER
        )
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        first_defaults = len(control_number_calls(runtime))
        runtime.hass.services.calls.clear()
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assertEqual(control_number_calls(runtime), [])
        self.assertGreater(first_defaults, 0)

    def test_resume_and_tick_are_serialized(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.control_mode = "Stop Sell"
        runtime.scheduler_enabled = False
        original_tick = runtime._async_tick_impl
        active = 0
        maximum = 0

        async def tracked_tick(*args):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            try:
                await asyncio.sleep(0)
                return await original_tick(*args)
            finally:
                active -= 1

        runtime._async_tick_impl = tracked_tick

        async def run_both():
            await asyncio.gather(runtime.async_resume_manager(), runtime.async_tick())

        asyncio.run(run_both())
        self.assertEqual(maximum, 1)


class FuturePlanTests(unittest.TestCase):
    class MemoryStore:
        def __init__(self):
            self.value = None

        async def async_save(self, value):
            self.value = value

        async def async_load(self):
            return self.value

    def test_future_plan_is_stored_exactly_and_not_applied_early(self):
        runtime = make_runtime()
        runtime._ai_store = self.MemoryStore()
        update = {
            "slot_key": "05_06", "enabled": True, "charge_enabled": False,
            "mode": const.MODE_SELLING_FIRST, "sell_power": 5000,
            "discharge_current": 120, "charge_current": 0,
            "grid_charge_current": 0, "minimum_sell_soc": 20, "min_sell_price": 0.9,
        }
        asyncio.run(runtime.async_save_future_plan({
            "date": "2026-07-19", "strategy": "balanced",
            "labels": ["05:00–06:00"], "updates": [update],
        }))
        self.assertEqual("scheduled", runtime.future_plan["status"])
        self.assertEqual([update], runtime.future_plan["updates"])
        before = list(runtime.hass.services.calls)
        asyncio.run(runtime.async_process_future_plan())
        self.assertEqual(before, runtime.hass.services.calls)
        self.assertEqual("scheduled", runtime.future_plan["status"])

    def test_future_plan_rejects_wrong_date(self):
        runtime = make_runtime()
        runtime._ai_store = self.MemoryStore()
        with self.assertRaisesRegex(ValueError, "wyłącznie na jutro"):
            asyncio.run(runtime.async_save_future_plan({
                "date": "2026-07-18",
                "updates": [{"slot_key": "05_06", "mode": const.MODE_SELLING_FIRST}],
            }))

    def test_future_plan_survives_runtime_reload_and_can_be_cancelled(self):
        store = self.MemoryStore()
        store.value = {
            "settings": {}, "history": [], "last_saved_at": "",
            "future_plan": {
                "date": "2026-07-19", "status": "scheduled",
                "updates": [{"slot_key": "05_06", "mode": const.MODE_SELLING_FIRST}],
            },
        }
        runtime = make_runtime()
        previous_store = manager.Store
        manager.Store = lambda *_args, **_kwargs: store
        try:
            asyncio.run(runtime.async_load_ai_data())
        finally:
            manager.Store = previous_store
        self.assertEqual("scheduled", runtime.future_plan["status"])
        asyncio.run(runtime.async_cancel_future_plan())
        self.assertEqual("cancelled", runtime.future_plan["status"])
        self.assertEqual("cancelled", store.value["future_plan"]["status"])

    def test_failed_activation_uses_full_user_defaults(self):
        runtime = make_runtime(price=None, default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime._ai_store = self.MemoryStore()
        runtime.future_plan = {
            "date": "2026-07-19", "status": "scheduled",
            "updates": [{
                "slot_key": "05_06", "enabled": True,
                "mode": const.MODE_SELLING_FIRST,
                "sell_power": 5000, "discharge_current": 120, "min_sell_price": 0.9,
            }],
        }
        previous_now = manager.ha_now
        manager.ha_now = lambda: datetime(2026, 7, 19, 0, 1, tzinfo=timezone.utc)
        try:
            asyncio.run(runtime.async_process_future_plan())
        finally:
            manager.ha_now = previous_now
        self.assertEqual("failed", runtime.future_plan["status"])
        calls = control_number_calls(runtime)
        self.assertTrue(calls)
        self.assertFalse(any(call[2]["value"] == 0 for call in calls))
        mode_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(const.MODE_ZERO_EXPORT_CT, mode_calls[-1][2]["option"])


class StatisticsTests(unittest.TestCase):
    def test_current_day_reports_progress_not_accuracy(self):
        runtime = make_runtime()
        runtime.solcast_tracking = {"date": "2026-07-18", "forecast": 50.0, "actual": 10.0}
        rows = runtime.history_daily_summary()
        today = next(row for row in rows if row["date"] == "2026-07-18")
        self.assertIsNone(today["accuracy_percent"])
        self.assertEqual(today["forecast_progress_percent"], 20.0)
        self.assertFalse(today["day_complete"])

    def test_historical_accuracy_uses_only_completed_days(self):
        runtime = make_runtime()
        runtime.solcast_history = [
            {"date": "2026-07-17", "forecast_kwh": 50, "actual_kwh": 40, "accuracy_percent": 80, "day_complete": True},
            {"date": "2026-07-16", "forecast_kwh": 20, "actual_kwh": 40, "accuracy_percent": 0, "day_complete": True},
            {"date": "2026-07-18", "forecast_kwh": 60, "actual_kwh": 6, "accuracy_percent": None, "day_complete": False},
        ]
        runtime.solcast_tracking = {"date": "2026-07-18", "forecast": 60, "actual": 6}
        summary = runtime.learning_summary()
        self.assertEqual(summary["solcast_accuracy_days"], 2)
        self.assertEqual(summary["solcast_accuracy_avg"], 40.0)
        self.assertEqual(summary["solcast_correction_factor"], 1.15)
        self.assertEqual(summary["current_forecast_progress"], 10.0)

    def test_g12w_weekend_is_offpeak_all_day(self):
        saturday = datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)
        profile = manager.hourly_tariff_profile(saturday, "g12w", 0.5, 0.2)
        self.assertTrue(all(row["zone"] == "offpeak" for row in profile))
        self.assertTrue(all(row["rate"] == 0.2 for row in profile))

    def test_flow_signs_are_configurable(self):
        runtime = make_runtime()
        runtime.hass.states.values[const.DEFAULT_GRID_POWER_SENSOR] = FakeState("500")
        runtime.hass.states.values[const.DEFAULT_BATTERY_POWER_SENSOR] = FakeState("-700")
        runtime.data[const.CONF_GRID_POWER_SENSOR] = const.DEFAULT_GRID_POWER_SENSOR
        runtime.data[const.CONF_BATTERY_POWER_SENSOR] = const.DEFAULT_BATTERY_POWER_SENSOR
        self.assertEqual(runtime.normalized_grid_power(), 500)
        self.assertEqual(runtime.normalized_battery_power(), -700)
        runtime.data[const.CONF_GRID_POSITIVE_IS_IMPORT] = False
        runtime.data[const.CONF_BATTERY_POSITIVE_IS_DISCHARGE] = False
        self.assertEqual(runtime.normalized_grid_power(), -500)
        self.assertEqual(runtime.normalized_battery_power(), 700)


if __name__ == "__main__":
    unittest.main()
