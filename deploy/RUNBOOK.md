# Venue machine runbook

How to set up, run and recover the venue machine, from a bare Windows PC to the end of a Fest.
Written so a second Feuerwehr member can follow it without knowing the code.

## What runs where

```text
iPads (window, Wi-Fi) ──HTTPS──▶ Windows PC on the FRITZ!Box, by Ethernet
                                 ├── Docker Desktop
                                 │   └── server   (the shared event log, port 443)
                                 └── pager bridge (Windows service, port 9186, this PC only)
                                       └── USB ── TD186 transmitter ))) pagers
```

- **The venue machine** is a small Windows PC on the first floor, far from the window. It runs the
  sync server in Docker Desktop and the pager bridge as a Windows service. The transmitter is
  plugged into it by USB.
- **The server** holds the event log the iPads share and passes pager calls on to the bridge.
- **The pager bridge** drives the transmitter. It listens only on this PC (loopback and Docker's
  network), never on the venue Wi-Fi. The server reaches it at `BRIDGE_URL`.
- **The iPads** find the server as `kirbe.<DOMAIN>` through public DNS: a public `A` record points
  at the PC's fixed address on the venue network. There is no local DNS server.

Background: the spec [#23](https://github.com/lharzenetter/order-processor/issues/23) and
[ADR 0002](../docs/adr/0002-native-pager-bridge-behind-the-server.md). Terms such as _pager call_,
_transmitter_ and _automatic pager calls_ are defined in [`CONTEXT.md`](../CONTEXT.md).

Placeholders in the commands:

| Placeholder | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `<DOMAIN>`  | the IONOS domain from `.env`; the server's name is `kirbe.<DOMAIN>`         |
| `<VERSION>` | the release, e.g. `0.11.0`: the server image and the bridge always share it |
| `<PC_IP>`   | the PC's fixed IPv4 address on the venue FRITZ!Box, e.g. `192.168.178.2`    |

Everything lives in `C:\kirbe\`: the compose files there, the bridge in `C:\kirbe\bridge\`. All
commands are PowerShell. Open it **as administrator** (right-click → _Run as administrator_)
where a step says so.

## 1. One-time setup

### 1.1 The PC

1. Windows 11 (or Windows 10 22H2), with virtualization enabled in the BIOS. Connect it to the
   FRITZ!Box by **Ethernet**.
2. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) with
   the WSL 2 backend (the default), and restart. `docker version` must show a _Server_ section.
3. Docker Desktop → _Settings → General_: enable _Start Docker Desktop when you sign in to your
   computer_.
4. Docker Desktop runs only while a user is signed in. So that the PC comes back by itself after a
   reboot or power cut, sign that user in automatically with
   [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon): run it,
   enter the user's password, _Enable_. Lock the screen afterwards (`Win+L`); Docker Desktop and
   the containers keep running while locked.
5. Never sleep. As administrator:

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   ```

6. Mark the Ethernet network as private and let the iPads reach port 443. As administrator:

   ```powershell
   Get-NetConnectionProfile                       # note the InterfaceAlias, e.g. Ethernet
   Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private
   New-NetFirewallRule -DisplayName "kirbe https" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Private
   ```

   Port 9186 (the bridge) gets **no** firewall rule, on purpose.

### 1.2 `C:\kirbe\`

Download the deploy files of the release you install. In PowerShell:

```powershell
$v = "<VERSION>"
$base = "https://raw.githubusercontent.com/lharzenetter/order-processor/v$v/deploy"
New-Item -ItemType Directory -Force C:\kirbe\secrets, C:\kirbe\certs | Out-Null
cd C:\kirbe
foreach ($f in "compose.yaml", "env.example", "install-bridge.ps1", "secrets/ionos.env.example") {
  Invoke-WebRequest "$base/$f" -OutFile $f -UseBasicParsing
}
Copy-Item env.example .env
Move-Item secrets\ionos.env.example secrets\ionos.env
```

Fill in `.env` (e.g. `notepad .env`):

| Key            | Value                                                   |
| -------------- | ------------------------------------------------------- |
| `SERVER_TAG`   | `<VERSION>`, the app's current release (never `latest`) |
| `DOMAIN`       | the IONOS domain, e.g. `example.org`                    |
| `PAIRING_CODE` | see 1.4                                                 |
| `BRIDGE_URL`   | leave empty; set it only if 1.8 says so                 |

The event log does not live in `C:\kirbe\`: it is in the Docker volume `kirbe_data`, because
SQLite needs a Linux file system. Section 6 shows how to back it up.

### 1.3 The IONOS API key

lego proves to Let's Encrypt that we own `kirbe.<DOMAIN>` by writing a TXT record through the
IONOS DNS API (DNS-01).

1. Log in at <https://developer.hosting.ionos.de/> with the account that holds the domain, and
   create an API key under _API-Schlüssel_. IONOS shows a **prefix** and a **secret**, the secret
   only once.
2. In `C:\kirbe\secrets\ionos.env`:

   ```sh
   IONOS_API_KEY=<prefix>.<secret>
   LEGO_EMAIL=<an address that should get Let's Encrypt notices>
   ```

3. Make the file readable by your user only:

   ```powershell
   icacls C:\kirbe\secrets\ionos.env /inheritance:r /grant:r "${env:USERNAME}:F"
   ```

The key controls **every** domain in the IONOS account. It lives only in this file on the PC:
never in the repo, a chat or the image. **If the PC is lost or stolen, revoke the key at IONOS
straight away**, then create a new one for the replacement PC.

### 1.4 The pairing code

Choose 8 characters without `0`, `O`, `1`, `l` or `I`, e.g. with

```powershell
-join (1..8 | ForEach-Object { 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[(Get-Random -Maximum 31)] })
```

and put it in `.env` as `PAIRING_CODE`. The server won't start with fewer than 8 characters.

Write it down outside the repo, where the window staff can find it on Fest day:
**_\<where: fill in, e.g. sealed envelope in the kit box and the Feuerwehr password manager\>_**.
Change it only if someone with access leaves or the code leaks. Then every iPad needs the new code
in the Verwaltung.

### 1.5 The venue network and DNS

1. FRITZ!Box: _Heimnetz → Netzwerk_ → the PC → enable _Diesem Netzwerkgerät immer die gleiche
   IPv4-Adresse zuweisen_. That address is `<PC_IP>`.
2. IONOS, under the domain's _DNS_ settings: add an `A` record with host `kirbe` and value
   `<PC_IP>`. The private address is then visible in public DNS; that is accepted.
3. FRITZ!Box: _Heimnetz → Netzwerk → Netzwerkeinstellungen → DNS-Rebind-Schutz_: add
   `kirbe.<DOMAIN>` to the exceptions. Without it, the FRITZ!Box drops answers that point at a
   private address.
4. Put the PC and all iPads on the **same, non-guest** network. Guest clients can't reach the PC.
5. _System → Sicherung_: save a config export and keep it with the kit.
6. Check from the PC or any device on the venue network: `Resolve-DnsName kirbe.<DOMAIN>` (or
   `nslookup kirbe.<DOMAIN>`) prints `<PC_IP>`.

The menu names vary a little between FRITZ!OS versions. The iPads resolve the name through the
FRITZ!Box's internet uplink: **without internet at the venue, they can't find the server** (see
section 5).

### 1.6 The first certificate

The PC needs internet for this, at home or at the venue.

```powershell
cd C:\kirbe
docker compose run --rm lego run
dir certs\certificates            # kirbe.<DOMAIN>.crt and .key are there
```

Then do the expiry check in 2.2.

### 1.7 Start the server

```powershell
cd C:\kirbe
docker compose up -d
docker compose ps                 # server becomes "healthy" within about a minute
```

The server restarts by itself whenever Docker Desktop starts.

### 1.8 The pager bridge

The bridge is a separate program, `order-processor-bridge-<VERSION>.exe`, attached to the same
GitHub release as the server image. `install-bridge.ps1` downloads it to `C:\kirbe\bridge\`,
registers it as the Windows service `order-processor-bridge` (starts at boot without anyone signed
in, restarts 5 s after a crash) and starts it.

1. Plug the transmitter into the PC by USB. Windows normally installs the CH340 driver by itself;
   if the transmitter shows no COM port in the Device Manager, install the CH340 driver from the
   transmitter's vendor. The COM number doesn't matter: the bridge finds the transmitter by its
   heartbeat on any port.
2. As administrator, with the same version as `SERVER_TAG`:

   ```powershell
   cd C:\kirbe
   powershell -ExecutionPolicy Bypass -File .\install-bridge.ps1 -Version <VERSION>
   ```

3. Check the bridge on the PC. Within a few seconds it should answer `connected : True`:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:9186/status
   ```

4. Check that the server reaches the bridge from inside Docker. It should print
   `{"connected":true}`:

   ```powershell
   docker compose exec server node -e "fetch((process.env.BRIDGE_URL || 'http://host.docker.internal:9186') + '/status').then(r => r.text()).then(console.log, console.error)"
   ```

   If step 3 works but this one prints an error, the container can't reach the bridge on the PC's
   loopback. Point it at Docker's network adapter instead:
   1. `ipconfig`: find the adapter named `vEthernet (WSL…)` or `vEthernet (Docker…)` and note its
      IPv4 address.
   2. `Restart-Service order-processor-bridge` (as administrator), so the bridge listens on that
      adapter too; it reads the adapters only when it starts.
   3. In `.env`, set `BRIDGE_URL=http://<that address>:9186`, then `docker compose up -d` and
      repeat step 4.

   That address can change after a Windows update or a Docker Desktop reinstall; the dress
   rehearsal (2.4) checks it again.

The bridge writes to the Windows Event Log (_Event Viewer → Windows Logs → Application_, source
`order-processor-bridge`): when it finds the transmitter (COM port and System ID), when it loses
it, and when two transmitters answer. From PowerShell:

```powershell
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'order-processor-bridge' } -MaxEvents 20
```

The bridge learns the System ID from the transmitter; there is nothing to configure. If the
keypad's Host ID (menu F1) changes, the bridge picks it up after the next reconnect.

To remove the bridge from the PC, see section 8.

### 1.9 Each iPad

1. Open the web app from `https://lharzenetter.github.io/order-processor/` and add it to the Home
   Screen.
2. _Settings → Wi-Fi_ → (i) next to the venue network: turn off _iCloud Private Relay_ if it is
   shown, so the iPad asks the FRITZ!Box for `kirbe.<DOMAIN>`.
3. _Verwaltung → Server_:
   - _Adresse_: `kirbe.<DOMAIN>`, without `https://`.
   - _Kopplungscode_: the pairing code.
   - _Gerätename_: a name, e.g. _Annahme_ or _Ausgabe_.
4. Tap _Verbinden_. It should show _Verbunden. Server hat N Ereignisse._ and then
   _● Verbunden als …_ in the header.
5. _Verwaltung → Sender_ shows _Sender verbunden_.

If the server is empty and the iPad already has events, it asks whether to upload them
(_Hochladen und verbinden_).

A kitchen station iPad is set up the same way, then _Verwaltung → Küchenanzeige…_: tick the dishes
that station cooks and tap _Küchenanzeige zeigen_. It shows only how many plates of each are still
waiting, records nothing, never calls a pager, and comes back as a Küchenanzeige after a restart.
Hold the _Küchenanzeige_ button in its corner to change the Auswahl or end it. Greyed-out numbers
under a red banner are old: the connection is down. _Rückfrage vom Server_ means it must be ended
and the server's question answered on the normal screen.

## 2. Pre-Fest session at home (7–14 days before)

The PC needs internet. The iPads at home reach the server only if the PC gets the same `<PC_IP>`
on the home network and the home router lets that answer through (1.5 step 3). If not, rehearse at
the venue.

### 2.1 Update the server and the bridge

Both always run the same version: the one the iPads run (_Verwaltung → Version_). If the server
and the app don't match, the iPads show _Diese App passt nicht zum Protokoll auf dem Server…_.

1. In `C:\kirbe\.env`, set `SERVER_TAG=<VERSION>`, then:

   ```powershell
   cd C:\kirbe
   docker compose pull server
   docker compose up -d server
   ```

2. Fetch the new release's install script and run it, as administrator. Rerunning it updates the
   bridge in place and removes the old exe once the new one runs:

   ```powershell
   cd C:\kirbe
   Invoke-WebRequest "https://raw.githubusercontent.com/lharzenetter/order-processor/v<VERSION>/deploy/install-bridge.ps1" -OutFile install-bridge.ps1 -UseBasicParsing
   powershell -ExecutionPolicy Bypass -File .\install-bridge.ps1 -Version <VERSION>
   Invoke-RestMethod http://127.0.0.1:9186/status
   ```

If a release changes `compose.yaml` or `env.example`, download those as in 1.2, but keep your
`.env` and add any new keys to it by hand.

### 2.2 Renew the certificate and check it

```powershell
cd C:\kirbe
docker compose run --rm lego renew --days 90
(New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 "C:\kirbe\certs\certificates\kirbe.<DOMAIN>.crt").NotAfter
```

**Accept only if the date is at least the last Fest day + 7.** The running server loads the new
certificate within about 5 seconds, with no restart. The iPads also show the days left in the
header and warn below 14.

### 2.3 Windows updates

Install all pending Windows updates and restart, then _Settings → Windows Update → Pause updates_
until after the Fest, so Windows doesn't restart during it. Check afterwards that the PC comes
back on its own: signed in, Docker Desktop running, `docker compose ps` healthy, the bridge
connected.

### 2.4 Dress rehearsal

With two iPads, one with the web app installed from Safari and one from Chrome:

1. Both _Verbinden_.
2. A tap on one shows up on the other.
3. An undo on one shows up on the other.
4. `docker compose restart server`: both show _Keine Verbindung…_, then reconnect by themselves.
5. The spinner (after 300 ms) and the 4 s no-reply timeout feel right on that Wi-Fi.
6. If a kitchen station gets a Küchenanzeige: a new order shows up on it, and its numbers grey out
   while the server restarts.
7. With the transmitter plugged in: _Verwaltung → Sender_ shows _Sender verbunden_, and a
   _Testruf_ makes the pager vibrate and shows _Pager N gerufen_.

Start the Fest with an empty log: _Verwaltung → Neues Fest starten…_. The server archives the old
log in the `kirbe_data` volume, under `archive/`. A new Fest always starts with _Pager automatisch
rufen_ on.

## 3. Hardware check at the venue

Before each Fest, once the PC, the transmitter and the iPads are set up at the venue, go through
this list, the same way every time:

- [ ] Bridge service finds the transmitter after boot, whatever the COM number. The Verwaltung shows _Sender verbunden_.
- [ ] _Testruf_ to one pager: it vibrates, _Pager N gerufen_.
- [ ] Range: _Testruf_ from the window while someone carries pagers to the far corners of the grounds and behind the building.
- [ ] _Alle Pager rufen_ with a few pagers out of the charging base: those vibrate, the ones in the base don't, _Alle Pager gerufen_.
- [ ] Unplug the USB cable: _Sender getrennt_ within seconds, a buzz shows the staying toast. Plug it back in: the indicator goes away without touching the PC.
- [ ] Reboot the PC: calls work again without anyone logging in.
- [ ] Stop the bridge service: _Sender nicht verbunden_.
- [ ] Buzz, re-buzz and hand on each call the right pager. Undo calls nothing.
- [ ] Switch automatic pager calls off on one iPad: no calls or toasts on any iPad. _Rückgängig_ does not switch them back on.

Notes for the list:

- _Testruf_ is in _Verwaltung → Sender_: enter the pager number under _Testruf an Pager_, tap
  _Rufen_. It records nothing.
- _Alle Pager rufen_ is below it.
  At closing time it finds the pagers not yet returned; while orders are open, it asks first.
  It records nothing.
- Stop and start the bridge as administrator with `Stop-Service order-processor-bridge` and
  `Start-Service order-processor-bridge`. Start it again after that check.
- The buzz checks record real taps: run them before the Fest starts, then start it with an empty
  log (_Neues Fest starten…_, 2.4).
- Switch _Pager automatisch rufen_ back on after the last check.

## 4. Fest day

1. Switch on the PC with the transmitter plugged in. It signs in by itself; Docker Desktop starts
   the server, and the bridge finds the transmitter. `docker compose ps`: server _healthy_.
2. Ready when an iPad shows **● Verbunden als …** and _Verwaltung → Sender_ shows _Sender
   verbunden_.
3. Shut the PC down through the Start menu, not by pulling the plug. A power cut loses no
   confirmed tap, and the iPads catch up after the PC boots, but it can damage Windows or Docker
   Desktop's virtual disk.
4. Each evening: _Verwaltung → Exportieren_ on any iPad, and keep the file off the iPad.
5. To pack the pagers away, put them all in the charging base, then tap _Verwaltung → Sender → Alle Pager ausschalten_ and confirm: every pager in the base turns off (_Pager ausgeschaltet_).
   It always asks first and records nothing; pagers outside the base stay on.
   To turn them back on, unplug the charging base and plug it in again, then take each pager out and put it back.

## 5. When something fails

| Symptom on the iPad                                             | Action                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Keine Verbindung… Tippen gesperrt_ for a few seconds           | Wait. It reconnects by itself.                                                                                                                                                                                                                                                                                            |
| Server stays away                                               | On the PC: is Docker Desktop running? `docker compose ps`, `docker compose logs --tail 50 server`, `docker compose restart server`. If it stays down: on **one** iPad _Verwaltung → Trennen_ and carry on standalone there. The other iPads stop taking taps. A standalone iPad calls no pagers: call them by hand (5.1). |
| _Server nicht erreichbar. Adresse, WLAN und Zertifikat prüfen._ | Check that the iPad is on the right, non-guest Wi-Fi, the _Adresse_ is `kirbe.<DOMAIN>`, the PC is up, and the FRITZ!Box has internet: the name comes from public DNS. Check the DNS-Rebind-Schutz exception (1.5) and _iCloud Private Relay_ (1.9).                                                                      |
| _Kopplungscode falsch_                                          | Enter the code from `.env` in _Verwaltung → Server_.                                                                                                                                                                                                                                                                      |
| Certificate expired                                             | Renew on site over the FRITZ!Box uplink: `docker compose run --rm lego renew --days 90`. Without internet: standalone on one iPad.                                                                                                                                                                                        |
| Server back after standalone                                    | On the standalone iPad, _Verbinden_ again. If the server's log is the start of the iPad's, the iPad uploads the missing events by itself. Otherwise it shows _Anderes Protokoll auf dem Server_: _Exportieren_ first, then decide which log is right.                                                                     |
| _Pager N nicht gerufen_ with _Erneut senden_                    | The transmitter answered "call failed", or nothing within 1 s. Tap _Erneut senden_; it records nothing. If it fails again, call pager N by hand. If every call fails, see 5.1.                                                                                                                                            |
| _Sender nicht verbunden – Pager N von Hand rufen_               | Call pager N by hand now, then see 5.1.                                                                                                                                                                                                                                                                                   |
| _Sender getrennt_ in the header                                 | The transmitter is not connected. See 5.1.                                                                                                                                                                                                                                                                                |

The server's log shows only method, path and status: `docker compose logs server`. The bridge's
log is in the Windows Event Log (1.8).

### 5.1 The transmitter fails

1. On the PC, check the transmitter's USB cable; unplug it and plug it back in. The bridge picks
   it up again within a few seconds, whatever COM port it gets.
2. Check the bridge, as administrator:

   ```powershell
   Get-Service order-processor-bridge            # Status: Running
   Start-Service order-processor-bridge          # if it isn't
   Invoke-RestMethod http://127.0.0.1:9186/status
   ```

   Its Event Log (1.8) says whether it found a transmitter and on which port.

3. If `/status` says `connected : True` but the iPads still show _Sender nicht verbunden_, the
   server can't reach the bridge: run the check in 1.8 step 4.
4. Back to normal when _Verwaltung → Sender_ shows _Sender verbunden_ and a _Testruf_ works.

If it isn't fixed within a few minutes, **fall back to calling by hand**:

1. On any one iPad, _Verwaltung → Sender_: switch off _Pager automatisch rufen_. It applies to every
   iPad at once: buzz, re-buzz and hand on stop calling pagers, and the result toasts and
   _Sender getrennt_ go away. _Rückgängig_ never switches it back on.
2. Window staff carry on as usual on the iPads and call each pager by hand: bring the transmitter
   to the window, power it from a USB-C power supply, and type the pager number on its keypad for
   each buzz, re-buzz and hand on. If the transmitter itself is broken, call the guests some other
   way, e.g. call out the pager number.
3. _Testruf_ and the transmitter status keep working while the switch is off. Once the transmitter
   is back on the PC, _Sender verbunden_ shows and a _Testruf_ works, switch _Pager automatisch
   rufen_ on again.

## 6. After the Fest

Back up the log volume while the server is stopped:

```powershell
cd C:\kirbe
docker compose stop server
docker compose cp server:/data "$HOME\kirbe-data-$(Get-Date -Format yyyy-MM-dd)"
docker compose start server
```

Every file in the backup's `archive\` folder is a normal export and can go back onto an iPad with
_Exportieren und importieren_. The archive is never pruned. Keep the backup off the PC, and pack
the PC, the transmitter with its USB cable, the Ethernet cable and the FRITZ!Box config export into
the kit.

## 7. If the PC is lost

1. Revoke the IONOS API key.
2. Change the pairing code.
3. Set up a new PC from section 1. Before any iPad connects, restore the last backup into the
   volume:

   ```powershell
   cd C:\kirbe
   docker compose stop server
   docker compose cp "<backup folder>\." server:/data
   docker compose run --rm --no-deps --user root server chown -R node:node /data
   docker compose start server
   ```

4. If the new PC has another address, update the IONOS `A` record (1.5).

## 8. Uninstall the bridge

This removes the Windows service and its exe. The server keeps running, but _Verwaltung → Sender_
shows _Sender nicht verbunden_ until a bridge is installed again (1.8).

As administrator:

```powershell
Stop-Service -Name order-processor-bridge -Force
sc.exe delete order-processor-bridge
Remove-Item -Recurse -Force C:\kirbe\bridge
```

Write `sc.exe`, not `sc`: in PowerShell, `sc` is short for `Set-Content`. If `sc.exe delete`
reports that the service is marked for deletion, close the _Services_ window and the Event Viewer,
then sign out and back in. Windows removes the service once nothing holds it open.

The entries the bridge wrote stay in the Windows Event Log. To also remove the bridge as an event
source:

```powershell
[System.Diagnostics.EventLog]::DeleteEventSource('order-processor-bridge')
```

Check that the service is gone. This should print nothing:

```powershell
Get-Service -Name order-processor-bridge -ErrorAction SilentlyContinue
```
