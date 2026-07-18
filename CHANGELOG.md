# Changelog

## 0.7.6

### Bezpieczeństwo

- Naprawiono regresję, która przy Stop Sell, zatrzymaniu awaryjnym i części błędów ustawiała `Max Sell Power` oraz prąd rozładowania na `0`.
- Wszystkie ścieżki zatrzymania i błędów korzystają teraz ze wspólnego stanu powrotu opartego 1:1 na ustawieniach domyślnych użytkownika: trybie, mocy sprzedaży oraz prądach rozładowania, ładowania i ładowania z sieci.
- Usunięto przejściowe zerowanie parametrów i wymuszanie `Zero Export To Load`. Docelowy tryb jest ustawiany dopiero po zapisaniu i potwierdzeniu wartości liczbowych.
- Błąd w połowie operacji przywraca logiczny harmonogram i pełne ustawienia domyślne. `Zero Export To CT`, `Zero Export To Load` i `Selling First` nie są wzajemnie zastępowane.
- Dodano weryfikację odczytu trybu, mocy i wszystkich trzech prądów oraz diagnostykę krytycznego błędu częściowego zapisu.
- Brak poprawnego odczytu przy aktywnej ochronie SOC uruchamia powrót 1:1 do pełnych ustawień domyślnych użytkownika.
- Brakująca lub błędna cena przy aktywnej ochronie ceny uruchamia powrót 1:1 do pełnych ustawień domyślnych użytkownika.
- Zapisy ustawień falownika są serializowane.
- Wielopolowe aktualizacje są serializowane; wartości liczbowe są zapisywane i potwierdzane przed ustawieniem wybranego trybu docelowego.
- Błąd mapowania ponad 6 zakresów zatrzymuje operację i stosuje 1:1 pełne ustawienia domyślne użytkownika.
- Dodano zakresy walidacji dla mocy, prądów, SOC i cen.
- Zatrzymanie awaryjne przełącza sterowanie w zatrzaśnięty tryb `Stop Sell`.

### Harmonogram

- Dodano usługę `apply_schedule_patch` do atomowych operacji zbiorczych.
- Edycja zbiorcza i zastosowanie sugestii korzystają z jednej operacji backendowej.
- Scheduler ładowania jest aktywowany przy wyborze trybu `Charge`.
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
- Zwiększono czytelność wykresów planu: energia i SOC mają osobne osie, siatka została uproszczona, legenda umożliwia ukrywanie serii, a wariant 48 h korzysta z szerokiego przewijanego widoku i wyraźnego podziału dni.
- Dodano osobny zsynchronizowany pasek pogody z ikoną dla każdej godziny oraz osobne pasy godzinowe sprzedaży, ładowania i taniej dystrybucji.
- Dodano datowany plan na jutro, który po ręcznym zatwierdzeniu jest zapisywany do restartu i stosowany dopiero właściwego dnia po kontroli SOC, cen i encji. Plan nie jest automatycznie zastępowany inną propozycją.
- Zaktualizowano wersjonowanie do 0.7.6.

### Jakość

- Dodano testy regresji logiki bezpieczeństwa, mapowania i kolejności zapisów.
- Usunięto śledzone pliki `__pycache__` i `.pyc`.
- Naprawiono kodowanie polskich dokumentów.
