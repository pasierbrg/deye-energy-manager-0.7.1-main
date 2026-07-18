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
        setattr(self.runtime, self.attr, True)
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()

    async def async_turn_off(self, **kwargs: Any):
        setattr(self.runtime, self.attr, False)
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()


class DeyeSlotSwitch(DeyeEnergyManagerEntity, SwitchEntity, RestoreEntity):
    def __init__(self, runtime, slot_key, label, charge=False):
        key = f"slot_{slot_key}_charge_enabled" if charge else f"slot_{slot_key}_enabled"
        name = f"Charge {label}" if charge else f"Slot {label}"
        super().__init__(runtime, key, name)
        self.slot_key = slot_key
        self.charge = charge

    @property
    def is_on(self):
        slot = self.runtime.slots[self.slot_key]
        return slot.charge_enabled if self.charge else slot.enabled

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None:
            slot = self.runtime.slots[self.slot_key]
            if self.charge:
                slot.charge_enabled = last_state.state == "on"
            else:
                slot.enabled = last_state.state == "on"

    async def async_turn_on(self, **kwargs: Any):
        slot = self.runtime.slots[self.slot_key]
        if self.charge:
            slot.charge_enabled = True
            slot.enabled = True
            self.runtime.scheduler_enabled = True
            self.runtime.charge_scheduler_enabled = True
        else:
            slot.enabled = True
            self.runtime.scheduler_enabled = True
        self.runtime.mark_config_saved()
        self.runtime.notify_update()
        await self.runtime.async_tick()

    async def async_turn_off(self, **kwargs: Any):
        slot = self.runtime.slots[self.slot_key]
        if self.charge:
            slot.charge_enabled = False
        else:
            slot.enabled = False
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
        DeyeManagerSwitch(runtime, "charge_scheduler_enabled", "Charge scheduler", "charge_scheduler_enabled"),
    ]
    for key, label, *_ in SLOTS:
        entities.append(DeyeSlotSwitch(runtime, key, label))
        entities.append(DeyeSlotSwitch(runtime, key, label, charge=True))
    async_add_entities(entities)
