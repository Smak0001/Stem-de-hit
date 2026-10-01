# Aparte testsite

Op 1 oktober 2026 is een aparte openbare testsite gepubliceerd. De originele site is niet opnieuw gepubliceerd of gewijzigd; GitHub `main` is niet gewijzigd.

## Links en scheiding

- Testsite voor gasten: https://stem-de-hit-test.patric726901.chatgpt.site/
- Testhost: https://stem-de-hit-test.patric726901.chatgpt.site/?host=1
- Originele site: https://stem-de-hit.patric726901.chatgpt.site/
- Test Site-ID: `appgprj_6abe1859bf6481918ced86c3777d26aa`.
- Originele Site-ID: `appgprj_6ab6f0e9565081919db1a409b7072ca4`.

De testsite heeft een eigen database, beheercode, gasten, stemmen en Spotify-koppeling. Er zijn geen productiegegevens of Spotify-tokens gekopieerd. De site is publiek bereikbaar voor telefoons via QR; deelnemen vereist nog steeds de wisselende zescijferige feestcode.

## Eenmalig Spotify instellen

1. Voeg in de instellingen van je Spotify Developer-app deze extra Redirect URI toe: `https://stem-de-hit-test.patric726901.chatgpt.site/?host=1`. Laat de oorspronkelijke Redirect URI staan.
2. Open de testhost. Vul in de hostinstellingen de Spotify Client ID en de aparte test-beheercode in en koppel Spotify opnieuw.
3. De lokaal opgeslagen test-beheercode staat in `work/testsite-toegang.txt`. Dit bestand is uitgesloten van Git. Deel deze beheercode niet met gasten; zij gebruiken de wisselende feestcode op het hostscherm.
4. Start Spotify op de laptop, kies de juiste speler en laat de testhost open. Scan de QR van deze testhost met telefoons op 4G.

Let op: twee websites met hetzelfde Spotify-account bedienen dezelfde Spotify-speler. Gebruik een apart Spotify-account voor gelijktijdig testen zonder de muziek van de originele site te beïnvloeden. Houd ook rekening met toegestane gebruikers van je Spotify Developer-app.

## Gepubliceerde code en toekomstige updates

- Basis: GitHub `test`, commit `e7ae57320a8579e7e1b0c8bd5342273fb4575ebc`.
- Testsite-versie 1: Sites-broncommit `1fcfb412dee3f456f9ebf5e342923f99c944e9b1`.
- Aparte lokale publicatiecheckout: `../stem-de-hit-test` naast deze repository.
- De `.openai/hosting.json` in deze GitHub-repository blijft naar de originele site verwijzen. Gebruik die niet om naar de testsite te publiceren. De aparte testcheckout bevat de test Site-ID.
- Een push naar GitHub `test` publiceert niet automatisch. Wijzigingen blijven naar GitHub `test` gaan; publiceer alleen naar de juiste afzonderlijke testsite. De originele site en `main` blijven ongemoeid tot expliciete toestemming.

De build is geslaagd. Echte Spotify-overgangen en een duurtest met telefoons moeten nog plaatsvinden na het koppelen. Gebruik hiervoor [de praktijktestchecklist](party-test-checklist.md).
