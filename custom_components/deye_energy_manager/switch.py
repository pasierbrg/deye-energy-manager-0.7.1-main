from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN, SLOTS
from .entity import DeyeEnergyManagerEntity


class DeyeManagerSwitch(DeyeEnergyManagerEntity, SwitchEntity, RestoreEntity):
    def __init__(self, runtime, key, name, attr):
        super().__init__(runtime, key, name)
        self.attr = attr

    @property
    def is_on(self):
        return bool(getattr(self.runtime, self.attr))

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None:
            setattr(self.runtime, self.attr, last_state.state == "on")

    async def async_turn_on(self, **kwargs: Any):
        if self.attr == "emergency_stop":
            await self.runtime.async_emergency_stop()
            return
        if self.attr == "charge_profile_grid_enabled":
            await self.runtime.async_save_charge_profile({
                "charge_current": self.runtime.charge_profile_charge_current,
                "discharge_current": self.runtime.charge_profile_discharge_current,
                "grid_charge_current": self.runtime.charge_profile_grid_charge_current,
                "target_soc": self.runtime.charge_profile_target_soc,
                "grid_charge_enabled": True,
            })
            return
        setattr(self.runtime, self.attr, True)
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()

    async def async_turn_off(self, **kwargs: Any):
        if self.attr == "charge_profile_grid_enabled":
            await self.runtime.async_save_charge_profile({
                "charge_current": self.runtime.charge_profile_charge_current,
                "discharge_current": self.runtime.charge_profile_discharge_current,
                "grid_charge_current": self.runtime.charge_profile_grid_charge_current,
                "target_soc": self.runtime.charge_profile_target_soc,
                "grid_charge_enabled": False,
            })
            return
        setattr(self.runtime, self.attr, False)
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()


class DeyeSlotSwitch(DeyeEnergyManagerEntity, SwitchEntity, RestoreEntity):
    def __init__(self, runtime, slot_key, label):
        key = f"slot_{slot_key}_enabled"
        name = f"Slot {label}"
        super().__init__(runtime, key, name)
        self.slot_key = slot_key

    @property
    def is_on(self):
        slot = self.runtime.slots[self.slot_key]
        return slot.enabled

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None:
            slot = self.runtime.slots[self.slot_key]
            slot.enabled = last_state.state == "on"

    async def async_turn_on(self, **kwargs: Any):
        slot = self.runtime.slots[self.slot_key]
        slot.enabled = True
        self.runtime.scheduler_enabled = True
        self.runtime._clear_slot_failure_latch()
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()

    async def async_turn_off(self, **kwargs: Any):
        slot = self.runtime.slots[self.slot_key]
        slot.enabled = False
        self.runtime._clear_slot_failure_latch()
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    entities = [
        DeyeManagerSwitch(runtime, "scheduler_enabled", "Scheduler", "scheduler_enabled"),
        DeyeManagerSwitch(runtime, "soc_guard_enabled", "SOC guard", "soc_guard_enabled"),
        DeyeManagerSwitch(runtime, "price_guard_enabled", "Price guard", "price_guard_enabled"),
        DeyeManagerSwitch(runtime, "emergency_stop", "Emergency stop", "emergency_stop"),
        DeyeManagerSwitch(runtime, "charge_profile_grid_enabled", "Charge profile grid charge", "charge_profile_grid_enabled"),
    ]
    for key, label, *_ in SLOTS:
        entities.append(DeyeSlotSwitch(runtime, key, label))
    async_add_entities(entities)
