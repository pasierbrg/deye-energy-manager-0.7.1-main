# Współpraca

Dzięki za chęć pomocy przy Deye Energy Manager.

## Zgłaszanie problemów

Przy zgłoszeniu błędu podaj:

- wersję Home Assistant,
- wersję Deye Energy Manager,
- nazwę integracji, która udostępnia encje `deye_inverter_*`,
- zrzut ekranu karty lub błąd z logów,
- informację, która encja nie działa zgodnie z oczekiwaniem.

## Propozycje zmian

Najlepiej opisać:

- co ma się zmienić,
- jaki problem rozwiązuje zmiana,
- jakie encje Deye/Pstryk mają być użyte,
- jak powinno to wyglądać na telefonie i komputerze.

## Pull requesty

Przed wysłaniem zmian sprawdź:

```text
python -m compileall custom_components/deye_energy_manager
node --check custom_components/deye_energy_manager/www/deye-energy-manager-card.js
```

Projekt jest skierowany głównie na polski rynek energii, więc dokumentacja i teksty użytkownika powinny być po polsku.
