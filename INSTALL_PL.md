# Deye Energy Manager 0.7.6 — instalacja

Wymagany Home Assistant: `2026.6` lub nowszy.

## Instalacja przez HACS

1. Dodaj repozytorium jako niestandardowe repozytorium HACS typu **Integracja**.
2. Zainstaluj Deye Energy Manager.
3. Uruchom ponownie Home Assistant.
4. Przejdź do **Ustawienia → Urządzenia i usługi → Dodaj integrację**.
5. Przejdź przez kreator:
   - wybierz mapowanie automatyczne, ręczne albo zachowanie bieżących ustawień;
   - sprawdź encje sterujące i pomiarowe Deye;
   - wybierz encje cen sprzedaży i zakupu;
   - sprawdź encje Solcast;
   - wybierz prognozę `weather.*` (domyślnie `weather.forecast_home_2`);
   - wykonaj test i potwierdź mapowanie.

Automatyczne mapowanie niczego nie zapisuje bez końcowego potwierdzenia. Kreator służy wyłącznie do wyboru encji Home Assistant. Operatora, taryfę, stawki oraz kierunek znaku mocy sieci i baterii ustawia się później w karcie.

## Karta dashboardu

Dodaj zasób JavaScript:

```text
/deye_energy_manager/deye-energy-manager-card.js?v=0777
```

Przy instalacji ręcznej użyj:

```text
/local/deye-energy-manager-card.js?v=0777
```

Następnie dodaj kartę ręczną:

```yaml
type: custom:deye-energy-manager-card
```

## Aktualizacja z 0.7.5

1. Wykonaj kopię konfiguracji w panelu **System i diagnostyka**.
2. Zaktualizuj integrację i uruchom ponownie Home Assistant.
3. Zmień parametr cache zasobu na `v=0777`.
4. Odśwież przeglądarkę przez `Ctrl + F5`.
5. Sprawdź mapowanie encji w opcjach integracji.
6. Otwórz **Ustawienia i diagnostyka → Taryfa i dystrybucja**, wybierz operatora i taryfę, a następnie użyj przycisku **Zapisz ustawienia taryfy**.
7. Zweryfikuj diagnostykę i wykonaj pierwszy test przy niskich limitach mocy.
8. Po Stop Sell lub zatrzymaniu awaryjnym użyj **System i diagnostyka → Włącz Manager i harmonogram**. Przycisk włącza `Schedule` i Scheduler, lecz nie zmienia szablonu ani istniejących slotów `Charge`; tylko **Ładowanie z sieci: TAK** w konkretnym slocie `Charge` zezwala na ładowanie z sieci.

Po aktualizacji otwórz **Ustawienia → Urządzenia i usługi → Deye Energy Manager → Konfiguruj**. Kreator zachowa dotychczasowe mapowanie i pozwoli uzupełnić encje cen, Solcast oraz pogody. Ustawienia OSD i taryfy zostały przeniesione do karty i nie są już częścią mapowania encji.

## Wymagane i zalecane encje

Wymagane dla bezpiecznego sterowania są: tryb pracy Deye, maksymalna moc sprzedaży, maksymalny prąd rozładowania, prąd ładowania baterii, prąd ładowania z sieci oraz bieżący odczyt SOC baterii. Cena sprzedaży jest wymagana tylko przez aktywny slot `Selling First`, jeżeli ma odpowiedni limit. Sloty `Zero Export` mogą działać bez aktualnego SOC i ceny. Pozostałe encje pomiarowe są zalecane zgodnie z używanymi funkcjami.

Prognoza pogody jest opcjonalnym wsparciem Solcast. Jeżeli `weather.forecast_home_2` nie istnieje, wybierz inną encję z domeny `weather`, która udostępnia prognozę godzinową. Integracja pobiera prognozy godzinowe i dzienne przez `weather.get_forecasts`; brak osobnej prognozy dziennej jest podsumowywany z dostępnych danych godzinowych.

## Kontrola po instalacji

1. W diagnostyce sprawdź, czy wymagane encje mają stan `OK`.
2. Porównaj znaki `Sieć` i `Bateria` z kartą falownika.
3. W zakładce **Taryfa i dystrybucja** wybierz tryb automatyczny lub ręczny, operatora i taryfę, ustaw znaki przepływu, a następnie kliknij **Zapisz ustawienia taryfy**.
4. Sprawdź profil 48 godzin: strefy na dziś i jutro, rodzaj dnia, sezon oraz łączną stawkę dystrybucji.
5. Jeżeli encja ceny zakupu zawiera dystrybucję, zaznacz **Cena zakupu zawiera już dystrybucję**.
6. Sprawdź stan i wersję katalogu. Automatyczna kontrola odbywa się przy starcie i co 7 dni; przycisk **Sprawdź aktualizację katalogu** uruchamia ją ręcznie. Przy błędzie pozostaje ostatnia poprawna kopia, a ostatecznym zabezpieczeniem jest katalog dostarczony z integracją.
7. Sprawdź, czy dashboard reaguje na zmianę mocy bez czekania jednej minuty.
8. Po zakończeniu pełnego dnia sprawdź trafność historyczną; w ciągu dnia używaj pola `Realizacja dzisiaj`.
9. Otwórz **Sugestie AI** i sprawdź zakładkę **Jakość danych**. Brak cen jutra lub prognozy pogody powinien być jawnie opisany jako brak danych.
10. W **Proponowanych zmianach** sprawdź osobno **Dziś** i **Jutro**. Plan jutra jest tylko zapisywany; nie zmienia od razu powtarzalnego Deye Time Of Use.
11. Sprawdź wykresy **Plan na dziś**, **Plan na jutro** i **Plan energii 48h**. Każda godzina powinna mieć ikonę pogody; lewa oś opisuje energię w kWh, prawa SOC w procentach, a dolne pasy sprzedaż, ładowanie i tanią dystrybucję. Po najechaniu lub dotknięciu godziny powinny być widoczne: produkcja rzeczywista, prognoza Solcast, prognoza skorygowana, przedział prognozy, zużycie, SOC, działanie i pogoda. Brak pomiaru powinien być opisany jako brak danych.
12. W sekcji **Pogoda** przełącz widok **Dzienna/Godzinowa** i potwierdź, że jako źródło widoczna jest wybrana encja `weather.*`.

Tryb ręczny pozwala wpisać własne stawki i przedziały tanich godzin. W trybie automatycznym pory roku, weekendy oraz polskie dni ustawowo wolne wynikają z wybranego profilu OSD. Katalog nie zastępuje umowy — przed uruchomieniem ładowania z sieci porównaj wybrane dane z dokumentami operatora.

Po ręcznym skopiowaniu nowej karty do `/config/www/` użyj zasobu `/local/deye-energy-manager-card.js?v=0777`, przeładuj zasoby Lovelace i wykonaj `Ctrl + F5`. Jeśli korzystasz z karty dostarczanej przez integrację, użyj adresu `/deye_energy_manager/deye-energy-manager-card.js?v=0777`.

Plan na jutro wymaga ręcznego zaznaczenia godzin i potwierdzenia przyciskiem **Zaplanuj wybrane na jutro**. Plan jest zapisany z datą i pozostaje oczekujący po restarcie Home Assistant. W dniu wykonania integracja sprawdza encje sterujące oraz tylko SOC i ceny wymagane przez zatwierdzony slot `Selling First`, po czym stosuje dokładnie zaakceptowane pozycje. Nie tworzy planu zastępczego. W razie błędu plan jest oznaczony jako nieudany, a falownik otrzymuje pełne **Ustawienia domyślne** 1:1.

W 0.7.6 warunek SOC jest sprawdzany wyłącznie dla aktywnego slotu `Selling First`, gdy ma ustawiony minimalny SOC sprzedaży. Brakujący lub nieprawidłowy SOC (analogicznie cena) jest błędem tylko dla slotu, który wymaga tego warunku; prawidłowy odczyt poniżej progu jedynie wstrzymuje sprzedaż bez błędu harmonogramu. Nie blokuje slotu `Zero Export` ani nie jest zastępowany sztuczną wartością.

**Minimalny SOC sprzedaży** jest warunkiem wyłącznie dla `Selling First`; nie trafia do fizycznego Deye TOU. Okno slotu pokazuje tylko jedno pole SOC odpowiednie dla trybu: minimalny SOC sprzedaży, SOC Deye TOU albo docelowy SOC Charge. Po zapisie falownik może opublikować nowy stan z opóźnieniem: integracja nasłuchuje zmian encji Deye i wykonuje odczyt kontrolny po 0,5, 1 i 2 sekundach, maksymalnie przez 12 sekund, bez ponownego wysyłania tej samej transakcji; w tym czasie diagnostyka pokazuje oczekiwanie, a nie błąd.

Jeżeli poprzednia konfiguracja nie zawiera wiarygodnie zapisanego **SOC baterii Deye (TOU)**, wprowadź go świadomie dla każdego slotu niebędącego `Charge`. Do czasu potwierdzenia integracja blokuje fizyczny zapis mapowania TOU, zamiast kopiować minimalny SOC sprzedaży albo podstawić `0`.

## Ustawienia ładowania

W **Ustawienia i diagnostyka → Ustawienia Trybów → Ustawienia ładowania** zapisz szablon dla nowych slotów `Charge`: prąd ładowania, prąd rozładowania, prąd ładowania z sieci oraz **Docelowy SOC**. Szablon jest kopiowany przy zmianie trybu danego slotu na `Charge`. Od tej chwili wartości slotu można edytować ręcznie i mają one pierwszeństwo; późniejsza zmiana szablonu ich nie nadpisze. Jedyną zgodą na Grid Charge jest przełącznik **Ładowanie z sieci: TAK** w danym slocie Charge. Przy wartości `NIE` Grid Charge pozostaje wyłączone nawet przy dodatnim limicie prądu; bateria może ładować się z PV.

Przycisk **Zapisz ustawienia ładowania** zapisuje cały profil jako jeden rekord. Po zamknięciu okna, ponownym otwarciu karty lub restarcie Home Assistant wszystkie zapisane wartości profilu powinny pozostać bez zmian. Formularz korzysta również z zapisanego profilu w atrybutach statusu managera, jeśli pomocnicza encja nie opublikowała jeszcze stanu. Tabela harmonogramu pokazuje zgodę **Ładowanie z sieci** zawsze jako **TAK** albo **NIE**. Jeżeli walidacja albo zapis się nie powiedzie, integracja zachowuje ostatni poprawny profil i wyświetla błąd.

Zakładka **Deye Time Of Use** udostępnia bezpośrednią edycję sześciu fizycznych zakresów falownika. Jest to ścieżka dla świadomej konfiguracji i diagnostyki; późniejsze zastosowanie Harmonogramu sprzedaży może ponownie zapisać te zakresy zgodnie z mapowaniem 24 h.

Stop Sell, zatrzymanie awaryjne oraz błąd sterowania nie zerują automatycznie mocy ani prądów Deye. Integracja stosuje 1:1 pełny zestaw zapisany w **Ustawieniach domyślnych**, włącznie z trybem `Zero Export To CT`, `Zero Export To Load` albo `Selling First`. Integracja nie odgaduje topologii instalacji i nie zastępuje wybranego trybu innym. Przycisk **Zastosuj ustawienia domyślne teraz** pozwala wykonać świadome ręczne przywrócenie.
