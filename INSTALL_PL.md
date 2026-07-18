# Deye Energy Manager 0.7.6 — instalacja

Wymagany Home Assistant: `2026.6` lub nowszy.

## Instalacja przez HACS

1. Dodaj repozytorium jako niestandardowe repozytorium HACS typu **Integracja**.
2. Zainstaluj Deye Energy Manager.
3. Uruchom ponownie Home Assistant.
4. Przejdź do **Ustawienia → Urządzenia i usługi → Dodaj integrację**.
5. Przejdź przez kreator:
   - wybierz mapowanie automatyczne, ręczne albo zachowanie bieżących ustawień;
   - sprawdź encje Deye i znaki przepływu mocy;
   - wybierz źródło cen, operatora OSD, taryfę i wpisz aktualne stawki dystrybucji;
   - sprawdź encje Solcast;
   - wybierz prognozę `weather.*` (domyślnie `weather.forecast_home_2`);
   - wykonaj test i potwierdź mapowanie.

Automatyczne mapowanie niczego nie zapisuje bez końcowego potwierdzenia. Szczególną uwagę zwróć na encje sterujące falownikiem oraz kierunek znaku mocy sieci i baterii.

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

Po aktualizacji otwórz **Ustawienia → Urządzenia i usługi → Deye Energy Manager → Konfiguruj**. Nowy kreator zachowa dotychczasowe mapowanie i poprosi o uzupełnienie pogody, profilu OSD, taryfy, stawek oraz znaków przepływu.

## Wymagane i zalecane encje

Wymagane dla bezpiecznego sterowania są: tryb pracy Deye, maksymalna moc sprzedaży, maksymalny prąd rozładowania oraz SOC baterii. Pozostałe encje sterujące i pomiarowe są zalecane zgodnie z używanymi funkcjami.

Prognoza pogody jest opcjonalnym wsparciem Solcast. Jeżeli `weather.forecast_home_2` nie istnieje, wybierz inną encję z domeny `weather`, która udostępnia prognozę godzinową.

## Kontrola po instalacji

1. W diagnostyce sprawdź, czy wymagane encje mają stan `OK`.
2. Porównaj znaki `Sieć` i `Bateria` z kartą falownika.
3. W zakładce **Taryfa i dystrybucja** sprawdź bieżącą strefę i 24 godziny.
4. Sprawdź, czy dashboard reaguje na zmianę mocy bez czekania jednej minuty.
5. Po zakończeniu pełnego dnia sprawdź trafność historyczną; w ciągu dnia używaj pola `Realizacja dzisiaj`.

W 0.7.6 ochrona SOC działa fail-safe. Jeśli sensor SOC jest brakujący lub niedostępny, manager stosuje 1:1 pełny zestaw zapisany w **Ustawieniach domyślnych**, włącznie z wybranym przez użytkownika trybem.

Stop Sell, zatrzymanie awaryjne oraz błąd sterowania nie zerują automatycznie mocy ani prądów Deye. Integracja stosuje 1:1 pełny zestaw zapisany w **Ustawieniach domyślnych**, włącznie z trybem `Zero Export To CT`, `Zero Export To Load` albo `Selling First`. Integracja nie odgaduje topologii instalacji i nie zastępuje wybranego trybu innym. Przycisk **Zastosuj ustawienia domyślne teraz** pozwala wykonać świadome ręczne przywrócenie.
