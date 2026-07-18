"""Validated, cached tariff catalog updates for Deye Energy Manager."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .tariffs import load_bundled_catalog, validate_catalog

_LOGGER = logging.getLogger(__name__)

DEFAULT_CATALOG_URL = (
    "https://raw.githubusercontent.com/pasierbrg/deye-energy-manager-0.7.1-main/"
    "main/custom_components/deye_energy_manager/tariff_catalog.json"
)
MAX_CATALOG_BYTES = 1_000_000
REFRESH_INTERVAL = timedelta(days=7)


class TariffCatalogManager:
    """Select the newest valid catalog and retain the last working copy."""

    def __init__(self, hass, entry_id: str, url: str | None = None) -> None:
        self.hass = hass
        self.url = str(url or DEFAULT_CATALOG_URL)
        self.store = Store(hass, 1, f"{DOMAIN}_{entry_id}_tariff_catalog")
        self.catalog = load_bundled_catalog()
        self.source = "bundled"
        self.last_checked = ""
        self.last_updated = ""
        self.last_error = ""

    @staticmethod
    def _version_key(value: str) -> tuple[int, ...]:
        parts: list[int] = []
        for part in str(value).replace("-", ".").split("."):
            try:
                parts.append(int(part))
            except ValueError:
                parts.append(0)
        return tuple(parts)

    def _activate_if_newer(self, candidate: dict[str, Any], source: str) -> bool:
        validate_catalog(candidate)
        current = self._version_key(self.catalog.get("catalog_version", "0"))
        incoming = self._version_key(candidate.get("catalog_version", "0"))
        if incoming < current:
            return False
        self.catalog = candidate
        self.source = source
        return True

    async def async_load(self) -> None:
        cached = await self.store.async_load()
        if not isinstance(cached, dict):
            return
        self.last_checked = str(cached.get("last_checked") or "")
        self.last_updated = str(cached.get("last_updated") or "")
        candidate = cached.get("catalog")
        if isinstance(candidate, dict):
            try:
                self._activate_if_newer(candidate, "cache")
            except ValueError as err:
                self.last_error = f"Odrzucono uszkodzony katalog w pamięci: {err}"

    def refresh_due(self, now: datetime | None = None) -> bool:
        if not self.last_checked:
            return True
        try:
            checked = datetime.fromisoformat(self.last_checked)
        except ValueError:
            return True
        current = now or datetime.now(timezone.utc)
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        return current - checked >= REFRESH_INTERVAL

    async def async_refresh(self, force: bool = False) -> bool:
        if not force and not self.refresh_due():
            return False
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.last_checked = now
        try:
            from homeassistant.helpers.aiohttp_client import async_get_clientsession

            session = async_get_clientsession(self.hass)
            async with session.get(self.url, timeout=15) as response:
                response.raise_for_status()
                raw = await response.read()
            if len(raw) > MAX_CATALOG_BYTES:
                raise ValueError("katalog przekracza dopuszczalny rozmiar")
            candidate = json.loads(raw.decode("utf-8"))
            changed = self._activate_if_newer(candidate, "online")
            if changed:
                self.last_updated = now
            self.last_error = ""
        except Exception as err:  # network and validation must always fall back safely
            changed = False
            self.last_error = f"Aktualizacja katalogu nie powiodła się: {err}"
            _LOGGER.warning("Tariff catalog refresh failed; using %s catalog: %s", self.source, err)
        await self.store.async_save({
            "last_checked": self.last_checked,
            "last_updated": self.last_updated,
            "catalog": self.catalog,
        })
        return changed

    def status(self) -> dict[str, Any]:
        return {
            "catalog_version": self.catalog.get("catalog_version"),
            "catalog_generated_at": self.catalog.get("generated_at"),
            "catalog_effective_from": self.catalog.get("effective_from"),
            "catalog_source": self.source,
            "catalog_url": self.url,
            "catalog_last_checked": self.last_checked,
            "catalog_last_updated": self.last_updated,
            "catalog_refresh_days": int(REFRESH_INTERVAL.total_seconds() / 86400),
            "catalog_error": self.last_error,
        }
