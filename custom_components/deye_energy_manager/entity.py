from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN
from .manager import DeyeEnergyManagerRuntime


class DeyeEnergyManagerEntity(Entity):
    _attr_has_entity_name = True

    def __init__(self, runtime: DeyeEnergyManagerRuntime, key: str, name: str) -> None:
        self.runtime = runtime
        self._attr_unique_id = f"{runtime.entry_id}_{key}"
        self._attr_object_id = f"deye_energy_manager_{key}"
        self._attr_name = name
        runtime.register_entity(self)

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self.runtime.entry_id)},
            name="Deye Energy Manager",
            manufacturer="pasierbrg",
            model="Deye Energy Manager",
        )
