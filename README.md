# Deye Energy Manager

![Deye Energy Manager](docs/banner.svg)

[![release](https://img.shields.io/badge/release-0.7.6-blue.svg)](#wersja-076)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](#instalacja)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026.6%2B-18BCF2.svg)](#wymagania)

Deye Energy Manager jest niestandardową integracją Home Assistant dla falowników Deye. Łączy harmonogram sprzedaży, ochronę magazynu energii, ładowanie z sieci, ceny Pstryk, prognozę Solcast oraz statystyki w jednej karcie Lovelace.

## Wersja 0.7.6

Wersja 0.7.6 koncentruje się na bezpieczeństwie i niezawodności sterowania:

- brak poprawnego odczytu SOC blokuje sprzedaż zamiast przyjmować 100%;
- zapisy wielopolowe są serializowane i wykonywane przez bezpieczny tryb bez eksportu;
- harmonogram przekraczający 6 fizycznych zakresów Deye jest odrzucany przed aktywnym sterowaniem;
- karta stosuje operacje zbiorcze i sugestie przez jedną transakcyjną usługę backendu;
- dodano walidację trybów, mocy, prądów, SOC i cen;
- naprawiono działanie ochrony ceny i schedulera ładowania;
- dodano edycję mapowania encji w opcjach integracji;
- sensory PV, domu i baterii można mapować bez zmiany kodu;
- bieżący dzień pokazuje realizację prognozy, a nie przedwczesną „trafność”;
- poprawiono bezpieczeństwo HTML, widoki mobilne i przewijanie okien;
- dodano testy regresji najważniejszych reguł bezpieczeństwa.

Pełna lista znajduje się w [CHANGELOG.md](CHANGELOG.md).

## Najważniejsze funkcje

- 24 godzinne sloty sprzedaży i ładowania;
- tryby `Selling First`, `Zero Export To Load`, `Zero Export To CT` i `Charge`;
- kompresja harmonogramu do 6 fizycznych slotów Deye Time Of Use;
- minimalny SOC i minimalna cena sprzedaży dla każdego slotu;
- ręczne i zbiorcze edytowanie harmonogramu;
- inteligentne sugestie bazujące na cenach, prognozie PV i historii;
- statystyki sprzedaży, produkcji, zużycia i pracy baterii;
- diagnostyka wymaganych encji;
- eksport historii i kopii konfiguracji.

Sugestie nie są stosowane automatycznie. Użytkownik wybiera godziny i zatwierdza każdą zmianę harmonogramu.

## Wymagania

Wymagany jest Home Assistant `2026.6` lub nowszy.

Podstawowe encje sterujące:

```text
select.deye_inverter_system_work_mode
number.deye_inverter_max_sell_power
number.deye_inverter_maximum_battery_discharge_current
number.deye_inverter_maximum_battery_charge_current
number.deye_inverter_maximum_battery_grid_charge_current
sensor.deye_inverter_battery
sensor.deye_inverter_grid_power
```

Dla funkcji Deye Time Of Use wymagane są również:

```text
switch.deye_inverter_time_of_use
time.deye_inverter_time_of_use_1_start ... 6_start
number.deye_inverter_time_of_use_1_soc ... 6_soc
switch.deye_inverter_time_of_use_1_grid_charge ... 6_grid_charge
```

Opcjonalnie można skonfigurować sensory:

- mocy PV, domu, sieci i baterii;
- dziennej produkcji PV;
- cen sprzedaży i zakupu Pstryk;
- prognozy oraz aktualnej mocy Solcast.

Po instalacji mapowanie można zmienić przez **Ustawienia → Urządzenia i usługi → Deye Energy Manager → Konfiguruj**.

## Instalacja

### HACS

1. Otwórz HACS.
2. Dodaj repozytorium jako niestandardowe repozytorium typu **Integracja**.
3. Zainstaluj Deye Energy Manager.
4. Uruchom ponownie Home Assistant.
5. Dodaj integrację w **Ustawienia → Urządzenia i usługi**.

### Karta Lovelace

Integracja udostępnia kartę pod adresem:

```text
/deye_energy_manager/deye-energy-manager-card.js?v=076
```

Jeżeli karta jest instalowana ręcznie, skopiuj:

```text
www/deye-energy-manager-card.js
```

do `/config/www/` i dodaj zasób:

```text
/local/deye-energy-manager-card.js?v=076
```

Konfiguracja karty:

```yaml
type: custom:deye-energy-manager-card
```

Przykład kompletnego dashboardu znajduje się w `dashboard/energy_manager.yaml`.

## Zasady bezpieczeństwa

- Przy aktywnej ochronie SOC brak poprawnego odczytu baterii blokuje sprzedaż.
- Przy aktywnej ochronie ceny brak poprawnej ceny blokuje sprzedaż.
- Aktualizacja ustawień sprzedaży najpierw przełącza falownik w `Zero Export To Load`.
- Mapowanie ponad 6 zakresów nie jest zapisywane do Deye.
- Zatrzymanie awaryjne ustawia tryb bez eksportu, zeruje limity i pozostaje zatrzymane po skasowaniu alarmu — ponowne uruchomienie wymaga świadomej zmiany trybu.

Integracja steruje fizycznym urządzeniem. Pierwszą konfigurację należy obserwować w Home Assistant i aplikacji falownika, używając konserwatywnych limitów mocy i prądu.

## Testy

Testy logiki bezpieczeństwa nie wymagają instalacji Home Assistant:

```text
python -m unittest discover -s tests -v
```

## Licencja

Projekt jest udostępniany na licencji MIT. Szczegóły: [LICENSE](LICENSE).

Rozwój projektu można wesprzeć przez [buycoffee.to](https://buycoffee.to/pasierbrg).
