# CX Trip Manager

Responsywna aplikacja PWA dla małej ekipy planującej wyjazdy na wyścigi. Działa na telefonie i laptopie, a po podłączeniu Supabase wszystkie zmiany synchronizują się między urządzeniami.

## Co już działa

- wspólny pulpit z najbliższymi wyścigami i ostrzeżeniami,
- kalendarz miesięczny,
- dodawanie i edycja wyścigów na bieżąco,
- skład osobno na każdy wyścig: Jedzie / Może / Nie jedzie / Nieustalone,
- hotel: status, nazwa, adres, pokoje, cena, link, notatki,
- Google Maps z lokalizacji wyścigu lub hotelu,
- osobna zakładka **Zadania zespołu** dla Eduarda, Kuby, Dawida, Bartka i Donaty,
- każdy członek ekipy może dodać zadanie dowolnej osobie, a wszyscy widzą zmiany,
- zadania ogólne lub przypięte do konkretnego wyścigu,
- priorytet, termin, autor zadania, notatka, edycja i oznaczenie wykonania,
- alerty o zadaniach po terminie na pulpicie,
- transport i samochody,
- lista sprzętu / pakowania,
- koszty z wyborem płacącego i osób, których koszt dotyczy,
- automatyczne rozliczenie „kto komu powinien oddać”,
- eksport wszystkich kosztów do CSV,
- eksport wyścigu do pliku `.ics` (kalendarz telefonu/komputera),
- drukowanie karty wyjazdu,
- logowanie e-mail + hasło,
- ekipa chroniona kodem zaproszenia,
- synchronizacja Realtime przez Supabase,
- PWA — można dodać stronę jako ikonę na ekran telefonu,
- tryb DEMO, dopóki nie wstawisz danych Supabase.

## 1. Uruchomienie od razu w trybie DEMO

Nie musisz nic instalować. Otwórz `index.html` przez prosty serwer WWW, np. rozszerzenie Live Server w VS Code. Zobaczysz przykładowe dane i możesz klikać całą aplikację. Dane demo zapisują się lokalnie w przeglądarce.

> Logowanie i prawdziwa synchronizacja działają dopiero po wykonaniu kroków z Supabase.

## 2. Darmowy Supabase

1. Załóż darmowy projekt w Supabase.
2. Otwórz **SQL Editor**.
3. Skopiuj całą zawartość `schema.sql` i uruchom ją jeden raz.
   - Jeśli wcześniej uruchomiłeś starszą wersję bazy, zamiast ponownie wykonywać cały schemat uruchom `upgrade_tasks_v2.sql`.
4. Wejdź w **Project Settings → API** i skopiuj:
   - Project URL,
   - Publishable key / anon key.
5. W `config.js` wklej wartości:

```js
window.CXTRIP_CONFIG = {
  supabaseUrl: "https://TWOJ-PROJEKT.supabase.co",
  supabaseKey: "TWOJ_PUBLISHABLE_KEY",
};
```

Publishable/anon key jest kluczem przeznaczonym do aplikacji klienckich. **Nigdy nie wklejaj `service_role` key.** Dostęp do danych zabezpiecza Row Level Security z `schema.sql`.

### E-mail confirmation

Supabase może domyślnie wymagać potwierdzania e-maila. Możesz zostawić tę opcję i każdy potwierdzi konto, albo w ustawieniach Auth wyłączyć potwierdzanie e-maila dla tej małej prywatnej aplikacji.

## 3. Pierwsza ekipa

1. Pierwsza osoba zakłada konto.
2. Wybiera **Załóż ekipę** i wpisuje np. `Victoria CX`.
3. Aplikacja generuje kod zaproszenia, np. `A7C91F`.
4. Pozostałe 4 osoby zakładają swoje konta.
5. Wybierają **Dołącz kodem** i wpisują ten sam kod.
6. Od tej chwili wszyscy widzą ten sam kalendarz i dane.

## 4. Realtime

`schema.sql` dodaje najważniejsze tabele do publikacji `supabase_realtime`. Aplikacja nasłuchuje zmian w Postgres i automatycznie odświeża dane po dodaniu/edycji/usunięciu wpisu na innym urządzeniu.

## 5. Publikacja na GitHub Pages za 0 zł

Repozytorium ma gotowy workflow `.github/workflows/deploy.yml`.

1. Utwórz repozytorium na GitHubie.
2. Wrzuć zawartość tego folderu do repozytorium.
3. Ustaw główną gałąź jako `main`.
4. GitHub: **Settings → Pages → Source → GitHub Actions**.
5. Po pushu workflow opublikuje stronę.

To jest czysta aplikacja statyczna, więc nie ma serwera Node i nie ma rachunku za hosting. Baza oraz logowanie są po stronie darmowego Supabase.

### Ważne o repozytorium

Jeżeli korzystasz wyłącznie z bezpłatnego GitHub Pages, najprostszy wariant to publiczne repozytorium. Publiczny kod aplikacji nie oznacza publicznego dostępu do Waszych danych — dane są chronione logowaniem i RLS w Supabase. Jeśli nie chcesz publicznego kodu, możesz później przenieść hosting np. na inny darmowy serwis obsługujący prywatne repozytorium.

## 6. Telefon

Po opublikowaniu:

- iPhone/Safari: **Udostępnij → Dodaj do ekranu początkowego**,
- Android/Chrome: **menu → Zainstaluj aplikację / Dodaj do ekranu głównego**.

PWA zapamiętuje podstawowe pliki aplikacji. Dane wymagają połączenia z Supabase; ostatnio pobrany stan jest dodatkowo zapisywany jako lokalny snapshot awaryjny.

## Struktura

```text
index.html                 główna strona
styles.css                 wygląd responsywny
app.js                     cała logika aplikacji
config.js                  URL i publishable key Supabase
schema.sql                 baza, funkcje, RLS i Realtime
upgrade_tasks_v2.sql        aktualizacja starej bazy o nowe zadania
manifest.webmanifest       instalacja PWA
sw.js                      cache aplikacji
icons/icon.svg             ikona
.github/workflows/deploy.yml  publikacja GitHub Pages
```

## Co można dołożyć później

Architektura jest przygotowana pod dalszą rozbudowę, np. dokumenty/regulaminy, zdjęcia paragonów, powiadomienia push, przebieg trasy, wyniki po wyścigu, rejestr rowerów i kół, serwis sprzętu czy osobne ekipy/sezony.
