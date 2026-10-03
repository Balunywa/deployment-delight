# Install Cloud Delivery on your PC

Cloud Delivery runs on your Windows PC. Your customers, context and engagements stay on your PC. You share them with
your team through a Microsoft Teams team's files, so nothing goes to a separate cloud service.

## What you need

- Windows 10 or 11, x64 or ARM64.
- **msx-mcp** in your home folder as `msx-mcp`
  ([github.com/mcaps-microsoft/msx-mcp](https://github.com/mcaps-microsoft/msx-mcp), with your Microsoft EMU account).
  Cloud Delivery reads MSX through it, as you.
- **Azure CLI** (`az`). MSX sign-in and team sharing use the Azure CLI profile that msx-mcp signs in with. Azure
  calls and deployments use your normal `az login`.
- Corporate VPN on when you read MSX.

You don't need Node.js: the app brings its own.

## Install

The installers are in this repository's GitHub Releases. The repository is private: ask Lukman Balunywa to add your
GitHub account before you download.

1. Open the latest release of this repository and download the installer for your PC:
   - `CloudDelivery-<version>-arm64-setup.exe` for ARM64 PCs (for example Surface Pro with Snapdragon)
   - `CloudDelivery-<version>-x64-setup.exe` for every other PC
2. Run it. It installs for you only, without admin rights. The `.msi` is for IT-managed installs.
3. Windows may warn that the publisher is unknown, because the installer isn't code-signed yet. Choose
   **More info → Run anyway**. You can check a download against `SHA256SUMS.txt` in the release, and its build
   provenance with `gh attestation verify <file> --repo Balunywa/deployment-delight`.
4. Start **Cloud Delivery** from the Start menu.

The first start takes a little longer while the app creates your local database.

## Sign in to MSX

Open **Onboard customer** and choose **Sign in to MSX** once. msx-mcp opens your browser for the Microsoft sign-in.
After that, look up customers by TPID.

## Share with your team

**Settings → Team space → Choose a team** lists the Microsoft Teams teams you're a member of. Pick the one your SEs
and CSAs share. Cloud Delivery keeps a folder **Cloud Delivery** in that team's files (SharePoint), with one file per
customer and per engagement:

- Members of the team see each other's customers, context and engagements. Nobody else does: the team's permissions
  apply, and you manage them in Teams.
- The app syncs when it starts, every 10 minutes, and when you click the team name in the header.
- If two people change the same engagement between syncs, the newer change is kept. The older one stays in the
  file's version history in SharePoint.
- Customer context is merged, not replaced: notes from everyone are kept.
- **Stop sharing** leaves your local data and the team's files as they are.

MSX is never changed by syncing.

## Use it from Copilot in VS Code (optional)

While the app is open, Copilot can use it beside msx-mcp (this repository's `.vscode/mcp.json` has both servers):
the `prep-customer` skill looks a TPID up in MSX and records the customer and engagement here.

1. In the app: **Settings → Connect Copilot → Copy token**.
2. In VS Code, start the `cloud-delivery` MCP server and paste the token when it asks.

The app answers Copilot only on `127.0.0.1:47616`, only with that token, and never from a web page.

## Where your data is

| What                                               | Where                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local database (customers, engagements, audit log) | `%LOCALAPPDATA%\CloudDelivery\db`                                                        |
| Logs                                               | `%LOCALAPPDATA%\CloudDelivery\logs\desktop.log`                                          |
| Team space                                         | The chosen team's SharePoint library, folder `Cloud Delivery`                            |
| MSX sign-in                                        | msx-mcp's Azure CLI profile (`%USERPROFILE%\.azure-msx`). Cloud Delivery never stores it |

The app listens on `127.0.0.1` only, on ports chosen at start. Only its own window can use it: every request needs
a session key that only the window gets.

To back up your data, close the app and copy `%LOCALAPPDATA%\CloudDelivery\db`.

## Update

Install the newer release over the old one. Your data stays.

## Uninstall

**Settings → Apps → Cloud Delivery → Uninstall**. Your data stays in `%LOCALAPPDATA%\CloudDelivery`. Delete that
folder too if you want it gone.

## If something's wrong

- **"Cloud Delivery couldn't start"**: the message names the problem. Details are in
  `%LOCALAPPDATA%\CloudDelivery\logs\desktop.log` (the previous run is in `desktop.prev.log`).
- **"Already running on this PC"**: Cloud Delivery is already open. Look for its window, or end it in Task Manager.
- **MSX shows "not found"**: msx-mcp isn't at `%USERPROFILE%\msx-mcp`. Download it again from GitHub and unzip it
  there.
- **No teams to choose from**: sign in to MSX first. Team sharing uses the same sign-in.
