# Skrizzle

Link einwerfen, Video landet im Zielordner. Mac zuerst, Windows vorbereitet.

Die eigentliche Arbeit macht [yt-dlp](https://github.com/yt-dlp/yt-dlp); diese App
ist die Oberfläche darum: Zielordner, Qualitätsstufe, Warteschlange, Fortschritt.

## Starten

```sh
npm install
npm start
```

## Voraussetzungen

| Programm | Wofür | Wenn es fehlt |
|---|---|---|
| `yt-dlp` | holt das Video | Die App lädt es auf Knopfdruck selbst herunter |
| `ffmpeg` | fügt Bild und Ton zusammen | Nur Einzeldateien, bei YouTube meist 720p |

`ffmpeg` kann die App **nicht** selbst nachladen: offizielle yt-dlp-Builds gibt es
nur für Linux und Windows, nicht für macOS. Auf dem Mac also:

```sh
brew install ffmpeg
```

Alternativ im Hinweisbalken „ffmpeg auswählen …“ und den Pfad von Hand setzen.

## Qualitätsstufen

| Auswahl | Format | Hinweis |
|---|---|---|
| Beste (überall abspielbar) | H.264 + AAC → mp4 | läuft nativ in QuickTime, dafür max. 1080p |
| Maximum (bis 4K) | bestes Video + bester Ton → mp4 | kann VP9/AV1 sein — dann VLC oder IINA nutzen |
| 720p — klein | Höhe ≤ 720 → mp4 | |
| Nur Ton (MP3) | MP3 mit Cover und Metadaten | braucht ffmpeg |

Dateiname: `Titel [Video-ID].mp4`. Die ID verhindert Namenskollisionen und lässt
dich das Ursprungsvideo später wiederfinden.

Playlist-Links laden standardmäßig **nur das eine Video**. Für die ganze Liste
den Haken „Ganze Playlist“ setzen.

## Knopf in Firefox

Die Erweiterung in `firefox/` legt auf jeder YouTube-Videoseite einen Knopf
**Laden ▾** an. Das Menü dahinter hat die vier Qualitätsstufen; ein Klick
schickt den Link an die laufende App.

Danach zeigt der Knopf selbst, wie es steht — er fragt die App im Takt nach
dem Stand des Auftrags:

```
Laden ▾  →  Sende …  →  Wartet …  →  41 %  →  Zusammenfügen …  →  Fertig!
```

Während des Ladens füllt er sich von links nach rechts mit. Nach *Fertig!*
springt er von selbst auf *Laden ▾* zurück. Fehler aus der App stehen direkt
auf dem Knopf, etwa *Skrizzle antwortet nicht auf Port 7337*.

### Einrichten

1. In Skrizzle den Abschnitt **Knopf in Firefox** aufklappen, „Beides kopieren“
   drücken.
2. Erweiterung laden (siehe unten), ihre Einstellungen öffnen, unter
   „Beides auf einmal einfügen“ einfügen, „Übernehmen“.
3. „Verbindung testen“ muss *Verbindung steht* melden.

### Erweiterung laden

Firefox nimmt unsignierte Erweiterungen nicht dauerhaft an. Drei Wege:

| Weg | Haltbarkeit |
|---|---|
| `about:debugging` → Dieser Firefox → Temporäres Add-on laden → `firefox/manifest.json` | bis zum Neustart |
| Developer Edition oder ESR mit `xpinstall.signatures.required=false` in `about:config` | dauerhaft |
| Bei [AMO](https://addons.mozilla.org/developers/) signieren lassen, auch „unlisted“ möglich | dauerhaft |

### Wie die Übergabe abgesichert ist

Skrizzle öffnet eine Annahmestelle auf `127.0.0.1` — erreichbar also nur von
diesem Rechner, aber grundsätzlich von **jeder** Seite im Browser und jedem
lokalen Programm. Deshalb:

- Jede Anfrage braucht den Token aus der App, 128 Bit, zeitkonstant verglichen.
- Nur `http`- und `https`-Links kommen durch. Alles andere ginge ungeprüft an
  yt-dlp weiter.
- Der Token steht nur im Hintergrundteil der Erweiterung, nie im Skript auf der
  YouTube-Seite.
- Lässt sich im Abschnitt **Knopf in Firefox** ganz abschalten.

Nach „Neuer Token“ muss der Wert auch in der Erweiterung neu eingetragen werden.

## Tests

```sh
npm test
```

Prüft die Firefox-Erweiterung gegen eine nachgestellte YouTube-Seite: wo der
Knopf landet, ob er bei verzögert aufgebauter Knopfreihe nachrückt, ob das
Menü auf- und zuklappt, und ob Fortschritt und Fehler richtig ankommen.

YouTube baut sein Menü regelmäßig um. Wenn der Knopf eines Tages falsch sitzt:
in `test/content.test.js` die nachgestellte Struktur an die echte anpassen,
dann zeigt der Test, welche Annahme nicht mehr stimmt.

## Aufbau

```
src/main/settings.js     Einstellungen, liegen in Application Support
src/main/binaries.js     findet yt-dlp/ffmpeg, lädt yt-dlp bei Bedarf nach
src/main/downloader.js   ruft yt-dlp auf, liest den Fortschritt aus
src/main/server.js       Annahmestelle für den Browser-Knopf (127.0.0.1)
test/content.test.js     Tests der Erweiterung gegen eine nachgestellte Seite
src/main/main.js         Fenster, Warteschlange, IPC
src/main/preload.js      abgeschottete Brücke zum UI
src/renderer/            die Oberfläche
scripts/dev.js           Starter (siehe unten)
firefox/                 die Firefox-Erweiterung
```

### Zwei Stolpersteine, die schon eingebaut sind

**`ELECTRON_RUN_AS_NODE`** — ist diese Variable gesetzt (etwa wenn der Aufrufer
selbst eine Electron-App ist), startet `electron .` nur einen Node-Prozess und
`require('electron')` liefert kein `ipcMain`. `scripts/dev.js` entfernt sie.

**Nackte `PATH` im Finder** — eine aus dem Finder gestartete App kennt
`/opt/homebrew/bin` nicht. `binaries.js` sucht die üblichen Orte deshalb selbst ab,
statt sich auf `PATH` zu verlassen.

## Bauen

```sh
npm run dist:mac    # .dmg für Apple Silicon
npm run dist:win    # .exe-Installer
```

Legst du Binaries in `vendor/mac/` bzw. `vendor/win/`, werden sie ins Paket
übernommen und bevorzugt benutzt — dann braucht der Rechner weder Homebrew
noch einen Nachladeschritt.

Die App ist ad-hoc signiert, nicht notarisiert. Auf dem eigenen Mac läuft sie
direkt; auf anderen Macs beim ersten Start Rechtsklick → Öffnen. Für eine
saubere Weitergabe wären Developer-ID-Signierung und Notarisierung nötig.

## Rechtliches

Für eigene Videos, CC-lizenzierte Inhalte und Material mit Download-Erlaubnis
unproblematisch. YouTubes AGB untersagen das Herunterladen generell; was du
damit machst, liegt bei dir.
