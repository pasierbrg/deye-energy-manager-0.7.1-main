# Deye Energy Manager

![Deye Energy Manager](docs/banner.svg)

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](#instalacja-przez-hacs)
[![release](https://img.shields.io/badge/release-0.7.5-blue.svg)](#aktualna-wersja)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2024.6%2B-18BCF2.svg)](#wymagane-encje)
[![Postaw kawÄ™](https://img.shields.io/badge/buycoffee.to-Postaw%20kawÄ™-ff6b3d.svg)](https://buycoffee.to/pasierbrg)

đź’› **Darmowe i open-source.** JeĹ›li Deye Energy Manager pomaga Ci lepiej sprzedawaÄ‡ energiÄ™, oszczÄ™dzaÄ‡ kWh albo wygodniej obsĹ‚ugiwaÄ‡ falownik Deye, moĹĽesz [postawiÄ‡ kawÄ™](https://buycoffee.to/pasierbrg) â•. To najlepszy sygnaĹ‚, ĹĽe warto rozwijaÄ‡ i utrzymywaÄ‡ ten projekt.

<a href="https://buycoffee.to/pasierbrg" target="_blank">
  <img src="https://buycoffee.to/static/img/share/share-button-primary.png" width="166" height="43" alt="Postaw kawÄ™ dla pasierbrg na buycoffee.to">
</a>

## Aktualna wersja

`0.7.5`

## Co robi integracja

Deye Energy Manager to integracja Home Assistant / HACS dla falownikĂłw Deye, przygotowana pod polski rynek energii. Pozwala sterowaÄ‡ sprzedaĹĽÄ… energii, limitami baterii, Ĺ‚adowaniem z sieci, prognozÄ… Solcast, cenami Pstryk i statystykami sprzedaĹĽy z jednej karty Lovelace.

## Co dodano w 0.7.5

- Uproszczono status energii i pozostawiono najwaĹĽniejsze informacje o pracy managera.
- Przebudowano szczegĂłĹ‚y historii analiz: czytelne godziny, ceny, SOC, moc, powĂłd, stan zastosowania i skutecznoĹ›Ä‡ sugestii.
- Dodano dziaĹ‚ajÄ…cy `Grid Charge` dla kaĹĽdego slotu godzinowego. Tryb `Charge` automatycznie wĹ‚Ä…cza Ĺ‚adowanie z sieci i stosuje prÄ…d oraz limit SOC slotu.
- Dodano bezpieczne mapowanie harmonogramu 24h na szeĹ›Ä‡ fizycznych slotĂłw Deye. Zbyt zĹ‚oĹĽony ukĹ‚ad nie jest zapisywany bĹ‚Ä™dnie.
- Dodano natychmiastowÄ… aktualizacjÄ™ widoku podczas zapisu, komunikaty `Zapisywanie` i `Zapisano` oraz cofniÄ™cie zmiany po bĹ‚Ä™dzie.
- Uproszczono panele cen sprzedaĹĽy i zakupu, pozostawiajÄ…c aktualnÄ… cenÄ™ oraz peĹ‚ne tabele godzinowe na dziĹ› i jutro.

## UkĹ‚ad dashboardu

- **Status energii** - tryb, PV, dom, sieÄ‡, bateria, SOC, sprzedane dzisiaj i aktywny slot.
- **Ceny sprzedaĹĽy** - obecna cena i kompletna tabela cen dzisiaj/jutro.
- **Ceny zakupu** - obecna cena oraz tabela cen zakupu dzisiaj/jutro.
- **Prognoza Solcast** - aktualna moc PV, prognoza dzisiaj/jutro, najlepszy dzieĹ„ i wykres.
- **Harmonogram sprzedaĹĽy** - peĹ‚ne 24 godziny, edycja pojedyncza i zbiorcza.
- **Statystyki sprzedaĹĽy** - obecna godzina, dzieĹ„, tydzieĹ„ i miesiÄ…c.

## Zrzuty ekranu

### Dashboard

![Dashboard Deye Energy Manager](docs/screenshots/dashboard-v073.png)

### Edycja pojedynczego slotu

![Edycja pojedynczego slotu harmonogramu](docs/screenshots/slot-editor-v073.png)

### Inteligentne planowanie i analiza

![Ustawienia AI i analizy](docs/screenshots/ai-settings-v073.png)

## Wymagane encje

Podstawowe encje sterujÄ…ce Deye:

```text
select.deye_inverter_system_work_mode
number.deye_inverter_max_sell_power
number.deye_inverter_maximum_battery_discharge_current
number.deye_inverter_maximum_battery_charge_current
number.deye_inverter_maximum_battery_grid_charge_current
sensor.deye_inverter_battery
sensor.deye_inverter_grid_power
```

Opcjonalne odczyty statusu Deye uĹĽywane przez dashboard:

```text
sensor.deye_inverter_pv_power
sensor.deye_inverter_load_power
sensor.deye_inverter_battery_power
```

Encje cen sprzedaĹĽy i zakupu z Pstryk AIO:

```text
sensor.pstryk_aio_obecna_cena_sprzedazy_pradu
sensor.pstryk_aio_cena_sprzedazy_pradu_jutro
sensor.pstryk_aio_obecna_cena_zakupu_pradu
sensor.pstryk_aio_cena_zakupu_pradu_jutro
```

DomyĹ›lne encje prognozy Solcast:

```text
sensor.solcast_pv_forecast_aktualna_moc
sensor.solcast_pv_forecast_prognoza_na_dzisiaj
sensor.solcast_pv_forecast_prognoza_na_jutro
sensor.solcast_pv_forecast_prognoza_na_dzien_3
sensor.solcast_pv_forecast_prognoza_na_dzien_4
sensor.solcast_pv_forecast_prognoza_na_dzien_5
sensor.solcast_pv_forecast_prognoza_na_dzien_6
sensor.solcast_pv_forecast_prognoza_na_dzien_7
sensor.solcast_pv_forecast_pozostala_prognoza_na_dzis
sensor.solcast_pv_forecast_szczytowa_moc_dzisiaj
sensor.solcast_pv_forecast_czas_szczytowej_mocy_dzisiaj
```

Encje Deye Time Of Use:

```text
time.deye_inverter_time_of_use_1_start
number.deye_inverter_time_of_use_1_soc
switch.deye_inverter_time_of_use_1_grid_charge
```

Ten sam wzĂłr jest uĹĽywany dla slotĂłw od `1` do `6`.

## Instalacja przez HACS

1. W Home Assistant otwĂłrz **HACS**.
2. WejdĹş w **Custom repositories**.
3. Dodaj repozytorium jako **Integration**.
4. Zainstaluj **Deye Energy Manager**.
5. Zrestartuj Home Assistant.
6. PrzejdĹş do **Ustawienia â†’ UrzÄ…dzenia i usĹ‚ugi**.
7. Kliknij **Dodaj integracjÄ™**.
8. Wyszukaj **Deye Energy Manager** i dodaj integracjÄ™.
9. W formularzu wybierz encje swojego falownika, cen energii i Solcast.

Nie dodawaj `deye_energy_manager:` do `configuration.yaml`. Integracja dziaĹ‚a przez UI Home Assistant.

## Dodanie karty dashboardu

Po zainstalowaniu integracji skopiuj plik:

```text
www/deye-energy-manager-card.js
```

do katalogu Home Assistant:

```text
/config/www/deye-energy-manager-card.js
```

NastÄ™pnie przejdĹş do:

```text
Ustawienia â†’ Panele â†’ menu â‹® â†’ Zasoby
```

Dodaj nowy zasĂłb:

```text
/local/deye-energy-manager-card.js?v=0761
```

Typ zasobu:

```text
ModuĹ‚ JavaScript
```

Po zapisaniu odĹ›wieĹĽ stronÄ™ Home Assistant przez `Ctrl + F5`.

NastÄ™pnie otwĂłrz wybrany dashboard i wybierz:

```text
Edytuj dashboard â†’ Dodaj kartÄ™ â†’ RÄ™cznie
```

Wklej konfiguracjÄ™:

```yaml
type: custom:deye-energy-manager-card
```

Gotowy przykĹ‚ad dashboardu znajduje siÄ™ w katalogu:

```text
dashboard/
```

## Jak dziaĹ‚a harmonogram

Harmonogram ma 24 osobne sloty godzinowe. KaĹĽda godzina moĹĽe mieÄ‡ wĹ‚asny tryb pracy, moc sprzedaĹĽy, prÄ…d rozĹ‚adowania, prÄ…d Ĺ‚adowania baterii i minimalny SOC.

WĹ‚Ä…czenie dowolnej godziny w kolumnie **Aktywne** uruchamia sterowanie harmonogramem. JeĹĽeli aktualny slot jest wyĹ‚Ä…czony, integracja stosuje ustawienia domyĹ›lne.

Tryb `Charge` oznacza Ĺ‚adowanie z sieci. Integracja prĂłbuje wtedy wpisaÄ‡ odpowiednie zakresy do 6 slotĂłw Deye Time Of Use i zaznaczyÄ‡ `Grid Charge` dla wĹ‚aĹ›ciwych wierszy. JeĹ›li harmonogram 24h jest zbyt szczegĂłĹ‚owy i nie da siÄ™ go bezpiecznie zmieĹ›ciÄ‡ w 6 slotach Deye, integracja nie wpisuje bĹ‚Ä™dnych danych i pokazuje ostrzeĹĽenie w mapowaniu.

## Sugestie AI

Panel AI analizuje ceny sprzedaĹĽy i zakupu, prognozÄ™ Solcast, rzeczywistÄ… produkcjÄ™ PV oraz aktywne godziny harmonogramu. Ustawienia i historia analiz sÄ… przechowywane przez Home Assistant, dziÄ™ki czemu sÄ… wspĂłlne dla telefonu i komputera.

AI przygotowuje podglÄ…d kompletnego harmonogramu 24h z godzinami sprzedaĹĽy i Ĺ‚adowania. Harmonogram zostaje zapisany dopiero po rÄ™cznym wybraniu przycisku **Zastosuj propozycjÄ™ rÄ™cznie** i potwierdzeniu operacji. Integracja kontroluje przy tym limit 6 fizycznych zakresĂłw Deye Time Of Use.

Integracja zapisuje rĂłwnieĹĽ prognozÄ™ Solcast i rzeczywistÄ… produkcjÄ™ z encji `sensor.deye_inverter_daily_pv_production`. Po zakoĹ„czeniu dnia wylicza rĂłĹĽnicÄ™, bĹ‚Ä…d procentowy i trafnoĹ›Ä‡ prognozy.

## Aktualizacja karty po zmianach

Po kaĹĽdej aktualizacji karty zmieĹ„ koĹ„cĂłwkÄ™ zasobu Lovelace, np.:

```text
/local/deye-energy-manager-card.js?v=0761
```

Przy kolejnej wersji podnieĹ› numer cache, a potem odĹ›wieĹĽ przeglÄ…darkÄ™ przez `Ctrl + F5`.



