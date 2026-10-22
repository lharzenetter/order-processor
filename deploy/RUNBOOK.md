# Sync server runbook

How to set up, run and recover the sync server on the Pi, from a bare Pi to the end of a Fest.
Written so a second Feuerwehr member can follow it. The decisions behind it are in
`.scratch/server-sync/issues/05-server-host-and-fest-day-setup.md`.

In the commands, `<DOMAIN>` is the IONOS domain from `.env` and the server's name is
`kirbe.<DOMAIN>`. Everything on the Pi lives in `/opt/kirbe/`.

## 1. One-time setup

### 1.1 The Pi

1. Flash Raspberry Pi OS Lite (64-bit) onto the SSD with Raspberry Pi Imager. Set a user, SSH and
   the hostname in the Imager's settings. Boot the Pi from the SSD over USB, not from an SD card.
2. Install Docker and start it at boot:

   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker "$USER"     # log out and back in afterwards
   sudo systemctl enable --now docker
   ```

3. Check that `id -u` prints `1000`. Both the server and lego run as uid 1000. If your user has
   another uid, the `chown` below still makes the directories belong to 1000.

### 1.2 `/opt/kirbe/`

Copy the repo's `deploy/` directory to the Pi:

```sh
# on your laptop, in the repo
scp -r deploy/compose.yaml deploy/env.example deploy/dnsmasq.conf deploy/secrets pi@<pi>:/tmp/kirbe/
```

```sh
# on the Pi
sudo mkdir -p /opt/kirbe && sudo cp -r /tmp/kirbe/. /opt/kirbe/ && cd /opt/kirbe
sudo mkdir -p certs data
sudo cp env.example .env
sudo cp secrets/ionos.env.example secrets/ionos.env && sudo rm secrets/ionos.env.example
sudo chown -R 1000:1000 /opt/kirbe
chmod 0600 secrets/ionos.env
```

Fill in `.env`:

| Key            | Value                                                    |
| -------------- | -------------------------------------------------------- |
| `SERVER_TAG`   | the app's current release, e.g. `0.5.0` (never `latest`) |
| `DOMAIN`       | the IONOS domain, e.g. `example.org`                     |
| `PAIRING_CODE` | see 1.4                                                  |
| `PI_IP`        | the Pi's fixed IP on the venue FRITZ!Box, see 1.5        |

Fill in `dnsmasq.conf`: replace `kirbe.example.org` with `kirbe.<DOMAIN>`, `192.168.178.2` with
`PI_IP`, and `192.168.178.1` with the FRITZ!Box's IP.

### 1.3 The IONOS API key

lego proves to Let's Encrypt that we own `kirbe.<DOMAIN>` by writing a TXT record through the
IONOS DNS API (DNS-01). The name needs **no public A record**, and none should be created.

1. Log in at <https://developer.hosting.ionos.de/> with the account that holds the domain, and
   create an API key under _API-Schlüssel_. IONOS shows a **prefix** and a **secret**, the secret
   only once.
2. In `secrets/ionos.env`:

   ```sh
   IONOS_API_KEY=<prefix>.<secret>
   LEGO_EMAIL=<an address that should get Let's Encrypt notices>
   ```

The key controls **every** domain in the IONOS account. It lives only in this file on the Pi:
never in the repo, a chat or the image. **If the Pi is lost or stolen, revoke the key at IONOS
straight away**, then create a new one for the replacement Pi.

### 1.4 The pairing code

Choose 8 characters without `0`, `O`, `1`, `l` or `I`, e.g. with
`tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' </dev/urandom | head -c 8; echo`, and put it in `.env`
as `PAIRING_CODE`. The server won't start with fewer than 8 characters.

Write it down outside the repo, where the window staff can find it on Fest day:
**_\<where: fill in, e.g. sealed envelope in the kit box and the Feuerwehr password manager\>_**.
Change it only if someone with access leaves or the code leaks. Then every iPad needs the new code
in the Verwaltung.

### 1.5 The venue FRITZ!Box

1. Connect the Pi to the FRITZ!Box by **Ethernet**.
2. _Heimnetz → Netzwerk_ → the Pi → enable _Diesem Netzwerkgerät immer die gleiche IPv4-Adresse
   zuweisen_. That address is `PI_IP`.
3. _Heimnetz → Netzwerk → Netzwerkeinstellungen → IP-Adressen_:
   - _IPv4-Einstellungen_: set _Lokaler DNS-Server_ to `PI_IP`.
   - _IPv6-Einstellungen_: also hand out the Pi as the local DNS server. If IPv6 still points at
     the FRITZ!Box, iPads ask it instead and can't find `kirbe.<DOMAIN>`.
4. Put the Pi and all iPads on the **same, non-guest** network. Guest clients can't reach the Pi,
   and the local DNS setting doesn't apply there.
5. _System → Sicherung_: save a config export and keep it with the kit.

The menu names vary a little between FRITZ!OS versions.

### 1.6 The first certificate

The Pi needs internet for this, at home or at the venue.

```sh
cd /opt/kirbe
docker compose run --rm lego run
ls certs/certificates/            # kirbe.<DOMAIN>.crt and .key are there
```

Then do the `notAfter` check in 2.2.

### 1.7 Start

```sh
docker compose up -d              # server + dnsmasq
docker compose ps                 # server becomes "healthy" within about a minute
```

`dnsmasq` binds to `PI_IP` on port 53, so it starts only on the venue network, where the Pi has
that address. On any other network, start just the server with `docker compose up -d server`.

### 1.8 Each iPad

1. Open the web app from `https://lharzenetter.github.io/order-processor/` and add it to the Home
   Screen.
2. _Verwaltung → Server_:
   - _Adresse_: `kirbe.<DOMAIN>`, without `https://`.
   - _Kopplungscode_: the pairing code.
   - _Gerätename_: a name, e.g. _Annahme_ or _Ausgabe_.
3. Tap _Verbinden_. It should show _Verbunden. Server hat N Ereignisse._ and then
   _● Verbunden als …_ in the header.

If the server is empty and the iPad already has events, it asks whether to upload them
(_Hochladen und verbinden_).

## 2. Pre-Fest session at home (7–14 days before)

The Pi needs internet. iPads at home can reach the server only if the home router also hands
out the Pi as local DNS. If not, rehearse at the venue.

### 2.1 Bump the image

1. Set `SERVER_TAG` in `.env` to the version the iPads run (_Verwaltung → Version_). If the server
   and the app don't match, the iPads show _Diese App passt nicht zum Protokoll auf dem Server…_.
2. Pull and restart:

   ```sh
   cd /opt/kirbe && docker compose pull server && docker compose up -d server
   ```

### 2.2 Renew the certificate and check it

```sh
docker compose run --rm lego renew --days 90
openssl x509 -enddate -noout -in certs/certificates/kirbe.<DOMAIN>.crt
```

**Accept only if `notAfter` is at least the last Fest day + 7.** The running server loads the new
certificate within about 5 seconds, with no restart. The iPads also show the days left in the
header and warn below 14.

### 2.3 Dress rehearsal

With two iPads, one with the web app installed from Safari and one from Chrome:

1. Both _Verbinden_.
2. A tap on one shows up on the other.
3. An undo on one shows up on the other.
4. `docker compose restart server`: both show _Keine Verbindung…_, then reconnect by themselves.
5. The spinner (after 300 ms) and the 4 s no-reply timeout feel right on that Wi-Fi.

Start the Fest with an empty log: _Verwaltung → Neues Fest starten…_. The server archives the old
log in `data/archive/`.

## 3. Fest day

1. Set up the Pi on Ethernet at the FRITZ!Box, then `docker compose up -d` (it also starts by
   itself after power-on). `docker compose ps`: server _healthy_, dnsmasq _running_.
2. Ready when an iPad shows **● Verbunden als …**.
3. Pulling the Pi's plug is allowed: no confirmed tap is lost, and the iPads catch up after it
   boots.
4. Each evening: _Verwaltung → Exportieren_ on any iPad, and keep the file off the iPad.

## 4. When something fails

| Symptom on the iPad                                             | Action                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Keine Verbindung… Tippen gesperrt_ for a few seconds           | Wait. It reconnects by itself.                                                                                                                                                                                                                        |
| Server stays away                                               | On the Pi: `docker compose ps`, `docker compose logs --tail 50 server`, `docker compose restart server`. If it stays down: on **one** iPad _Verwaltung → Trennen_ and carry on standalone there. The other iPads stop taking taps.                    |
| _Server nicht erreichbar. Adresse, WLAN und Zertifikat prüfen._ | Check that the iPad is on the right, non-guest Wi-Fi, the _Adresse_ is `kirbe.<DOMAIN>`, the Pi is up, and dnsmasq is running (`docker compose ps`). Check the FRITZ!Box DNS settings (1.5).                                                          |
| _Kopplungscode falsch_                                          | Enter the code from `.env` in _Verwaltung → Server_.                                                                                                                                                                                                  |
| Certificate expired                                             | Renew on site over the FRITZ!Box uplink: `docker compose run --rm lego renew --days 90`. Without internet: standalone on one iPad.                                                                                                                    |
| Server back after standalone                                    | On the standalone iPad, _Verbinden_ again. If the server's log is the start of the iPad's, the iPad uploads the missing events by itself. Otherwise it shows _Anderes Protokoll auf dem Server_: _Exportieren_ first, then decide which log is right. |

The server's log shows only method, path and status: `docker compose logs server`.

## 5. After the Fest

```sh
cd /opt/kirbe
docker compose stop server
tar czf ~/kirbe-data-$(date +%F).tar.gz data    # then copy it home, e.g. with scp
docker compose start server
```

Every file in `data/archive/` is a normal export and can go back onto an iPad with
_Exportieren und importieren_. The archive is never pruned. Pack the Pi, the SSD, the Ethernet
cable and the FRITZ!Box config export into the kit.

## 6. If the Pi is lost

1. Revoke the IONOS API key.
2. Change the pairing code.
3. Set up a new Pi from section 1 and restore the last `data/` backup into `/opt/kirbe/data/`
   (owned by uid 1000).
