# Deye Energy Manager 0.7.6 — instalacja

Wymagany Home Assistant: `2026.6` lub nowszy.

## Instalacja przez HACS

1. Dodaj repozytorium jako niestandardowe repozytorium HACS typu **Integracja**.
2. Zainstaluj Deye Energy Manager.
3. Uruchom ponownie Home Assistant.
4. Przejdź do **Ustawienia → Urządzenia i usługi → Dodaj integrację**.
5. Wybierz encje sterujące Deye oraz opcjonalne sensory Pstryk i Solcast.

## Karta dashboardu

Dodaj zasób JavaScript:

```text
/deye_energy_manager/deye-energy-manager-card.js?v=076
```

Przy instalacji ręcznej użyj:

```text
/local/deye-energy-manager-card.js?v=076
```

Następnie dodaj kartę ręczną:

```yaml
type: custom:deye-energy-manager-card
```

## Aktualizacja z 0.7.5

1. Wykonaj kopię konfiguracji w panelu **System i diagnostyka**.
2. Zaktualizuj integrację i uruchom ponownie Home Assistant.
3. Zmień parametr cache zasobu na `v=076`.
4. Odśwież przeglądarkę przez `Ctrl + F5`.
5. Sprawdź mapowanie encji w opcjach integracji.
6. Zweryfikuj diagnostykę i wykonaj pierwszy test przy niskich limitach mocy.

W 0.7.6 ochrona SOC działa fail-safe. Jeśli sensor SOC jest brakujący lub niedostępny, manager nie uruchomi sprzedaży.
