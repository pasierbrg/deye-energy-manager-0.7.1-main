from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import DeyeEnergyManagerEntity


class DeyeManagerButton(DeyeEnergyManagerEntity, ButtonEntity):
    def __init__(self, runtime, key, name, action):
        super().__init__(runtime, key, name)
        self.action = action

    async def async_press(self) -> None:
        await self.action(self.runtime)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            DeyeManagerButton(runtime, "apply_schedule", "Apply schedule", lambda r: r.async_tick()),
            DeyeManagerButton(runtime, "manual_sell", "Manual sell", lambda r: r.async_manual_sell()),
            DeyeManagerButton(runtime, "charge_now", "Charge now", lambda r: r.async_charge_now()),
            DeyeManagerButton(runtime, "stop_selling", "Stop selling", lambda r: r.async_request_stop()),
            DeyeManagerButton(runtime, "restore_defaults", "Restore defaults", lambda r: r.async_restore_defaults()),
            DeyeManagerButton(runtime, "resume_manager", "Resume manager and schedule", lambda r: r.async_resume_manager()),
            DeyeManagerButton(runtime, "emergency_stop", "Emergency stop", lambda r: r.async_emergency_stop()),
        ]
    )
