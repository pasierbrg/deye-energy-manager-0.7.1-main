# Changelog

## 0.7.6

### Bezpieczeństwo

- Naprawiono regresję, która przy Stop Sell, zatrzymaniu awaryjnym i części błędów ustawiała `Max Sell Power` oraz prąd rozładowania na `0`.
- Wszystkie ścieżki zatrzymania i błędów korzystają teraz ze wspólnego stanu powrotu opartego 1:1 na ustawieniach domyślnych użytkownika: trybie, mocy sprzedaży oraz prądach rozładowania, ładowania i ładowania z sieci.
- Usunięto przejściowe zerowanie parametrów i wymuszanie `Zero Export To Load`. Docelowy tryb jest ustawiany dopiero po zapisaniu i potwierdzeniu wartości liczbowych.
- Błąd w połowie operacji przywraca logiczny harmonogram i pełne ustawienia domyślne. `Zero Export To CT`, `Zero Export To Load` i `Selling First` nie są wzajemnie zastępowane.
- Dodano weryfikację odczytu trybu, mocy i wszystkich trzech prądów oraz diagnostykę krytycznego błędu częściowego zapisu.
- Brakujący lub nieprawidłowy SOC albo cena są błędem tylko aktywnego slotu `Selling First`, gdy ma ustawiony odpowiedni warunek. Prawidłowy odczyt poniżej progu jest zwykłym wstrzymaniem sprzedaży, bez `SCHEDULE APPLY ERROR`, bez ponawiania zapisu i bez blokowania slotów `Zero Export`.
- Zapisy ustawień falownika są serializowane.
- Wielopolowe aktualizacje są serializowane; wartości liczbowe są zapisywane i potwierdzane przed ustawieniem wybranego trybu docelowego.
- Błąd mapowania ponad 6 zakresów zatrzymuje operację i stosuje 1:1 pełne ustawienia domyślne użytkownika.
- Dodano zakresy walidacji dla mocy, prądów, SOC i cen.
- Zatrzymanie awaryjne przełącza sterowanie w zatrzaśnięty tryb `Stop Sell`.
- Dla zapisu aktywnego slotu dodano nasłuchiwanie zmian encji Deye oraz szybkie odczyty kontrolne po 1, 2 i 4 sekundach, z limitem oczekiwania 90 sekund. W tym czasie transakcja nie jest ponawiana, ustawienia domyślne nie są przedwcześnie przywracane, a diagnostyka pokazuje etap oraz wartości oczekiwane i odczytane.
- Dodano walidację fizycznych encji Deye Time Of Use oraz świadomy przycisk/usługę `resume_manager` („Włącz Manager i harmonogram”). Włącza `Schedule` i Scheduler, lecz nie zmienia flagi `Grid` w żadnym slocie.
- Pole **Ładowanie z sieci** jest jedyną zgodą na Deye Grid Charge: wartość `nie` zawsze zapisuje wyłączony Grid Charge, także w trybie `Charge`; `charge_current` pozostaje limitem całkowitego ładowania baterii, a `grid_charge_current` limitem ładowania z sieci.
- Dodano osobny profil **Ustawienia ładowania** dla aktywnych slotów `Charge`: prąd ładowania, prąd rozładowania, prąd ładowania z sieci oraz docelowy SOC. **Minimalny SOC sprzedaży** pozostaje warunkiem tylko dla `Selling First`; do fizycznego SOC zakresu TOU dla Charge trafia wyłącznie docelowy SOC profilu.
- Usunięto aktywny przełącznik `charge_scheduler_enabled` z logiki sterowania. Parametry falownika wynikają z aktywnego slotu.
- Po błędzie tego samego aktywnego slotu ustawienia domyślne są stosowane tylko raz; kolejna próba wymaga zmiany encji, harmonogramu, slotu albo świadomego wznowienia Managera.

### Harmonogram

- Dodano usługę `apply_schedule_patch` do atomowych operacji zbiorczych.
- Edycja zbiorcza i zastosowanie sugestii korzystają z jednej operacji backendowej.
- Tryb `Charge` nie jest zgodą na Grid Charge; jedyną zgodę określa pole **Ładowanie z sieci** we wspólnym profilu Charge.
- Nieudana aktualizacja przywraca logiczną konfigurację slotów.

### Dane i konfiguracja

- Dodano Options Flow do późniejszej zmiany mapowania encji.
- Dodano konfigurowalne sensory mocy PV, domu i baterii.
- Bieżący dzień pokazuje realizację prognozy; trafność jest liczona po zamknięciu dnia.
- Duże atrybuty historii oznaczono jako niewymagające zapisu w Recorderze.
- Rozdzielono realizację bieżącego dnia od trafności zakończonych dni.
- Trafność pokazuje średnią, ostatni zamknięty dzień i liczbę dni, a korekta historyczna jest ograniczana do bezpiecznego zakresu.
- Dodano próbki pięciominutowe z jawnym oznaczeniem brakujących danych oraz archiwa 90 dni / 24 miesiące / 5 lat / miesięczne bez limitu.
- Dodano pomocniczą prognozę godzinową i dzienną `weather.*`, domyślnie `weather.forecast_home_2`; dane są pobierane przez `weather.get_forecasts`, a brak prognozy dziennej może zostać podsumowany z dostępnych próbek godzinowych.
- Dodano wersjonowany katalog profili PGE, Tauron, Enea, Energa i Stoen, obejmujący dostępne taryfy gospodarstw domowych oraz profil własny.
- Katalog jest sprawdzany przy starcie i co 7 dni, walidowany przed zapisaniem oraz przechowywany jako ostatnia poprawna kopia; dostępne są też ręczne odświeżenie i ręczne stawki awaryjne.
- Profile taryfowe uwzględniają strefy godzinowe, zmiany sezonowe, weekendy i polskie święta, a AI porównuje pełną cenę zakupu z dystrybucją dla dziś i jutra.
- Próbki uczenia są oznaczane operatorem, taryfą, strefą, rodzajem dnia, sezonem i wersją katalogu.
- Dodano konfigurację kierunku znaku mocy sieci i baterii.
- Options Flow przebudowano na pięcioetapowy kreator mapujący wyłącznie encje, z polskimi nazwami, instrukcjami, podpowiedziami automatycznymi i końcową walidacją.

### Karta i UX

- Pole statusu karty tłumaczy `SELL BLOCKED` jako **Sprzedaż zatrzymana**; pełna przyczyna pozostaje widoczna jako decyzja managera.
- Rozdzielono `minimum_sell_soc` od fizycznego `tou_soc`: minimalny SOC jest wyłącznie warunkiem `Selling First`, a do Deye TOU trafia niezależny SOC slotu albo docelowy SOC wspólnego profilu Charge.
- Migracja nie zastępuje brakującego fizycznego `tou_soc` minimalnym SOC sprzedaży ani `0`; wymagające potwierdzenia sloty blokują zapis mapowania przed pierwszą zmianą w Deye.
- Edytor fizycznego Deye Time Of Use jest wyłącznie diagnostyczny; jedyną ścieżką zapisu pozostaje serializowana transakcja Harmonogramu sprzedaży.
- Obie dystrybuowane kopie karty mają identyczną zawartość i rewizję zasobu `v=0772`.
- Poprawiono zabezpieczanie dynamicznych wartości HTML.
- Usunięto błędnie wyświetlane encje numeryczne HTML, m.in. w nazwie strategii „Zrównoważony”.
- Dodano zakładkę `Taryfa i dystrybucja` z wyborem operatora, taryfy i trybu katalogu, jawnym przyciskiem zapisu, diagnostyką aktualizacji oraz profilem 48h dla dziś i jutra.
- Sensory proxy reagują na zdarzenia źródłowych encji, a karta grupuje aktualizacje w jednej klatce animacji i nie przelicza ciężkich wykresów przy każdej zmianie mocy.
- Zmienione wartości są krótko sygnalizowane wizualnie bez tworzenia sztucznych odczytów.
- Uporządkowano działanie ustawień inteligentnego optymalizatora.
- Okna ustawień i sugestii mają lepsze przewijanie, przyklejone akcje i pełnoekranowy widok mobilny.
- Przebudowano okno `Sugestie AI` zgodnie z układem nawigacyjnym: Przegląd, Proponowane zmiany, Plan na dziś, Plan na jutro, Plan energii 48h i Jakość danych.
- Dodano rozdzielone tabele cen Dziś/Jutro, przełącznik propozycji/pełnych 24 godzin oraz jeden dynamiczny przycisk Zaznacz/Odznacz wszystkie.
- Dodano rzeczywistą symulację energii i SOC na 48 godzin, osobne wykresy dziś/jutro, pogodę pomocniczą, jakość danych i warianty Bezpieczny/Zrównoważony/Maksymalny zysk.
- Przebudowano wykresy planu dziś, jutro i 48 h: rozdzielono produkcję rzeczywistą, prognozę Solcast, prognozę skorygowaną i jej przedział oraz dodano zużycie, SOC, działania, tanią dystrybucję, pogodę godzinową, granicę dni i znacznik bieżącego czasu.
- Dodano wspólny interaktywny kursor i szczegółowy tooltip dla myszy oraz dotyku; brakujące pomiary są jawnie oznaczane jako brak danych.
- Rozbudowano kartę pogody o bieżące warunki, temperaturę, ciśnienie, wilgotność, wiatr oraz przełączane prognozy dzienną i godzinową z dokładnym źródłem i stanem aktualizacji.
- Zwiększono czytelność wykresów planu: energia i SOC mają osobne osie, legenda umożliwia ukrywanie serii, a wariant 48 h jest pokazany jako dwa osobne wykresy dobowe bez poziomego przewijania.
- Teksty osi, godziny, ikony pogody i pasy statusu przeniesiono poza skalowany SVG; usunięto dominujące pionowe linie godzinowe i pozostawiono tylko delikatne prowadnice co 6 godzin.
- Dodano osobny zsynchronizowany pasek pogody z ikoną dla każdej godziny oraz osobne pasy godzinowe sprzedaży, ładowania i taniej dystrybucji.
- Dodano datowany plan na jutro, który po ręcznym zatwierdzeniu jest zapisywany do restartu i stosowany dopiero właściwego dnia po kontroli SOC, cen i encji. Plan nie jest automatycznie zastępowany inną propozycją.
- Zaktualizowano wersjonowanie do 0.7.6.

### Jakość

- Dodano testy regresji logiki bezpieczeństwa, mapowania i kolejności zapisów.
- Usunięto śledzone pliki `__pycache__` i `.pyc`.
- Naprawiono kodowanie polskich dokumentów.
