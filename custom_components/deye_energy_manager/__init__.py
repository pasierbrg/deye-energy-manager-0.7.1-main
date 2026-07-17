from __future__ import annotations

import inspect
import json
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from pathlib import Path

from .const import DOMAIN, PLATFORMS
from .manager import DeyeEnergyManagerRuntime

APPLY_SCHEMA = vol.Schema(
    {
        vol.Required("mode"): cv.string,
        vol.Required("sell_power"): vol.Coerce(float),
        vol.Required("discharge_current"): vol.Coerce(float),
        vol.Optional("charge_current", default=0): vol.Coerce(float),
    }
)
MANUAL_SELL_SCHEMA = vol.Schema(
    {
        vol.Required("sell_power"): vol.Coerce(float),
        vol.Required("discharge_current"): vol.Coerce(float),
    }
)
CHARGE_SCHEMA = vol.Schema({vol.Required("charge_current"): vol.Coerce(float)})
AI_DATA_SCHEMA = vol.Schema({vol.Required("data"): cv.string})
AI_RATING_SCHEMA = vol.Schema({vol.Required("timestamp"): vol.Coerce(float), vol.Required("rating"): vol.All(vol.Coerce(int), vol.Range(min=1, max=5))})
SLOT_GRID_CHARGE_SCHEMA = vol.Schema(
    {
        vol.Required("slot_key"): cv.string,
        vol.Required("enabled"): cv.boolean,
        vol.Optional("grid_charge_current"): vol.Coerce(float),
        vol.Optional("min_soc"): vol.Coerce(float),
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    runtime = DeyeEnergyManagerRuntime(hass=hass, entry_id=entry.entry_id, data=dict(entry.data))
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = runtime
    await runtime.async_start()
    static_path = str(Path(__file__).parent / "www")
    if hasattr(hass.http, "async_register_static_path"):
        result = hass.http.async_register_static_path("/deye_energy_manager", static_path, True)
        if inspect.isawaitable(result):
            await result
    elif hasattr(hass.http, "register_static_path"):
        hass.http.register_static_path("/deye_energy_manager", static_path, True)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def handle_apply_settings(call: ServiceCall) -> None:
        await runtime.async_set_work_mode(call.data["mode"])
        await runtime.async_set_number(runtime.max_sell_power_number, call.data["sell_power"])
        await runtime.async_set_number(runtime.discharge_current_number, call.data["discharge_current"])
        await runtime.async_set_number(runtime.charge_current_number, call.data["charge_current"])
        runtime.last_action = "Service apply_settings"
        runtime.notify_update()

    async def handle_manual_sell(call: ServiceCall) -> None:
        runtime.manual_sell_power = call.data["sell_power"]
        runtime.manual_discharge_current = call.data["discharge_current"]
        await runtime.async_manual_sell()

    async def handle_charge_now(call: ServiceCall) -> None:
        runtime.manual_charge_current = call.data["charge_current"]
        await runtime.async_charge_now()

    async def handle_stop_selling(call: ServiceCall) -> None:
        runtime.control_mode = "Stop Sell"
        await runtime.async_stop_selling()

    async def handle_restore_defaults(call: ServiceCall) -> None:
        await runtime.async_restore_defaults()

    async def handle_emergency_stop(call: ServiceCall) -> None:
        await runtime.async_emergency_stop()

    async def handle_save_ai_settings(call: ServiceCall) -> None:
        data = json.loads(call.data["data"])
        if isinstance(data, dict):
            await runtime.async_set_ai_settings(data)

    async def handle_save_ai_analysis(call: ServiceCall) -> None:
        data = json.loads(call.data["data"])
        if isinstance(data, dict):
            await runtime.async_add_ai_analysis(data)

    async def handle_clear_ai_history(call: ServiceCall) -> None:
        await runtime.async_clear_ai_history()

    async def handle_rate_ai_analysis(call: ServiceCall) -> None:
        await runtime.async_rate_ai_analysis(call.data["timestamp"], call.data["rating"])

    async def handle_clear_history(call: ServiceCall) -> None:
        await runtime.async_clear_all_history()

    async def handle_set_slot_grid_charge(call: ServiceCall) -> None:
        slot_key = call.data["slot_key"]
        if slot_key not in runtime.slots:
            raise ValueError(f"Unknown schedule slot: {slot_key}")
        slot = runtime.slots[slot_key]
        enabled = call.data["enabled"]
        slot.charge_enabled = enabled
        if enabled:
            slot.enabled = True
            runtime.scheduler_enabled = True
        if "grid_charge_current" in call.data:
            slot.grid_charge_current = max(0, call.data["grid_charge_current"])
        if "min_soc" in call.data:
            slot.min_soc = min(100, max(0, call.data["min_soc"]))
        runtime.mark_config_saved()
        runtime.notify_update()
        if not await runtime.async_apply_slot_grid_charge(slot_key):
            raise ValueError(runtime.last_error or "Nie udało się zastosować mapowania Deye")
        await runtime.async_tick()

    hass.services.async_register(DOMAIN, "apply_settings", handle_apply_settings, schema=APPLY_SCHEMA)
    hass.services.async_register(DOMAIN, "manual_sell", handle_manual_sell, schema=MANUAL_SELL_SCHEMA)
    hass.services.async_register(DOMAIN, "charge_now", handle_charge_now, schema=CHARGE_SCHEMA)
    hass.services.async_register(DOMAIN, "stop_selling", handle_stop_selling)
    hass.services.async_register(DOMAIN, "restore_defaults", handle_restore_defaults)
    hass.services.async_register(DOMAIN, "emergency_stop", handle_emergency_stop)
    hass.services.async_register(DOMAIN, "save_ai_settings", handle_save_ai_settings, schema=AI_DATA_SCHEMA)
    hass.services.async_register(DOMAIN, "save_ai_analysis", handle_save_ai_analysis, schema=AI_DATA_SCHEMA)
    hass.services.async_register(DOMAIN, "clear_ai_history", handle_clear_ai_history)
    hass.services.async_register(DOMAIN, "rate_ai_analysis", handle_rate_ai_analysis, schema=AI_RATING_SCHEMA)
    hass.services.async_register(DOMAIN, "clear_history", handle_clear_history)
    hass.services.async_register(
        DOMAIN,
        "set_slot_grid_charge",
        handle_set_slot_grid_charge,
        schema=SLOT_GRID_CHARGE_SCHEMA,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    runtime = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if runtime:
        await runtime.async_unload()
    if unload_ok and DOMAIN in hass.data and not hass.data[DOMAIN]:
        hass.data.pop(DOMAIN)
    return unload_ok
