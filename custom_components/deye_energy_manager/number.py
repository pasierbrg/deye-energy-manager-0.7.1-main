from __future__ import annotations

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

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None:
            try:
                setattr(self.runtime, self.attr, float(last_state.state))
            except (TypeError, ValueError):
                pass

    async def async_set_native_value(self, value: float):
        setattr(self.runtime, self.attr, value)
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
        if (last_state := await self.async_get_last_state()) is not None:
            try:
                setattr(self.runtime.slots[self.slot_key], self.attr, float(last_state.state))
            except (TypeError, ValueError):
                pass

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
                DeyeSlotNumber(runtime, key, label, "min_sell_price", "Minimum sell price", 5, 0.01, "PLN/kWh"),
            ]
        )
    async_add_entities(entities)
