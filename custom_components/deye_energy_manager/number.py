from __future__ import annotations

import math

from homeassistant.components.number import NumberEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN, SLOTS
from .entity import DeyeEnergyManagerEntity


class DeyeManagerNumber(DeyeEnergyManagerEntity, NumberEntity, RestoreEntity):
    def __init__(self, runtime, key, name, attr, native_min_value, native_max_value, native_step, unit=None):
        super().__init__(runtime, key, name)
        self.attr = attr
        self._attr_native_min_value = native_min_value
        self._attr_native_max_value = native_max_value
        self._attr_native_step = native_step
        self._attr_native_unit_of_measurement = unit
        self._attr_mode = "box"

    @property
    def native_value(self):
        return getattr(self.runtime, self.attr)

    def _physical_range_entity(self):
        """Return the mapped Deye entity that owns this helper's limits."""
        sources = {
            "default_sell_power": self.runtime.max_sell_power_number,
            "default_discharge_current": self.runtime.discharge_current_number,
            "default_charge_current": self.runtime.charge_current_number,
            "default_grid_charge_current": self.runtime.grid_charge_current_number,
            "charge_profile_charge_current": self.runtime.charge_current_number,
            "charge_profile_discharge_current": self.runtime.discharge_current_number,
            "charge_profile_grid_charge_current": self.runtime.grid_charge_current_number,
            "charge_profile_target_soc": self.runtime._tou_entity(1, "soc"),
        }
        return sources.get(self.attr)

    def _sync_physical_range(self) -> None:
        """Expose the actual Deye min/max/step to the card and HA controls."""
        entity_id = self._physical_range_entity()
        state = self.runtime.hass.states.get(entity_id) if entity_id else None
        attrs = getattr(state, "attributes", {}) or {}
        try:
            minimum = float(attrs["min"])
            maximum = float(attrs["max"])
            step = float(attrs["step"])
        except (KeyError, TypeError, ValueError):
            return
        if minimum <= maximum and step > 0:
            self._attr_native_min_value = minimum
            self._attr_native_max_value = maximum
            self._attr_native_step = step

    async def async_added_to_hass(self):
        self._sync_physical_range()
        if self.attr.startswith("charge_profile_") and self.runtime._charge_profile_loaded_from_store:
            return
        if (last_state := await self.async_get_last_state()) is not None:
            try:
                value = float(last_state.state)
                if math.isfinite(value) and self.native_min_value <= value <= self.native_max_value:
                    setattr(self.runtime, self.attr, value)
            except (TypeError, ValueError):
                pass

    async def async_set_native_value(self, value: float):
        previous = getattr(self.runtime, self.attr)
        setattr(self.runtime, self.attr, value)
        # The default profile is deliberately a save-only operation.  It is
        # applied to the inverter only by restore_defaults or a safety path.
        if self.attr.startswith("default_"):
            self.runtime.mark_config_saved()
            self.runtime.notify_update()
            return
        # Direct edits from Home Assistant's number entity remain compatible
        # with the shared Charge profile and its single schedule path.
        if self.attr.startswith("charge_profile_"):
            try:
                await self.runtime.async_save_charge_profile({
                    "charge_current": self.runtime.charge_profile_charge_current,
                    "discharge_current": self.runtime.charge_profile_discharge_current,
                    "grid_charge_current": self.runtime.charge_profile_grid_charge_current,
                    "target_soc": self.runtime.charge_profile_target_soc,
                    "grid_charge_enabled": self.runtime.charge_profile_grid_enabled,
                })
            except Exception:
                # Do not leave an invalid direct helper edit in memory when
                # profile validation rejects it before the schedule write.
                setattr(self.runtime, self.attr, previous)
                self.runtime.notify_update()
                raise
            return
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()


class DeyeSlotNumber(DeyeEnergyManagerEntity, NumberEntity, RestoreEntity):
    def __init__(self, runtime, slot_key, label, attr, name, max_value, step, unit):
        super().__init__(runtime, f"slot_{slot_key}_{attr}", f"{name} {label}")
        self.slot_key = slot_key
        self.attr = attr
        self._attr_native_min_value = 0
        self._attr_native_max_value = max_value
        self._attr_native_step = step
        self._attr_native_unit_of_measurement = unit
        self._attr_mode = "box"

    @property
    def native_value(self):
        return getattr(self.runtime.slots[self.slot_key], self.attr)

    async def async_added_to_hass(self):
        restored = False
        if (last_state := await self.async_get_last_state()) is not None:
            try:
                value = float(last_state.state)
                if math.isfinite(value) and self.native_min_value <= value <= self.native_max_value:
                    setattr(self.runtime.slots[self.slot_key], self.attr, value)
                    restored = True
            except (TypeError, ValueError):
                pass
        if self.attr == "tou_soc" and not restored:
            physical_soc = self.runtime.physical_tou_soc_for_slot(self.slot_key)
            if physical_soc is not None:
                setattr(self.runtime.slots[self.slot_key], self.attr, physical_soc)

    async def async_set_native_value(self, value: float):
        setattr(self.runtime.slots[self.slot_key], self.attr, value)
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    entities = [
        DeyeManagerNumber(runtime, "minimum_sell_soc", "Minimum sell SOC", "min_sell_soc", 0, 100, 1, "%"),
        DeyeManagerNumber(runtime, "minimum_sell_price", "Minimum sell price", "price_sell_threshold", 0, 5, 0.01, "PLN/kWh"),
        DeyeManagerNumber(runtime, "manual_sell_power", "Manual sell power", "manual_sell_power", 0, 13000, 100, "W"),
        DeyeManagerNumber(runtime, "manual_discharge_current", "Manual discharge current", "manual_discharge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "manual_charge_current", "Manual charge current", "manual_charge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "default_sell_power", "Default sell power", "default_sell_power", 0, 13000, 100, "W"),
        DeyeManagerNumber(runtime, "default_discharge_current", "Default discharge current", "default_discharge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "default_charge_current", "Default charge current", "default_charge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "default_grid_charge_current", "Default grid charge current", "default_grid_charge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "charge_profile_charge_current", "Charge profile battery charge current", "charge_profile_charge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "charge_profile_discharge_current", "Charge profile discharge current", "charge_profile_discharge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "charge_profile_grid_charge_current", "Charge profile grid charge current", "charge_profile_grid_charge_current", 0, 240, 5, "A"),
        DeyeManagerNumber(runtime, "charge_profile_target_soc", "Charge profile target SOC", "charge_profile_target_soc", 0, 100, 1, "%"),
    ]
    for key, label, *_ in SLOTS:
        entities.extend(
            [
                DeyeSlotNumber(runtime, key, label, "sell_power", "Sell power", 13000, 100, "W"),
                DeyeSlotNumber(runtime, key, label, "discharge_current", "Discharge current", 240, 5, "A"),
                DeyeSlotNumber(runtime, key, label, "charge_current", "Charge current", 240, 5, "A"),
                DeyeSlotNumber(runtime, key, label, "grid_charge_current", "Grid charge current", 240, 5, "A"),
                DeyeSlotNumber(runtime, key, label, "minimum_sell_soc", "Minimum sell SOC", 100, 1, "%"),
                DeyeSlotNumber(runtime, key, label, "tou_soc", "Deye TOU battery SOC", 100, 1, "%"),
                DeyeSlotNumber(runtime, key, label, "min_sell_price", "Minimum sell price", 5, 0.01, "PLN/kWh"),
            ]
        )
    async_add_entities(entities)
