# Współtworzenie Deye Energy Manager

Dziękujemy za pomoc w rozwoju projektu.

## Zgłoszenia błędów

Do zgłoszenia dołącz:

- wersję Home Assistant i Deye Energy Manager;
- model falownika;
- stan sensora diagnostycznego integracji;
- oczekiwane i rzeczywiste zachowanie;
- logi bez danych poufnych;
- informację, czy problem dotyczy sprzedaży, ładowania czy mapowania Time Of Use.

## Zmiany w kodzie

1. Utwórz osobną gałąź.
2. Nie dodawaj `__pycache__`, plików `.pyc` ani danych z własnej instalacji HA.
3. Zachowaj fail-safe dla brakujących danych SOC i ceny.
4. Nie omijaj transakcyjnej usługi harmonogramu dla operacji wielopolowych.
5. Uruchom testy:

```text
python -m unittest discover -s tests -v
node --check www/deye-energy-manager-card.js
```

6. Opisz wpływ zmiany na bezpieczeństwo sterowania falownikiem.
