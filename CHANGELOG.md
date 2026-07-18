# Changelog

## 0.7.6

### Bezpieczeństwo

- Sprzedaż jest blokowana, gdy aktywna ochrona SOC nie ma poprawnego odczytu.
- Aktywna ochrona ceny blokuje sprzedaż przy brakującej lub błędnej cenie.
- Zapisy ustawień falownika są serializowane.
- Wielopolowe aktualizacje przechodzą przez `Zero Export To Load`.
- Błąd mapowania ponad 6 zakresów zatrzymuje operację i utrzymuje bezpieczny tryb.
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

### Karta i UX

- Poprawiono zabezpieczanie dynamicznych wartości HTML.
- Uporządkowano działanie ustawień inteligentnego optymalizatora.
- Okna ustawień i sugestii mają lepsze przewijanie, przyklejone akcje i pełnoekranowy widok mobilny.
- Zaktualizowano wersjonowanie do 0.7.6.

### Jakość

- Dodano testy regresji logiki bezpieczeństwa, mapowania i kolejności zapisów.
- Usunięto śledzone pliki `__pycache__` i `.pyc`.
- Naprawiono kodowanie polskich dokumentów.
