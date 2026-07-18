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
/deye_energy_manager/deye-energy-manager-card.js?v=0762
```

Przy instalacji ręcznej użyj:

```text
/local/deye-energy-manager-card.js?v=0762
```

Następnie dodaj kartę ręczną:

```yaml
type: custom:deye-energy-manager-card
```

## Aktualizacja z 0.7.5

1. Wykonaj kopię konfiguracji w panelu **System i diagnostyka**.
2. Zaktualizuj integrację i uruchom ponownie Home Assistant.
3. Zmień parametr cache zasobu na `v=0762`.
4. Odśwież przeglądarkę przez `Ctrl + F5`.
5. Sprawdź mapowanie encji w opcjach integracji.
6. Otwórz **Ustawienia i diagnostyka → Taryfa i dystrybucja**, wybierz operatora i taryfę, a następnie użyj przycisku **Zapisz ustawienia taryfy**.
7. Zweryfikuj diagnostykę i wykonaj pierwszy test przy niskich limitach mocy.

Po aktualizacji otwórz **Ustawienia → Urządzenia i usługi → Deye Energy Manager → Konfiguruj**. Kreator zachowa dotychczasowe mapowanie i pozwoli uzupełnić encje cen, Solcast oraz pogody. Ustawienia OSD i taryfy zostały przeniesione do karty i nie są już częścią mapowania encji.

## Wymagane i zalecane encje

Wymagane dla bezpiecznego sterowania są: tryb pracy Deye, maksymalna moc sprzedaży, maksymalny prąd rozładowania oraz SOC baterii. Pozostałe encje sterujące i pomiarowe są zalecane zgodnie z używanymi funkcjami.

Prognoza pogody jest opcjonalnym wsparciem Solcast. Jeżeli `weather.forecast_home_2` nie istnieje, wybierz inną encję z domeny `weather`, która udostępnia prognozę godzinową.

## Kontrola po instalacji

1. W diagnostyce sprawdź, czy wymagane encje mają stan `OK`.
2. Porównaj znaki `Sieć` i `Bateria` z kartą falownika.
3. W zakładce **Taryfa i dystrybucja** wybierz tryb automatyczny lub ręczny, operatora i taryfę, ustaw znaki przepływu, a następnie kliknij **Zapisz ustawienia taryfy**.
4. Sprawdź profil 48 godzin: strefy na dziś i jutro, rodzaj dnia, sezon oraz łączną stawkę dystrybucji.
5. Jeżeli encja ceny zakupu zawiera dystrybucję, zaznacz **Cena zakupu zawiera już dystrybucję**.
6. Sprawdź stan i wersję katalogu. Automatyczna kontrola odbywa się przy starcie i co 7 dni; przycisk **Sprawdź aktualizację katalogu** uruchamia ją ręcznie. Przy błędzie pozostaje ostatnia poprawna kopia, a ostatecznym zabezpieczeniem jest katalog dostarczony z integracją.
7. Sprawdź, czy dashboard reaguje na zmianę mocy bez czekania jednej minuty.
8. Po zakończeniu pełnego dnia sprawdź trafność historyczną; w ciągu dnia używaj pola `Realizacja dzisiaj`.

Tryb ręczny pozwala wpisać własne stawki i przedziały tanich godzin. W trybie automatycznym pory roku, weekendy oraz polskie dni ustawowo wolne wynikają z wybranego profilu OSD. Katalog nie zastępuje umowy — przed uruchomieniem ładowania z sieci porównaj wybrane dane z dokumentami operatora.

Po ręcznym skopiowaniu nowej karty do `/config/www/` użyj zasobu `/local/deye-energy-manager-card.js?v=0762`, przeładuj zasoby Lovelace i wykonaj `Ctrl + F5`. Jeśli korzystasz z karty dostarczanej przez integrację, użyj adresu `/deye_energy_manager/deye-energy-manager-card.js?v=0762`. Parametr `0762` wymusza pobranie drugiej rewizji karty wydania 0.7.6.

W 0.7.6 ochrona SOC działa fail-safe. Jeśli sensor SOC jest brakujący lub niedostępny, manager stosuje 1:1 pełny zestaw zapisany w **Ustawieniach domyślnych**, włącznie z wybranym przez użytkownika trybem.

Stop Sell, zatrzymanie awaryjne oraz błąd sterowania nie zerują automatycznie mocy ani prądów Deye. Integracja stosuje 1:1 pełny zestaw zapisany w **Ustawieniach domyślnych**, włącznie z trybem `Zero Export To CT`, `Zero Export To Load` albo `Selling First`. Integracja nie odgaduje topologii instalacji i nie zastępuje wybranego trybu innym. Przycisk **Zastosuj ustawienia domyślne teraz** pozwala wykonać świadome ręczne przywrócenie.
