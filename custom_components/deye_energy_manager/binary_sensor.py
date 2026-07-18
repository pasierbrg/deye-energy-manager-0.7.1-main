from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import DeyeEnergyManagerEntity


class DeyeManagerBinarySensor(DeyeEnergyManagerEntity, BinarySensorEntity):
    def __init__(self, runtime, key, name, value_fn):
        super().__init__(runtime, key, name)
        self.value_fn = value_fn

    @property
    def is_on(self):
        return self.value_fn(self.runtime)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            DeyeManagerBinarySensor(runtime, "active_slot_enabled", "Active slot enabled", lambda r: r.active_slot.enabled),
            DeyeManagerBinarySensor(runtime, "sell_allowed", "Sell allowed", lambda r: r.sell_allowed),
            DeyeManagerBinarySensor(runtime, "charge_allowed", "Charge allowed", lambda r: r.charge_allowed),
            DeyeManagerBinarySensor(runtime, "soc_guard_ok", "SOC guard OK", lambda r: r.soc_ok),
            DeyeManagerBinarySensor(runtime, "price_guard_ok", "Price guard OK", lambda r: r.price_ok),
            DeyeManagerBinarySensor(
                runtime,
                "scheduler_running",
                "Scheduler running",
                lambda r: r.scheduler_enabled
                and r.active_slot.enabled
                and r.data_available
                and not r.emergency_stop
                and r.control_mode == "Schedule",
            ),
        ]
    )
