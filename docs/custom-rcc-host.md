# LuckyBlox external RCC host

The website can stay on Render while a separate **Windows** machine runs the
bundled RCC process. `tools/rcc-host-worker.js` polls the website for join
requests and starts an RCC process for each requested place. It waits until RCC
opens its TCP port, then registers the public host and port with the website.
Each running server is reused for that place until full; empty instances stop
after 10 minutes. Capacity is bounded by `LUCKYBLOX_HOST_MAX_SERVERS`.

This is a deployment path, not a hosted machine: you still need a Windows cloud
VM that allows inbound game traffic. GitHub Pages and GitHub Actions cannot run
this persistent worker or accept player game connections. The worker does not
turn a Render Linux container into a Windows host.

## Configure the website

Set `LUCKYBLOX_HOST_TOKEN` in the Render service environment to a randomly
generated secret of at least 32 characters. Keep it private. The registration,
heartbeat, and close APIs reject calls without this bearer token.

## Configure a Windows VM

1. Deploy or clone the same LuckyBlox repository on a Windows cloud VM and
   install Node.js 18 or newer. Make sure
   `Clients/2021E/RCCService/RobloxPlayerBeta.exe` and its neighboring files are
   present.
2. Configure these environment variables on the VM:

   - `LUCKYBLOX_HOST_SITE_URL=https://luckyblox-server.onrender.com`
   - `LUCKYBLOX_HOST_TOKEN` — the exact secret configured on Render
   - `GAME_SERVER_IP` — the VM's public DNS name or public IPv4 address
   - `GAME_SERVER_PORT=53640` — first RCC listening port; additional instances
     use consecutive ports
   - `LUCKYBLOX_HOST_MAX_SERVERS=10` — maximum simultaneous RCC instances. Tune
     this to the VM's CPU and memory; it is not unlimited.
   - `LUCKYBLOX_HOST_PLACES` — optional comma-separated places to warm-start.
     Leave it unset for on-demand hosting of any requested place; it is not an
     allowlist.
   - `LUCKYBLOX_HOST_PUBLIC_PORTS` — optional comma-separated public ports, one
     per server slot, for a TCP tunnel. Leave unset when public and local ports
     are identical.
   - optionally `LUCKYBLOX_HOST_MAX_PLAYERS=20`
3. Allow inbound traffic on the configured game port range in both the VM's
   firewall and the cloud provider's network rules. The website cannot open
   ports on the VM for you. For direct public hosting, players connect to the
   VM's public address, not Render; open the full configured port range.
4. Run `npm run start:host` and keep it running as a Windows service or
   supervised process. On shutdown it unregisters its jobs; if it crashes,
   registrations expire after one minute without a heartbeat.
5. A player's first join request queues that place on the Windows host. RCC
   starts automatically, and the website retries the launch while the instance
   is starting (up to two minutes). If RCC takes longer, retry the Play action.
   Check
   `GET /api/servers?placeId=<placeId>` on the website; it lists the VM only
   after RCC has opened the port and the worker has registered it.

The worker validates process startup by checking that RCC opened its TCP port;
that alone does **not** prove that this historical client build can complete a
gameplay handshake through a particular provider's firewall. Test an actual
client join from outside the VM before treating the host as production-ready.
If RCC exits or fails to listen, the worker unregisters the failed instance
instead of advertising a pretend server; a later join can request another try.

## Using a TCP tunnel such as Playit

A tunnel agent (including its Docker deployment) forwards traffic; it does not
provide the Windows machine or run RCC. The RCC process still needs to run on a
Windows host. Configure the tunnel to forward TCP from its public endpoint to
the RCC machine's local game port. Set `GAME_SERVER_IP` to the tunnel's public
hostname, and `LUCKYBLOX_HOST_PUBLIC_PORTS` to one assigned public port per
server slot; RCC itself listens locally on ports starting at `GAME_SERVER_PORT`.
`LUCKYBLOX_GAME_HOST` and `LUCKYBLOX_GAME_PORT` remain supported as legacy
aliases. Confirm that the tunnel product/plan supports raw TCP for arbitrary
game traffic and that the 2021 client can connect through it.
