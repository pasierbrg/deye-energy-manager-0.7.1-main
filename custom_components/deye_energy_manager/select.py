from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import ACCEPTED_SLOT_MODES, CONTROL_MODES, DOMAIN, PHYSICAL_NORMAL_MODES, SLOTS, SLOT_MODES, WORK_MODES
from .entity import DeyeEnergyManagerEntity


class DeyeControlModeSelect(DeyeEnergyManagerEntity, SelectEntity, RestoreEntity):
    def __init__(self, runtime):
        super().__init__(runtime, "control_mode", "Control mode")

    @property
    def options(self):
        return CONTROL_MODES

    @property
    def current_option(self):
        return self.runtime.control_mode

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None and last_state.state in CONTROL_MODES:
            self.runtime.control_mode = last_state.state

    async def async_select_option(self, option: str):
        self.runtime.set_control_mode(option)
        self.runtime.mark_config_saved()
        await self.runtime.async_tick()


class DeyeDefaultWorkModeSelect(DeyeEnergyManagerEntity, SelectEntity, RestoreEntity):
    def __init__(self, runtime):
        super().__init__(runtime, "default_work_mode", "Default work mode")

    @property
    def options(self):
        return WORK_MODES

    @property
    def current_option(self):
        return self.runtime.default_work_mode

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None and last_state.state in WORK_MODES:
            self.runtime.default_work_mode = last_state.state

    async def async_select_option(self, option: str):
        self.runtime.set_default_work_mode(option)
        self.runtime.mark_config_saved()


class DeyeNormalProfileModeSelect(DeyeEnergyManagerEntity, SelectEntity, RestoreEntity):
    def __init__(self, runtime):
        super().__init__(runtime, "normal_profile_mode", "Normal profile Deye mode")

    @property
    def options(self):
        return list(PHYSICAL_NORMAL_MODES)

    @property
    def current_option(self):
        return self.runtime.normal_profile_physical_work_mode

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None and last_state.state in PHYSICAL_NORMAL_MODES:
            self.runtime.normal_profile_physical_work_mode = last_state.state

    async def async_select_option(self, option: str):
        await self.runtime.async_save_normal_profile({
            "physical_work_mode": option,
        })
        self.runtime.mark_config_saved()


class DeyeSlotModeSelect(DeyeEnergyManagerEntity, SelectEntity, RestoreEntity):
    def __init__(self, runtime, slot_key, label):
        super().__init__(runtime, f"slot_{slot_key}_mode", f"Mode {label}")
        self.slot_key = slot_key

    @property
    def options(self):
        return SLOT_MODES

    @property
    def current_option(self):
        return self.runtime.slots[self.slot_key].mode

    async def async_added_to_hass(self):
        if (last_state := await self.async_get_last_state()) is not None and last_state.state in ACCEPTED_SLOT_MODES:
            await self.runtime.async_restore_slot_mode(self.slot_key, last_state.state)

    async def async_select_option(self, option: str):
        self.runtime.set_work_mode_for_slot(self.slot_key, option)
        self.runtime.mark_config_saved()
        await self.runtime.async_tick()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    entities = [
        DeyeControlModeSelect(runtime),
        DeyeDefaultWorkModeSelect(runtime),
        DeyeNormalProfileModeSelect(runtime),
    ]
    entities.extend(DeyeSlotModeSelect(runtime, key, label) for key, label, *_ in SLOTS)
    async_add_entities(entities)
