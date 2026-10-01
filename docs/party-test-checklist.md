# Testversie: betrouwbare playback en sessies

Deze wijzigingen horen bij branch `test`. Niet publiceren of naar `main` mergen zonder expliciete toestemming.

## Wat is aangepast

- Een al spelende winnaar wordt bevestigd, niet opnieuw gestart.
- Ontbrekende/verouderde Spotify-status is geen reden om te skippen. Laatst bekende informatie blijft staan met een melding; Auto-DJ wacht.
- Alle gasten delen één opgeslagen playbackmomentopname. Binnen één Worker worden gelijktijdige polls samengevoegd; een atomaire D1-lease voorkomt gelijktijdig verversen door andere Workers. Een snapshot wordt ongeveer eenmaal per seconde vernieuwd, onafhankelijk van het aantal gasten.
- Spotify 429/Retry-After wordt ook tussen Workers gerespecteerd. Verzoeken overlappen niet meer per telefoon.
- De volledige vervolgvolgorde wordt vóór een afspeelopdracht opgeslagen in D1, niet alleen de beperkte Spotify-queue. Lange lijsten worden in blokken van maximaal 100 nummers afgespeeld; het restant blijft opgeslagen en wordt bij het einde van een blok hervat.
- Auto-DJ reserveert geen winnaar meer twaalf seconden vooraf. Playlistgegevens worden eventueel vooraf gelezen, maar de winnaar wordt op het overgangsmoment server-side bepaald.
- Dubbele afleveringen, twee hostschermen en onzekere antwoorden mogen niet blind een extra afspeelopdracht geven.
- Party Mode vult verzoeken met unieke Spotify-nummers aan tot vijf beschikbare nummers.
- Na sessie-intrekking gaan gasten terug naar de code-invoer. Late antwoorden van de oude sessie worden genegeerd.

## Voorwaarden en grenzen

- Laat één hostpagina actief op de laptop staan en voorkom slaapstand. De host stuurt de overgangen aan; dit is geen autonome server-DJ wanneer alle hostpagina's gesloten zijn.
- Start voor de test een gewone toegankelijke Spotify-playlist of album, met Shuffle en nummer-herhalen uit. Een onbekende afspeelbron of Shuffle wordt niet stilzwijgend omgezet naar een verzonnen volgorde: de host krijgt een melding.
- Bij een privéplaylist kan opnieuw koppelen nodig zijn vanwege `playlist-read-private` en `playlist-read-collaborative`. Deze toestemming is alleen lezen, niet wijzigen. Spotify kan voor sommige apps/afspeellijsten alsnog toegang beperken. Een onleesbare bron blokkeert overname; de bestaande muziek blijft spelen.
- De originele playlist wordt niet bewerkt. De app bewaart een eigen vervolgvolgorde, inclusief het zichtbare queue-prefix, en haalt de gepromoveerde winnaar daaruit. Na overname wordt de oorspronkelijke volgorde één keer afgewerkt; wijzigingen die je daarna in de bronplaylist maakt worden niet automatisch geïmporteerd.
- Spotify's Web API biedt geen atomaire opdracht om een willekeurig queue-item te verwijderen of te verplaatsen. Deze versie neemt bij een winnaar daarom de afspeelreeks over. Exacte timing, native handmatig toegevoegde queue-items, crossfade en gapless playback moeten op het echte Spotify-apparaat worden getest. Bij polling/API-latentie kan de natuurlijke volgende track kort beginnen voordat de winnaar wordt gestart; er is geen garantie op sample-nauwkeurige, naadloze overgangen.
- Een expliciete nieuwe sessie wist verzoeken/stemmen en gastentoegang. Een bevestigde opgeslagen playbackreeks blijft bestaan zodat de muziek niet na 100 nummers afbreekt. Een onzekere opdracht wordt bij een bewuste reset verlaten; start dan eerst opnieuw de oorspronkelijke playlist op Spotify.
- Een GitHub-push is geen uitrol. De huidige openbare site blijft de oude versie totdat uitrollen expliciet is toegestaan.

## Geautomatiseerde controles

```sh
npm test
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

Tests laden de echte TypeScript-modules met een in-memory SQLite-opslag en gesimuleerde Spotify-antwoorden. Ze plaatsen geen live stemmen en bedienen geen echt Spotify-apparaat. Node 22.13+ is vereist; `node:sqlite` kan een experimentele waarschuwing geven.

## Praktijktest voor het feest (30–60 minuten)

1. Koppel Spotify zo nodig opnieuw. Start een playlist en open de host; laat twee of meer telefoons via 4G aansluiten met de tv-code.
2. Controleer actueel nummer, stemtotalen en vijf regels in Party Mode, ook met precies één verzoek en lange titels.
3. Stem een nummer uit de oorspronkelijke queue naar boven. Laat de winnaar volledig uitspelen. Controleer dat hij niet opnieuw begint en later niet nog een keer uit de bewaarde vervolgvolgorde verschijnt.
4. Stem in de laatste seconden en test twee hosttabs. Controleer dat maar één winnaar gestart wordt.
5. Verbreek kort de netwerkverbinding van de host. Muziek mag hierdoor niet starten/skippen; een waarschuwing moet verschijnen. Na herstel moet de actuele status terugkomen.
6. Test de overgang na nummer 100 met een lange playlist; controleer dat het opgeslagen restant wordt hervat.
7. Start een nieuwe sessie. Een al aangesloten telefoon moet zonder verversen de nieuwe code vragen; oude verzoeken en stemmen moeten weg zijn.
8. Luister expliciet naar overgangen met de gewenste Spotify-crossfade. Als dit niet acceptabel klinkt, gebruik Auto-DJ niet op het feest voordat de apparaat-specifieke overgang is opgelost.

De lokale controles bewijzen geen geslaagde echte Spotify-duurtest. Die is nog nodig vóór een besluit om deze branch uit te rollen.
