# Budowa domu

Panel inwestora do prowadzenia prostego rejestru budowy domu. Aplikacja łączy listę zadań, rejestr wydatków, podział kosztów między inwestorów oraz podstawowe ustawienia konta w jednym widoku.

## Funkcjonalność

### Panel podsumowania

Na górze aplikacji widoczne są trzy kafelki z najważniejszymi liczbami:

- **Planowany koszt inwestycji** - suma wszystkich wydatków z rejestru, łącznie z kosztami planowanymi.
- **Zapłacone do tej pory** - suma wydatków oznaczonych jako zapłacone wraz z paskiem pokazującym podział płatności między inwestorów.
- **Do zapłaty** - tylko wydatki wymagające płatności, bez kosztów oznaczonych jako planowane.

Kafelek planowanego kosztu pokazuje też procent zapłaconej części planu oraz pasek postępu.

### Zadania

Moduł zadań pozwala prowadzić listę prac i spraw do załatwienia na budowie. Każde zadanie może mieć:

- nazwę,
- etap budowy,
- termin z godziną rozpoczęcia i zakończenia,
- status wykonania,
- oznaczenie jako pilne,
- komentarz,
- załączniki w formie obrazów lub PDF.

Zadania można filtrować według statusu: do zrobienia, zrobione albo wszystkie. Przy zakładce zadań widoczny jest licznik zadań do wykonania, jeśli takie istnieją.

Załączniki w zadaniach są grupowane. Obrazy i dokumenty/PDF pokazywane są jako osobne przyciski z licznikami, a kliknięcie otwiera podgląd lub wybór pliku, gdy w danej grupie jest ich kilka.

### Wydatki

Rejestr wydatków służy do zapisywania kosztów budowy i dokumentów kosztowych. Każdy wydatek może zawierać:

- opis,
- etap budowy,
- kategorię,
- kwotę,
- status płatności,
- datę zapłaty,
- informację, kto płaci,
- podział kwoty między inwestorów,
- notatkę z prostym formatowaniem tekstu,
- fakturę lub inny załącznik.

Dostępne statusy płatności:

- **Planowane** - koszt jest uwzględniony w planowanym koszcie inwestycji, ale nie trafia jeszcze do kafelka "Do zapłaty".
- **Do zapłaty** - koszt jest wymagalny i widoczny w podsumowaniu kwoty do zapłaty.
- **Zapłacone** - koszt jest uwzględniony w zapłaconej kwocie i w podziale płatności inwestorów.

Wydatki można filtrować według statusu: planowane, do zapłaty, zapłacone albo wszystkie. Przy zakładce wydatków widoczny jest licznik wydatków do zapłaty, jeśli takie istnieją.

### Podział kosztów

Formularz wydatku pozwala szybko ustawić, kto płaci za dany koszt:

- pierwszy inwestor,
- drugi inwestor,
- podział 50:50,
- własny podział kwotowy.

Kwoty są prezentowane bez groszy i z separatorem tysięcy. W widoku listy kwota wydatku jest pokazana jako plakietka.

### Notatki i załączniki

Komentarze i notatki nie zaśmiecają listy. Jeśli wpis ma notatkę albo załącznik, na karcie pojawia się ikona otwierająca modal z podglądem. Obrazy są wyświetlane jako obrazy, a dokumenty/PDF w podglądzie osadzonym w aplikacji. Pliki można dodawać przez wybór z dysku albo przez przeciągnięcie i upuszczenie.

### Ustawienia

W ustawieniach można skonfigurować:

- nazwy inwestorów,
- adresy email inwestorów,
- link kalendarza,
- nowe hasło do konta po podaniu aktualnego hasła.

### Responsywność

Interfejs jest dostosowany do telefonu i wąskich ekranów. Na mniejszych szerokościach przyciski przechodzą w tryb ikonowy, układy kart upraszczają się, a akcje przy zadaniach i wydatkach przenoszą się pod treść wpisu.

## Dane aplikacji

Aplikacja zapisuje dane lokalnie w `storage/budowa.json`, a załączniki w `uploads/`.
Te katalogi są ignorowane przez git, więc aktualizacja kodu z repozytorium nie nadpisze zadań, wydatków ani faktur.

W repozytorium znajduje się tylko plik przykładowy `server/data/budowa.example.json`. Przy pierwszym uruchomieniu aplikacja tworzy z niego lokalną bazę, jeśli `storage/budowa.json` jeszcze nie istnieje.

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

## Build produkcyjny

```bash
npm run build
```

Build aktualizuje `index.html`, `favicon.svg` i katalog `assets/`, czyli pliki potrzebne do działania na hostingu PHP.

## Aktualizacja na hostingu

```bash
git pull
npm install
npm run build
mkdir -p storage uploads
chmod 750 storage uploads
```

Jeśli hosting nie ma Node.js, można zbudować projekt lokalnie i wgrać gotowe pliki z repozytorium.
