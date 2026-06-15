# Budowa domu

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
chmod 775 storage uploads
```

Jeśli hosting nie ma Node.js, można zbudować projekt lokalnie i wgrać gotowe pliki z repozytorium.
