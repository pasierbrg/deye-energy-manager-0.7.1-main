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
- Dodano pomocniczą prognozę godzinową `weather.*`, domyślnie `weather.forecast_home_2`.
- Dodano profile PGE, Tauron, Enea, Energa, Stoen i własny oraz taryfy G11, G12, G12w, G12e i własną.
- Profile taryfowe uwzględniają weekendy i polskie święta, a AI porównuje pełną cenę zakupu z dystrybucją.
- Dodano konfigurację kierunku znaku mocy sieci i baterii.
- Options Flow przebudowano na pięcioetapowy kreator z polskimi nazwami, instrukcjami, podpowiedziami automatycznymi i końcową walidacją.

### Karta i UX

- Poprawiono zabezpieczanie dynamicznych wartości HTML.
- Usunięto błędnie wyświetlane encje numeryczne HTML, m.in. w nazwie strategii „Zrównoważony”.
- Dodano zakładkę `Taryfa i dystrybucja` z profilem 24h.
- Sensory proxy reagują na zdarzenia źródłowych encji, a karta grupuje aktualizacje w jednej klatce animacji i nie przelicza ciężkich wykresów przy każdej zmianie mocy.
- Zmienione wartości są krótko sygnalizowane wizualnie bez tworzenia sztucznych odczytów.
- Uporządkowano działanie ustawień inteligentnego optymalizatora.
- Okna ustawień i sugestii mają lepsze przewijanie, przyklejone akcje i pełnoekranowy widok mobilny.
- Zaktualizowano wersjonowanie do 0.7.6.

### Jakość

- Dodano testy regresji logiki bezpieczeństwa, mapowania i kolejności zapisów.
- Usunięto śledzone pliki `__pycache__` i `.pyc`.
- Naprawiono kodowanie polskich dokumentów.
