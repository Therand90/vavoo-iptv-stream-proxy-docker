[English](LIBREELEC.md) | [Français](LIBREELEC.fr.md)

# LibreELEC installation without Docker Compose

LibreELEC's Docker add-on provides the Docker engine, but some installations do not include the `docker compose` command. This repository therefore ships a native `/bin/sh` helper that installs, updates, validates and removes the container with ordinary Docker commands.

> [!IMPORTANT]
> The currently published image targets `linux/amd64`. This guide is therefore intended for x86_64 LibreELEC systems such as Intel and AMD mini-PCs. ARM support requires a future multi-architecture image.

## 1. Install Docker and enable SSH

In Kodi, install the **Docker** service from the official LibreELEC add-on repository, then enable SSH in the LibreELEC settings.

Connect to LibreELEC over SSH before continuing.

## 2. Download the helper and configuration

```sh
mkdir -p /storage/docker/vavoo-iptv-stream-proxy
cd /storage/docker/vavoo-iptv-stream-proxy

wget -O libreelec-vavoo.sh \
  https://raw.githubusercontent.com/Therand90/vavoo-iptv-stream-proxy-docker/main/scripts/libreelec-vavoo.sh

wget -O .env.example \
  https://raw.githubusercontent.com/Therand90/vavoo-iptv-stream-proxy-docker/main/.env.example

[ -f .env ] || cp .env.example .env
chmod +x libreelec-vavoo.sh
```

Review `.env` before installation. The safe default publishes the proxy only on `127.0.0.1:8899`.

For a persistent internal HLS-signing secret, generate one once:

```sh
secret="$(head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1)"
sed -i "s|^VAVOO_HLS_PROXY_SECRET=.*|VAVOO_HLS_PROXY_SECRET=$secret|" .env
```

The helper does not execute `.env` as shell code. It passes the complete file to Docker through `--env-file` and parses only the few values needed for port publishing and command-line arguments.

## 3. Install the container

```sh
./libreelec-vavoo.sh install
```

The helper downloads the validated public image, creates the hardened container and waits for the channel catalog to answer before reporting success.

Useful endpoints on the LibreELEC host are:

```text
http://127.0.0.1:8899/countries
http://127.0.0.1:8899/channels.m3u8
http://127.0.0.1:8899/channels.m3u8?country=France
```

## Daily commands

```sh
./libreelec-vavoo.sh status
./libreelec-vavoo.sh logs
./libreelec-vavoo.sh update
```

`update` performs the following guarded sequence:

1. tags the currently running image as a temporary rollback;
2. downloads the latest validated image;
3. recreates the container with the current `.env` settings;
4. waits for `/countries` to answer;
5. restores the previous image automatically if validation fails;
6. removes the temporary rollback and only old unused images produced by this repository after success.

The command does not run a global `docker image prune`, so it does not clean unrelated Docker services.

Updates are not scheduled automatically. Run the `update` command whenever a new image is available or when you want to resynchronize the container.

## Migrating an existing manual container

If an existing container is already named `vavoo-iptv-stream-proxy`, first copy its intended values into the new `.env`, then run:

```sh
./libreelec-vavoo.sh update
```

The helper detects the existing container and uses its current image as the temporary rollback during migration.

A complete inspection can be saved before migration with:

```sh
docker inspect vavoo-iptv-stream-proxy \
  > /storage/vavoo-iptv-stream-proxy.inspect.json
```

## Cleanup and removal

Remove only unused historical images produced by this repository:

```sh
./libreelec-vavoo.sh cleanup
```

Remove the container while preserving `.env` and the helper:

```sh
./libreelec-vavoo.sh uninstall
```

Delete the configuration directory manually only when it is no longer needed.

## Security notes

The helper applies the same main runtime protections as `compose.yaml`:

- loopback-only publishing by default;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- bounded `/tmp` tmpfs;
- PID limit;
- log rotation;
- `unless-stopped` restart policy.

Do not expose the proxy directly to the public Internet. Use the loopback default or a trusted private network such as WireGuard.
