# Deye Energy Manager - instalacja

Aktualna wersja: `0.7.5`

To jest kompletne repozytorium do GitHuba i HACS. Nie dodawaj `deye_energy_manager:` do `configuration.yaml`.

## 1. Instalacja przez HACS

1. OtwĂłrz Home Assistant.
2. WejdĹş w HACS.
3. Kliknij trzy kropki i wybierz `Custom repositories`.
4. Wklej adres swojego repozytorium GitHub.
5. Jako typ wybierz `Integration`.
6. Dodaj repozytorium.
7. Zainstaluj `Deye Energy Manager`.
8. Zrestartuj Home Assistant.

## 2. Dodanie integracji

1. WejdĹş w `Ustawienia -> UrzÄ…dzenia i usĹ‚ugi`.
2. Kliknij `Dodaj integracjÄ™`.
3. Wyszukaj `Deye Energy Manager`.
4. Dodaj integracjÄ™ i wybierz encje falownika Deye, Pstryk AIO oraz Solcast.

## 3. Dodanie karty Lovelace

Po restarcie Home Assistant skopiuj plik:

```text
www/deye-energy-manager-card.js
```

do katalogu:

```text
/config/www/deye-energy-manager-card.js
```

NastÄ™pnie dodaj zasĂłb Lovelace:

```text
/local/deye-energy-manager-card.js?v=0780
```

Typ zasobu:

```text
ModuĹ‚ JavaScript
```

Potem odĹ›wieĹĽ Home Assistant przez `Ctrl + F5` i dodaj kartÄ™ rÄ™cznÄ…:

```yaml
type: custom:deye-energy-manager-card
```

## 4. Co dodano w 0.7.5

- Uproszczony status energii.
- Czytelne szczegĂłĹ‚y historii analiz i sugestii.
- DziaĹ‚ajÄ…cy `Grid Charge` w godzinowych slotach oraz automatyczna obsĹ‚uga trybu `Charge`.
- Bezpieczne mapowanie harmonogramu 24h na szeĹ›Ä‡ slotĂłw Deye Time Of Use.
- Natychmiastowa aktualizacja widoku po zapisie z obsĹ‚ugÄ… bĹ‚Ä™dĂłw.
- Uproszczone panele cen sprzedaĹĽy i zakupu.

## 5. Gdy widzisz starÄ… kartÄ™

ZmieĹ„ numer w zasobie Lovelace:

```text
/local/deye-energy-manager-card.js?v=0780
```

Potem odĹ›wieĹĽ przeglÄ…darkÄ™ przez `Ctrl + F5`.



